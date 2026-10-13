"use strict";

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

function basenameOf(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1];
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
    const baseName = basenameOf(stripMdExtension(path));
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
      const base = basenameOf(path);
      return locator ? base + ", " + locator : base;
    }
    return locator ? "[[" + path + "]], " + locator : "[[" + path + "]]";
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
  return "";
}

function rewriteCitations(markdown, evidence, noteText) {
  const byEid = new Map();
  for (const entry of evidence || []) {
    if (entry && typeof entry.eid === "string" && !byEid.has(entry.eid)) {
      byEid.set(entry.eid, entry);
    }
  }
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

  const src = typeof markdown === "string" ? markdown : "";
  const out = src.replace(/( ?)\[((?:E\d+\s*(?:,\s*E\d+\s*)*))\]( ?)/g, (match, pre, inner, post) => {
    const eids = inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const known = [];
    for (const eid of eids) {
      if (byEid.has(eid)) known.push(eid);
      else dropped += 1;
    }
    if (known.length === 0) return pre && post ? " " : "";
    return pre + known.map((eid) => "[^" + numFor(eid) + "]").join("") + post;
  });

  const ordered = Array.from(numByEid.entries()).sort((a, b) => a[1] - b[1]);
  const lines = ordered.map(([eid, n]) => {
    const entry = byEid.get(eid);
    return "[^" + n + "]: " + labelFor(entry ? entry.source : null);
  });

  return { markdown: out, footnotes: lines.join("\n"), used, dropped };
}

module.exports = { rewriteCitations };
