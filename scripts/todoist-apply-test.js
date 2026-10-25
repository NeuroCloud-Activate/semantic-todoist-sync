"use strict";
const assert = require("assert");
const { buildApplyBatches, buildUndoBatches } = require("../src/todoist/apply.js");

const item = (o) => ({ id: "t1", content: "Buy compost", description: "", projectId: "p1", sectionId: "", parentId: "", labels: ["home"], priority: 1, dueDate: "2026-11-01", deadlineDate: "", isCompleted: false, ...o });
const snap = (tasks) => ({ tasks, projects: [], sections: [], labels: [] });
let n = 0;
const uuid = () => "u" + ++n;
const all = (r) => r.batches.flat();

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("stale deleted task skipped, not sent", () => {
  const rows = [{ op: "update", taskId: "t1", fields: { priority: 3 } }, { op: "update", taskId: "t2", fields: { priority: 3 } }];
  const pre = snap([item({ id: "t1" }), item({ id: "t2" })]);
  const fresh = snap([item({ id: "t1" })]);
  const r = buildApplyBatches(rows, pre, fresh, uuid);
  assert.strictEqual(all(r).length, 1);
  assert.strictEqual(all(r)[0].args.id, "t1");
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.skipped[0].row.taskId, "t2");
  assert.ok(r.skipped[0].reason);
});

test("completed since preview skipped", () => {
  const rows = [{ op: "update", taskId: "t1", fields: { priority: 3 } }];
  const r = buildApplyBatches(rows, snap([item()]), snap([item({ isCompleted: true })]), uuid);
  assert.strictEqual(all(r).length, 0);
  assert.strictEqual(r.skipped.length, 1);
});

test("task whose touched field changed skipped", () => {
  const rows = [{ op: "update", taskId: "t1", fields: { priority: 3 } }];
  const r = buildApplyBatches(rows, snap([item()]), snap([item({ priority: 2 })]), uuid);
  assert.strictEqual(all(r).length, 0);
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.undo.entries.length, 0);
});

test("untouched field change elsewhere does not skip", () => {
  const rows = [{ op: "update", taskId: "t1", fields: { priority: 3 } }];
  const r = buildApplyBatches(rows, snap([item()]), snap([item({ content: "Renamed" })]), uuid);
  assert.strictEqual(r.skipped.length, 0);
  assert.deepStrictEqual(all(r)[0].args, { id: "t1", priority: 3 });
  assert.strictEqual(all(r)[0].type, "item_update");
});

test("labels add/remove and due/deadline map to args", () => {
  const rows = [{ op: "update", taskId: "t1", fields: { addLabels: ["x"], removeLabels: ["home"], dueDate: "2026-12-01", deadlineDate: "" } }];
  const r = buildApplyBatches(rows, snap([item()]), snap([item()]), uuid);
  assert.deepStrictEqual(all(r)[0].args, { id: "t1", labels: ["x"], due: { date: "2026-12-01" }, deadline: null });
});

test("250 updates become batches of 100,100,50", () => {
  const items = [], rows = [];
  for (let i = 0; i < 250; i++) { items.push(item({ id: "i" + i })); rows.push({ op: "update", taskId: "i" + i, fields: { priority: 4 } }); }
  const r = buildApplyBatches(rows, snap(items), snap(items), uuid);
  assert.deepStrictEqual(r.batches.map((b) => b.length), [100, 100, 50]);
  assert.strictEqual(new Set(all(r).map((c) => c.uuid)).size, 250);
});

test("undo restores fields, moves back, reopens completed, deletes created section only if empty", () => {
  const before = item({ sectionId: "s1", labels: ["home"], priority: 1 });
  const rows = [
    { op: "update", taskId: "t1", fields: { priority: 4 } },
    { op: "move", taskId: "t1", target: { projectId: "p2" } },
    { op: "complete", taskId: "t2", fields: {} },
    { op: "create", fields: { content: "New" }, target: { projectId: "p1" } }
  ];
  const pre = snap([before, item({ id: "t2" })]);
  const r = buildApplyBatches(rows, pre, pre, uuid);
  assert.strictEqual(r.undo.entries.length, 2);
  assert.strictEqual(r.undo.createdTaskTempIds.length, 1);
  const afterItems = [item({ projectId: "p2", sectionId: "", priority: 4 }), item({ id: "t2", isCompleted: true }), item({ id: "real1", projectId: "p1" })];
  const undo = { ...r.undo, createdTaskTempIds: ["real1"], createdSectionIds: ["sA", "sB"] };
  const fresh = { ...snap(afterItems), sections: [{ id: "sA", projectId: "p1" }, { id: "sB", projectId: "p1" }] };
  fresh.tasks.push(item({ id: "t9", sectionId: "sB" }));
  const u = buildUndoBatches(undo, fresh, uuid);
  const cmds = all(u);
  const of = (type, id) => cmds.filter((c) => c.type === type && c.args.id === id);
  assert.strictEqual(of("item_update", "t1").length, 1);
  assert.strictEqual(of("item_update", "t1")[0].args.priority, 1);
  assert.strictEqual(of("item_move", "t1")[0].args.section_id, "s1");
  assert.strictEqual(of("item_reopen", "t2").length, 1);
  assert.strictEqual(of("item_delete", "real1").length, 1);
  assert.strictEqual(of("section_delete", "sA").length, 1);
  assert.strictEqual(of("section_delete", "sB").length, 0);
});

test("undo skips task deleted since", () => {
  const undo = { at: 1, entries: [{ taskId: "gone", previous: { fields: { priority: 1 }, projectId: "p1", sectionId: "", parentId: "", checked: false } }], createdTaskTempIds: [], createdSectionIds: [] };
  const u = buildUndoBatches(undo, snap([]), uuid);
  assert.strictEqual(all(u).length, 0);
  assert.strictEqual(u.skipped.length, 1);
});

test("delete has no undo entry", () => {
  const rows = [{ op: "delete", taskId: "t1", fields: {} }];
  const r = buildApplyBatches(rows, snap([item()]), snap([item()]), uuid);
  assert.strictEqual(all(r)[0].type, "item_delete");
  assert.strictEqual(r.undo.entries.length, 0);
});

test("create-section precedes moves that use it, via temp_id", () => {
  const rows = [
    { op: "move", taskId: "t1", target: { projectId: "p1", sectionId: "sec-new" } },
    { op: "create-section", id: "sec-new", fields: { content: "Later" }, target: { projectId: "p1" } }
  ];
  const r = buildApplyBatches(rows, snap([item()]), snap([item()]), uuid);
  const cmds = r.batches[0];
  assert.strictEqual(cmds[0].type, "section_add");
  assert.strictEqual(cmds[0].args.name, "Later");
  assert.ok(cmds[0].temp_id);
  assert.strictEqual(cmds[1].type, "item_move");
  assert.strictEqual(cmds[1].args.section_id, cmds[0].temp_id);
  assert.deepStrictEqual(r.undo.createdSectionIds, [cmds[0].temp_id]);
});

test("items alias still accepted", () => {
  const s = { items: [item()], projects: [], sections: [] };
  const r = buildApplyBatches([{ op: "update", taskId: "t1", fields: { priority: 3 } }], s, s, uuid);
  assert.strictEqual(all(r)[0].type, "item_update");
});

test("real {tasks} snapshot: move and priority update produce commands", () => {
  const s = { tasks: [item()], projects: [{ id: "p2", name: "Work" }], sections: [] };
  const rows = [{ op: "move", taskId: "t1", target: { projectId: "p2" }, fields: {} }, { op: "update", taskId: "t1", fields: { priority: 4 } }];
  const r = buildApplyBatches(rows, s, s, uuid);
  assert.strictEqual(r.skipped.length, 0);
  assert.deepStrictEqual(all(r).map((c) => c.type).sort(), ["item_move", "item_update"]);
});

test("undo with {tasks} snapshot restores previous values", () => {
  const s = { tasks: [item()], projects: [], sections: [] };
  const r = buildApplyBatches([{ op: "update", taskId: "t1", fields: { priority: 4 } }], s, s, uuid);
  const u = buildUndoBatches(r.undo, { tasks: [item({ priority: 4 })], projects: [], sections: [] }, uuid);
  assert.strictEqual(all(u).length, 1);
  assert.strictEqual(all(u)[0].args.priority, 1);
});

test("undo of complete reopens although task is absent from active snapshot", () => {
  const s = { tasks: [item()], projects: [], sections: [] };
  const r = buildApplyBatches([{ op: "complete", taskId: "t1", fields: {} }], s, s, uuid);
  const u = buildUndoBatches(r.undo, { tasks: [], projects: [], sections: [] }, uuid);
  assert.deepStrictEqual(all(u).map((c) => [c.type, c.args.id]), [["item_reopen", "t1"]]);
  assert.strictEqual(u.skipped.length, 0);
});

test("reopen row not skipped when task absent from active snapshot", () => {
  const pre = { tasks: [item({ isCompleted: true })], projects: [], sections: [] };
  const r = buildApplyBatches([{ op: "reopen", taskId: "t1", fields: {} }], pre, { tasks: [], projects: [], sections: [] }, uuid);
  assert.deepStrictEqual(all(r).map((c) => [c.type, c.args.id]), [["item_reopen", "t1"]]);
  assert.strictEqual(r.skipped.length, 0);
});

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n" + (e && e.stack)); }
}
process.exit(failed ? 1 : 0);
