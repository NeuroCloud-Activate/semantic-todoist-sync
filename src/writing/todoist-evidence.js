"use strict";

// Pure Todoist evidence helpers for meeting prep. No obsidian, no network.

const DESC_LIMIT = 600;
const DUE_SOON_DAYS = 7;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const singleLine = (v) => String(v || "").replace(/\s+/g, " ").trim();
// Same rules as markdownLinkText in src/main.js.
function markdownLinkText(value) {
  const text = singleLine(value) || "Open task";
  if (/^[xX]$/.test(text)) return "\\" + text; // a lone x/X would read as a checkbox "[x]"
  return text.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
const pad = (n) => String(n).padStart(2, "0");
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const datePart = (v) => String(v || "").slice(0, 10);
// Timestamps (with "T") show the local day; plain dates stay as written.
const dayOf = (v) => {
  const s = String(v || "");
  const d = s.includes("T") ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? localDay(d) : datePart(s);
};
const cleanLabel = (l) => String(l || "").replace(/^[#@]/, "").trim().toLowerCase();

function taskStatus(task, now = new Date()) {
  if (task.completedAt) return "done";
  const due = datePart(task.dueDate ?? task.due);
  if (!due) return "open";
  const today = localDay(now);
  if (due < today) return "overdue";
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + DUE_SOON_DAYS);
  return due <= localDay(limit) ? "due-soon" : "open";
}

function notePathsFromDescription(text) {
  const out = [];
  const re = /obsidian:\/\/open\?((?:[^\s()\]>"]|\([^\s()]*\))+)/g; // balanced (...) stays in the name; an unbalanced ) closes the markdown link
  let m;
  while ((m = re.exec(String(text || "")))) {
    for (const part of m[1].split("&")) {
      if (!part.startsWith("file=")) continue;
      let p = part.slice(5);
      try { p = decodeURIComponent(p); } catch (_) { /* keep raw */ }
      if (p && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

function stripSources(text) {
  const s = String(text || "");
  const i = s.search(/^[ \t]*(?:Sources|Source List|Context Notes):/im);
  return (i < 0 ? s : s.slice(0, i)).trim();
}

function buildTaskRecords({ snapshot, completed = [], completedDays = 14, projects = [], now = new Date(), taskUrl }) {
  completedDays = Number.isFinite(Number(completedDays)) ? Math.min(90, Math.max(1, Number(completedDays))) : 14;
  const snap = snapshot || {};
  const projectNames = new Map((snap.projects || []).map((p) => [String(p.id), p.name]));
  const sectionNames = new Map((snap.sections || []).map((s) => [String(s.id), s.name]));
  const all = [...(snap.tasks || []), ...completed];
  const titles = new Map(all.map((t) => [String(t.id), singleLine(t.content)]));
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - completedDays);
  const seen = new Set();
  const mk = (t) => {
    const d = String(t.description || "");
    const r = {
      id: String(t.id),
      title: singleLine(t.content),
      projectId: String(t.projectId || ""),
      projectName: projectNames.get(String(t.projectId)) || "Unknown project",
      sectionName: sectionNames.get(String(t.sectionId)) || "",
      parentId: String(t.parentId || ""),
      parentTitle: titles.get(String(t.parentId)) || "",
      status: "open",
      due: t.dueDate || "",
      deadline: t.deadlineDate || "",
      priority: t.priority,
      labels: t.labels || [],
      completedAt: t.completedAt || "",
      description: stripSources(d).slice(0, DESC_LIMIT),
      notePaths: notePathsFromDescription(d),
      url: typeof taskUrl === "function" ? taskUrl(String(t.id)) : ""
    };
    r.status = taskStatus(r, now);
    return r;
  };
  let records = [];
  for (const t of snap.tasks || []) {
    if (t.completedAt || seen.has(String(t.id))) continue;
    seen.add(String(t.id));
    records.push(mk(t));
  }
  for (const t of completed) {
    const at = new Date(t.completedAt);
    if (!t.completedAt || Number.isNaN(at.getTime()) || at < cutoff || seen.has(String(t.id))) continue;
    seen.add(String(t.id));
    records.push(mk(t));
  }
  const unknownProjects = [];
  const wanted = (projects || []).map((p) => singleLine(p)).filter(Boolean);
  if (wanted.length) {
    const names = new Set(records.map((r) => r.projectName.toLowerCase()));
    for (const n of [...projectNames.values()]) names.add(String(n).toLowerCase());
    const keep = new Set(wanted.map((w) => w.toLowerCase()));
    for (const w of wanted) if (!names.has(w.toLowerCase())) unknownProjects.push(w);
    records = records.filter((r) => keep.has(r.projectName.toLowerCase()));
  }
  return { records, unknownProjects };
}

// Rule order (spec call 6): sibling, parent is the completed task, FollowUp label same project, shared note.
function followUpMap(records) {
  const done = records.filter((r) => r.status === "done");
  const open = records.filter((r) => r.status !== "done");
  const rules = [
    (c, o) => c.parentId && o.parentId === c.parentId,
    (c, o) => o.parentId === c.id,
    (c, o) => o.projectId === c.projectId && o.labels.some((l) => cleanLabel(l) === "followup"),
    (c, o) => o.notePaths.some((p) => c.notePaths.includes(p))
  ];
  const map = new Map();
  for (const o of open) {
    let hit = null;
    for (const rule of rules) {
      hit = done.find((c) => rule(c, o));
      if (hit) break;
    }
    if (hit) map.set(hit.id, [...(map.get(hit.id) || []), o.id]);
  }
  return map;
}

function groupByProject(records) {
  const groups = new Map();
  for (const r of records) {
    if (!groups.has(r.projectId)) groups.set(r.projectId, { projectName: r.projectName, projectId: r.projectId, records: [] });
    groups.get(r.projectId).records.push(r);
  }
  const active = (g) => g.records.filter((r) => r.status !== "done").length;
  return [...groups.values()].sort((a, b) => active(b) - active(a) || a.projectName.localeCompare(b.projectName));
}

function taskEvidenceText(r) {
  const head = [
    r.title,
    `${r.projectName}${r.sectionName ? " › " + r.sectionName : ""}`,
    r.parentTitle ? `parent: ${r.parentTitle}` : "",
    r.status,
    r.due ? `due ${datePart(r.due)}` : "",
    r.deadline ? `deadline ${datePart(r.deadline)}` : "",
    r.priority > 1 ? `priority p${5 - r.priority}` : "",
    r.labels.length ? `labels: ${r.labels.join(", ")}` : "",
    r.completedAt ? `completed ${dayOf(r.completedAt)}` : ""
  ].filter(Boolean).join(" | ");
  return r.description ? `${head}\n${singleLine(r.description)}` : head;
}

function budgetRecords(records, instruction, maxChars = 6000) {
  const words = String(instruction || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const rank = (r) => {
    if (r.status === "overdue") return 0;
    if (r.status === "due-soon") return 1;
    if (r.status === "done") return 2;
    const hay = `${r.title} ${r.projectName}`.toLowerCase();
    return words.some((w) => hay.includes(w)) ? 3 : 4;
  };
  const sorted = records.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
  const kept = [];
  let used = 0;
  for (const r of sorted) {
    const len = taskEvidenceText(r).length + 1;
    if (used + len > maxChars) continue;
    kept.push(r);
    used += len;
  }
  return { kept, dropped: records.length - kept.length };
}

function dueLabel(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dayOf(v));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : "";
}

function renderTaskList(records, followUps = new Map()) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const nested = new Set();
  for (const ids of followUps.values()) for (const id of ids) nested.add(id);
  const line = (r, indent) => {
    const due = r.status === "done" ? dueLabel(r.completedAt) : dueLabel(r.due);
    const suffix = ` · ${r.status}${due ? ` · ${r.status === "done" ? "done" : "due"} ${due}` : ""}`;
    return `${indent}- [${singleLine(r.title) ? markdownLinkText(r.title) : "(untitled task)"}](${r.url})${suffix}`;
  };
  const out = [];
  for (const r of records) {
    if (nested.has(r.id) && byId.has(r.id) && [...followUps.entries()].some(([k, v]) => v.includes(r.id) && byId.has(k))) continue;
    out.push(line(r, ""));
    for (const id of followUps.get(r.id) || []) if (byId.has(id)) out.push(line(byId.get(id), "  "));
  }
  return out.join("\n");
}

module.exports = { buildTaskRecords, taskStatus, notePathsFromDescription, followUpMap, groupByProject, taskEvidenceText, budgetRecords, renderTaskList };
