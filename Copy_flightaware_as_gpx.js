// ==UserScript==
// @name         FlightAware - Copy Tracklog as Clean GPX (Cmd+Shift+C)
// @namespace    https://tampermonkey.net/
// @version      0.3.0
// @description  Copy FlightAware tracklog table as a clean GPX 1.1 track. Extra table fields go into per-point <extensions>.
// @match        https://www.flightaware.com/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const HOTKEY = (e) =>
    e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && e.code === "KeyC";

  // 按你的样例，CST 视为 China Standard Time
  const TZ_ABBR_TO_OFFSET = {
    UTC: "+00:00",
    GMT: "+00:00",
    Z: "+00:00",
    CST: "+08:00",
    KST: "+09:00",
    JST: "+09:00",
    HKT: "+08:00",
    SGT: "+08:00",
    ICT: "+07:00",
    EST: "-05:00",
    EDT: "-04:00",
    CDT: "-05:00",
    MDT: "-06:00",
    PDT: "-07:00",
    PST: "-08:00",
  };

  const WEEKDAY_TO_NUM = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  function getStartDateFromUrl() {
    const m = location.pathname.match(/\/history\/(\d{8})\//);
    if (!m) return null;
    const raw = m[1];
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function escapeXml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function text(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function parseNumber(raw) {
    if (raw == null) return null;
    const cleaned = String(raw).replace(/,/g, "").trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function feetToMeters(feet) {
    return feet == null ? null : feet * 0.3048;
  }

  function extractPrimaryVisibleText(cell) {
    if (!cell) return "";
    const medium = cell.querySelector(".show-for-medium-up");
    if (medium && text(medium)) return text(medium);
    return text(cell);
  }

  function capitalize3(s) {
    const x = String(s || "").slice(0, 3).toLowerCase();
    return x.charAt(0).toUpperCase() + x.slice(1);
  }

  function normalizeTime12(t) {
    const s = String(t).trim().toUpperCase().replace(/\s+/g, " ");
    if (/^\d{1,2}:\d{2}\s[AP]M$/.test(s)) {
      return s.replace(/^(\d{1,2}:\d{2}) /, "$1:00 ");
    }
    return s;
  }

  function parseDisplayedTime(cell) {
    const t = extractPrimaryVisibleText(cell);
    const m = t.match(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\b/i);
    if (!m) return null;
    return {
      raw: t,
      weekdayAbbr: capitalize3(m[1]),
      time12: normalizeTime12(m[2]),
    };
  }

  function parseTime12To24(time12) {
    const m = String(time12).match(/^(\d{1,2}):(\d{2}):(\d{2})\s([AP]M)$/);
    if (!m) return null;

    let hh = Number(m[1]);
    const mm = Number(m[2]);
    const ss = Number(m[3]);
    const ampm = m[4];

    if (ampm === "AM") {
      if (hh === 12) hh = 0;
    } else {
      if (hh !== 12) hh += 12;
    }

    return { hh, mm, ss };
  }

  function parseYmd(ymd) {
    const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return {
      year: Number(m[1]),
      month: Number(m[2]),
      day: Number(m[3]),
    };
  }

  function localDateToJsDate(ymd) {
    const p = parseYmd(ymd);
    if (!p) return null;
    return new Date(p.year, p.month - 1, p.day);
  }

  function formatDateYmd(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function nextDateMatchingWeekday(baseYmd, targetWeekdayNum) {
    const d = localDateToJsDate(baseYmd);
    if (!d) return null;
    for (let i = 0; i < 8; i++) {
      if (d.getDay() === targetWeekdayNum) return formatDateYmd(d);
      d.setDate(d.getDate() + 1);
    }
    return null;
  }

  function combineLocalDateTimeAndOffset(ymd, time12, tzAbbr) {
    const t24 = parseTime12To24(time12);
    if (!t24) return null;
    const offset = TZ_ABBR_TO_OFFSET[tzAbbr] || "+00:00";
    return `${ymd}T${pad2(t24.hh)}:${pad2(t24.mm)}:${pad2(t24.ss)}${offset}`;
  }

  function parseCourse(courseText) {
    const t = (courseText || "").trim();
    const m = t.match(/^(\S+)?\s*([0-9]+(?:\.[0-9]+)?)°$/);
    if (!m) {
      return {
        raw: t || null,
        symbol: null,
        degrees: null,
      };
    }
    return {
      raw: t,
      symbol: m[1] || null,
      degrees: Number(m[2]),
    };
  }

  function parseRate(rateCell) {
    const rateText = text(rateCell);
    const img = rateCell ? rateCell.querySelector("img") : null;
    const iconAlt = img ? (img.getAttribute("alt") || "").trim() : "";
    const numMatch = rateText.match(/-?\d[\d,]*/);

    return {
      raw: rateText || null,
      value_fpm: numMatch ? parseNumber(numMatch[0]) : null,
      icon_alt: iconAlt || null,
    };
  }

  function detectHeaderTz(table) {
    const th = table.querySelector("thead tr.thirdHeader th");
    const header = text(th);
    const m = header.match(/\(([^)]+)\)/);
    return m ? m[1].trim() : "UTC";
  }

  function toEpochMs(isoString) {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return null;
    return d.getTime();
  }

  function getTracklogTable() {
    return document.querySelector("#tracklogTable");
  }

  function getTrackName() {
    return document.title.replace(/\s+/g, " ").trim();
  }

  function parseTrackPoints(table, startDateYmd) {
    const headerTz = detectHeaderTz(table);
    const rows = Array.from(table.querySelectorAll("tbody > tr"));

    let lastResolvedDate = startDateYmd;
    let currentFacilitySection = null;
    const points = [];

    for (const row of rows) {
      const cls = row.className || "";

      if (cls.includes("flight_event_facility")) {
        currentFacilitySection = text(row) || null;
        continue;
      }

      if (cls.includes("flight_event") || cls.includes("flight_event_taxi")) {
        continue;
      }

      const cells = Array.from(row.children);
      if (cells.length < 9) continue;

      const [
        timeCell,
        latCell,
        lonCell,
        courseCell,
        ktsCell,
        mphCell,
        feetCell,
        rateCell,
        facilityCell,
      ] = cells;

      const displayed = parseDisplayedTime(timeCell);
      if (!displayed) continue;

      const targetWd = WEEKDAY_TO_NUM[displayed.weekdayAbbr];
      if (targetWd != null) {
        const resolvedYmd = nextDateMatchingWeekday(lastResolvedDate, targetWd);
        if (resolvedYmd) lastResolvedDate = resolvedYmd;
      }

      const isoTime = combineLocalDateTimeAndOffset(
        lastResolvedDate,
        displayed.time12,
        headerTz
      );

      const lat = parseNumber(extractPrimaryVisibleText(latCell));
      const lon = parseNumber(extractPrimaryVisibleText(lonCell));
      if (lat == null || lon == null) continue;

      const course = parseCourse(text(courseCell));
      const speedKts = parseNumber(text(ktsCell));
      const speedMph = parseNumber(text(mphCell));
      const altitudeFeet = parseNumber(extractPrimaryVisibleText(feetCell));
      const altitudeMeters = feetToMeters(altitudeFeet);
      const rate = parseRate(rateCell);
      const facilityText = text(facilityCell) || null;

      points.push({
        lat,
        lon,
        ele: altitudeMeters,
        time: isoTime,
        timestampMs: isoTime ? toEpochMs(isoTime) : null,

        displayedWeekday: displayed.weekdayAbbr,
        displayedTime: displayed.time12,
        headerTz,

        courseRaw: course.raw,
        courseSymbol: course.symbol,
        courseDegrees: course.degrees,

        speedKts,
        speedMph,
        altitudeFeet,
        rateRaw: rate.raw,
        rateFpm: rate.value_fpm,
        rateIconAlt: rate.icon_alt,

        facility: facilityText,
        sourceSection: currentFacilitySection,
      });
    }

    return {
      headerTz,
      points,
    };
  }

  function addNode(arr, tag, value, formatter = null) {
    if (value === null || value === undefined || value === "") return;
    const out = formatter ? formatter(value) : String(value);
    arr.push(`<${tag}>${escapeXml(out)}</${tag}>`);
  }

  function buildGpx(parsed) {
    const trackName = getTrackName();

    const trkptsXml = parsed.points.map((pt) => {
      const lines = [];
      lines.push(`<trkpt lat="${escapeXml(pt.lat)}" lon="${escapeXml(pt.lon)}">`);

      if (pt.ele != null) {
        lines.push(`  <ele>${escapeXml(pt.ele.toFixed(2))}</ele>`);
      }

      if (pt.time) {
        lines.push(`  <time>${escapeXml(pt.time)}</time>`);
      }

      lines.push(`  <extensions>`);
      addNode(lines, "fa:timestampMs", pt.timestampMs);
      addNode(lines, "fa:displayedWeekday", pt.displayedWeekday);
      addNode(lines, "fa:displayedTime", pt.displayedTime);
      addNode(lines, "fa:headerTimezone", pt.headerTz);

      addNode(lines, "fa:courseRaw", pt.courseRaw);
      addNode(lines, "fa:courseSymbol", pt.courseSymbol);
      addNode(lines, "fa:courseDegrees", pt.courseDegrees, (v) => Number(v).toFixed(2));

      addNode(lines, "fa:speedKts", pt.speedKts, (v) => Number(v).toFixed(2));
      addNode(lines, "fa:speedMph", pt.speedMph, (v) => Number(v).toFixed(2));

      addNode(lines, "fa:altitudeFeet", pt.altitudeFeet, (v) => Number(v).toFixed(2));
      addNode(lines, "fa:rateRaw", pt.rateRaw);
      addNode(lines, "fa:rateFpm", pt.rateFpm, (v) => Number(v).toFixed(2));
      addNode(lines, "fa:rateIconAlt", pt.rateIconAlt);

      addNode(lines, "fa:facility", pt.facility);
      addNode(lines, "fa:sourceSection", pt.sourceSection);
      lines.push(`  </extensions>`);
      lines.push(`</trkpt>`);
      return lines.join("\n");
    }).join("\n");

    return `<?xml version="1.0" encoding="utf-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:fa="https://flightaware.com/ns/export/1"
     version="1.1"
     creator="Tampermonkey FlightAware Export">
  <metadata>
    <author />
    <link href="https://www.flightaware.com/" />
  </metadata>
  <trk>
    <name>${escapeXml(trackName)}</name>
    <trkseg>
${indent(trkptsXml, 6)}
    </trkseg>
  </trk>
</gpx>`;
  }

  function indent(s, spaces) {
    const pad = " ".repeat(spaces);
    return String(s)
      .split("\n")
      .map((line) => (line ? pad + line : line))
      .join("\n");
  }

  async function copyTextToClipboard(textToCopy) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
        return true;
      }
    } catch (_) {}

    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(textToCopy, "text");
        return true;
      }
    } catch (_) {}

    const ta = document.createElement("textarea");
    ta.value = textToCopy;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();

    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {
      ok = false;
    }

    document.body.removeChild(ta);
    return ok;
  }

  async function exportTracklogAsGpx() {
    const startDateYmd = getStartDateFromUrl();
    if (!startDateYmd) {
      alert("Could not extract start date from URL. Expected a path like /history/YYYYMMDD/...");
      return;
    }

    const table = getTracklogTable();
    if (!table) {
      alert("Could not find #tracklogTable on this page.");
      return;
    }

    const parsed = parseTrackPoints(table, startDateYmd);
    if (parsed.points.length === 0) {
      alert("No track points found.");
      return;
    }

    const gpx = buildGpx(parsed);
    const ok = await copyTextToClipboard(gpx);

    if (ok) {
      alert(`GPX copied to clipboard.\nStart date: ${startDateYmd}\nTrack points: ${parsed.points.length}`);
    } else {
      alert("Failed to copy GPX to clipboard.");
    }
  }

  window.addEventListener("keydown", async (e) => {
    if (!HOTKEY(e)) return;
    e.preventDefault();
    await exportTracklogAsGpx();
  });
})();
