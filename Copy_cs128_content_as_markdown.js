// ==UserScript==
// @name         cs128.org - Copy selection as Markdown (Shift+Cmd+C)
// @namespace    https://tampermonkey.net/
// @version      0.1.1
// @description  Convert selected content on cs128.org to Markdown and copy to clipboard.
// @match        https://cs128.org/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // Hotkey: Shift + Cmd + C
  const HOTKEY = (e) =>
    e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && e.code === "KeyC";

  // --- Utilities ---
  const isElement = (n) => n && n.nodeType === Node.ELEMENT_NODE;
  const isText = (n) => n && n.nodeType === Node.TEXT_NODE;

  function normalizeMarkdown(md) {
    return (
      md
        .replace(/\u00a0/g, " ")
        // 去掉每行行尾空格，但保留行首缩进
        .replace(/[ \t]+$/gm, "")
        // 把 3+ 个空行压成 2 个空行
        .replace(/\n{3,}/g, "\n\n")
        // 规范段落间 "空白行"
        .replace(/\n[ \t]*\n/g, "\n\n")
        .trimEnd() + "\n"
    );
  }

  function normalizeSpaces(s) {
    return s
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function getSelectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;
    return range;
  }

  function selectionToFragment(range) {
    return range.cloneContents();
  }

  function closest(el, selector) {
    if (!el) return null;
    if (el.closest) return el.closest(selector);
    while (el && el.nodeType === 1) {
      if (el.matches && el.matches(selector)) return el;
      el = el.parentElement;
    }
    return null;
  }

  // --- Ace editor support (cs128 code panes) ---
  function tryCopyAceEditorSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const anchorNode = sel.anchorNode;
    const focusNode = sel.focusNode;

    const anchorEl = isElement(anchorNode)
      ? anchorNode
      : anchorNode?.parentElement;
    const focusEl = isElement(focusNode) ? focusNode : focusNode?.parentElement;

    const aceEl =
      closest(anchorEl, ".ace_editor") || closest(focusEl, ".ace_editor");
    if (!aceEl) return null;

    const aceId = aceEl.id;
    let filename = null;

    const btn = aceEl.closest(".collapse")?.previousElementSibling;
    if (btn && btn.textContent) {
      filename = btn.textContent.trim().replace(/\s+/g, " ");
    }

    let code = null;
    try {
      if (window.ace && aceId) {
        const editor = window.ace.edit(aceId);
        if (editor && typeof editor.getValue === "function") {
          code = editor.getValue();
        }
      }
    } catch (_) {}

    if (!code) {
      const textLayer = aceEl.querySelector(".ace_text-layer");
      if (textLayer) code = textLayer.innerText;
    }

    if (!code) return null;

    const lang = guessLanguageFromFilename(filename) || "text";
    const header = filename ? `// ${filename}\n` : "";
    return `\`\`\`${lang}\n${header}${code.replace(/\s+$/g, "")}\n\`\`\``;
  }

  function guessLanguageFromFilename(filename) {
    if (!filename) return null;
    const m = filename.match(/([A-Za-z0-9._/-]+\.[A-Za-z0-9]+)\s*$/);
    const fn = m ? m[1] : filename;
    const ext = (fn.split(".").pop() || "").toLowerCase();
    const map = {
      cc: "cpp",
      cpp: "cpp",
      cxx: "cpp",
      c: "c",
      h: "cpp",
      hpp: "cpp",
      hh: "cpp",
      hxx: "cpp",
      js: "javascript",
      ts: "typescript",
      py: "python",
      sh: "bash",
      zsh: "zsh",
      md: "markdown",
      yml: "yaml",
      yaml: "yaml",
      json: "json",
      html: "html",
      css: "css",
    };
    return map[ext] || null;
  }

  // --- HTML -> Markdown ---
  function nodeToMarkdown(node, ctx) {
    ctx = ctx || { listStack: [] }; // listStack: [{type:'ul'|'ol', index:number}]

    if (!node) return "";

    if (isText(node)) {
      const t = node.nodeValue || "";
      if (/^\s+$/.test(t)) return " ";
      return t.replace(/\s+/g, " ");
    }

    if (!isElement(node)) return "";

    const tag = node.tagName.toLowerCase();

    if (tag === "script" || tag === "style" || tag === "noscript") return "";
    if (node.getAttribute && node.getAttribute("aria-hidden") === "true")
      return "";

    if (tag === "pre") {
      const codeEl = node.querySelector("code");
      const lang =
        codeEl?.className?.match(/language-([a-z0-9_+-]+)/i)?.[1] || "";
      const text = (codeEl ? codeEl.textContent : node.textContent) || "";
      return `\n\`\`\`${lang}\n${text.replace(/\s+$/g, "")}\n\`\`\`\n`;
    }

    if (tag === "code") {
      if (closest(node, "pre")) return "";
      const text = (node.textContent || "").trim();
      if (!text) return "";
      const longest = (text.match(/`+/g) || []).reduce(
        (m, s) => Math.max(m, s.length),
        0
      );
      const ticks = "`".repeat(Math.max(1, longest + 1));
      return `${ticks}${text}${ticks}`;
    }

    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      const text = normalizeSpaces(node.textContent || "");
      if (!href || /^javascript:/i.test(href)) return text;
      return `[${text || href}](${href})`;
    }

    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag.slice(1), 10);
      const text = normalizeSpaces(node.textContent || "");
      if (!text) return "";
      return `\n${"#".repeat(level)} ${text}\n`;
    }

    if (tag === "p") {
      const inner = childrenToMarkdown(node, ctx);
      const s = normalizeSpaces(inner);
      return s ? `\n${s}\n` : "";
    }

    if (tag === "br") return "  \n";

    if (tag === "em" || tag === "i") {
      const inner = normalizeSpaces(childrenToMarkdown(node, ctx));
      return inner ? `*${inner}*` : "";
    }
    if (tag === "strong" || tag === "b") {
      const inner = normalizeSpaces(childrenToMarkdown(node, ctx));
      return inner ? `**${inner}**` : "";
    }

    // ---- FIXED: Nested list handling ----
    if (tag === "ul" || tag === "ol") {
      const nextStack = ctx.listStack.slice();
      if (tag === "ol") nextStack.push({ type: "ol", index: 1 });
      else nextStack.push({ type: "ul" });

      const inner = childrenToMarkdown(node, { ...ctx, listStack: nextStack });

      // 如果已经在列表内部，不要额外加空行
      if ((ctx.listStack || []).length > 0) {
        return inner || "";
      }

      // 只有顶层列表才前后加空行
      return inner ? `\n${inner}\n` : "";
    }

    if (tag === "li") {
      const stack = ctx.listStack || [];
      const depth = Math.max(0, stack.length - 1);

      // 每级固定 2 空格
      const spaces = "  ";
      const indent = spaces.repeat(depth);

      const currentList = stack.length
        ? stack[stack.length - 1]
        : { type: "ul" };
      let marker = "- ";
      if (currentList.type === "ol") {
        marker = `${currentList.index}. `;
        currentList.index += 1;
      }

      // 子内容统一再 +2 空格
      const childIndent = indent + spaces;

      let inline = "";
      let nested = "";

      for (const child of Array.from(node.childNodes || [])) {
        if (isElement(child)) {
          const t = child.tagName.toLowerCase();
          if (t === "ul" || t === "ol") {
            nested += nodeToMarkdown(child, ctx);
            continue;
          }
        }
        inline += nodeToMarkdown(child, ctx);
      }

      inline = normalizeSpaces(inline);

      // 处理 li 内部换行（对齐到子缩进）
      if (inline.includes("\n")) {
        inline = inline
          .split("\n")
          .map((line, i) => (i === 0 ? line : `${childIndent}${line.trim()}`))
          .join("\n");
      }

      let out = `${indent}${marker}${inline || ""}\n`;

      if (nested && nested.trim()) {
        let n = nested.replace(/\n{3,}/g, "\n\n").trimEnd();
        n = n.replace(/^/gm, childIndent);
        out += `${n}\n`;
      }

      return out;
    }

    if (tag === "blockquote") {
      const inner = normalizeSpaces(childrenToMarkdown(node, ctx));
      if (!inner) return "";
      return `\n> ${inner.replace(/\n/g, "\n> ")}\n`;
    }

    return childrenToMarkdown(node, ctx);
  }

  function childrenToMarkdown(el, ctx) {
    let out = "";
    for (const child of Array.from(el.childNodes || [])) {
      out += nodeToMarkdown(child, ctx);
    }
    return out;
  }

  function fragmentToMarkdown(fragment) {
    const container = document.createElement("div");
    container.appendChild(fragment);

    let md = childrenToMarkdown(container, { listStack: [] });

    // 不要用 normalizeSpaces，它会破坏缩进
    md = normalizeMarkdown(md);

    return md;
  }

  function copyMarkdown(md) {
    if (!md || !md.trim()) return;

    try {
      if (typeof GM_setClipboard === "function") {
        GM_setClipboard(md, { type: "text", mimetype: "text/plain" });
        return;
      }
    } catch (_) {}

    navigator.clipboard?.writeText(md).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = md;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
  }

  function flashToast(text) {
    const div = document.createElement("div");
    div.textContent = text;
    div.style.position = "fixed";
    div.style.right = "16px";
    div.style.bottom = "16px";
    div.style.zIndex = "999999";
    div.style.padding = "10px 12px";
    div.style.borderRadius = "10px";
    div.style.background = "rgba(0,0,0,0.85)";
    div.style.color = "#fff";
    div.style.fontSize = "13px";
    div.style.maxWidth = "60vw";
    div.style.boxShadow = "0 6px 24px rgba(0,0,0,0.25)";
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 1200);
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (!HOTKEY(e)) return;

      const range = getSelectionRange();
      if (!range) {
        flashToast("No selection.");
        return;
      }

      const aceMd = tryCopyAceEditorSelection();
      if (aceMd) {
        copyMarkdown(aceMd.trim() + "\n");
        flashToast("Copied Ace code as Markdown.");
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const frag = selectionToFragment(range);
      const md = fragmentToMarkdown(frag);

      if (!md.trim()) {
        flashToast("Selection produced empty Markdown.");
        return;
      }

      copyMarkdown(md);
      flashToast("Copied selection as Markdown ✅");
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );
})();
