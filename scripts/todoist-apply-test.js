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

const merge = (taskId, keep) => ({ op: "merge", taskId, fields: { targetTaskId: keep } });
const mergeRun = (rows, tasks, fresh) => buildApplyBatches(rows, snap(tasks), snap(fresh || tasks), uuid);
const updateOf = (r, id) => all(r).find((c) => c.type === "item_update" && c.args.id === id);

test("merge: kept task's values win, blanks filled (priority highest, due/deadline earliest only if kept has none)", () => {
  const keep = item({ id: "k", content: "Keep", priority: 1, dueDate: "", deadlineDate: "" });
  const a = item({ id: "a", content: "A", priority: 4, dueDate: "2026-12-05", deadlineDate: "2026-12-09" });
  const b = item({ id: "b", content: "B", priority: 1, dueDate: "2026-12-01T10:00:00", deadlineDate: "2026-12-20" });
  const r = mergeRun([merge("a", "k"), merge("b", "k")], [keep, a, b]);
  const u = updateOf(r, "k");
  assert.strictEqual(u.args.priority, 4);
  assert.deepStrictEqual(u.args.due, { date: "2026-12-01T10:00:00" });
  assert.deepStrictEqual(u.args.deadline, { date: "2026-12-09" });
  assert.strictEqual("content" in u.args, false);
  const kept = item({ id: "k", priority: 2, dueDate: "2026-11-30", deadlineDate: "2026-11-30" });
  const r2 = mergeRun([merge("a", "k")], [kept, a]);
  assert.strictEqual(updateOf(r2, "k"), undefined);
});
test("merge: labels unioned", () => {
  const r = mergeRun([merge("a", "k")], [item({ id: "k", labels: ["home"] }), item({ id: "a", labels: ["work", "home"] })]);
  assert.deepStrictEqual(updateOf(r, "k").args.labels.slice().sort(), ["home", "work"]);
});
test("merge: others' descriptions appended under 'From merged task', skipping text already present", () => {
  const keep = item({ id: "k", description: "Own text\nshared line" });
  const a = item({ id: "a", content: "Task A", description: "from a" });
  const b = item({ id: "b", content: "Task B", description: "shared line" });
  const c = item({ id: "c", content: "Task C", description: "" });
  const u = updateOf(mergeRun([merge("a", "k"), merge("b", "k"), merge("c", "k")], [keep, a, b, c]), "k");
  assert.strictEqual(u.args.description, "Own text\nshared line\n\nFrom merged task: Task A\nfrom a");
});
test("merge: appended description cut to 16383, kept task's own text never cut", () => {
  const own = "x".repeat(16000);
  const u = updateOf(mergeRun([merge("a", "k")], [item({ id: "k", description: own }), item({ id: "a", content: "A", description: "y".repeat(5000) })]), "k");
  assert.strictEqual(u.args.description.length, 16383);
  assert.ok(u.args.description.startsWith(own));
  const full = "z".repeat(16383);
  const r = mergeRun([merge("a", "k")], [item({ id: "k", description: full }), item({ id: "a", description: "more" })]);
  assert.strictEqual(updateOf(r, "k"), undefined);
});
test("merge: others' subtasks moved under kept, order kept", () => {
  const tasks = [item({ id: "k", content: "Keep" }), item({ id: "a" }), item({ id: "s1", parentId: "a" }), item({ id: "s2", parentId: "a" }), item({ id: "s3", parentId: "a" })];
  const cmds = all(mergeRun([merge("a", "k")], tasks));
  const moves = cmds.filter((c) => c.type === "item_move");
  assert.deepStrictEqual(moves.map((c) => [c.args.id, c.args.parent_id]), [["s1", "k"], ["s2", "k"], ["s3", "k"]]);
  assert.ok(cmds.indexOf(moves[2]) < cmds.findIndex((c) => c.type === "item_close"));
});
test("merge: others completed with 'merged into' note, not deleted", () => {
  const r = mergeRun([merge("a", "k")], [item({ id: "k", content: "Keep" }), item({ id: "a", description: "old note" })]);
  const cmds = all(r);
  const note = updateOf(r, "a");
  assert.strictEqual(note.args.description, "old note\n\nmerged into Keep");
  assert.ok(cmds.indexOf(note) < cmds.findIndex((c) => c.type === "item_close" && c.args.id === "a"));
  assert.strictEqual(cmds.some((c) => c.type === "item_delete"), false);
});
test("merge: merged-away vault lines stay ticked in place, no line removed", () => {
  const r = mergeRun([merge("a", "k"), merge("b", "k")], [item({ id: "k" }), item({ id: "a" }), item({ id: "b" })]);
  assert.deepStrictEqual(r.mergedAwayIds, ["a", "b"]);
  assert.strictEqual(all(r).some((c) => c.type === "item_delete" || (c.type === "item_move" && (c.args.id === "a" || c.args.id === "b"))), false);
});
test("merge: stale kept or merged-away task skipped, nothing sent for it", () => {
  const pre = [item({ id: "k" }), item({ id: "a", priority: 1 })];
  const r = mergeRun([merge("a", "k")], pre, [item({ id: "k" }), item({ id: "a", priority: 3 })]);
  assert.strictEqual(all(r).length, 0);
  assert.strictEqual(r.skipped.length, 1);
  assert.deepStrictEqual(r.mergedAwayIds, []);
  const r2 = mergeRun([merge("a", "k")], pre, [item({ id: "a" })]);
  assert.strictEqual(all(r2).length, 0);
  assert.strictEqual(r2.skipped.length, 1);
});
test("merge: undo reopens and restores", () => {
  const tasks = [item({ id: "k", description: "own", priority: 1, labels: ["home"], dueDate: "", content: "Keep" }), item({ id: "a", description: "a-desc", priority: 4, dueDate: "2026-12-05", labels: ["work"] }), item({ id: "s1", parentId: "a" })];
  const r = mergeRun([merge("a", "k")], tasks);
  const after = [item({ id: "k", description: "changed", priority: 4, labels: ["home", "work"], dueDate: "2026-12-05", content: "Keep" }), item({ id: "s1", parentId: "k" })];
  const cmds = all(buildUndoBatches(r.undo, snap(after), uuid));
  const idx = (t, id) => cmds.findIndex((c) => c.type === t && c.args.id === id);
  const k = cmds.find((c) => c.type === "item_update" && c.args.id === "k");
  assert.strictEqual(k.args.description, "own");
  assert.strictEqual(k.args.priority, 1);
  assert.deepStrictEqual(k.args.labels, ["home"]);
  assert.strictEqual(k.args.due, null);
  assert.ok(idx("item_reopen", "a") >= 0);
  const a = cmds.find((c) => c.type === "item_update" && c.args.id === "a");
  assert.strictEqual(a.args.description, "a-desc");
  assert.ok(idx("item_reopen", "a") < idx("item_move", "s1"));
  assert.strictEqual(cmds[idx("item_move", "s1")].args.parent_id, "a");
});
let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log("PASS " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n" + (e && e.stack)); }
}
process.exit(failed ? 1 : 0);
