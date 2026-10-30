"use strict";

const { baseNameOf } = require("../context/source.js");
const { formatInText, planReferences, sourceKey } = require("./styles.js");

function startNumber(noteText) {
  const text = typeof noteText === "string" ? noteText : "";
  const re = /\[\^(\d+)\]/g;
  let max = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max + 1;
}

function isUnsafeName(s) {
  return /[|\[\]#]/.test(s);
}

function normaliseHeading(s) {
  // Strip leading markdown heading markers
  let h = String(s || "").trim();
  h = h.replace(/^#{1,6}\s*/, "").trim();
  // If nested headings joined by write.js (>), use last segment only
  if (h.includes(" > ")) {
    const parts = h.split(" > ");
    h = parts[parts.length - 1];
  }
  h = h.trim();
  // Replace characters that break wikilink heading anchors
  // Obsidian avoids: # | ^ : %% [[ ]]
  h = h.replace(/[#:[\]^%|]/g, " ");
  // Collapse whitespace
  h = h.replace(/\s+/g, " ").trim();
  return h;
}

function stripMdExtension(path) {
  return path.endsWith(".md") ? path.slice(0, -3) : path;
}

function labelFor(source) {
  if (!source || typeof source.kind !== "string") return "";
  if (source.kind === "vault") {
    const path = source.path || "";
    const rawHeading = source.heading || "";
    const heading = normaliseHeading(rawHeading);
    const baseName = baseNameOf(stripMdExtension(path));
    if (isUnsafeName(path)) {
      return heading ? baseName + ", " + heading : baseName;
    }
    const noMd = stripMdExtension(path);
    const omitHeading = !heading || heading.toLowerCase() === baseName.toLowerCase();
    return omitHeading ? "[[" + noMd + "]]" : "[[" + noMd + "#" + heading + "]]";
  }
  if (source.kind === "context-vault") {
    const path = source.path || "";
    const locator = source.locator || "";
    if (isUnsafeName(path)) {
      const base = baseNameOf(path);
      return locator ? base + ", " + locator : base;
    }
    return locator ? "[[" + path + "]], " + locator : "[[" + path + "]]";
  }
  // writing-mode: task 11 saved deep-research notes render like vault/context sources
  if (source.kind === "research-vault") {
    const path = source.path || "";
    const locator = source.locator || "";
    if (isUnsafeName(path)) {
      const base = baseNameOf(path);
      return locator ? base + ", " + locator : base;
    }
    return locator ? "[[" + path + "]], " + locator : "[[" + path + "]]";
  }
  if (source.kind === "research-external") {
    const name = source.name || "";
    const locator = source.locator || "";
    return locator ? name + ", " + locator : name;
  }
  if (source.kind === "context-external") {
    const name = source.name || "";
    const locator = source.locator || "";
    return locator ? name + ", " + locator : name;
  }
  if (source.kind === "web") {
    const title = String(source.title || "").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    const url = String(source.url || "").trim();
    if (url && /^https?:\/\//i.test(url)) return `[${title}](${url})`;
    return title || url;
  }
  return ""; // todoist sources never reach the footnotes: they render as inline links
}

const RANGE_CAP = 32;
const DASH = "[-–—]";
const MARKER_INNER = `E\\d+(?:\\s*${DASH}\\s*(?:E)?\\d+)?\\s*(?:,\\s*E\\d+(?:\\s*${DASH}\\s*(?:E)?\\d+)?\\s*)*`;
// One bare id or E16-E19 range; not E2E, E1.5 or E3-5.
const BARE_ITEM = `\\bE\\d+(?:[ \\t]*${DASH}[ \\t]*E\\d+)?(?!\\w|\\.\\d|${DASH}\\d)`;
const BARE_SEP = "(?:[ \\t]*,[ \\t]*(?:and[ \\t]+)?|[ \\t]+(?:and|&)[ \\t]+)";
// Spans that are matched first and returned untouched: code, wikilinks, links, urls, real markers.
const SPAN_RE = new RegExp(`(\`\`\`[\\s\\S]*?(?:\`\`\`|$)|~~~[\\s\\S]*?(?:~~~|$)|\`[^\`\\n]*\`|\\[\\[[^\\]\\n]*\\]\\]|\\[[^\\[\\]\\n]*\\]\\((?:<[^>\\n]*>|[^)\\n]*)\\)|\\[[^\\[\\]\\n]*\\]|\\b(?:https?|todoist|obsidian):\\/\\/\\S+)|(${BARE_ITEM}(?:${BARE_SEP}${BARE_ITEM})*)`, "g");
const GONE = "\u0000";

// Bare ids the model left outside brackets: allowed ids become [E1, E2] markers, ids that are
// evidence but not allowed here are removed, any other token is not ours and stays as written.
// By design a real word like "Grant E10" is cited when E10 is an allowed id.
function normalizeBareCitations(text, { allowed, known } = {}) {
  const src = typeof text === "string" ? text : "";
  const ok = allowed instanceof Set ? allowed : new Set();
  const all = known instanceof Set ? known : ok;
  function rewriteRun(run) {
    const parts = []; // { text } kept as written, or { ids } to cite
    let end = 0;
    for (const m of run.matchAll(new RegExp(BARE_ITEM, "g"))) {
      const sep = parts.length ? run.slice(end, m.index) : "";
      end = m.index + m[0].length;
      const r = new RegExp(`^E(\\d+)[ \\t]*${DASH}[ \\t]*E(\\d+)$`).exec(m[0]);
      let ids = [m[0]];
      if (r) {
        const lo = parseInt(r[1], 10);
        const hi = parseInt(r[2], 10);
        ids = lo <= hi && hi - lo < RANGE_CAP ? Array.from({ length: hi - lo + 1 }, (_, i) => "E" + (lo + i)) : [];
      }
      const cite = ids.filter((id) => ok.has(id));
      if (cite.length) {
        const prev = parts[parts.length - 1];
        if (prev && prev.ids) prev.ids.push(...cite);
        else parts.push({ sep, ids: cite });
      } else if (ids.length && ids.every((id) => all.has(id))) {
        // evidence the caller may not cite here: removed
      } else {
        parts.push({ sep, text: m[0] });
      }
    }
    if (!parts.length) return GONE;
    return parts.map((p, i) => (i ? p.sep : "") + (p.ids ? "[" + p.ids.join(", ") + "]" : p.text)).join("");
  }
  const out = src.replace(SPAN_RE, (m, span, run) => (span !== undefined ? span : rewriteRun(run)));
  if (!out.includes(GONE)) return out;
  return out
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]*\u0000[ \t]*(?:\r?\n|$)/gm, "") // list item that became empty
    .replace(/,[ \t]*\u0000[ \t]*,/g, ",") // "a, E4, b"
    .replace(/,[ \t]*\u0000(?=[ \t]*[)\].;:!?])/g, "") // "(a, E4)", "a, E4."
    .replace(/\(\s*\u0000\s*\)/g, GONE)
    .replace(/([ \t]*)\u0000([ \t]*)/g, (m, before, after, at, whole) => {
      const prev = whole.charAt(at - 1);
      const next = whole.charAt(at + m.length);
      if (at === 0 || prev === "\n" || next === "" || next === "\n" || /[.,;:!?)\]]/.test(next)) return "";
      return before || after ? " " : "";
    });
}

// A usable link for a todoist source, or "" (then the citation is dropped).
function todoistUrl(source) {
  const url = String((source && source.url) || "").trim();
  return /^(?:https?|todoist):\/\/[^\s<>]+$/i.test(url) ? url : "";
}

function rewriteCitations(markdown, evidence, noteText, style = "footnotes") {
  const byEid = new Map();
  for (const entry of evidence || []) {
    if (entry && typeof entry.eid === "string" && !byEid.has(entry.eid)) {
      byEid.set(entry.eid, entry);
    }
  }
  const nonFootnotes = style === "apa" || style === "nature";
  let next = startNumber(noteText);
  const numByEid = new Map();
  const used = [];
  let dropped = 0;

  const isTask = (eid) => !!(byEid.get(eid).source && byEid.get(eid).source.kind === "todoist");

  // Todoist citations are inline links: they are reported as used but take no footnote number.
  function numFor(eid) {
    if (!used.includes(eid)) used.push(eid);
    if (isTask(eid)) return 0;
    if (!numByEid.has(eid)) {
      numByEid.set(eid, next);
      next += 1;
    }
    return numByEid.get(eid);
  }

  const RANGE_RE = /^E(\d+)\s*[-–—]\s*(E)?(\d+)$/;
  const MARKER_RE = /( ?)\[((?:E\d+(?:\s*[-–—]\s*(?:E)?\d+)?\s*(?:,\s*E\d+(?:\s*[-–—]\s*(?:E)?\d+)?\s*)*))\]( ?)/g;
  const eids = new Set(byEid.keys());
  const src = normalizeBareCitations(typeof markdown === "string" ? markdown : "", { allowed: eids, known: eids });

  // Collect marker groups first so apa/nature can plan reference numbers
  // for every cited source before any marker is replaced.
  const groups = [];
  for (const m of src.matchAll(MARKER_RE)) {
    const tokens = m[2]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const known = [];
    for (const token of tokens) {
      const rm = RANGE_RE.exec(token);
      if (rm) {
        const start = parseInt(rm[1], 10);
        const end = parseInt(rm[3], 10);
        if (!(start <= end) || end - start + 1 > RANGE_CAP) {
          dropped += 1;
          continue;
        }
        for (let n = start; n <= end; n += 1) {
          const eid = "E" + n;
          if (byEid.has(eid)) known.push(eid);
          else dropped += 1;
        }
        continue;
      }
      if (byEid.has(token)) known.push(token);
      else dropped += 1;
    }
    groups.push({ pre: m[1], post: m[3], known });
  }

  for (const g of groups) {
    for (const eid of g.known) numFor(eid);
  }

  const ordered = Array.from(numByEid.entries()).sort((a, b) => a[1] - b[1]);
  const cited = used.map((eid) => byEid.get(eid).source).filter(Boolean);

  let numbers = {};
  if (nonFootnotes) {
    numbers = planReferences(noteText, style, cited).numbers; // planReferences skips todoist sources
  }

  let gi = 0;
  const out = src.replace(MARKER_RE, (match, pre, inner, post) => {
    const g = groups[gi];
    gi += 1;
    const notes = g.known.filter((eid) => !isTask(eid));
    const links = g.known.filter(isTask).map((eid) => todoistUrl(byEid.get(eid).source)).filter(Boolean).map((u) => "[↗](<" + u + ">)");
    let cite = "";
    if (notes.length && !nonFootnotes) cite = notes.map((eid) => "[^" + numByEid.get(eid) + "]").join("");
    else if (notes.length) {
      cite = formatInText(style, notes.map((eid) => {
        const source = byEid.get(eid).source;
        const item = { source };
        if (style === "nature") item.number = numbers[sourceKey(source)];
        return item;
      }));
    }
    const body = [cite, ...links].filter(Boolean).join(" ");
    if (!body) return pre && post ? " " : "";
    return pre + body + post;
  });

  const lines = ordered.map(([eid, n]) => {
    const entry = byEid.get(eid);
    return "[^" + n + "]: " + labelFor(entry ? entry.source : null);
  });

  return { markdown: out, footnotes: nonFootnotes ? "" : lines.join("\n"), used, cited, numbers, dropped };
}

module.exports = { rewriteCitations, normalizeBareCitations };
