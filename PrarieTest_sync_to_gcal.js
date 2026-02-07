// ==UserScript==
// @name         PrairieTest → Google Calendar Auto-Update
// @namespace    prairie-tools
// @version      2.3
// @description  Extract PrairieTest reservations and sync to the given google calendar. Supports updating existing reservations based on exam name.
// @match        https://us.prairietest.com/pt*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @author       cicero.elead.apollonius@gmail.com
// @license      GPL
// ==/UserScript==

(function () {
  "use strict";

  // --- 配置部分 ---
  const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx3zrIggQJ8n_Qp_nq-NRebt7KUBA3mG4YHkoIek9vXpxsEzcwhflruiX7eKHuNdF10/exec"; // 粘贴你的 Web App URL
  const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 小时自动同步一次
  // ---------------------

  function parseDuration(text) {
    let hours = 0,
      minutes = 0;
    const hMatch = text.match(/(\d+)\s*h/);
    const mMatch = text.match(/(\d+)\s*min/);
    if (hMatch) hours = parseInt(hMatch[1]);
    if (mMatch) minutes = parseInt(mMatch[1]);
    return (hours * 60 + minutes) * 60 * 1000;
  }

  function extractExams() {
    const exams = [];
    document.querySelectorAll("li.list-group-item").forEach((li) => {
      // 提取名称和链接
      const linkEl = li.querySelector('[data-testid="exam"] a');
      const name = linkEl?.innerText.trim();
      const relativeUrl = linkEl?.getAttribute("href") || "";
      const fullUrl = relativeUrl
        ? "https://us.prairietest.com" + relativeUrl
        : "";

      // 提取日期
      const dateEl = li.querySelector(
        '[data-testid="date"] [data-format-date]'
      );
      const dateJson = dateEl?.getAttribute("data-format-date");
      let start = null;
      if (dateJson) {
        try {
          start = new Date(JSON.parse(dateJson).date);
        } catch (e) {
          console.error(e);
        }
      }

      // 提取时长
      const durationText =
        li.querySelector(".col-xxl-4, .col-md-6.col-xs-12:last-child")
          ?.innerText || "";
      const duration = parseDuration(durationText);

      // 提取地点 (去除多余空格和换行)
      const location =
        li
          .querySelector('[data-testid="location"]')
          ?.innerText.trim()
          .replace(/\s+/g, " ") || "Unknown";

      if (start && name) {
        const end = new Date(start.getTime() + duration);
        exams.push({
          name,
          start: start.toISOString(),
          end: end.toISOString(),
          location,
          url: fullUrl,
        });
      }
    });
    return exams;
  }

  function syncToGoogle(buttonEl = null) {
    const exams = extractExams();
    if (exams.length === 0) {
      if (buttonEl) buttonEl.textContent = "❌ No exams found";
      return;
    }

    if (buttonEl) {
      buttonEl.textContent = "⏳ Syncing...";
      buttonEl.style.backgroundColor = "#ffc107";
    }

    GM_xmlhttpRequest({
      method: "POST",
      url: GOOGLE_SCRIPT_URL,
      data: JSON.stringify({ exams }),
      headers: { "Content-Type": "application/json" },
      onload: function (response) {
        console.log("PrairieTest Sync: Success!");
        GM_setValue("last_sync", Date.now());
        if (buttonEl) {
          buttonEl.textContent = "✅ Sync Success!";
          buttonEl.style.backgroundColor = "#28a745";
          setTimeout(() => updateButtonToDefault(buttonEl), 3000);
        }
      },
      onerror: function (err) {
        console.error("PrairieTest Sync: Failed", err);
        if (buttonEl) {
          buttonEl.textContent = "❌ Sync Failed";
          buttonEl.style.backgroundColor = "#dc3545";
          setTimeout(() => updateButtonToDefault(buttonEl), 3000);
        }
      },
    });
  }

  function updateButtonToDefault(btn) {
    btn.textContent = "🔄 Sync to Calendar";
    btn.style.backgroundColor = "#007bff";
  }

  function createUI() {
    if (document.getElementById("pt-sync-btn")) return;
    const btn = document.createElement("button");
    btn.id = "pt-sync-btn";
    updateButtonToDefault(btn);

    Object.assign(btn.style, {
      position: "fixed",
      bottom: "20px",
      left: "20px", // 已移至左下角
      zIndex: "9999",
      padding: "10px 15px",
      border: "none",
      borderRadius: "5px",
      color: "white",
      cursor: "pointer",
      fontWeight: "bold",
      boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
      transition: "all 0.3s ease",
    });

    btn.onclick = () => syncToGoogle(btn);
    document.body.appendChild(btn);
  }

  function checkAutoSync() {
    const lastSync = GM_getValue("last_sync", 0);
    if (Date.now() - lastSync > SYNC_INTERVAL_MS) {
      syncToGoogle();
    }
  }

  window.addEventListener("load", () => {
    createUI();
    checkAutoSync();
    setInterval(checkAutoSync, 5 * 60 * 1000);
  });
})();
