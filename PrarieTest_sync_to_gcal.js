// ==UserScript==
// @name         PrairieTest → Google Calendar Auto-Sync (with UI)
// @namespace    prairie-tools
// @version      2.1
// @description  Automatically and manually syncs PrairieTest exams to Google Calendar
// @match        https://us.prairietest.com/pt*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @author       cicero.elead.apollonius@gmail.com
// @license      GPL
// ==/UserScript==

(function () {
  "use strict";

  // --- CONFIGURATION ---
  // Replace the link below with the one you got from Google Deployment
  const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx3zrIggQJ8n_Qp_nq-NRebt7KUBA3mG4YHkoIek9vXpxsEzcwhflruiX7eKHuNdF10/exec";
  const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 Hour
  // ---------------------

  function parseDuration(text) {
    let hours = 0, minutes = 0;
    const hMatch = text.match(/(\d+)\s*h/);
    const mMatch = text.match(/(\d+)\s*min/);
    if (hMatch) hours = parseInt(hMatch[1]);
    if (mMatch) minutes = parseInt(mMatch[1]);
    return (hours * 60 + minutes) * 60 * 1000;
  }

  function extractExams() {
    const exams = [];
    document.querySelectorAll("li.list-group-item").forEach((li) => {
      const name = li.querySelector('[data-testid="exam"] a')?.innerText.trim();
      const dateEl = li.querySelector('[data-testid="date"] [data-format-date]');
      const dateJson = dateEl?.getAttribute("data-format-date");

      let start = null;
      if (dateJson) {
        try {
          start = new Date(JSON.parse(dateJson).date);
        } catch (e) { console.error("Date parse error:", e); }
      }

      const durationText = li.querySelector(".col-xxl-4, .col-md-6.col-xs-12:last-child")?.innerText || "";
      const duration = parseDuration(durationText);
      const location = li.querySelector('[data-testid="location"]')?.innerText.trim() || "Unknown";

      if (start && name) {
        const end = new Date(start.getTime() + duration);
        exams.push({ name, start: start.toISOString(), end: end.toISOString(), location });
      }
    });
    return exams;
  }

  function syncToGoogle(buttonEl = null) {
    const exams = extractExams();
    if (exams.length === 0) {
        if(buttonEl) buttonEl.textContent = "❌ No exams found";
        return;
    }

    if(buttonEl) {
        buttonEl.textContent = "⏳ Syncing...";
        buttonEl.style.backgroundColor = "#ffc107";
    }

    GM_xmlhttpRequest({
      method: "POST",
      url: GOOGLE_SCRIPT_URL,
      data: JSON.stringify({ exams }),
      headers: { "Content-Type": "application/json" },
      onload: function(response) {
        console.log("PrairieTest: Sync Successful!");
        GM_setValue("last_sync", Date.now());
        if(buttonEl) {
            buttonEl.textContent = "✅ Sync Success!";
            buttonEl.style.backgroundColor = "#28a745";
            setTimeout(() => updateButtonToDefault(buttonEl), 3000);
        }
      },
      onerror: function(err) {
        console.error("PrairieTest: Sync Failed", err);
        if(buttonEl) {
            buttonEl.textContent = "❌ Sync Failed";
            buttonEl.style.backgroundColor = "#dc3545";
            setTimeout(() => updateButtonToDefault(buttonEl), 3000);
        }
      }
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

    // 样式设置
    Object.assign(btn.style, {
        position: "fixed",
        bottom: "20px", // 距离底部 20 像素
        left: "20px",// <--- 这里从 right 改成了 left
        zIndex: "9999",
        padding: "10px 15px",
        border: "none",
        borderRadius: "5px",
        color: "white",
        cursor: "pointer",
        fontWeight: "bold",
        boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
        transition: "all 0.3s ease"
    });

    btn.onclick = () => syncToGoogle(btn);
    document.body.appendChild(btn);
  }

  function checkSync() {
    const lastSync = GM_getValue("last_sync", 0);
    const now = Date.now();

    if (now - lastSync > SYNC_INTERVAL_MS) {
      syncToGoogle();
    }
  }

  window.addEventListener("load", () => {
    createUI();
    checkSync();
    // Check every 5 mins if an hour has passed
    setInterval(checkSync, 5 * 60 * 1000);
  });
})();
