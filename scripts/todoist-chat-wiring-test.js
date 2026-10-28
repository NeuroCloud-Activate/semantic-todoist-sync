"use strict";
// Task 5: chat look-up, change preview, apply and undo wiring in src/main.js. Every Todoist and model call is stubbed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = path.join(__dirname, "..", "src/main.js");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
let requestHandler = () => { throw new Error("network disabled in test"); };
const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class Empty { open() { globalThis.__lastOpenedModal = this; } }
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: Empty, Plugin: Empty,
    PluginSettingTab: Empty, Setting: Empty, TFile: Empty, setIcon() {},
    requestUrl: async (options) => requestHandler(options)
  };
};
let Plugin;
try {
  global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
  testModule._compile(fs.readFileSync(mainPath, "utf8"), mainPath);
  Plugin = testModule.exports;
} finally {
  Module._load = originalLoad;
}

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const task = (o) => ({ id: "t1", content: "Buy compost", description: "", parentId: "", sectionId: "", projectId: "p1", labels: [], priority: 1, dueDate: "", deadlineDate: "", duration: null, isCompleted: false, ...o });
const baseSnapshot = (tasks) => ({ tasks, projects: [{ id: "p1", name: "Home", isInbox: false }, { id: "pin", name: "Inbox", isInbox: true }], sections: [], fetchedAt: "2026-10-25T10:00:00" });

// model replies keyed by operation; counters expose what ran
function makePlugin({ lookup, answer, token = "tok", snapshot = baseSnapshot([task({ id: "t1" })]), context = [], taskCache = {} } = {}) {
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { todoistToken: token, autoAddActiveContentToContext: false, taskCache, scheduleTodayLastUndo: { sentinel: true } });
  plugin.calls = { snapshot: [], sync: [], ops: [], saves: 0, lineUpdates: [], checks: [] };
  plugin.saveSettings = async () => { plugin.calls.saves += 1; };
  for (const name of ["logLocal", "recordDebugDiagnostic", "setSidebarStatus", "markTaskReferenceStateDirty"]) plugin[name] = () => {};
  for (const name of ["ensureCompatibleEmbeddingForChatModel", "tryUpdateSchedulerMemoryFromChat", "tryUpdateTaskDeduplicationPolicyFromChat", "buildTaskContext"]) plugin[name] = async () => "";
  plugin.requireAiAccess = () => {};
  plugin.retrieveAdaptiveSemanticContext = async () => context.slice();
  plugin.aiModelForRequest = () => ({ model: "fictional-model" });
  plugin.withAiActivity = async (label, work) => work();
  plugin.getTodoistSnapshot = async (types, force) => { plugin.calls.snapshot.push({ force: Boolean(force) }); return plugin.snapshotNow || snapshot; };
  plugin.snapshotNow = null;
  plugin.todoistSync = async (commands) => { plugin.calls.sync.push(commands); return plugin.syncResponse ? plugin.syncResponse(commands, plugin.calls.sync.length) : { sync_status: {}, temp_id_mapping: {} }; };
  plugin.updateTaskLineFromTodoist = async (id) => { plugin.calls.lineUpdates.push(id); };
  plugin.setTaskLineChecked = async (id, checked) => { plugin.calls.checks.push({ id, checked }); };
  plugin.openaiResponse = async (request) => {
    plugin.calls.ops.push(request.operation);
    if (request.operation === "todoist-lookup") return JSON.stringify(lookup);
    return JSON.stringify(typeof answer === "function" ? answer(request) : answer);
  };
  return plugin;
}
const lookupOf = (o) => ({ needsTodoist: true, kind: "question", filters: { words: [], projects: [], labels: [] }, refersToLastAnswer: false, ...o });
const claims = (ids = []) => ({ claims: [{ text: "Compost is on your list.", established: ids.length > 0, evidence_ids: ids, category: ids.length ? "fact" : "unsupported", topic: "Compost" }] });

test("models see user-facing priorities P1 (highest) to P4, not raw API numbers", async () => {
  let text = "";
  const p = makePlugin({
    lookup: lookupOf({ kind: "change", filters: { words: ["compost"], projects: [], labels: [] } }),
    answer: (request) => { text = `${request.system}\n${request.user}`; return claims(); }
  });
  p.snapshotNow = null;
  p.getTodoistSnapshot = async () => ({ tasks: [task({ id: "t1", priority: 4 }), task({ id: "t2", content: "Buy compost 2", priority: 1 })], projects: [], sections: [], fetchedAt: "" });
  await p.chat("Make the compost task urgent", null, [], "chat-query", { todoist: true });
  assert.ok(/\| t1 \| Buy compost \|[^\n]*\| P1 \|/.test(text), "API 4 shown as P1");
  assert.ok(/\| t2 \| Buy compost 2 \|[^\n]*\| P4 \|/.test(text), "API 1 shown as P4");
  assert.ok(!/\| p[1-4] \|/.test(text), "no raw pN priority");
  assert.ok(/P1 \(highest\)/.test(text), "header explains P1 highest");
  assert.ok(/API (priority )?4, 3, 2, 1/.test(text) && /P1.*P4|P1, P2, P3, P4/.test(text), "change instruction maps P1..P4 to API 4..1");
  assert.ok(/name priorities only as P1-P4[^\n]*never mention API numbers/.test(text), "answer must not expose API numbers");
});

test("vault-only question never fetches snapshot", async () => {
  const p = makePlugin({ lookup: lookupOf({ needsTodoist: false, kind: "none" }), answer: claims() });
  const r = await p.chat("What did the vendor notes say about invoices?", null, [], "chat-query", { todoist: true });
  assert.ok(r.answer);
  assert.equal(p.calls.snapshot.length, 0);
  assert.equal(r.todoistChanges, undefined);
});

test("chat turn never calls todoistSync even when model returns a changePlan", async () => {
  const p = makePlugin({
    lookup: lookupOf({ kind: "change", filters: { words: ["compost"], projects: [], labels: [] } }),
    answer: { ...claims(), changePlan: { changes: [{ op: "update", taskId: "t1", priority: 4 }] } }
  });
  const r = await p.chat("Make the compost task urgent", null, [], "chat-query", { todoist: true });
  assert.equal(p.calls.sync.length, 0);
  assert.equal(r.todoistChanges.rows.length, 1);
  assert.equal(p.calls.snapshot.every((c) => c.force === false), true);
});

test("apply re-fetches force=true and sends batches", async () => {
  const tasks = Array.from({ length: 120 }, (_, i) => task({ id: `t${i}`, content: `Task ${i}` }));
  const snapshot = baseSnapshot(tasks);
  const rows = tasks.map((t) => ({ op: "update", taskId: t.id, fields: { priority: 3 }, newLabels: [] }));
  const p = makePlugin({ snapshot });
  const r = await p.applyTodoistChanges({ rows, snapshot }, rows.map((_, i) => `row-${i}`));
  assert.deepEqual(p.calls.snapshot[0], { force: true });
  assert.deepEqual(p.calls.sync.map((b) => b.length), [100, 20]);
  assert.equal(r.applied, 120);
  assert.equal(r.failedAt, undefined);
});

test("partial batch failure keeps undo of applied batches only", async () => {
  const tasks = Array.from({ length: 120 }, (_, i) => task({ id: `t${i}`, content: `Task ${i}` }));
  const snapshot = baseSnapshot(tasks);
  const rows = tasks.map((t) => ({ op: "update", taskId: t.id, fields: { priority: 3 }, newLabels: [] }));
  const p = makePlugin({ snapshot });
  p.syncResponse = (commands, n) => { if (n === 2) throw new Error("network dropped"); return { sync_status: {}, temp_id_mapping: {} }; };
  const r = await p.applyTodoistChanges({ rows, snapshot }, rows.map((_, i) => `row-${i}`));
  assert.equal(r.failedAt, 1);
  assert.equal(r.applied, 100);
  const ids = p.settings.todoistChatLastUndo.entries.map((e) => e.taskId);
  assert.equal(ids.length, 100);
  assert.ok(ids.includes("t0") && ids.includes("t99") && !ids.includes("t100") && !ids.includes("t119"));
});

test("no token: answer still returned and says Todoist wasn't available", async () => {
  const p = makePlugin({ token: "", lookup: lookupOf({ filters: { words: ["compost"], projects: [], labels: [] } }), answer: claims() });
  const r = await p.chat("Which of my Todoist tasks mention compost?", null, [], "chat-query", { todoist: true });
  assert.ok(r.answer.includes("Compost is on your list"));
  assert.ok(r.answer.includes("Todoist wasn't available"));
  assert.equal(p.calls.snapshot.length, 0);
});

test("undo slot persists via saveSettings and is separate from scheduleTodayLastUndo", async () => {
  const snapshot = baseSnapshot([task({ id: "t1", priority: 1 })]);
  const rows = [{ op: "update", taskId: "t1", fields: { priority: 4 }, newLabels: [] }];
  const p = makePlugin({ snapshot });
  await p.applyTodoistChanges({ rows, snapshot }, ["row-0"]);
  assert.ok(p.calls.saves > 0);
  assert.equal(p.settings.todoistChatLastUndo.entries[0].taskId, "t1");
  assert.deepEqual(p.settings.scheduleTodayLastUndo, { sentinel: true });
  p.snapshotNow = baseSnapshot([task({ id: "t1", priority: 4 })]);
  await p.undoLastTodoistChanges(false);
  assert.equal(p.settings.todoistChatLastUndo, null);
  assert.deepEqual(p.settings.scheduleTodayLastUndo, { sentinel: true });
  assert.equal(p.calls.sync[1][0].args.priority, 1);
  assert.ok(Object.prototype.hasOwnProperty.call(Plugin.DEFAULT_SETTINGS, "todoistChatLastUndo"));
});

test("create row description cites vault notes used in answer", async () => {
  const p = makePlugin({
    lookup: lookupOf({ kind: "change" }),
    context: [{ evidenceId: "E1", path: "Notes/Garden.md", title: "Garden", text: "Build a compost bin." }],
    answer: { ...claims(["E1"]), changePlan: { changes: [{ op: "create", content: "Build compost bin", description: "Per the garden plan." }] } }
  });
  const r = await p.chat("Add a task to build the compost bin", null, [], "chat-query", { todoist: true });
  const row = r.todoistChanges.rows[0];
  assert.equal(row.op, "create");
  assert.ok(row.fields.description.startsWith("Per the garden plan."));
  assert.ok(row.fields.description.includes("[Garden](obsidian://open?file=Notes%2FGarden.md)"));
});

test("duplicates request in phase 1 keeps the vault answer and proposes nothing", async () => {
  const p = makePlugin({ lookup: lookupOf({ kind: "duplicates" }), answer: claims() });
  const r = await p.chat("Find my duplicate tasks", null, [], "chat-query", { todoist: true });
  assert.ok(r.answer.includes("Compost is on your list"));
  assert.ok(r.answer.includes("I can't search existing tasks for duplicates; new tasks are checked when they're created."));
  assert.equal(r.todoistChanges, undefined);
  assert.equal(p.calls.snapshot.length, 0);
  assert.equal(p.calls.ops.includes("chat"), true);
});

test("normalizeTodoistTask and projects expose isRecurring and isShared", async () => {
  const p = makePlugin();
  delete p.getTodoistSnapshot;
  p.todoistSnapshotCache = null;
  p.settings.todoistSectionCache = {};
  requestHandler = () => ({
    status: 200, text: "",
    json: {
      items: [{ id: "a", content: "Weekly", project_id: "p1", due: { date: "2026-11-01", is_recurring: true } }, { id: "b", content: "Once", project_id: "p1", due: { date: "2026-11-02" } }],
      projects: [{ id: "p1", name: "Home", is_shared: true }, { id: "p2", name: "Solo" }],
      sections: []
    }
  });
  const snap = await p.getTodoistSnapshot(["items", "projects", "sections"], true);
  assert.deepEqual(snap.tasks.map((t) => t.isRecurring), [true, false]);
  assert.deepEqual(snap.projects.map((x) => [x.name, x.isShared]).sort(), [["Home", true], ["Solo", false]]);
});

test("temp ids in the saved undo record are replaced by real ids", async () => {
  const snapshot = baseSnapshot([]);
  const rows = [{ op: "create", fields: { content: "New one" }, target: { projectId: "p1" }, newLabels: [] }];
  const p = makePlugin({ snapshot });
  p.syncResponse = (commands) => ({ sync_status: {}, temp_id_mapping: { [commands[0].temp_id]: "real-77" } });
  await p.applyTodoistChanges({ rows, snapshot }, ["row-0"]);
  const tempId = p.calls.sync[0][0].temp_id;
  assert.deepEqual(p.settings.todoistChatLastUndo.createdTaskTempIds, ["real-77"]);
  assert.ok(!JSON.stringify(p.settings.todoistChatLastUndo).includes(tempId));
});

// ---- fix round 3 ----
const sentOk = (commands) => Object.fromEntries(commands.map((c) => [c.uuid, "ok"]));
const upd = (id, priority = 3) => ({ op: "update", taskId: id, fields: { priority }, newLabels: [] });

test("chat without the todoist option never runs the look-up (prompt templates)", async () => {
  const p = makePlugin({ lookup: lookupOf({ kind: "change" }), answer: claims() });
  const r = await p.chat("Which of my Todoist tasks mention compost?", null, [], "chat-query");
  assert.equal(p.calls.ops.includes("todoist-lookup"), false);
  assert.equal(p.calls.snapshot.length, 0);
  assert.equal(r.todoistChanges, undefined);
  assert.ok(!r.answer.includes("Todoist wasn't available"));
  const src = fs.readFileSync(mainPath, "utf8");
  assert.equal((src.match(/todoist: true/g) || []).length, 1, "only the sidebar ask opts in");
});

const strictProblems = (schema, where = "root") => {
  const problems = [];
  const types = [].concat(schema && schema.type);
  if (types.includes("object") && schema.properties) {
    if (schema.additionalProperties !== false) problems.push(`${where}: additionalProperties`);
    const keys = Object.keys(schema.properties).sort();
    if (JSON.stringify([...(schema.required || [])].sort()) !== JSON.stringify(keys)) problems.push(`${where}: required != properties`);
    for (const k of keys) problems.push(...strictProblems(schema.properties[k], `${where}.${k}`));
  }
  if (schema && schema.items) problems.push(...strictProblems(schema.items, `${where}[]`));
  return problems;
};

test("chatResponseSchema with a change plan is strict-mode compliant and nullable", async () => {
  const { CHANGE_PLAN_SCHEMA } = require("../src/todoist/plan.js");
  assert.deepEqual(strictProblems(Plugin.chatResponseSchema()), []);
  const schema = Plugin.chatResponseSchema(CHANGE_PLAN_SCHEMA);
  assert.deepEqual(strictProblems(schema), []);
  assert.ok(schema.required.includes("changePlan"));
  assert.ok([].concat(schema.properties.changePlan.type).includes("null"));
  assert.ok(schema.properties.changePlan.properties.changes, "original sub-schema kept");
});

test("null changePlan means no plan", async () => {
  const p = makePlugin({ lookup: lookupOf({ kind: "change" }), answer: { ...claims(), changePlan: null } });
  const r = await p.chat("Make the compost task urgent", null, [], "chat-query", { todoist: true });
  assert.ok(r.answer.includes("Compost is on your list"));
  assert.equal(r.todoistChanges, undefined);
});

test("todoistSync attaches the response to failures and survives non-JSON", async () => {
  const p = makePlugin();
  const body = { sync_status: { u1: "ok", u2: { error: "nope" } }, temp_id_mapping: { a: "b" } };
  requestHandler = () => ({ status: 200, text: "", json: body });
  await assert.rejects(Plugin.prototype.todoistSync.call(p, [{ uuid: "u1" }]), (e) => e.syncResponse === body && /Todoist command failed/.test(e.message));
  requestHandler = () => ({ status: 200, text: "<html>", get json() { throw new SyntaxError("bad json"); } });
  await assert.rejects(Plugin.prototype.todoistSync.call(p, [{ uuid: "u1" }]), (e) => !(e instanceof TypeError) && !(e instanceof SyntaxError) && /unreadable/.test(e.message));
  requestHandler = () => ({ status: 200, text: "ok", json: null });
  await assert.rejects(Plugin.prototype.todoistSync.call(p, [{ uuid: "u1" }]), (e) => !(e instanceof TypeError) && /unreadable/.test(e.message));
});

test("failed batch keeps the commands Todoist accepted", async () => {
  const tasks = [task({ id: "a", content: "A" }), task({ id: "b", content: "B" }), task({ id: "c", content: "C" })];
  const snapshot = baseSnapshot(tasks);
  const rows = tasks.map((t) => upd(t.id));
  const p = makePlugin({ snapshot, taskCache: { a: {}, b: {}, c: {} } });
  p.syncResponse = (commands) => {
    const err = new Error('Todoist command failed: ["x"]');
    err.syncResponse = { sync_status: { [commands[0].uuid]: "ok", [commands[1].uuid]: { error: "boom" }, [commands[2].uuid]: "ok" }, temp_id_mapping: {} };
    throw err;
  };
  const r = await p.applyTodoistChanges({ rows, snapshot }, ["row-0", "row-1", "row-2"]);
  assert.equal(r.applied, 2);
  assert.equal(r.failedAt, 0);
  assert.deepEqual(p.settings.todoistChatLastUndo.entries.map((e) => e.taskId).sort(), ["a", "c"]);
  assert.deepEqual(p.calls.lineUpdates.sort(), ["a", "c"]);
});

test("part-way failure text is plain: no JSON, no uuid, names the task", async () => {
  const tasks = [task({ id: "a", content: "Alpha" }), task({ id: "b", content: "Bravo" })];
  const snapshot = baseSnapshot(tasks);
  const rows = tasks.map((t) => upd(t.id));
  const p = makePlugin({ snapshot, taskCache: { a: {}, b: {} } });
  p.syncResponse = (commands) => {
    const err = new Error(`Todoist command failed: ${JSON.stringify({ [commands[1].uuid]: { error_code: 22, error: "boom" } })}`);
    err.syncResponse = { sync_status: { [commands[0].uuid]: "ok", [commands[1].uuid]: { error_code: 22, error: "boom" } }, temp_id_mapping: {} };
    throw err;
  };
  const r = await p.applyTodoistChanges({ rows, snapshot }, ["row-0", "row-1"]);
  const text = Plugin.describeTodoistApplyResult(r, { snapshot }).join("\n");
  assert.ok(!/[{}]/.test(text) && !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(text) && !/error_code/.test(text), text);
  assert.ok(text.includes("Bravo") && !text.includes("Alpha\""), text);
  const p2 = makePlugin({ snapshot, taskCache: { a: {}, b: {} } });
  p2.syncResponse = () => { throw new Error("network dropped"); };
  const r2 = await p2.applyTodoistChanges({ rows, snapshot }, ["row-0", "row-1"]);
  const text2 = Plugin.describeTodoistApplyResult(r2, { snapshot }).join("\n");
  assert.ok(/couldn't be reached/.test(text2) && !/network dropped/.test(text2), text2);
});
test("temp ids from an earlier batch are swapped for real ids in later batches", async () => {
  const snapshot = baseSnapshot([]);
  const rows = [{ op: "create-section", id: "sec1", fields: { content: "New section" }, target: { projectId: "p1" }, newLabels: [] }];
  for (let i = 0; i < 101; i += 1) rows.push({ op: "create", fields: { content: `T${i}` }, target: { projectId: "p1", sectionId: "sec1" }, newLabels: [] });
  const p = makePlugin({ snapshot });
  p.syncResponse = (commands) => ({ sync_status: sentOk(commands), temp_id_mapping: Object.fromEntries(commands.filter((c) => c.temp_id).map((c) => [c.temp_id, `real-${c.temp_id}`])) });
  await p.applyTodoistChanges({ rows, snapshot }, rows.map((_, i) => `row-${i}`));
  assert.equal(p.calls.sync.length, 2);
  const secTemp = p.calls.sync[0][0].temp_id;
  const later = p.calls.sync[1].filter((c) => c.type === "item_add");
  assert.ok(later.length > 0);
  assert.ok(later.every((c) => c.args.section_id === `real-${secTemp}`), JSON.stringify(later.map((c) => c.args.section_id)));
});

test("a second Apply on the same preview sends nothing", async () => {
  const snapshot = baseSnapshot([task({ id: "t1" })]);
  const changes = { rows: [upd("t1")], snapshot };
  const p = makePlugin({ snapshot });
  const first = await p.applyTodoistChanges(changes, ["row-0"]);
  assert.equal(first.applied, 1);
  const second = await p.applyTodoistChanges(changes, ["row-0"]);
  assert.equal(p.calls.sync.length, 1);
  assert.equal(second.applied, 0);
  assert.equal(second.refused, true);
  // in-flight is refused too
  const c2 = { rows: [upd("t1")], snapshot };
  const [a, b] = await Promise.all([p.applyTodoistChanges(c2, ["row-0"]), p.applyTodoistChanges(c2, ["row-0"])]);
  assert.equal(p.calls.sync.length, 2);
  assert.equal([a, b].filter((x) => x.refused).length, 1);
});

test("a failure before anything is sent leaves the preview applicable", async () => {
  const snapshot = baseSnapshot([task({ id: "t1" })]);
  const changes = { rows: [upd("t1")], snapshot };
  const p = makePlugin({ snapshot });
  p.getTodoistSnapshot = async () => { throw new Error("offline"); };
  await assert.rejects(p.applyTodoistChanges(changes, ["row-0"]), /offline/);
  assert.notEqual(changes.applyState, "applied");
  assert.notEqual(changes.applyState, "applying");
});

test("delete confirmation key changes with the ticked deletes", () => {
  const key = Plugin.todoistDeleteConfirmKey;
  const deletes = new Set(["d1", "d2"]);
  assert.equal(key(new Set(["x"]), deletes), "");
  const both = key(new Set(["d1", "d2", "x"]), deletes);
  assert.ok(both);
  assert.notEqual(key(new Set(["d1"]), deletes), both);
  assert.equal(key(new Set(["d2", "d1"]), deletes), both);
});

test("a delete-only Apply keeps the earlier undo slot", async () => {
  const snapshot = baseSnapshot([task({ id: "t1" }), task({ id: "t2", content: "Old" })]);
  const p = makePlugin({ snapshot });
  await p.applyTodoistChanges({ rows: [upd("t1")], snapshot }, ["row-0"]);
  const before = JSON.stringify(p.settings.todoistChatLastUndo);
  const r = await p.applyTodoistChanges({ rows: [{ op: "delete", taskId: "t2", fields: {}, newLabels: [] }], snapshot }, ["row-0"]);
  assert.equal(r.applied, 1);
  assert.equal(r.undoable, false);
  assert.equal(JSON.stringify(p.settings.todoistChatLastUndo), before);
});

test("undo keeps the slot and says why when every entry is skipped", async () => {
  const p = makePlugin({ snapshot: baseSnapshot([]) });
  p.settings.todoistChatLastUndo = { at: "x", entries: [{ taskId: "gone", previous: { fields: { priority: 1 }, projectId: "p1" } }], createdTaskTempIds: [], createdSectionIds: [] };
  const r = await p.undoLastTodoistChanges(false);
  assert.equal(r.restored, 0);
  assert.ok(p.settings.todoistChatLastUndo);
  assert.equal(p.calls.sync.length, 0);
  assert.ok(/nothing|couldn't/i.test(r.message || ""));
});

test("undo counts tasks, not commands, and keeps the result when line refresh fails", async () => {
  const snapshot = baseSnapshot([task({ id: "t1", priority: 1, labels: [] })]);
  const p = makePlugin({ snapshot, taskCache: { t1: {} } });
  await p.applyTodoistChanges({ rows: [{ op: "update", taskId: "t1", fields: { priority: 4, content: "Renamed" }, newLabels: [] }], snapshot }, ["row-0"]);
  p.snapshotNow = baseSnapshot([task({ id: "t1", priority: 4, content: "Renamed" })]);
  p.updateTaskLineFromTodoist = async () => { throw new Error("line gone"); };
  const r = await p.undoLastTodoistChanges(false);
  assert.equal(r.restored, 1);
  assert.equal(p.settings.todoistChatLastUndo, null);
});

test("a failing saveSettings after Apply still returns the apply result", async () => {
  const snapshot = baseSnapshot([task({ id: "t1" })]);
  const p = makePlugin({ snapshot, taskCache: { t1: {} } });
  p.saveSettings = async () => { throw new Error("disk full"); };
  const r = await p.applyTodoistChanges({ rows: [upd("t1")], snapshot }, ["row-0"]);
  assert.equal(r.applied, 1);
  assert.equal(r.undoSaveFailed, true);
  assert.ok(p.settings.todoistChatLastUndo.entries.length);
  assert.deepEqual(p.calls.lineUpdates, ["t1"]);
  const lines = Plugin.describeTodoistApplyResult(r, { snapshot });
  assert.ok(lines.some((l) => /undo/i.test(l) && /couldn't|could not|not saved/i.test(l)));
});

test("reopen unticks the line; delete leaves it alone", async () => {
  const snapshot = baseSnapshot([task({ id: "del" })]);
  const p = makePlugin({ snapshot, taskCache: { done1: {}, del: {} } });
  const rows = [{ op: "reopen", taskId: "done1", fields: {}, newLabels: [] }, { op: "delete", taskId: "del", fields: {}, newLabels: [] }];
  await p.applyTodoistChanges({ rows, snapshot }, ["row-0", "row-1"]);
  assert.deepEqual(p.calls.checks, [{ id: "done1", checked: false }]);
  assert.deepEqual(p.calls.lineUpdates, []);
});

test("merge refreshes the kept line and ticks merged-away lines only after item_close succeeded", async () => {
  const snapshot = baseSnapshot([task({ id: "keep", content: "Keep", description: "k" }), task({ id: "away", content: "Away", description: "extra", labels: ["x"] })]);
  const rows = [{ op: "merge", taskId: "away", fields: { targetTaskId: "keep" }, newLabels: [] }];
  const p = makePlugin({ snapshot, taskCache: { keep: {}, away: {} } });
  await p.applyTodoistChanges({ rows, snapshot }, ["row-0"]);
  assert.deepEqual(p.calls.lineUpdates, ["keep"]);
  assert.deepEqual(p.calls.checks, [{ id: "away", checked: true }]);
  // close rejected by Todoist: the away line stays unticked
  const p2 = makePlugin({ snapshot, taskCache: { keep: {}, away: {} } });
  p2.syncResponse = (commands) => {
    const err = new Error("x");
    err.syncResponse = { sync_status: Object.fromEntries(commands.map((c) => [c.uuid, c.type === "item_close" ? { error: "no" } : "ok"])), temp_id_mapping: {} };
    throw err;
  };
  await p2.applyTodoistChanges({ rows, snapshot }, ["row-0"]);
  assert.deepEqual(p2.calls.checks, []);
});

test("undo unticks a chat-completed line and ticks a reopened one", async () => {
  const snapshot = baseSnapshot([task({ id: "t1" })]);
  const p = makePlugin({ snapshot, taskCache: { t1: {}, done1: {} } });
  await p.applyTodoistChanges({ rows: [{ op: "complete", taskId: "t1", fields: {}, newLabels: [] }, { op: "reopen", taskId: "done1", fields: {}, newLabels: [] }], snapshot }, ["row-0", "row-1"]);
  p.calls.checks.length = 0;
  p.snapshotNow = baseSnapshot([task({ id: "done1" })]);
  await p.undoLastTodoistChanges(false);
  assert.deepEqual(p.calls.checks.sort((a, b) => a.id.localeCompare(b.id)), [{ id: "done1", checked: true }, { id: "t1", checked: false }]);
});

test("couldn't-do lines name the task and use plain sentences", async () => {
  const p = makePlugin({
    lookup: lookupOf({ kind: "change" }),
    answer: { ...claims(), changePlan: { changes: [{ op: "update", taskId: "t1", priority: 9 }, { op: "frobnicate", taskId: "t1" }] } }
  });
  const r = await p.chat("Change the compost task", null, [], "chat-query", { todoist: true });
  assert.ok(r.answer.includes("Buy compost"), r.answer);
  assert.ok(!/bad-priority|unknown-op/.test(r.answer), r.answer);
  const lines = Plugin.describeTodoistApplyResult({ applied: 2, skipped: [{ row: { op: "update", taskId: "t1", fields: {} }, reason: "task no longer exists in Todoist" }] }, { snapshot: baseSnapshot([task({ id: "t1" })]) });
  assert.equal(lines[0], "Applied 2 Todoist changes.");
  assert.ok(lines.some((l) => l.includes("Buy compost") && l.includes("no longer exists")));
});

test("placement wording has no quoted internal phrases", async () => {
  const p = makePlugin({
    lookup: lookupOf({ kind: "change" }),
    context: [{ evidenceId: "E1", path: "Notes/Garden.md", title: "Garden", text: "Build compost bin." }],
    answer: { ...claims(["E1"]), changePlan: { changes: [{ op: "create", content: "Build compost bin" }] } }
  });
  const r = await p.chat("Add a task to build the compost bin", null, [], "chat-query", { todoist: true });
  const sentences = r.todoistChanges.preview.groups.flatMap((g) => g.rows).map((x) => x.sentence).join("\n");
  assert.ok(!/its parent task"|the end of note"|the end of the note"/.test(sentences), sentences);
  assert.ok(/in the monthly note under|at the end of|under its parent task in/.test(sentences), sentences);
});
test("look-up step is told today's device date", async () => {
  let lookupSystem = "";
  const p = makePlugin({ lookup: lookupOf({}), answer: claims() });
  const inner = p.openaiResponse;
  p.openaiResponse = async (request) => { if (request.operation === "todoist-lookup") lookupSystem = request.system; return inner(request); };
  await p.chat("What tasks do I have to do today?", null, [], "chat-query", { todoist: true });
  const d = new Date(); const pad = (n) => String(n).padStart(2, "0");
  assert.ok(lookupSystem.includes(`Today's date is ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`), lookupSystem);
});

test("when more tasks match than are listed, the model is told the true total", async () => {
  let userText = "";
  const many = Array.from({ length: 45 }, (_, i) => task({ id: `m${i}`, content: `Due task ${i}`, dueDate: "2026-10-28" }));
  const p = makePlugin({ lookup: lookupOf({ filters: { words: [], projects: [], labels: [], dueFrom: "2026-10-28", dueTo: "2026-10-28" } }), answer: (request) => { userText = request.user; return claims(); }, snapshot: baseSnapshot([...many, task({ id: "other", dueDate: "2026-11-01" })]) });
  await p.chat("What is due today?", null, [], "chat-query", { todoist: true });
  assert.ok(userText.includes("45 tasks match; the first 40 are listed"), userText.slice(0, 400));
  assert.equal(userText.split("evidence_id=todoist-m").length - 1, 40, "still at most 40 listed");
});

test("shortlisted Todoist tasks are citable evidence", async () => {
  let userText = "";
  const p = makePlugin({
    lookup: lookupOf({ filters: { words: ["compost"], projects: [], labels: [] } }),
    answer: (request) => { userText = request.user; return claims(["todoist-t1"]); }
  });
  const r = await p.chat("Which Todoist tasks mention compost?", null, [], "chat-query", { todoist: true });
  assert.ok(userText.includes("evidence_id=todoist-t1"), "prompt carries the task evidence id");
  assert.equal(userText.split("Buy compost").length - 1, 1, "shortlisted task listed once");
  assert.ok(r.answer.includes("Compost is on your list"));
  assert.ok(!/not established/i.test(r.answer), r.answer);
  assert.ok(r.answer.includes("https://todoist.com/app/task/t1"), r.answer);
  assert.equal(r.citationValidation.allowedEvidenceCount >= 1, true);
});

const indexRow = (id, extra = {}) => ({ evidenceId: `E-${id}`, path: `@todoist/${id}`, title: `Row ${id}`, text: `Indexed row ${id} marker-${id}`, sourceKind: "todoist-snapshot-reference-row", taskReference: { todoistId: id }, ...extra });

test("todoist turn drops index task rows missing from the fresh snapshot", async () => {
  let userText = "";
  const context = [indexRow("gone1"), indexRow("t1"), indexRow("done1", { taskReference: { todoistId: "done1", isCompleted: true } })];
  const p = makePlugin({ lookup: lookupOf({ kind: "question" }), context, answer: (request) => { userText = request.user; return claims(["E-gone1", "E-t1", "E-done1"]); } });
  const r = await p.chat("Does the compost task exist?", null, [], "chat-query", { todoist: true });
  assert.ok(!userText.includes("marker-gone1"), "stale row absent from prompt");
  assert.ok(!r.answer.includes("gone1"), r.answer);
  assert.ok(userText.includes("marker-t1"), "live row kept");
  assert.ok(userText.includes("marker-done1"), "completed row kept");
});

test("vault-only turn still receives index task rows absent from any snapshot", async () => {
  let userText = "";
  const p = makePlugin({ lookup: lookupOf({ needsTodoist: false, kind: "none" }), context: [indexRow("gone1")], answer: (request) => { userText = request.user; return claims(); } });
  await p.chat("What did the vendor notes say?", null, [], "chat-query", { todoist: true });
  assert.ok(userText.includes("marker-gone1"), userText);
});

test("vault-only turn prompt has no Todoist evidence rows", async () => {
  let userText = "";
  const p = makePlugin({ lookup: lookupOf({ needsTodoist: false, kind: "none" }), answer: (request) => { userText = request.user; return claims(); } });
  await p.chat("What did the vendor notes say?", null, [], "chat-query", { todoist: true });
  assert.ok(!userText.includes("todoist-"), userText);
});

test("create row note links exclude cited Todoist tasks", async () => {
  const p = makePlugin({
    lookup: lookupOf({ kind: "change", filters: { words: ["compost"], projects: [], labels: [] } }),
    context: [{ evidenceId: "E1", path: "Notes/Garden.md", title: "Garden", text: "Build a compost bin." }],
    answer: { ...claims(["E1", "todoist-t1"]), changePlan: { changes: [{ op: "create", content: "Build compost bin", description: "Per plan." }] } }
  });
  const r = await p.chat("Add a task to build the compost bin", null, [], "chat-query", { todoist: true });
  const d = r.todoistChanges.rows[0].fields.description;
  assert.ok(d.includes("obsidian://open?file=Notes%2FGarden.md"), d);
  assert.ok(!d.includes("todoist.com"), d);
});

test("change turn with rows and no model text gets a plain sentence", async () => {
  const p = makePlugin({
    lookup: lookupOf({ kind: "change" }),
    answer: { claims: [], changePlan: { changes: [{ op: "update", taskId: "t1", dueDate: "2026-11-05" }, { op: "create", content: "STS sample: order toner" }] } }
  });
  const r = await p.chat("Set the task due 2026-11-05 and add a new task", null, [], "chat-query", { todoist: true });
  assert.equal(r.todoistChanges.rows.length, 2);
  assert.ok(r.answer.includes("I've prepared 2 changes to 2 tasks. Review them before anything changes in Todoist."), JSON.stringify(r.answer));
});

test("change turn with no rows and no model text says none could be prepared", async () => {
  const p = makePlugin({
    lookup: lookupOf({ kind: "change" }),
    answer: { claims: [], changePlan: { changes: [{ op: "frobnicate", taskId: "t1" }] } }
  });
  const r = await p.chat("Change the compost task", null, [], "chat-query", { todoist: true });
  assert.ok(r.answer.includes("I couldn't prepare any change"), JSON.stringify(r.answer));
  assert.ok(r.answer.includes("I couldn't do 1 of the proposed changes"), r.answer);
});

// The sidebar's modal callback decides whether the Undo button appears; drive ask() with a stubbed view.
async function undoButtonsAfterApply(result) {
  const view = Object.create(Plugin.SemanticTodoistView.prototype);
  const actions = [];
  Object.assign(view, {
    promptEl: { value: "delete it" }, messages: [], webSearchMode: "off", setStatus() {}, addMessage() {}, renderRelevantNotes() {}, replaceLastAssistantMessage() {},
    getSelectedActiveContext: async () => null,
    addMessageAction: (label) => actions.push(label),
    plugin: { app: {}, chat: async () => ({ answer: "ok", context: [], todoistChanges: { rows: [{}], applyState: "ready", preview: { groups: [] } } }) }
  });
  globalThis.__lastOpenedModal = null;
  view.addMessageAction = (label, fn, disabled) => { actions.push(label); if (label.startsWith("Review")) fn(); };
  await view.ask();
  const modal = globalThis.__lastOpenedModal;
  assert.ok(modal, "modal opened");
  actions.length = 0;
  modal.onDone("Applied.", result);
  return actions;
}

test("Undo button is added after an undoable Apply", async () => {
  assert.deepEqual(await undoButtonsAfterApply({ undoable: true }), ["Undo last Todoist change"]);
});

test("no Undo button after a delete-only Apply that cannot be undone", async () => {
  assert.deepEqual(await undoButtonsAfterApply({ undoable: false }), []);
  assert.deepEqual(await undoButtonsAfterApply(undefined), []);
});

test("an Undo button turns off once its Apply was undone or a later Apply replaced it", async () => {
  const view = Object.create(Plugin.SemanticTodoistView.prototype);
  const actions = [];
  let renders = 0;
  const settings = { todoistChatLastUndo: null };
  let undone = 0;
  Object.assign(view, {
    promptEl: { value: "move it" }, messages: [], webSearchMode: "off", setStatus() {}, addMessage() {}, renderRelevantNotes() {}, replaceLastAssistantMessage() {},
    renderMessages: () => { renders += 1; },
    getSelectedActiveContext: async () => null,
    plugin: { app: {}, settings, undoLastTodoistChanges: async () => { undone += 1; settings.todoistChatLastUndo = null; }, chat: async () => ({ answer: "ok", context: [], todoistChanges: { rows: [{}], applyState: "ready", preview: { groups: [] } } }) }
  });
  view.addMessageAction = (label, fn, disabled) => { actions.push({ label, fn, disabled }); if (label.startsWith("Review")) fn(); };
  globalThis.__lastOpenedModal = null;
  await view.ask();
  const first = { at: "first" };
  settings.todoistChatLastUndo = first;
  globalThis.__lastOpenedModal.onDone("Applied.", { undoable: true });
  const undo = actions.find((a) => a.label === "Undo last Todoist change");
  assert.ok(undo && typeof undo.disabled === "function", "Undo has a disabled check");
  assert.equal(undo.disabled(), false, "live while its Apply is the last one");
  settings.todoistChatLastUndo = { at: "second" };
  assert.equal(undo.disabled(), true, "a later Apply replaced it");
  await undo.fn();
  assert.equal(undone, 0, "a replaced Undo does nothing");
  settings.todoistChatLastUndo = first;
  assert.equal(undo.disabled(), false);
  const before = renders;
  await undo.fn();
  assert.equal(undone, 1);
  assert.equal(undo.disabled(), true, "used up after Undo");
  assert.ok(renders > before, "buttons redrawn after Undo");
});

test("change turn with model text keeps it unchanged", async () => {
  const p = makePlugin({
    lookup: lookupOf({ kind: "change" }),
    answer: { ...claims(), changePlan: { changes: [{ op: "update", taskId: "t1", priority: 4 }] } }
  });
  const r = await p.chat("Make compost urgent", null, [], "chat-query", { todoist: true });
  assert.ok(!r.answer.includes("I've prepared"), r.answer);
});
(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); } catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${error && error.stack ? error.stack.split("\n").slice(0, 3).join("\n  ") : error}`); }
  }
  if (failed) process.exit(1);
})();
