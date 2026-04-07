// ==UserScript==
// @name         Copy zhihu.com content as markdown
// @namespace    https://tampermonkey.net/
// @version      0.1.2
// @description  Convert selected Zhihu content to Markdown and copy to clipboard.
// @match        https://www.zhihu.com/*
// @match        https://zhuanlan.zhihu.com/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @author       cicero.elead.apollonius@gmail.com
// @license      GPL
// ==/UserScript==

(function () {
  "use strict";

  // Hotkey:
  // macOS: Shift + Cmd + C
  // Windows/Linux: Shift + Ctrl + C
  const HOTKEY = (e) =>
    e.shiftKey &&
    e.code === "KeyC" &&
    ((e.metaKey && !e.ctrlKey) || (!e.metaKey && e.ctrlKey)) &&
    !e.altKey;

  const BLOCK_TAGS = new Set([
    "P", "DIV", "SECTION", "ARTICLE", "FIGURE",
    "UL", "OL", "LI",
    "H1", "H2", "H3", "H4", "H5", "H6",
    "PRE", "BLOCKQUOTE", "TABLE"
  ]);

  function showToast(text) {
    const old = document.getElementById("__zhihu_md_copy_toast__");
    if (old) old.remove();

    const div = document.createElement("div");
    div.id = "__zhihu_md_copy_toast__";
    div.textContent = text;
    Object.assign(div.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: "999999",
      background: "rgba(0,0,0,0.82)",
      color: "#fff",
      padding: "8px 12px",
      borderRadius: "10px",
      fontSize: "13px",
      lineHeight: "1.4",
      boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
      pointerEvents: "none"
    });
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 1800);
  }

  function isElement(n) {
    return n && n.nodeType === Node.ELEMENT_NODE;
  }

  function isText(n) {
    return n && n.nodeType === Node.TEXT_NODE;
  }

  function getClassNameSafe(el) {
    if (!el || !isElement(el)) return "";
    if (typeof el.className === "string") return el.className;
    if (typeof el.getAttribute === "function") return el.getAttribute("class") || "";
    return "";
  }

  function escapeMarkdownInline(text) {
    return text
      .replace(/\r/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/([*_`[\]])/g, "\\$1");
  }

  function normalizeWhitespace(text) {
    return text
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ");
  }

  function normalizeMarkdown(md) {
    return md
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+$/gm, "")
      .trim();
  }

  function getTextContentSafe(node) {
    return normalizeWhitespace(node.textContent || "");
  }

  function getBestImageSrc(img) {
    if (!img) return "";
    return (
      img.getAttribute("data-original") ||
      img.getAttribute("data-actualsrc") ||
      img.getAttribute("data-src") ||
      img.getAttribute("src") ||
      ""
    ).trim();
  }

  function getAnchorHref(a) {
    let href = (a.getAttribute("href") || "").trim();
    if (!href) return "";
    if (href.startsWith("//")) href = "https:" + href;
    return href;
  }

  function isZhidaZhihuUrl(url) {
    if (!url) return false;
    try {
      const u = new URL(url, location.href);
      return u.hostname === "zhida.zhihu.com";
    } catch {
      return /(?:^|\/\/)zhida\.zhihu\.com(?:\/|$)/i.test(url);
    }
  }

  function isZhihuNoiseElement(el) {
    if (!isElement(el)) return false;

    const cls = getClassNameSafe(el);
    const txt = getTextContentSafe(el);

    if (
      cls.includes("ContentItem-actions") ||
      cls.includes("RichContent-actions") ||
      cls.includes("Sticky") ||
      cls.includes("FollowButton") ||
      cls.includes("VoteButton") ||
      cls.includes("Reward") ||
      cls.includes("ModalLoading") ||
      cls.includes("Comments") ||
      cls.includes("ContentItem-time") ||
      cls.includes("AuthorInfo") ||
      cls.includes("ContentItem-meta")
    ) {
      return true;
    }

    if (
      /^已赞同\b/.test(txt) ||
      /条评论$/.test(txt) ||
      txt === "收藏" ||
      txt === "喜欢" ||
      txt === "分享" ||
      txt === "收起" ||
      txt === "关注" ||
      txt === "送礼物"
    ) {
      return true;
    }

    return false;
  }

  function closestMeaningfulBlock(node, root) {
    let cur = isText(node) ? node.parentNode : node;
    while (cur && cur !== root) {
      if (
        isElement(cur) &&
        (
          BLOCK_TAGS.has(cur.tagName) ||
          cur.classList?.contains("RichText") ||
          cur.classList?.contains("ztext") ||
          cur.classList?.contains("RichContent-inner")
        )
      ) {
        return cur;
      }
      cur = cur.parentNode;
    }
    return root;
  }

  function rangeIntersectsNode(range, node) {
    try {
      return range.intersectsNode(node);
    } catch {
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(node);
      return !(
        range.compareBoundaryPoints(Range.END_TO_START, nodeRange) <= 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0
      );
    }
  }

  function collectTopLevelSelectedBlocks(range) {
    const common = range.commonAncestorContainer;
    const root = isElement(common) ? common : common.parentNode;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!rangeIntersectsNode(range, node)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const blocks = [];
    const seen = new Set();

    let node = walker.currentNode;
    while (node) {
      if (isText(node) && node.nodeValue.trim()) {
        const block = closestMeaningfulBlock(node, root);
        if (block && !seen.has(block)) {
          seen.add(block);
          blocks.push(block);
        }
      } else if (isElement(node) && BLOCK_TAGS.has(node.tagName)) {
        const block = closestMeaningfulBlock(node, root);
        if (block && !seen.has(block)) {
          seen.add(block);
          blocks.push(block);
        }
      }
      node = walker.nextNode();
    }

    return blocks.filter((b, i) => {
      return !blocks.some((other, j) => j !== i && other.contains(b));
    });
  }

  function selectionToFragment() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

    const range = sel.getRangeAt(0);
    const fragment = document.createDocumentFragment();
    const blocks = collectTopLevelSelectedBlocks(range);

    if (blocks.length === 0) {
      const div = document.createElement("div");
      div.appendChild(range.cloneContents());
      fragment.appendChild(div);
      return fragment;
    }

    for (const block of blocks) {
      fragment.appendChild(block.cloneNode(true));
    }
    return fragment;
  }

  function convertChildren(node, ctx = {}) {
    let out = "";
    for (const child of Array.from(node.childNodes)) {
      out += convertNode(child, ctx);
    }
    return out;
  }

  function convertList(el, ordered, depth = 0) {
    let out = "";
    const items = Array.from(el.children).filter((c) => c.tagName === "LI");

    items.forEach((li, idx) => {
      const marker = ordered ? `${idx + 1}. ` : "- ";
      const body = convertChildren(li, { listDepth: depth + 1 }).trim();
      const lines = body.split("\n");
      if (!lines.length) return;

      out += `${"  ".repeat(depth)}${marker}${lines[0]}\n`;
      for (let i = 1; i < lines.length; i++) {
        out += `${"  ".repeat(depth + 1)}${lines[i]}\n`;
      }
    });

    return out + "\n";
  }

  function convertPre(el) {
    const code = el.innerText.replace(/\n$/, "");
    return `\n\`\`\`\n${code}\n\`\`\`\n\n`;
  }

  function convertFigure(el) {
    const img = el.querySelector("img");
    const captionEl = el.querySelector("figcaption");
    const src = getBestImageSrc(img);
    const alt = img ? (img.getAttribute("alt") || "").trim() : "";
    const caption = captionEl ? getTextContentSafe(captionEl).trim() : "";

    let out = "";
    if (src) out += `![${escapeMarkdownInline(alt || caption)}](${src})\n`;
    if (caption) out += `*${escapeMarkdownInline(caption)}*\n`;
    return out ? "\n" + out + "\n" : "";
  }

  function convertTable(el) {
    const rows = Array.from(el.querySelectorAll("tr"));
    if (!rows.length) return "";

    const matrix = rows.map((tr) =>
      Array.from(tr.children).map((cell) =>
        normalizeWhitespace(cell.innerText || "")
          .replace(/\|/g, "\\|")
          .trim()
      )
    );

    const colCount = Math.max(...matrix.map((r) => r.length), 0);
    if (colCount === 0) return "";

    const padded = matrix.map((row) => {
      const copy = row.slice();
      while (copy.length < colCount) copy.push("");
      return copy;
    });

    const header = padded[0];
    const sep = new Array(colCount).fill("---");
    const body = padded.slice(1);

    let out = `| ${header.join(" | ")} |\n`;
    out += `| ${sep.join(" | ")} |\n`;
    for (const row of body) {
      out += `| ${row.join(" | ")} |\n`;
    }
    return "\n" + out + "\n";
  }

  function convertNode(node, ctx = {}) {
    if (!node) return "";

    if (isText(node)) {
      return escapeMarkdownInline(node.nodeValue || "");
    }

    if (!isElement(node)) return "";

    const tag = node.tagName;

    if (tag === "SVG" || tag === "NOSCRIPT" || tag === "BUTTON" || tag === "META") {
      return "";
    }

    if (isZhihuNoiseElement(node)) return "";

    if (
      tag === "SPAN" &&
      node.classList &&
      (
        node.classList.contains("highlight-wrap") ||
        node.classList.contains("css-z4ujak")
      )
    ) {
      return convertChildren(node, ctx);
    }

    switch (tag) {
      case "DIV": {
        if (
          node.classList?.contains("RichContent-inner") ||
          node.classList?.contains("RichText") ||
          node.classList?.contains("ztext") ||
          node.id === "content"
        ) {
          return convertChildren(node, ctx);
        }

        const inner = convertChildren(node, ctx).trim();
        return inner ? inner + "\n\n" : "";
      }

      case "P": {
        const inner = convertChildren(node, ctx).trim();
        return inner ? inner + "\n\n" : "";
      }

      case "BR":
        return "  \n";

      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const level = Number(tag.slice(1));
        const text = convertChildren(node, ctx).trim();
        return text ? `${"#".repeat(level)} ${text}\n\n` : "";
      }

      case "STRONG":
      case "B": {
        const inner = convertChildren(node, ctx).trim();
        return inner ? `**${inner}**` : "";
      }

      case "EM":
      case "I": {
        const inner = convertChildren(node, ctx).trim();
        return inner ? `*${inner}*` : "";
      }

      case "A": {
        const href = getAnchorHref(node);
        const text = convertChildren(node, ctx).trim() || href;

        if (!href) return text;

        if (isZhidaZhihuUrl(href)) {
          return text;
        }

        return `[${text}](${href})`;
      }

      case "CODE": {
        if (node.parentElement && node.parentElement.tagName === "PRE") {
          return node.textContent || "";
        }
        const text = (node.textContent || "").replace(/`/g, "\\`");
        return text ? `\`${text}\`` : "";
      }

      case "PRE":
        return convertPre(node);

      case "BLOCKQUOTE": {
        const inner = convertChildren(node, ctx).trim();
        if (!inner) return "";
        return inner
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n";
      }

      case "UL":
        return convertList(node, false, ctx.listDepth || 0);

      case "OL":
        return convertList(node, true, ctx.listDepth || 0);

      case "LI": {
        const inner = convertChildren(node, ctx).trim();
        return inner ? `- ${inner}\n` : "";
      }

      case "FIGURE":
        return convertFigure(node);

      case "IMG": {
        const src = getBestImageSrc(node);
        if (!src) return "";
        const alt = (node.getAttribute("alt") || "").trim();
        return `![${escapeMarkdownInline(alt)}](${src})`;
      }

      case "FIGCAPTION": {
        const inner = convertChildren(node, ctx).trim();
        return inner ? `*${inner}*` : "";
      }

      case "TABLE":
        return convertTable(node);

      case "HR":
        return "\n---\n\n";

      default:
        return convertChildren(node, ctx);
    }
  }

  function fragmentToMarkdown(fragment) {
    const wrapper = document.createElement("div");
    wrapper.appendChild(fragment.cloneNode(true));
    const md = convertChildren(wrapper, {});
    return normalizeMarkdown(md);
  }

  async function copyMarkdownFromSelection() {
    console.log("[Zhihu Markdown Copy] hotkey triggered");

    const fragment = selectionToFragment();
    if (!fragment) {
      showToast("没有检测到选中内容");
      console.log("[Zhihu Markdown Copy] no selection");
      return;
    }

    const markdown = fragmentToMarkdown(fragment);
    if (!markdown.trim()) {
      showToast("选中内容无法转换");
      console.log("[Zhihu Markdown Copy] markdown empty");
      return;
    }

    GM_setClipboard(markdown, "text");
    showToast("Markdown 已复制");
    console.log("[Zhihu Markdown Copy] copied markdown:");
    console.log(markdown);
  }

  document.addEventListener("keydown", async (e) => {
    if (!HOTKEY(e)) return;

    const target = e.target;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
    const editable =
      target &&
      (target.isContentEditable || tag === "input" || tag === "textarea");

    if (editable) return;

    e.preventDefault();
    e.stopPropagation();

    try {
      await copyMarkdownFromSelection();
    } catch (err) {
      console.error("[Zhihu Markdown Copy] Failed:", err);
      showToast("复制失败，查看控制台");
    }
  }, true);

  showToast("Zhihu Markdown 脚本已加载");
  console.log("[Zhihu Markdown Copy] Loaded.");
})();
