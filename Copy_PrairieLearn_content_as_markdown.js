// ==UserScript==
// @name         Copy PrairieLearn content as markdown (shift + cmd + C)
// @namespace    prairie-tools
// @version      0.2.0
// @description  Copy PrairieLearn content as markdown (with LaTeX math supported). Hotkey: shift + cmd + C
// @match        https://us.prairielearn.com/*
// @match        https://canvas.*.edu/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @author       cicero.elead.apollonius@gmail.com
// @license      GPL
// ==/UserScript==

(function () {
  'use strict';

  // --- Config ---
  const HOTKEY = (e) => !e.altKey && !e.ctrlKey && e.metaKey && e.shiftKey && e.code === 'KeyC';

  // PrairieLearn typically has question body here:
  const PL_CONTAINER_SELECTOR = '.question-body, .question-container, .card-body.question-body';

  // --- Helpers ---
  function normalizeSpaces(s) {
    return s
      .replace(/\u00A0/g, ' ')      // nbsp
      .replace(/[ \t]+\n/g, '\n')   // trim line-end spaces
      .replace(/\n{3,}/g, '\n\n')   // collapse multiple blank lines
      .trim();
  }

  function escapeMarkdownText(s) {
    return s.replace(/([*_`])/g, '\\$1');
  }

  function isElement(node) {
    return node && node.nodeType === Node.ELEMENT_NODE;
  }

  function isText(node) {
    return node && node.nodeType === Node.TEXT_NODE;
  }

  function cloneSelectedFragment(range) {
    return range.cloneContents();
  }

  function findMathLatexInSubtree(el) {
    const mjx = el.querySelector('mjx-math[data-latex]');
    if (mjx) return mjx.getAttribute('data-latex') || '';
    return '';
  }

  function convertMathElementToMarkdown(el) {
    let container = el.closest && el.closest('mjx-container');
    if (!container && el.matches && el.matches('mjx-container')) container = el;

    const latex = container
      ? findMathLatexInSubtree(container)
      : (el.closest && el.closest('mjx-math[data-latex]')?.getAttribute('data-latex')) || '';

    if (!latex) return null;

    const isDisplay =
      (container && container.getAttribute('display') === 'true') ||
      /\\begin\{/.test(latex) ||
      /\n/.test(latex);

    if (isDisplay) {
      return `\n\n$$\n${latex}\n$$\n\n`;
    }
    return `$${latex}$`;
  }

  function getSelectedRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;
    return range;
  }

  // ---------- NEW: PrairieLearn multiple choice -> markdown checkboxes ----------
  function isMultipleChoiceGroup(el) {
    return (
      el &&
      el.getAttribute &&
      el.getAttribute('role') === 'group' &&
      (el.getAttribute('aria-label') || '').toLowerCase().includes('multiple choice')
    );
  }

  function parseMultipleChoiceGroupToMarkdown(groupEl) {
    // Convert PL's radio/checkbox options to markdown task list items:
    // - [ ] (a) Third order
    // - [ ] (b) Second order
    // ...
    // Works best on the full group element, not partial selections.
    const optionRows = groupEl.querySelectorAll('.form-check');
    if (!optionRows || optionRows.length === 0) return '';

    const lines = [];
    optionRows.forEach((row) => {
      // Try to read "(a)" style key label
      const keyEl = row.querySelector('.pl-multiple-choice-key-label');
      const key = keyEl ? normalizeSpaces(keyEl.textContent || '') : '';

      // Answer text (may include MathJax etc.)
      const ansEl = row.querySelector('.pl-multiple-choice-answer') || row.querySelector('label');
      const ans = ansEl ? normalizeSpaces(convertNodeToMarkdown(ansEl).trim()) : '';

      const text = normalizeSpaces(`${key} ${ans}`.trim());
      if (text) lines.push(`- [ ] ${text}`);
    });

    if (lines.length === 0) return '';
    return `\n\n${lines.join('\n')}\n\n`;
  }

  function groupContainsMultipleChoice(el) {
    if (!el || !el.querySelector) return false;
    return !!el.querySelector('[role="group"][aria-label*="Multiple choice"], [role="group"][aria-label*="multiple choice"]');
  }

  function maybeConvertMultipleChoiceFromNode(el) {
    if (!el) return null;

    // If this element IS the group
    if (isMultipleChoiceGroup(el)) {
      const md = parseMultipleChoiceGroupToMarkdown(el);
      return md || null;
    }

    // Or contains one (take the first; PL usually has one group per block)
    if (el.querySelector) {
      const group = el.querySelector('[role="group"][aria-label*="Multiple choice"], [role="group"][aria-label*="multiple choice"]');
      if (group && isMultipleChoiceGroup(group)) {
        const md = parseMultipleChoiceGroupToMarkdown(group);
        return md || null;
      }
    }

    return null;
  }
  // ---------------------------------------------------------------------------

function convertNodeToMarkdown(node, opts = {}) {
  const { inPre = false } = opts;
  if (!node) return '';

  if (isText(node)) {
    const txt = node.nodeValue || '';
    return inPre ? txt : txt.replace(/[ \t]+/g, ' ');
  }
  if (!isElement(node)) return '';

  const el = node;

  // Ignore interactive widgets / inputs
  if (el.matches('input, textarea, select, button, .input-group, .pl-number-input, .pl-string-input, .pl-checkbox, .pl-radio')) {
    return '';
  }

  // ✅ NEW: if this element IS a multiple choice group, convert in-place and stop.
  if (isMultipleChoiceGroup(el)) {
    return parseMultipleChoiceGroupToMarkdown(el);
  }

  // MathJax
  if (el.matches('mjx-container, mjx-math, mjx-mtable, mjx-mi, mjx-mo, mjx-mn, mjx-msub, mjx-msup, mjx-mfrac, mjx-texatom')) {
    const m = convertMathElementToMarkdown(el);
    return m ?? '';
  }
  if (el.closest && el.closest('mjx-container')) {
    const m = convertMathElementToMarkdown(el);
    return m ?? '';
  }

  if (el.tagName === 'BR') return '\n';
  if (el.tagName === 'HR') return '\n\n---\n\n';

  if (el.tagName === 'PRE') {
    const inner = Array.from(el.childNodes).map((c) => convertNodeToMarkdown(c, { inPre: true })).join('');
    return `\n\n\`\`\`\n${inner.replace(/\n+$/, '\n')}\`\`\`\n\n`;
  }
  if (el.tagName === 'CODE') {
    const inner = Array.from(el.childNodes).map((c) => convertNodeToMarkdown(c, { inPre: true })).join('');
    return `\`${inner.replace(/`/g, '\\`')}\``;
  }

  if (/H[1-6]/.test(el.tagName)) {
    const level = Number(el.tagName.slice(1));
    const inner = Array.from(el.childNodes).map(convertNodeToMarkdown).join('');
    return `\n\n${'#'.repeat(level)} ${normalizeSpaces(inner)}\n\n`;
  }

  const blockTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'SPAN']);
  const listTags = new Set(['UL', 'OL']);
  const liTag = el.tagName === 'LI';

  if (listTags.has(el.tagName)) {
    const isOrdered = el.tagName === 'OL';
    let idx = 1;
    const items = Array.from(el.children)
      .filter((c) => c.tagName === 'LI')
      .map((li) => {
        const body = normalizeSpaces(Array.from(li.childNodes).map(convertNodeToMarkdown).join(''));
        const prefix = isOrdered ? `${idx++}. ` : `- `;
        return prefix + body.replace(/\n/g, '\n  ');
      })
      .join('\n');
    return `\n\n${items}\n\n`;
  }

  if (el.tagName === 'A') {
    const text = normalizeSpaces(Array.from(el.childNodes).map(convertNodeToMarkdown).join('')) || el.textContent || '';
    const href = el.getAttribute('href') || '';
    if (!href) return text;
    return `[${text}](${href})`;
  }

  if (el.tagName === 'IMG') {
    const alt = el.getAttribute('alt') || '';
    const src = el.getAttribute('src') || '';
    if (!src) return '';
    return `![${alt}](${src})`;
  }

  // Default recurse (order preserved)
  let out = '';
  for (const child of Array.from(el.childNodes)) {
    out += convertNodeToMarkdown(child, { inPre });
  }

  if (blockTags.has(el.tagName)) {
    out = '\n' + out + '\n';
  }
  if (liTag) {
    out = out.replace(/\n+/g, '\n');
  }
  return out;
}

function convertSelectionToMarkdown(range) {
  const frag = cloneSelectedFragment(range);
  const wrapper = document.createElement('div');
  wrapper.appendChild(frag);

  // ✅ IMPORTANT: do NOT “extract + prepend” MC groups.
  // Let convertNodeToMarkdown handle them in-place so ordering matches the page.
  let md = convertNodeToMarkdown(wrapper);

  md = normalizeSpaces(md);

  // Escape only outside math
  const parts = [];
  let i = 0;
  while (i < md.length) {
    if (md.startsWith('$$', i)) {
      const j = md.indexOf('$$', i + 2);
      if (j !== -1) {
        parts.push({ t: 'math', s: md.slice(i, j + 2) });
        i = j + 2;
        continue;
      }
    }
    if (md[i] === '$') {
      const j = md.indexOf('$', i + 1);
      if (j !== -1) {
        parts.push({ t: 'math', s: md.slice(i, j + 1) });
        i = j + 1;
        continue;
      }
    }
    let next = md.length;
    const nextBlock = md.indexOf('$$', i);
    const nextInline = md.indexOf('$', i);
    if (nextBlock !== -1) next = Math.min(next, nextBlock);
    if (nextInline !== -1) next = Math.min(next, nextInline);
    parts.push({ t: 'txt', s: md.slice(i, next) });
    i = next;
  }

  md = parts.map((p) => (p.t === 'txt' ? escapeMarkdownText(p.s) : p.s)).join('');
  md = normalizeSpaces(md);

  return md;
}

  async function copyText(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, { type: 'text', mimetype: 'text/plain' });
        return true;
      }
    } catch {}

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function toast(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    Object.assign(div.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: 999999,
      padding: '10px 12px',
      background: 'rgba(0,0,0,0.8)',
      color: '#fff',
      borderRadius: '8px',
      fontSize: '12px',
      maxWidth: '40vw',
      lineHeight: '1.3',
    });
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 1400);
  }

  // --- Main ---
  window.addEventListener('keydown', async (e) => {
    if (!HOTKEY(e)) return;

    const range = getSelectedRange();
    if (!range) {
      toast('没有选中文本（selection is empty）');
      return;
    }

    const md = convertSelectionToMarkdown(range);
    if (!md) {
      toast('转换结果为空');
      return;
    }

    const ok = await copyText(md);
    toast(ok ? '已复制 Markdown ✅' : '复制失败（clipboard 权限）');
  });
})();
