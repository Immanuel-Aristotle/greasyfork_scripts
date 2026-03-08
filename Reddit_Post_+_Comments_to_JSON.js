// ==UserScript==
// @name         Reddit Post + Comments to JSON
// @namespace    https://tampermonkey.net/
// @version      0.1.0
// @description  Download current Reddit post and loaded comments as JSON.
// @match        https://www.reddit.com/r/*/comments/*
// @match        https://reddit.com/r/*/comments/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const BUTTON_ID = "tm-reddit-json-download-btn";

  function textOfNodeClean(node) {
    if (!node) return "";

    const clone = node.cloneNode(true);

    // 删掉常见的翻译插件/沉浸式翻译注入内容
    clone.querySelectorAll([
      "script",
      "style",
      "noscript",
      "font.notranslate",
      ".notranslate",
      ".immersive-translate-target-wrapper",
      ".immersive-translate-target-translation-block-wrapper",
      ".immersive-translate-target-translation-inline-wrapper",
      "[data-immersive-translate-translation-element-mark]"
    ].join(",")).forEach(el => el.remove());

    const text = clone.textContent || "";
    return text.replace(/\u00A0/g, " ").replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").replace(/[ \t]+/g, " ").trim();
  }

  function getTimeInfoFromElement(root) {
    const t = root?.querySelector("time");
    if (!t) return { datetime: null, title: null, relative: null };
    return {
      datetime: t.getAttribute("datetime"),
      title: t.getAttribute("title"),
      relative: (t.textContent || "").trim() || null
    };
  }

  function absoluteUrl(url) {
    if (!url) return null;
    try {
      return new URL(url, location.origin).href;
    } catch {
      return url;
    }
  }

  function parsePost() {
    const postEl = document.querySelector("shreddit-post");
    if (!postEl) return null;

    const titleEl =
      postEl.querySelector('h1[slot="title"]') ||
      postEl.querySelector("h1");

    const bodyEl =
      postEl.querySelector('shreddit-post-text-body [property="schema:articleBody"]') ||
      postEl.querySelector('shreddit-post-text-body [id$="-post-rtjson-content"]') ||
      postEl.querySelector('shreddit-post-text-body');

    const flairEl = postEl.querySelector('shreddit-post-flair .flair-content');
    const authorLink = postEl.querySelector('a[aria-label^="Author:"]');
    const subredditLink = postEl.querySelector('a[href^="/r/"]');
    const permalink = postEl.getAttribute("permalink");
    const contentHref = postEl.getAttribute("content-href");

    return {
      kind: "post",
      id: postEl.getAttribute("id") || null,
      thingId: postEl.getAttribute("id") || null,
      postId: postEl.getAttribute("id") || null,
      title: titleEl ? textOfNodeClean(titleEl) : postEl.getAttribute("post-title") || null,
      body: textOfNodeClean(bodyEl),
      author: postEl.getAttribute("author") || authorLink?.textContent?.trim() || null,
      authorProfile: absoluteUrl(authorLink?.getAttribute("href")),
      subreddit: postEl.getAttribute("subreddit-prefixed-name") || subredditLink?.textContent?.trim() || null,
      subredditName: postEl.getAttribute("subreddit-name") || null,
      subredditId: postEl.getAttribute("subreddit-id") || null,
      createdTimestamp: postEl.getAttribute("created-timestamp") || null,
      score: numberOrNull(postEl.getAttribute("score")),
      commentCount: numberOrNull(postEl.getAttribute("comment-count")),
      awardCount: numberOrNull(postEl.getAttribute("award-count")),
      postType: postEl.getAttribute("post-type") || null,
      postLanguage: postEl.getAttribute("post-language") || null,
      domain: postEl.getAttribute("domain") || null,
      flair: flairEl ? textOfNodeClean(flairEl) : null,
      permalink: absoluteUrl(permalink),
      contentHref: absoluteUrl(contentHref),
      time: getTimeInfoFromElement(postEl)
    };
  }

  function numberOrNull(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function parseComment(commentEl) {
    const thingId = commentEl.getAttribute("thingid") || null;
    const bodyEl =
      commentEl.querySelector('[slot="comment"] [id$="-post-rtjson-content"]') ||
      commentEl.querySelector('[slot="comment"]');

    const authorLink =
      commentEl.querySelector('.author-name-meta a[href^="/user/"]') ||
      commentEl.querySelector('a[aria-label$="profile"]');

    const flairEl = commentEl.querySelector("author-flair-event-handler .flair-content");
    const moreRepliesLink = commentEl.querySelector('a[slot="more-comments-permalink"]');

    return {
      kind: "comment",
      thingId,
      id: thingId,
      postId: commentEl.getAttribute("postid") || null,
      parentId: commentEl.getAttribute("parentid") || null,
      depth: numberOrNull(commentEl.getAttribute("depth")),
      author: commentEl.getAttribute("author") || authorLink?.textContent?.trim() || null,
      authorProfile: absoluteUrl(authorLink?.getAttribute("href")),
      created: commentEl.getAttribute("created") || null,
      score: numberOrNull(commentEl.getAttribute("score")),
      awardCount: numberOrNull(commentEl.getAttribute("award-count")),
      permalink: absoluteUrl(commentEl.getAttribute("permalink")),
      parentPermalink: absoluteUrl(commentEl.getAttribute("parent-permalink")),
      replyPermalink: absoluteUrl(commentEl.getAttribute("reply-permalink")),
      contentType: commentEl.getAttribute("content-type") || null,
      flair: flairEl ? textOfNodeClean(flairEl) : null,
      body: textOfNodeClean(bodyEl),
      time: getTimeInfoFromElement(commentEl),
      moreReplies: moreRepliesLink
        ? {
            text: textOfNodeClean(moreRepliesLink),
            href: absoluteUrl(moreRepliesLink.getAttribute("href")),
            topLevel: moreRepliesLink.hasAttribute("top-level")
          }
        : null,
      children: []
    };
  }

  function buildCommentTree() {
    const commentEls = Array.from(document.querySelectorAll("shreddit-comment"));
    const byId = new Map();
    const roots = [];

    for (const el of commentEls) {
      const parsed = parseComment(el);
      if (parsed.thingId) byId.set(parsed.thingId, parsed);
    }

    for (const comment of byId.values()) {
      const parentId = comment.parentId;
      if (parentId && byId.has(parentId)) {
        byId.get(parentId).children.push(comment);
      } else {
        roots.push(comment);
      }
    }

    return {
      roots,
      flat: Array.from(byId.values())
    };
  }

  function collectTopLevelMoreReplies() {
    return Array.from(document.querySelectorAll('a[slot="more-comments-permalink"]')).map(a => ({
      text: textOfNodeClean(a),
      href: absoluteUrl(a.getAttribute("href")),
      topLevel: a.hasAttribute("top-level"),
      id: a.id || null
    }));
  }

  function makeExportObject() {
    const post = parsePost();
    const comments = buildCommentTree();

    return {
      exportedAt: new Date().toISOString(),
      source: {
        url: location.href,
        title: document.title,
        userAgent: navigator.userAgent
      },
      post,
      comments: {
        totalLoaded: comments.flat.length,
        roots: comments.roots,
        flat: comments.flat
      },
      continuations: {
        moreRepliesLinks: collectTopLevelMoreReplies()
      }
    };
  }

  function safeFilename(input) {
    return (input || "reddit_post")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function downloadJson(data) {
    const postTitle = data?.post?.title || "reddit_post";
    const filename = safeFilename(postTitle) + ".json";
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function onDownloadClick() {
    try {
      const data = makeExportObject();
      if (!data.post) {
        alert("没找到 Reddit 主帖节点。");
        return;
      }
      downloadJson(data);
    } catch (err) {
      console.error("[Reddit JSON Export]", err);
      alert("导出失败： " + (err?.message || err));
    }
  }

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.textContent = "Download Reddit JSON";
    Object.assign(btn.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "999999",
      padding: "10px 14px",
      borderRadius: "999px",
      border: "1px solid rgba(255,255,255,0.15)",
      background: "#ff4500",
      color: "#fff",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      boxShadow: "0 6px 18px rgba(0,0,0,0.25)"
    });

    btn.addEventListener("click", onDownloadClick);
    document.body.appendChild(btn);
  }

  function init() {
    ensureButton();

    // Reddit 这玩意儿是单页应用，路由会飘，所以顺手观察一下
    const observer = new MutationObserver(() => {
      if (!document.getElementById(BUTTON_ID)) ensureButton();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  init();
})();
