"use strict";
// undo.createdSectionIds / createdTaskTempIds hold TEMP ids; the caller (Task 5) must replace them with real ids from the /sync temp_id_mapping before saving the undo record.
// Pure builders for Todoist /sync commands from approved change rows, plus the undo record.
// shortcut: temp_ids are only valid inside one /sync request; a created section used by moves
// that spill into a later batch of >100 commands is not re-sent. Upgrade if one plan nears 100 commands.

const BATCH_SIZE = 100;
const DESC_LIMIT = 16383; // Todoist description limit
const asArr = (v) => (Array.isArray(v) ? v : []);
const tasksOf = (s) => asArr(s && (s.tasks || s.items));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Accepts both the camelCase task shape and raw Todoist snake_case items.
function norm(t) {
  const due = t.due;
  return {
    id: String(t.id),
    content: t.content ?? "",
    description: t.description ?? "",
    priority: t.priority ?? 1,
    labels: asArr(t.labels).slice().sort(),
    dueDate: t.dueDate ?? (due && (due.date || (typeof due === "string" ? due : ""))) ?? "",
    deadlineDate: t.deadlineDate ?? (t.deadline && t.deadline.date) ?? "",
    projectId: t.projectId ?? t.project_id ?? "",
    sectionId: t.sectionId ?? t.section_id ?? "",
    parentId: t.parentId ?? t.parent_id ?? "",
    isCompleted: Boolean(t.isCompleted ?? t.checked ?? t.is_completed ?? false)
  };
}

// Row field name -> canonical task property.
const FIELD_PROP = { content: "content", description: "description", priority: "priority", labels: "labels", addLabels: "labels", removeLabels: "labels", dueDate: "dueDate", due: "dueDate", deadlineDate: "deadlineDate", deadline: "deadlineDate" };

function targetValue(target, key) {
  return target && Object.prototype.hasOwnProperty.call(target, key) ? target[key] || "" : undefined;
}

function touchedProps(row) {
  const props = new Set();
  for (const k of Object.keys(row.fields || {})) if (FIELD_PROP[k]) props.add(FIELD_PROP[k]);
  for (const k of ["projectId", "sectionId", "parentId"]) if (targetValue(row.target, k) !== undefined && row.op === "move") props.add(k);
  if (row.op === "complete" || row.op === "reopen" || row.op === "delete") props.add("isCompleted");
  return props;
}

function updateArgs(row, fresh, tempOf) {
  const f = row.fields || {};
  const args = {};
  if ("content" in f) args.content = f.content;
  if ("description" in f) args.description = f.description;
  if ("priority" in f) args.priority = f.priority;
  if ("labels" in f || "addLabels" in f || "removeLabels" in f) {
    const set = new Set("labels" in f ? asArr(f.labels) : fresh ? fresh.labels : []);
    asArr(f.addLabels).forEach((l) => set.add(l));
    asArr(f.removeLabels).forEach((l) => set.delete(l));
    args.labels = [...set];
  }
  const due = "dueDate" in f ? f.dueDate : f.due;
  if (due !== undefined) args.due = due ? { date: due } : null;
  const dl = "deadlineDate" in f ? f.deadlineDate : f.deadline;
  if (dl !== undefined) args.deadline = dl ? { date: dl } : null;
  return args;
}

function moveArgs(id, projectId, sectionId, parentId) {
  // Todoist item_move takes exactly one destination.
  const args = { id };
  if (parentId) args.parent_id = parentId;
  else if (sectionId) args.section_id = sectionId;
  else args.project_id = projectId;
  return args;
}

function chunk(cmds) {
  const out = [];
  for (let i = 0; i < cmds.length; i += BATCH_SIZE) out.push(cmds.slice(i, i + BATCH_SIZE));
  return out;
}

function buildApplyBatches(rows, previewSnapshot, freshSnapshot, uuid) {
  const pre = new Map(tasksOf(previewSnapshot).map((t) => [String(t.id), norm(t)]));
  const fresh = new Map(tasksOf(freshSnapshot).map((t) => [String(t.id), norm(t)]));
  const skipped = [];
  const sectionCmds = [];
  const cmds = [];
  const sectionTemp = new Map(); // row id of a create-section -> temp_id
  const entries = new Map();
  const undo = { at: Date.now(), entries: [], createdTaskTempIds: [], createdSectionIds: [] };
  const ref = (id) => (id && sectionTemp.has(id) ? sectionTemp.get(id) : id);

  for (const row of rows) {
    if (row.op !== "create-section") continue;
    const tempId = uuid();
    sectionTemp.set(row.id || row.tempId || tempId, tempId);
    sectionCmds.push({ type: "section_add", temp_id: tempId, uuid: uuid(), args: { name: (row.fields && row.fields.content) || row.name || "", project_id: row.target && row.target.projectId } });
    undo.createdSectionIds.push(tempId);
  }

  // Merge rows: row.taskId is merged away into row.fields.targetTaskId (the kept task). Produces no vault-line delete/move;
  // result.mergedAwayIds lets the caller tick those lines in place.
  const mergedAwayIds = [];
  const mergeGroups = new Map();
  for (const row of rows) if (row.op === "merge") {
    const keepId = String(row.fields && row.fields.targetTaskId);
    if (!mergeGroups.has(keepId)) mergeGroups.set(keepId, []);
    mergeGroups.get(keepId).push(row);
  }
  const MERGE_PROPS = ["description", "priority", "labels", "dueDate", "deadlineDate", "isCompleted"];
  const staleProps = (p, cur) => MERGE_PROPS.filter((k) => !same(p[k], cur[k]));
  const record = (id, p, fields, extra) => {
    if (entries.has(id)) { Object.assign(entries.get(id).previous.fields, fields); return; }
    const entry = { taskId: id, previous: { fields, projectId: p.projectId, sectionId: p.sectionId, parentId: p.parentId, checked: p.isCompleted, ...extra } };
    entries.set(id, entry);
    undo.entries.push(entry);
  };
  for (const [keepId, group] of mergeGroups) {
    const kp = pre.get(keepId);
    const kc = fresh.get(keepId);
    if (!kp || !kc || kc.isCompleted !== kp.isCompleted || staleProps(kp, kc).length) {
      for (const row of group) skipped.push({ row, reason: !kc ? "kept task no longer exists in Todoist" : "kept task changed in Todoist since preview" });
      continue;
    }
    const aways = [];
    for (const row of group) {
      const id = String(row.taskId);
      const p = pre.get(id);
      const cur = fresh.get(id);
      if (!cur) skipped.push({ row, reason: "task no longer exists in Todoist" });
      else if (!p) skipped.push({ row, reason: "task was not in preview" });
      else if (id === keepId) skipped.push({ row, reason: "cannot merge a task into itself" });
      else if (staleProps(p, cur).length) skipped.push({ row, reason: `changed in Todoist since preview (${staleProps(p, cur).join(", ")})` });
      else aways.push({ cur, p });
    }
    if (!aways.length) continue;
    const fields = {};
    let desc = kc.description;
    for (const { cur } of aways) {
      const text = cur.description.trim();
      if (!text || desc.includes(text) || desc.length >= DESC_LIMIT) continue;
      desc = (desc + `${desc ? "\n\n" : ""}From merged task: ${cur.content}\n${text}`).slice(0, DESC_LIMIT);
    }
    const labels = [...kc.labels];
    for (const { cur } of aways) for (const l of cur.labels) if (!labels.some((x) => x.toLowerCase() === l.toLowerCase())) labels.push(l);
    const earliest = (prop) => aways.map((x) => x.cur[prop]).filter(Boolean).sort((a, b) => String(a).slice(0, 10).localeCompare(String(b).slice(0, 10)))[0];
    const args = {};
    if (desc !== kc.description) args.description = desc;
    const prio = Math.max(...aways.map((x) => x.cur.priority));
    if (kc.priority <= 1 && prio > 1) args.priority = prio;
    if (labels.length !== kc.labels.length) args.labels = labels;
    if (!kc.dueDate && earliest("dueDate")) args.due = { date: earliest("dueDate") };
    if (!kc.deadlineDate && earliest("deadlineDate")) args.deadline = { date: earliest("deadlineDate") };
    for (const k of Object.keys(args)) fields[{ due: "dueDate", deadline: "deadlineDate" }[k] || k] = kc[{ due: "dueDate", deadline: "deadlineDate" }[k] || k];
    record(keepId, kp, {}, {});
    if (Object.keys(args).length) { Object.assign(entries.get(keepId).previous.fields, fields); cmds.push({ type: "item_update", uuid: uuid(), args: { id: keepId, ...args } }); }
    // Away entries precede subtask entries so undo reopens a parent before moving its subtasks back.
    for (const { cur, p } of aways) record(cur.id, p, { description: p.description }, { completedByChat: true });
    for (const { cur } of aways) for (const sub of fresh.values()) if (sub.parentId === cur.id) {
      record(sub.id, pre.get(sub.id) || sub, {}, {});
      cmds.push({ type: "item_move", uuid: uuid(), args: { id: sub.id, parent_id: keepId } });
    }
    for (const { cur } of aways) {
      const note = `merged into ${kc.content}`;
      const base = cur.description.slice(0, Math.max(0, DESC_LIMIT - note.length - 2));
      cmds.push({ type: "item_update", uuid: uuid(), args: { id: cur.id, description: base ? `${base}\n\n${note}` : note } });
      cmds.push({ type: "item_close", uuid: uuid(), args: { id: cur.id } });
      mergedAwayIds.push(cur.id);
    }
  }  for (const row of rows) {
    if (row.op === "create-section" || row.op === "merge") continue;
    if (row.op === "create") {
      const f = row.fields || {};
      const tempId = uuid();
      const args = { content: f.content, ...updateArgs({ fields: { ...f, content: undefined } }, null) };
      if (f.content === undefined) delete args.content; else args.content = f.content;
      const t = row.target || {};
      if (t.projectId) args.project_id = t.projectId;
      if (t.sectionId) args.section_id = ref(t.sectionId);
      if (t.parentId) args.parent_id = t.parentId;
      cmds.push({ type: "item_add", temp_id: tempId, uuid: uuid(), args });
      undo.createdTaskTempIds.push(tempId);
      continue;
    }
    const id = String(row.taskId);
    const p = pre.get(id);
    const cur = fresh.get(id);
    // Snapshots hold active tasks only, so a task to reopen is legitimately absent: send it.
    if (!cur && row.op === "reopen") {
      undo.entries.push({ taskId: id, previous: { fields: {}, projectId: p ? p.projectId : "", sectionId: p ? p.sectionId : "", parentId: p ? p.parentId : "", checked: true } });
      cmds.push({ type: "item_reopen", uuid: uuid(), args: { id } });
      continue;
    }
    if (!cur) { skipped.push({ row, reason: "task no longer exists in Todoist" }); continue; }
    if (!p) { skipped.push({ row, reason: "task was not in the preview" }); continue; }
    if (cur.isCompleted !== p.isCompleted) { skipped.push({ row, reason: "task completed or reopened in Todoist since the preview" }); continue; }
    const changed = [...touchedProps(row)].filter((k) => !same(p[k], cur[k]));
    if (changed.length) { skipped.push({ row, reason: `changed in Todoist since the preview (${changed.join(", ")})` }); continue; }

    if (row.op !== "delete") {
      if (!entries.has(id)) {
        const entry = { taskId: id, previous: { fields: {}, projectId: p.projectId, sectionId: p.sectionId, parentId: p.parentId, checked: p.isCompleted, ...(row.op === "complete" && { completedByChat: true }) } };
        entries.set(id, entry);
        undo.entries.push(entry);
      }
      for (const k of touchedProps(row)) if (["content", "description", "priority", "labels", "dueDate", "deadlineDate"].includes(k)) entries.get(id).previous.fields[k] = p[k];
    }

    if (row.op === "update") {
      const args = updateArgs(row, cur);
      if (Object.keys(args).length) cmds.push({ type: "item_update", uuid: uuid(), args: { id, ...args } });
    } else if (row.op === "move") {
      const t = row.target || {};
      const projectId = t.projectId !== undefined ? t.projectId : cur.projectId;
      const sectionId = ref(t.sectionId !== undefined ? t.sectionId : "");
      cmds.push({ type: "item_move", uuid: uuid(), args: moveArgs(id, projectId, sectionId, t.parentId || "") });
    } else if (row.op === "complete") cmds.push({ type: "item_close", uuid: uuid(), args: { id } });
    else if (row.op === "reopen") cmds.push({ type: "item_reopen", uuid: uuid(), args: { id } });
    else if (row.op === "delete") cmds.push({ type: "item_delete", uuid: uuid(), args: { id } });
  }
  return { batches: chunk([...sectionCmds, ...cmds]), skipped, undo, mergedAwayIds };
}

const PROP_ARG = { content: "content", description: "description", priority: "priority", labels: "labels" };

function buildUndoBatches(undo, freshSnapshot, uuid) {
  const fresh = new Map(tasksOf(freshSnapshot).map((t) => [String(t.id), norm(t)]));
  const cmds = [];
  const skipped = [];
  const created = new Set(asArr(undo.createdTaskTempIds).map(String));
  const finalSection = new Map();
  for (const e of asArr(undo.entries)) {
    const cur = fresh.get(String(e.taskId));
    // A chat-completed task leaves the active snapshot; reopen it by id.
    if (!cur && e.previous && e.previous.completedByChat) { cmds.push({ type: "item_reopen", uuid: uuid(), args: { id: String(e.taskId) } }); if (e.previous.fields && "description" in e.previous.fields) cmds.push({ type: "item_update", uuid: uuid(), args: { id: String(e.taskId), description: e.previous.fields.description } }); continue; }
    if (!cur) { skipped.push({ entry: e, reason: "task no longer exists in Todoist" }); continue; }
    const prev = e.previous || {};
    const args = {};
    for (const [k, v] of Object.entries(prev.fields || {})) {
      if (PROP_ARG[k]) args[PROP_ARG[k]] = v;
      else if (k === "dueDate") args.due = v ? { date: v } : null;
      else if (k === "deadlineDate") args.deadline = v ? { date: v } : null;
    }
    if (Object.keys(args).length) cmds.push({ type: "item_update", uuid: uuid(), args: { id: cur.id, ...args } });
    if (cur.projectId !== (prev.projectId || "") || cur.sectionId !== (prev.sectionId || "") || cur.parentId !== (prev.parentId || "")) {
      cmds.push({ type: "item_move", uuid: uuid(), args: moveArgs(cur.id, prev.projectId, prev.sectionId, prev.parentId) });
      finalSection.set(cur.id, prev.sectionId || "");
    }
    if (prev.checked === false && cur.isCompleted) cmds.push({ type: "item_reopen", uuid: uuid(), args: { id: cur.id } });
    else if (prev.checked === true && !cur.isCompleted) cmds.push({ type: "item_close", uuid: uuid(), args: { id: cur.id } });
  }
  for (const id of created) if (fresh.has(id)) cmds.push({ type: "item_delete", uuid: uuid(), args: { id } });
  // Delete a created section only if nothing will remain in it.
  for (const sid of asArr(undo.createdSectionIds)) {
    const occupied = [...fresh.values()].some((t) => !created.has(t.id) && (finalSection.has(t.id) ? finalSection.get(t.id) : t.sectionId) === sid);
    if (!occupied) cmds.push({ type: "section_delete", uuid: uuid(), args: { id: sid } });
  }
  return { batches: chunk(cmds), skipped };
}

module.exports = { buildApplyBatches, buildUndoBatches };
