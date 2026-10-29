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
  if (source.kind === "todoist") {
    const title = String(source.title || "").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
    const url = String(source.url || "").trim();
    const head = url && /^(https?|todoist):\/\//i.test(url) ? `[${title}](${url})` : title || url;
    return [head, "Todoist task", source.project, source.state].filter(Boolean).join(", ");
  }
  return "";
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

  function numFor(eid) {
    if (!numByEid.has(eid)) {
      numByEid.set(eid, next);
      next += 1;
      used.push(eid);
    }
    return numByEid.get(eid);
  }

  const RANGE_CAP = 32;
  const RANGE_RE = /^E(\d+)\s*[-–—]\s*(E)?(\d+)$/;
  const MARKER_RE = /( ?)\[((?:E\d+(?:\s*[-–—]\s*(?:E)?\d+)?\s*(?:,\s*E\d+(?:\s*[-–—]\s*(?:E)?\d+)?\s*)*))\]( ?)/g;
  const src = typeof markdown === "string" ? markdown : "";

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
  const cited = ordered.map(([eid]) => byEid.get(eid).source).filter(Boolean);

  let numbers = {};
  if (nonFootnotes) {
    numbers = planReferences(noteText, style, cited).numbers;
  }

  let gi = 0;
  const out = src.replace(MARKER_RE, (match, pre, inner, post) => {
    const g = groups[gi];
    gi += 1;
    if (g.known.length === 0) return pre && post ? " " : "";
    if (!nonFootnotes) {
      return pre + g.known.map((eid) => "[^" + numByEid.get(eid) + "]").join("") + post;
    }
    const items = g.known.map((eid) => {
      const source = byEid.get(eid).source;
      const item = { source };
      if (style === "nature") item.number = numbers[sourceKey(source)];
      return item;
    });
    return pre + formatInText(style, items) + post;
  });

  const lines = ordered.map(([eid, n]) => {
    const entry = byEid.get(eid);
    return "[^" + n + "]: " + labelFor(entry ? entry.source : null);
  });

  return { markdown: out, footnotes: nonFootnotes ? "" : lines.join("\n"), used, cited, numbers, dropped };
}

module.exports = { rewriteCitations };
