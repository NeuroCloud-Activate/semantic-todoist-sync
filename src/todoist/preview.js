"use strict";

// Plain-language preview rows for a validated change plan (rows as validateChangePlan emits them). Pure: no settings or Todoist imports.
const KINDS = ["moves", "labels", "dates", "completions", "creates", "merges", "edits"];

function kindOf(row) {
  const f = row.fields || {};
  if (row.op === "move") return "moves";
  if (row.op === "complete" || row.op === "reopen") return "completions";
  if (row.op === "create" || row.op === "create-section") return "creates";
  if (row.op === "merge") return "merges";
  if ("labels" in f || "addLabels" in f || "removeLabels" in f) return "labels";
  if ("dueDate" in f || "deadlineDate" in f) return "dates";
  return "edits";
}

function buildPreview(rows, snapshot, { placementFor } = {}) {
  const snap = snapshot || {};
  const tasks = snap.tasks || snap.items || [];
  const byId = new Map(tasks.map((t) => [String(t.id), t]));
  const projects = new Map((snap.projects || []).map((p) => [String(p.id), p]));
  const sections = new Map((snap.sections || []).map((s) => [String(s.id), s]));
  const cache = snap.cache || {};
  const projName = (id) => (projects.get(String(id)) || {}).name || "Inbox";
  const where = (projectId, sectionId) =>
    projName(projectId) + (sectionId && sections.get(String(sectionId)) ? ` / ${sections.get(String(sectionId)).name}` : "");
  const list = (a) => (a.length ? a.join(", ") : "no labels");
  const day = (d) => (d ? String(d).slice(0, 10) : "no date");
  const LABEL_KEYS = ["labels", "addLabels", "removeLabels"], DATE_KEYS = ["dueDate", "deadlineDate"];
  const otherKeys = (f) => Object.keys(f).filter((k) => !LABEL_KEYS.includes(k) && !DATE_KEYS.includes(k));
  const isMixed = (f) => [LABEL_KEYS.some((k) => k in f), DATE_KEYS.some((k) => k in f), otherKeys(f).length > 0].filter(Boolean).length > 1;
  // Mixed-category update: one row whose sentence names every changed field (before -> after).
  const dateParts = (task, f, parts) => {
    if ("dueDate" in f) parts.push(`due ${day(task.dueDate)} -> ${day(f.dueDate)}`);
    if ("deadlineDate" in f) parts.push(`deadline ${day(task.deadlineDate)} -> ${day(f.deadlineDate)}`);
  };
  const PRIO = { 4: "P1", 3: "P2", 2: "P3", 1: "P4" }; // API 4 = highest = Todoist P1
  const WORD = { content: "title", dueDate: "due date", deadlineDate: "deadline" };
  const show = (k, v) => (v === undefined || v === null || v === "" ? "(none)" : k === "priority" ? PRIO[v] || String(v) : `"${v}"`);
  const otherParts = (task, f, parts) => {
    for (const k of otherKeys(f)) parts.push(`${WORD[k] || k} ${show(k, task[k])} -> ${show(k, f[k])}`);
  };
  const make = (row, i) => {
    const task = byId.get(String(row.taskId)) || {};
    const f = row.fields || {};
    const t = row.target || {};
    const title = task.content || f.content || "task";
    const warnings = [];
    let sentence;
    let before = "";
    let after = "";
    let writesTo;
    if (row.op === "move") {
      before = where(task.projectId, task.sectionId);
      after = where(t.projectId || task.projectId, t.sectionId);
      sentence = `Move "${title}" from ${before} to ${after}`;
    } else if (row.op === "create") {
      const p = placementFor ? placementFor(row) : null;
      after = where(t.projectId, t.sectionId);
      sentence = `Add "${title}" to ${after}`;
      if (p) { writesTo = p.path; sentence += `; a note line will be written to ${p.path} under "${p.heading}"`; }
    } else if (row.op === "create-section") {
      after = f.content || "";
      sentence = `Create section "${after}" in ${projName(t.projectId)}`;
    } else if (row.op === "complete" || row.op === "reopen") {
      before = row.op === "complete" ? "open" : "done";
      after = row.op === "complete" ? "done" : "open";
      sentence = `${row.op === "complete" ? "Mark done" : "Reopen"} "${title}"`;
    } else if (row.op === "delete") {
      before = "exists"; after = "deleted";
      sentence = `Delete "${title}"`;
      warnings.push("Deletes can't be undone");
    } else if (row.op === "merge") {
      const keep = byId.get(String(f.targetTaskId)) || {};
      sentence = `Merge "${title}" into "${keep.content || "another task"}"`;
    } else if ("labels" in f || "addLabels" in f || "removeLabels" in f) {
      const cur = task.labels || [];
      const gone = (f.removeLabels || []).map((l) => String(l).toLowerCase());
      const next = "labels" in f ? f.labels : [...cur, ...(f.addLabels || [])].filter((l) => !gone.includes(String(l).toLowerCase()));
      before = list(cur);
      after = list(next);
      sentence = `Change labels on "${title}" from ${before} to ${after}`;
      if (isMixed(f)) {
        const parts = [`labels from ${before} to ${after}`];
        dateParts(task, f, parts, null);
        otherParts(task, f, parts);
        sentence = `Change "${title}": ${parts.join("; ")}`;
        before = ""; after = "";
      }
    } else if ("dueDate" in f || "deadlineDate" in f) {
      const b = [], a = [];
      if ("dueDate" in f) { b.push(`due ${day(task.dueDate)}`); a.push(`due ${day(f.dueDate)}`); }
      if ("deadlineDate" in f) { b.push(`deadline ${day(task.deadlineDate)}`); a.push(`deadline ${day(f.deadlineDate)}`); }
      before = b.join(", ");
      after = a.join(", ");
      sentence = `Change dates on "${title}" from ${before} to ${after}`;
      if (isMixed(f)) {
        const parts = [];
        dateParts(task, f, parts, true);
        otherParts(task, f, parts);
        sentence = `Change "${title}": ${parts.join("; ")}`;
        before = ""; after = "";
      }
    } else {
      const keys = Object.keys(f);
      after = keys.map((k) => `${WORD[k] || k}: ${k === "priority" ? show(k, f[k]) : f[k]}`).join(", ");
      sentence = `Update "${title}" (${keys.map((k) => WORD[k] || k).join(", ")})`;
    }
    if (row.newLabels && row.newLabels.length) warnings.push(`New label: ${row.newLabels.join(", ")}`);
    if (task.isRecurring) warnings.push("Recurring task");
    if (row.taskId && tasks.some((x) => x.parentId && String(x.parentId) === String(row.taskId))) warnings.push("Has subtasks");
    if (row.taskId && cache[row.taskId] && cache[row.taskId].path) warnings.push("Linked to a note");
    const pids = [task.projectId, t.projectId].filter(Boolean);
    if (pids.some((id) => (projects.get(String(id)) || {}).isShared)) warnings.push("Shared project");
    const out = { id: `row-${i}`, sentence, before, after, warnings, ticked: row.op !== "delete" };
    if (writesTo) out.writesTo = writesTo;
    return out;
  };
  const all = rows.map((r, i) => ({ row: r, pr: make(r, i) }));
  const buckets = new Map(KINDS.map((k) => [k, []]));
  const deletes = [];
  for (const { row, pr } of all) (row.op === "delete" ? deletes : buckets.get(kindOf(row))).push(pr);
  const groups = KINDS.filter((k) => buckets.get(k).length).map((kind) => ({ kind, rows: buckets.get(kind) }));
  const tasksTouched = new Set(rows.map((r, i) => r.taskId || `new-${i}`)).size;
  const n = rows.length;
  const summary = `${n} change${n === 1 ? "" : "s"} to ${tasksTouched} task${tasksTouched === 1 ? "" : "s"}`;
  return { summary, groups, deletes };
}

module.exports = { buildPreview };
