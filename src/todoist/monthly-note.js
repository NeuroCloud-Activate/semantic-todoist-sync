"use strict";

// Pure text-in/text-out helpers for the monthly "Miscellaneous Tasks" note.
// Marker (%%[p:: Project]%%) is the source of truth; `## Project` headings are display only.

const INBOX = "Inbox";
const OID_RE = /%%\[oid::\s*([^\]]+?)\s*\]%%/;
const P_RE = /\s*%%\[p::\s*([^\]\r\n]+?)\s*\]%%/;
const HEADING_RE = /^## ([^\r\n]*?)\s*$/;

const eolOf = (text) => (/\r\n/.test(text) ? "\r\n" : "\n");
const split = (text) => String(text).split(/\r?\n/);
const indentOf = (line) => /^[ \t]*/.exec(line)[0].replace(/\t/g, "    ").length;
const isTop = (line) => /^- \[.\] /.test(line) && OID_RE.test(line);
// One normalizer (same as main.js singleLine: collapse all whitespace incl. U+2028/9, trim) for headings and markers, so they always round-trip.
const headingName = (name) => String(name || "").replace(/\s+/g, " ").trim() || INBOX;
const projectOf = (line) => { const m = P_RE.exec(line); return m ? headingName(m[1]) : INBOX; };
// Lines inside (or delimiting) CommonMark fenced code blocks; an unclosed fence runs to the end.
function fenceMask(lines) {
  const mask = [];
  let open = null;
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open) {
      open = m && !(m[1][0] === "`" && m[2].includes("`")) ? m[1] : null;
      mask.push(!!open);
    } else {
      mask.push(true);
      if (m && m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim()) open = null;
    }
  }
  return mask;
}
const headingAt = (lines, mask, i) => (mask[i] ? null : HEADING_RE.exec(lines[i]));
const headingAbove = (lines, i) => { const mask = fenceMask(lines); for (; i >= 0; i--) { const m = headingAt(lines, mask, i); if (m) return m[1]; } return null; };

function monthlyNotePath(folder, date) {
  const d = date || new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${String(folder).replace(/[\\/]+$/, "")}/${ym} Tasks.md`;
}

function newMonthlyNote() {
  return "This note is kept in step with Todoist. Edits to tasks here sync both ways.\n";
}

// Block = top-level task line plus following lines indented deeper than it.
function blockEnd(lines, start) {
  const base = indentOf(lines[start]);
  let i = start + 1;
  while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > base) i++;
  return i;
}

function sectionRange(lines, name) {
  const mask = fenceMask(lines);
  const start = lines.findIndex((l, i) => { const m = headingAt(lines, mask, i); return m && m[1] === name; });
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !headingAt(lines, mask, end)) end++;
  return { start, end };
}

function place(lines, name, block) {
  const r = sectionRange(lines, name);
  if (!r) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length) lines.push("");
    lines.push(`## ${name}`, ...block, "");
    return;
  }
  let at = r.end;
  while (at > r.start + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, ...block);
}

// Remove only the named heading, and only if its section is now empty.
function dropIfEmpty(lines, name) {
  const r = name == null ? null : sectionRange(lines, name);
  if (r && lines.slice(r.start + 1, r.end).every((l) => !l.trim())) lines.splice(r.start, r.end - r.start);
}

function setMarker(line, project) {
  const bare = line.replace(P_RE, "");
  const name = headingName(project);
  if (name === INBOX) return bare;
  const marker = ` %%[p:: ${name}]%%`;
  const oid = bare.search(/\s%%\[oid::/);
  return oid >= 0 ? bare.slice(0, oid) + marker + bare.slice(oid) : bare + marker;
}

function insertTaskBlock(text, projectName, blockLines) {
  const eol = eolOf(text);
  const lines = split(text);
  place(lines, headingName(projectName), blockLines);
  return lines.join(eol);
}

function moveTaskBlock(text, oid, newProjectName) {
  const eol = eolOf(text);
  const lines = split(text);
  const mask = fenceMask(lines);
  const start = lines.findIndex((l, i) => !mask[i] && isTop(l) && OID_RE.exec(l)[1] === oid);
  if (start < 0) return text;
  const from = headingAbove(lines, start);
  const block = lines.splice(start, blockEnd(lines, start) - start);
  block[0] = setMarker(block[0], newProjectName);
  place(lines, headingName(newProjectName), block);
  dropIfEmpty(lines, from);
  return lines.join(eol);
}

function reconcileHeadings(text) {
  const eol = eolOf(text);
  const lines = split(text);
  let current = null;
  const left = new Set();
  // Hard bound: each pass moves one block, so more moves than lines means something is wrong; never hang.
  for (let i = 0, moves = 0; i < lines.length && moves <= lines.length; i++) {
    const mask = fenceMask(lines);
    if (mask[i]) continue;
    const h = HEADING_RE.exec(lines[i]);
    if (h) { current = h[1]; continue; }
    if (!isTop(lines[i])) continue;
    const want = projectOf(lines[i]);
    const end = blockEnd(lines, i);
    if (want !== current) {
      moves++;
      if (current != null) left.add(current);
      const block = lines.splice(i, end - i);
      place(lines, want, block);
      i = -1; current = null; // positions shifted; rescan
      continue;
    }
    i = end - 1;
  }
  for (const name of left) dropIfEmpty(lines, name);
  return lines.join(eol);
}

module.exports = { monthlyNotePath, newMonthlyNote, insertTaskBlock, moveTaskBlock, reconcileHeadings };
