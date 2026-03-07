// ==UserScript==
// @name         Google Forms - Export current filled responses as JSON
// @namespace    google-productivity
// @version      1.0.0
// @description  Export the current Google Form page responses to a JSON file
// @match        https://docs.google.com/forms/*
// @grant        none
// @run-at       document-idle
// @author       cicero.elead.apollonius@gmail.com
// @license      GPL
// ==/UserScript==

(function () {
  "use strict";

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $$(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function safeText(el) {
    return (el?.textContent || "").replace(/\u00a0/g, " ").trim();
  }

  function sanitizeFilename(name) {
    return (name || "google-form-response")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim();
  }

  function showToast(message, ms = 2200) {
    const old = document.getElementById("tm-gform-export-toast");
    if (old) old.remove();

    const div = document.createElement("div");
    div.id = "tm-gform-export-toast";
    div.textContent = message;

    Object.assign(div.style, {
      position: "fixed",
      right: "16px",
      bottom: "64px",
      zIndex: "1000000",
      background: "rgba(32,33,36,0.95)",
      color: "white",
      padding: "10px 14px",
      borderRadius: "10px",
      fontSize: "13px",
      boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
      maxWidth: "320px",
      lineHeight: "1.4",
    });

    document.body.appendChild(div);
    setTimeout(() => div.remove(), ms);
  }

  function fallbackDownloadText(text, filename) {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function getForm() {
    return $("form#mG61Hd") || $("form");
  }

  function getFormTitle() {
    return safeText($('[role="heading"][aria-level="1"]')) || document.title;
  }

  function getQuestionTitle(block) {
    const heading =
      block.querySelector('[role="heading"][aria-level="3"] .M7eMe') ||
      block.querySelector('[role="heading"][aria-level="3"]');
    return safeText(heading);
  }

  function parseEntryIdsFromDataParams(block) {
    const raw = block.getAttribute("data-params") || "";
    const ids = [...raw.matchAll(/\[\[(\d+),/g)].map(m => m[1]);
    return [...new Set(ids)];
  }

  function getSelectedDropdownValue(block) {
    const selected = block.querySelector(
      '[role="option"][aria-selected="true"][data-value]'
    );
    if (!selected) return null;

    const val = selected.getAttribute("data-value");
    return val !== null && val !== "" ? val : safeText(selected);
  }

  function getTextInputs(block) {
    return $$('input[type="text"], input[type="email"], input[type="number"]', block)
      .map(el => (el.value ?? el.getAttribute("data-initial-value") ?? "").trim())
      .filter(Boolean);
  }

  function getTextareas(block) {
    return $$("textarea", block)
      .map(el => (el.value ?? el.getAttribute("data-initial-value") ?? "").trim())
      .filter(Boolean);
  }

  function getCheckedValues(block) {
    const native = $$('input[type="radio"]:checked, input[type="checkbox"]:checked', block)
      .map(el => (el.value || "").trim())
      .filter(Boolean);

    const ariaBased = $$('[role="radio"][aria-checked="true"], [role="checkbox"][aria-checked="true"]', block)
      .map(el => (el.getAttribute("data-value") || safeText(el) || "").trim())
      .filter(Boolean);

    return [...new Set([...native, ...ariaBased])];
  }

  function extractVisibleAnswer(block) {
    const dropdownValue = getSelectedDropdownValue(block);
    if (dropdownValue !== null) return dropdownValue;

    const all = [
      ...getTextInputs(block),
      ...getTextareas(block),
      ...getCheckedValues(block),
    ].filter(v => v != null && String(v).trim() !== "");

    const unique = [...new Set(all)];

    if (unique.length === 0) return null;
    if (unique.length === 1) return unique[0];
    return unique;
  }

  function collectHiddenEntries(form) {
    const out = {};
    $$('input[type="hidden"][name^="entry."]', form).forEach(input => {
      out[input.name] = input.value ?? "";
    });
    return out;
  }

  function collectMetadata(form) {
    const names = [
      "emailAddress",
      "dlut",
      "fvv",
      "partialResponse",
      "pageHistory",
      "token",
      "tag",
      "fbzx",
      "submissionTimestamp",
      "emailReceipt",
    ];

    const out = {};
    for (const name of names) {
      const el = form.querySelector(`[name="${CSS.escape(name)}"]`);
      if (el) out[name] = el.value ?? "";
    }
    return out;
  }

  function buildQuestionObjects(form) {
    const blocks = $$(".Qr7Oae[role='listitem']", form);
    const hiddenEntries = collectHiddenEntries(form);

    return blocks.map((block, index) => {
      const question = getQuestionTitle(block);
      const entryIds = parseEntryIdsFromDataParams(block);
      const visibleAnswer = extractVisibleAnswer(block);

      const hiddenEntryValues = {};
      for (const id of entryIds) {
        const key = `entry.${id}`;
        if (key in hiddenEntries) {
          hiddenEntryValues[key] = hiddenEntries[key];
        }
      }

      let answer = visibleAnswer;
      if (answer == null) {
        const vals = Object.values(hiddenEntryValues).filter(v => String(v).trim() !== "");
        if (vals.length === 1) answer = vals[0];
        else if (vals.length > 1) answer = vals;
      }

      return {
        index: index + 1,
        question,
        entryIds,
        answer: answer ?? null,
        hiddenEntryValues,
      };
    });
  }

  function exportCurrentFormToJson() {
    try {
      showToast("正在导出 JSON...");
      const form = getForm();

      if (!form) {
        alert("没找到表单。");
        return;
      }

      const title = getFormTitle();
      const metadata = collectMetadata(form);
      const hiddenEntries = collectHiddenEntries(form);
      const questions = buildQuestionObjects(form);

      const payload = {
        exportedAt: new Date().toISOString(),
        url: location.href,
        form: {
          title,
          action: form.action || null,
          method: form.method || null,
          id: form.id || null,
        },
        metadata,
        questions,
        allHiddenEntryFields: hiddenEntries,
      };

      const filename = `${sanitizeFilename(title)}.json`;
      const json = JSON.stringify(payload, null, 2);

      console.log("[TM Export JSON] payload =", payload);
      fallbackDownloadText(json, filename);
      showToast(`已导出：${filename}`);
    } catch (err) {
      console.error("[TM Export JSON] failed:", err);
      alert("导出失败：\n" + (err?.stack || err?.message || String(err)));
    }
  }

  function addButton() {
    if (document.getElementById("tm-google-form-export-json")) return;

    const btn = document.createElement("button");
    btn.id = "tm-google-form-export-json";
    btn.type = "button";
    btn.textContent = "Export JSON";

    Object.assign(btn.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "999999",
      padding: "10px 14px",
      border: "none",
      borderRadius: "10px",
      background: "#1a73e8",
      color: "#fff",
      fontSize: "14px",
      cursor: "pointer",
      boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
    });

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      exportCurrentFormToJson();
    });

    document.body.appendChild(btn);
  }

  function onHotkey(e) {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
    if (cmdOrCtrl && e.shiftKey && !e.altKey && e.code === "KeyJ") {
      e.preventDefault();
      exportCurrentFormToJson();
    }
  }

  function init() {
    addButton();
    window.addEventListener("keydown", onHotkey, true);
  }

  const observer = new MutationObserver(() => {
    addButton();
  });

  window.addEventListener("load", init);
  setTimeout(init, 1000);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
