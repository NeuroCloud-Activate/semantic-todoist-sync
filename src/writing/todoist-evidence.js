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

function buildTaskRecords({ snapshot, completed = [], completedDays = 14, projects = [], now = new Date(), taskUrl, subprojects = "merge", ignoreLabels = [], ignoreProjects = [] }) {
  completedDays = Number.isFinite(Number(completedDays)) ? Math.min(90, Math.max(1, Number(completedDays))) : 14;
  let snap = snapshot || {};
  const projectNames = new Map((snap.projects || []).map((p) => [String(p.id), p.name]));
  const projectParent = new Map((snap.projects || []).map((p) => [String(p.id), String(p.parentId ?? p.parent_id ?? "")]));
  const sectionNames = new Map((snap.sections || []).map((s) => [String(s.id), s.name]));
  const topOf = (id) => {
    let cur = String(id || ""); const seen = new Set();
    while (projectParent.has(cur) && projectParent.get(cur) && !seen.has(cur)) { seen.add(cur); cur = projectParent.get(cur); }
    return cur;
  };
  const pathOf = (id) => {
    let cur = String(id || ""); const parts = []; const seen = new Set();
    while (cur && projectNames.has(cur) && !seen.has(cur)) { seen.add(cur); parts.push(projectNames.get(cur)); cur = projectParent.get(cur) || ""; }
    return parts.reverse().join(" › ");
  };
  // Ignored tasks are dropped first, so they never group, link as follow-ups or name a parent.
  const unknownIgnored = [];
  const ignoreLabelSet = new Set((ignoreLabels || []).map(cleanLabel).filter(Boolean));
  const ignoreWanted = (ignoreProjects || []).map((p) => singleLine(p)).filter(Boolean);
  const ignoreNames = ignoreWanted.map((n) => n.toLowerCase());
  const knownNames = new Set([...projectNames.values()].map((n) => String(n).toLowerCase()));
  for (const n of ignoreWanted) if (!knownNames.has(n.toLowerCase())) unknownIgnored.push(n);
  const ignoredProject = (id) => {
    let cur = String(id || ""); const seen = new Set();
    while (cur && projectNames.has(cur) && !seen.has(cur)) {
      if (ignoreNames.includes(String(projectNames.get(cur)).toLowerCase())) return true;
      seen.add(cur); cur = projectParent.get(cur) || "";
    }
    return false;
  };
  const keep = (t) => !(t.labels || []).some((l) => ignoreLabelSet.has(cleanLabel(l))) && !ignoredProject(t.projectId);
  snap = { ...snap, tasks: (snap.tasks || []).filter(keep) };
  completed = completed.filter(keep);
  const all = [...snap.tasks, ...completed];
  const titles = new Map(all.map((t) => [String(t.id), singleLine(t.content)]));
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - completedDays);
  const seen = new Set();
  const mk = (t) => mkRecord(t, projectNames, sectionNames, titles, taskUrl, now);
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
  const merge = String(subprojects || "").toLowerCase() !== "separate";
  // Preserve each record's original project id before merge remaps it.
  const origOf = new WeakMap(records.map((r) => [r, r.projectId]));
  if (merge) {
    for (const r of records) {
      r.projectPath = pathOf(r.projectId);
      const top = topOf(r.projectId);
      if (top !== r.projectId) { r.projectId = top; r.projectName = projectNames.get(top) || r.projectName; }
    }
  }
  const unknownProjects = [...unknownIgnored];
  const wanted = (projects || []).map((p) => singleLine(p)).filter(Boolean);
  if (wanted.length) {
    // Every project name at any depth is known (0.9.38 accepted any project name).
    const names = new Set([...projectNames.values()].map((n) => String(n).toLowerCase()));
    const wantedLower = wanted.map((w) => w.toLowerCase());
    for (const w of wanted) if (!names.has(w.toLowerCase())) unknownProjects.push(w);
    // A named project includes itself plus all of its descendants.
    const namedIds = new Set();
    for (const [id, name] of projectNames) {
      if (wantedLower.includes(String(name).toLowerCase())) namedIds.add(String(id));
    }
    const isUnder = (candidateId, namedId) => {
      let cur = String(candidateId || ""); const seen = new Set();
      while (cur && projectNames.has(cur) && !seen.has(cur)) {
        if (cur === namedId) return true;
        seen.add(cur); cur = projectParent.get(cur) || "";
      }
      return false;
    };
    const closureIds = new Set();
    for (const nid of namedIds) {
      for (const [cid] of projectNames) {
        if (isUnder(cid, nid)) closureIds.add(String(cid));
      }
    }
    records = records.filter((r) => closureIds.has(String(origOf.get(r) || r.projectId)));
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
    `${r.projectPath || r.projectName}${r.sectionName ? " › " + r.sectionName : ""}`,
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

// Shared record builder used by buildTaskRecords and targetRecords (identical shape).
function mkRecord(t, projectNames, sectionNames, titles, taskUrl, now) {
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

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Matches a Todoist task / project / section link on app.todoist.com or todoist.com,
// plus todoist://task?id=. Captures kind, the raw id segment (slug allowed), an optional
// query string, or the todoist:// id. Trailing punctuation is stripped by linkId.
const TODOIST_LINK = /(?:https?:\/\/(?:app\.)?todoist\.com\/app\/(task|project|section)\/([^\s#?]+)(?:\?([^\s#]*))?)|(?:todoist:\/\/task\?id=([^\s#&]+))/gi;
const stripTrailing = (s) => String(s).replace(/[^A-Za-z0-9]+$/, "");
const stripSlug = (s) => { const i = String(s).lastIndexOf("-"); return i < 0 ? String(s) : String(s).slice(i + 1); };
const linkId = (raw) => stripSlug(stripTrailing(raw));

// Resolves a Todoist target from an instruction: a link (first match wins) or a name.
// Returns { kind, id, name, projectId }, { ambiguous: [...] } or null.
function resolveTodoistTarget(text, snapshot) {
  const snap = snapshot || {};
  const tasks = snap.tasks || [];
  const projects = snap.projects || [];
  const sections = snap.sections || [];
  const taskById = new Map(tasks.map((t) => [String(t.id), t]));
  const projectById = new Map(projects.map((p) => [String(p.id), p]));
  const sectionById = new Map(sections.map((s) => [String(s.id), s]));

  TODOIST_LINK.lastIndex = 0;
  const m = TODOIST_LINK.exec(String(text || ""));
  if (m) {
    let kind = null; let rawId = null; let projectId = null;
    if (m[4] !== undefined) { kind = "task"; rawId = m[4]; }
    else {
      kind = m[1]; rawId = m[2]; const query = m[3] || "";
      if (kind === "project") {
        const sec = /(?:^|&)section=([^&]*)/.exec(query);
        if (sec) {
          kind = "section";
          const s = sectionById.get(String(stripTrailing(sec[1])));
          if (s) return { kind: "section", id: String(s.id), name: s.name, projectId: String(s.projectId || "") };
          kind = null; // section id not in snapshot: link does not resolve
        } else {
          projectId = String(rawId);
        }
      }
    }
    if (kind) {
      const id = linkId(rawId);
      if (id) {
        if (kind === "task") {
          const t = taskById.get(String(id));
          if (t) return { kind: "task", id: String(t.id), name: t.content, projectId: String(t.projectId || "") };
        } else if (kind === "section") {
          const s = sectionById.get(String(id));
          if (s) return { kind: "section", id: String(s.id), name: s.name, projectId: String(s.projectId || "") };
        } else {
          const p = projectById.get(String(id));
          if (p) return { kind: "project", id: String(p.id), name: p.name, projectId: String(p.id) };
        }
      }
    }
    // link found but did not resolve: fall through to name matching below
  }

  const phrase = (name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
  const candidates = []; const seen = new Set();
  const add = (kind, id, name, projectId) => {
    const key = `${kind}:${String(id)}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ kind, id: String(id), name, projectId: String(projectId || "") });
  };
  for (const s of sections) {
    const name = String(s.name || "");
    if (name.length < 3) continue;
    if (phrase(name).test(String(text))) add("section", s.id, name, s.projectId);
  }
  for (const p of projects) {
    const name = String(p.name || "");
    if (name.length < 3) continue;
    if (phrase(name).test(String(text))) add("project", p.id, name, p.id);
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return { ambiguous: candidates };
}

// Returns every open task of the target (no sampling, no window, no cap), plus matching
// completed tasks when includeCompleted is true. Keeps snapshot order; no sub-project merge.
function targetRecords({ snapshot, completed = [], target, taskUrl, includeCompleted = false }) {
  const snap = snapshot || {};
  const now = new Date();
  const tasks = snap.tasks || [];
  const projects = snap.projects || [];
  const projectNames = new Map(projects.map((p) => [String(p.id), p.name]));
  const projectParent = new Map(projects.map((p) => [String(p.id), String(p.parentId ?? p.parent_id ?? "")]));
  const sectionNames = new Map((snap.sections || []).map((s) => [String(s.id), s.name]));
  const byId = new Map(tasks.map((t) => [String(t.id), t]));
  const titles = new Map(tasks.map((t) => [String(t.id), singleLine(t.content)]));
  const children = new Map();
  for (const t of tasks) {
    const pid = String(t.parentId || "");
    if (!children.has(pid)) children.set(pid, []);
    children.get(pid).push(t);
  }
  const projectClosure = (rootId) => {
    const out = new Set([String(rootId)]);
    for (const [pid] of projectNames) {
      let cur = pid; const seen = new Set();
      while (cur && projectNames.has(cur) && !seen.has(cur)) {
        if (cur === String(rootId)) { out.add(pid); break; }
        seen.add(cur); cur = projectParent.get(cur) || "";
      }
    }
    return out;
  };
  const collectDescendants = (rootIds) => {
    const out = []; const seen = new Set(); const queue = rootIds.map(String);
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      const t = byId.get(id);
      if (t) out.push(t);
      for (const c of (children.get(id) || [])) queue.push(String(c.id));
    }
    return out;
  };
  let rootIds = [];
  if (target && target.kind === "task") rootIds = [String(target.id)];
  else if (target && target.kind === "section") {
    rootIds = tasks.filter((t) => String(t.sectionId) === String(target.id)).map((t) => String(t.id));
  } else if (target && target.kind === "project") {
    const closure = projectClosure(target.id);
    rootIds = tasks.filter((t) => closure.has(String(t.projectId))).map((t) => String(t.id));
  }
  const selected = collectDescendants(rootIds);
  const selectedSet = new Set(selected.map((t) => String(t.id)));
  const records = [];
  const seen = new Set();
  for (const t of tasks) {
    const id = String(t.id);
    if (!selectedSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    records.push(mkRecord(t, projectNames, sectionNames, titles, taskUrl, now));
  }
  let skippedCompleted = 0;
  if (includeCompleted) {
    let matchCompleted;
    if (target && target.kind === "section") {
      const sid = String(target.id);
      matchCompleted = (c) => String(c.sectionId || "") === sid;
    } else if (target && target.kind === "project") {
      const closure = projectClosure(target.id);
      matchCompleted = (c) => closure.has(String(c.projectId || ""));
    } else if (target && target.kind === "task") {
      // A completed item attaches to a task target only as a child of the
      // target task or of one of the target's open descendants (by parentId).
      // Completed items without a usable parentId are skipped and counted.
      const attachable = new Set(collectDescendants([String(target.id)]).map((t) => String(t.id)));
      matchCompleted = (c) => {
        const pid = String(c.parentId || "");
        return Boolean(pid && attachable.has(pid));
      };
    } else {
      matchCompleted = () => false;
    }
    for (const c of completed) {
      const id = String(c.id || "");
      if (!matchCompleted(c) || seen.has(id)) { skippedCompleted++; continue; }
      seen.add(id);
      records.push(mkRecord(c, projectNames, sectionNames, titles, taskUrl, now));
    }
  } else {
    skippedCompleted = completed.length;
  }
  return { records, skippedCompleted };
}

// Plain bullets: - [title](url) · status [· due <label>], done shows `done <label>`.
// Subtasks indented two spaces under a parent that is also in records. Section headers
// (**<name>** / **No section**) only when records span more than one section.
function renderPullList(records) {
  if (!records || !records.length) return "";
  const byId = new Map(records.map((r) => [r.id, r]));
  const children = new Map(); const topLevel = [];
  for (const r of records) {
    const pid = String(r.parentId || "");
    if (pid && byId.has(pid)) {
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(r);
    } else {
      topLevel.push(r);
    }
  }
  const sectionKey = (r) => r.sectionName || "No section";
  const distinct = []; const seenSec = new Set();
  for (const r of records) {
    const k = sectionKey(r);
    if (!seenSec.has(k)) { seenSec.add(k); distinct.push(k); }
  }
  const multi = distinct.length > 1;
  const out = []; let lastKey = null;
  const line = (r, indent) => {
    const due = r.status === "done" ? dueLabel(r.completedAt) : dueLabel(r.due);
    const suffix = r.status === "done"
      ? ` · done ${due}`
      : ` · ${r.status}${due ? ` · due ${due}` : ""}`;
    const title = singleLine(r.title);
    const text = title ? markdownLinkText(title) : "(untitled task)";
    return `${indent}- [${text}](${r.url})${suffix}`;
  };
  const emit = (r, indent) => {
    if (indent === "" && multi) {
      const k = sectionKey(r);
      if (k !== lastKey) { out.push(`**${k}**`); lastKey = k; }
    }
    out.push(line(r, indent));
    for (const c of (children.get(r.id) || [])) emit(c, indent + "  ");
  };
  for (const r of topLevel) emit(r, "");
  return out.join("\n");
}

module.exports = { buildTaskRecords, taskStatus, notePathsFromDescription, followUpMap, groupByProject, taskEvidenceText, budgetRecords, renderTaskList, resolveTodoistTarget, targetRecords, renderPullList };
