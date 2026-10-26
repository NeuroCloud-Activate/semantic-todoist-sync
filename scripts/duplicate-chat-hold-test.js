"use strict";
// T4: chat Apply holds likely-duplicate creates; old phase-2 flag retired; recurrence from snapshot; no hold without a Todoist write.
// Every Todoist, embedding and model call is stubbed. DUPBOX_MAIN overrides the main.js under test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = process.env.DUPBOX_MAIN ? path.resolve(process.env.DUPBOX_MAIN) : path.join(__dirname, "..", "src/main.js");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class Empty { open() {} }
  return { ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty, TFile: Empty, setIcon() {}, requestUrl: async () => { throw new Error("network disabled in test"); } };
};
let Plugin;
try {
  global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
  testModule._compile(fs.readFileSync(mainPath, "utf8"), mainPath);
  Plugin = testModule.exports;
} finally { Module._load = originalLoad; }

const dedupe = require("../src/todoist/dedupe.js");
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const flush = () => new Promise((resolve) => setImmediate(resolve));

const snapshot = { tasks: [], projects: [{ id: "p1", name: "Home", isInbox: false }, { id: "pin", name: "Inbox", isInbox: true }], sections: [{ id: "s1", name: "Later", projectId: "p1" }], fetchedAt: "2026-10-25T10:00:00" };
const createRow = (content, extra = {}) => ({ op: "create", fields: { content, description: "d " + content, priority: 3, dueDate: "2026-11-02", labels: ["a"] }, target: { projectId: "p1", sectionId: "s1", parentId: "par1" }, newLabels: [], ...extra });
const existing = { id: "e1", content: "Dup task", projectId: "p1" };

function makePlugin(over = {}) {
  const p = Object.create(Plugin.prototype);
  p.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { todoistToken: "tok", embeddingModel: "embeddinggemma-2", enableTaskDeduplication: true, enableAiAmbiguousTaskDeduplication: true, taskCache: {} }, over.settings || {});
  p.manifest = { dir: "plugin-dir" };
  p.files = {};
  p.app = { vault: { adapter: { read: async (f) => { if (!(f in p.files)) throw new Error("ENOENT"); return p.files[f]; }, write: async (f, body) => { p.files[f] = body; } } } };
  p.calls = { sync: [], judged: [], lines: [], find: [], notices: [] };
  p.saveSettings = async () => {};
  for (const name of ["logLocal", "setSidebarStatus", "markTaskReferenceStateDirty", "refreshTodoistLines"]) p[name] = () => {};
  p.getTodoistSnapshot = async () => snapshot;
  p.todoistSync = async (commands) => { p.calls.sync.push(commands); return { sync_status: {}, temp_id_mapping: Object.fromEntries(commands.filter((c) => c.temp_id).map((c) => [c.temp_id, "real-" + c.args.content])) }; };
  p.writeCreatedTaskLines = async (results) => { p.calls.lines.push(results); return []; };
  p.judgeHeldDuplicates = async (records) => { p.calls.judged.push(records.map((r) => r.id)); };
  p.noticeDuplicateCheckOff = (reason) => p.calls.notices.push(reason);
  p.findDuplicateHolds = over.findDuplicateHolds || (async (tasks, options) => {
    p.calls.find.push({ contents: tasks.map((t) => t.content), options });
    return { holds: tasks.filter((t) => t.content === "Dup task").map((task) => ({ task, candidate: existing, score: 0.93, nearIdentical: false })), degraded: "" };
  });
  return p;
}
const store = (p) => JSON.parse(p.files["plugin-dir/duplicate-review.json"]);
const sentContents = (p) => p.calls.sync.flat().filter((c) => c.type === "item_add").map((c) => c.args.content);

test("chat Apply: held create is not sent, kind chat record saved with the row, judge started, result says one task waits", async () => {
  const p = makePlugin();
  const rows = [createRow("Dup task"), createRow("Other task")];
  const changes = { rows, snapshot };
  const r = await p.applyTodoistChanges(changes, ["row-0", "row-1"]);
  assert.deepEqual(sentContents(p), ["Other task"]);
  const held = store(p).held;
  assert.equal(held.length, 1);
  assert.equal(held[0].kind, "chat");
  assert.equal(held[0].status, "checking");
  assert.equal(held[0].source.type, "chat");
  assert.equal(held[0].source.row.fields.content, "Dup task");
  assert.deepEqual(held[0].task, { content: "Dup task", description: "d Dup task", labels: ["a"], priority: 3, due_date: "2026-11-02", deadline_date: "", projectId: "p1", projectName: "Home", sectionId: "s1", section: "Later", parentId: "par1", subtasks: [] });
  assert.deepEqual(p.calls.judged, [[held[0].id]]);
  assert.equal(r.held, 1);
  const text = Plugin.describeTodoistApplyResult(r, { snapshot }).join("\n");
  assert.ok(/1 task is waiting for a duplicate answer in the sidebar/.test(text), text);
  // the only create that went out got its note line; the held one did not
  assert.equal(p.calls.lines.length, 1);
  assert.deepEqual(p.calls.lines[0].map((x) => x.row.fields.content), ["Other task"]);
  // held rows must not be created again by a second Apply of the same preview
  const again = await p.applyTodoistChanges(changes, ["row-0"]);
  assert.equal(again.refused, true);
});

test("chat Apply: nothing sent still marks the preview applied; plural wording", async () => {
  const p = makePlugin({ findDuplicateHolds: async (tasks) => ({ holds: tasks.map((task) => ({ task, candidate: existing, score: 0.95, nearIdentical: true })), degraded: "" }) });
  const changes = { rows: [createRow("Dup task"), createRow("Dup two")], snapshot };
  const r = await p.applyTodoistChanges(changes, ["row-0", "row-1"]);
  assert.equal(p.calls.sync.flat().length, 0);
  assert.equal(r.held, 2);
  assert.equal(changes.applyState, "applied");
  assert.ok(/2 tasks are waiting for a duplicate answer in the sidebar/.test(Plugin.describeTodoistApplyResult(r, { snapshot }).join("\n")));
  assert.equal(store(p).held.filter((x) => x.status === "waiting").length, 2); // near-identical skips AI
});

test("chat Apply: update/move/complete rows are never checked; only create rows reach the matcher", async () => {
  const tasks = [{ id: "t1", content: "Dup task", projectId: "p1", sectionId: "", parentId: "", labels: [], priority: 1 }];
  const snap = { ...snapshot, tasks };
  const p = makePlugin();
  p.getTodoistSnapshot = async () => snap;
  const rows = [
    { op: "update", taskId: "t1", fields: { content: "Dup task", priority: 4 }, newLabels: [] },
    { op: "move", taskId: "t1", fields: {}, target: { projectId: "pin" }, newLabels: [] },
    { op: "complete", taskId: "t1", fields: {}, newLabels: [] }
  ];
  await p.applyTodoistChanges({ rows, snapshot: snap }, ["row-0", "row-1", "row-2"]);
  assert.ok(p.calls.find.every((c) => c.contents.length === 0), JSON.stringify(p.calls.find));
  assert.equal(store0(p), 0);
  const p2 = makePlugin();
  await p2.applyTodoistChanges({ rows: [createRow("Other task"), { op: "update", taskId: "t1", fields: { priority: 4 }, newLabels: [] }], snapshot: snap }, ["row-0", "row-1"]);
  assert.deepEqual(p2.calls.find.map((c) => c.contents), [["Other task"]]);
  assert.equal(p2.calls.find[0].options.source, "chat");
  assert.equal(p2.calls.find[0].options.includeLiveTodoistCandidates, true);
});
const store0 = (p) => ("plugin-dir/duplicate-review.json" in p.files ? store(p).held.length : 0);

test("createHeldChatRow sends exactly the held row's create through the batch path and returns its id", async () => {
  const p = makePlugin();
  const row = createRow("Dup task");
  const { id } = await p.createHeldChatRow({ id: "h1", kind: "chat", source: { type: "chat", row }, task: {} });
  assert.equal(id, "real-Dup task");
  assert.equal(p.calls.sync.length, 1);
  assert.equal(p.calls.sync[0].length, 1);
  const cmd = p.calls.sync[0][0];
  assert.equal(cmd.type, "item_add");
  assert.equal(cmd.args.content, "Dup task");
  assert.equal(cmd.args.project_id, "p1"); assert.equal(cmd.args.section_id, "s1"); assert.equal(cmd.args.parent_id, "par1");
  assert.deepEqual(p.calls.lines, [], "createHeldChatRow no longer writes the note line; keepHeldDuplicate does, once");
});

test("createHeldChatRow throws plainly when Todoist does not accept the create", async () => {
  const p = makePlugin();
  p.todoistSync = async () => { const e = new Error("nope"); e.syncResponse = { sync_status: {}, temp_id_mapping: {} }; throw e; };
  await assert.rejects(p.createHeldChatRow({ id: "h1", kind: "chat", source: { type: "chat", row: createRow("Dup task") } }), /Todoist did not create/);
  assert.equal(p.calls.lines.length, 0);
});

test("dedupeAllowed and the old duplicate flags are gone; merges stay off", async () => {
  assert.equal(dedupe.dedupeAllowed, undefined);
  assert.deepEqual(dedupe.CALIBRATED_EMBEDDING_MODELS, ["embeddinggemma-2"]);
  assert.ok(!("todoistDuplicateFinding" in Plugin.DEFAULT_SETTINGS) && !("todoistDuplicateFindingValidated" in Plugin.DEFAULT_SETTINGS));
  const src = fs.readFileSync(mainPath, "utf8");
  assert.ok(!/dedupeAllowed|duplicatesNotReady|todoistDuplicateFinding|Duplicate finding isn't turned on/.test(src));
  const { validateChangePlan } = require("../src/todoist/plan.js");
  const snap = { tasks: [{ id: "a", content: "A", projectId: "p1" }, { id: "b", content: "B", projectId: "p1" }], projects: [{ id: "p1", name: "Home" }], sections: [] };
  const res = validateChangePlan({ changes: [{ op: "merge", taskId: "a", targetTaskId: "b" }] }, snap, { allowedIds: new Set(["a", "b"]), allowMerge: false });
  assert.deepEqual(res.rows, []);
  assert.equal(res.rejected[0].reason, "merge-disabled");
});

test("chat look-up of duplicates answers from the vault plus the new plain sentence", async () => {
  const p = makePlugin();
  for (const name of ["recordDebugDiagnostic"]) p[name] = () => {};
  for (const name of ["ensureCompatibleEmbeddingForChatModel", "tryUpdateSchedulerMemoryFromChat", "tryUpdateTaskDeduplicationPolicyFromChat", "buildTaskContext"]) p[name] = async () => "";
  Object.assign(p.settings, { autoAddActiveContentToContext: false });
  p.requireAiAccess = () => {};
  p.retrieveAdaptiveSemanticContext = async () => [];
  p.aiModelForRequest = () => ({ model: "fictional-model" });
  p.withAiActivity = async (label, work) => work();
  p.openaiResponse = async (request) => request.operation === "todoist-lookup"
    ? JSON.stringify({ needsTodoist: true, kind: "duplicates", filters: { words: [], projects: [], labels: [] }, refersToLastAnswer: false })
    : JSON.stringify({ claims: [{ text: "Compost is on your list.", established: false, evidence_ids: [] }] });
  const r = await p.chat("Find my duplicate tasks", null, [], "chat-query", { todoist: true });
  assert.ok(r.answer.includes("I can't search existing tasks for duplicates; new tasks are checked when they're created."), r.answer);
  assert.equal(r.todoistChanges, undefined);
});

// ---- Fix A: recurrence for cached candidates comes from the Todoist snapshot ----
const SIM = [1, 0], NEAR = [0.95, Math.sqrt(1 - 0.95 * 0.95)];
const vectors = { "submit annual irgp report funder": SIM, "submit annual irgp report to funder": NEAR };
function matcher(candidate, snapshotTasks, over = {}) {
  const p = makePlugin();
  delete p.findDuplicateHolds; // use the real one
  p.findDuplicateHolds = Plugin.prototype.findDuplicateHolds;
  p.embedTexts = async (texts) => texts.map((t) => vectors[String(t).toLowerCase()] || [0, 1]);
  // Candidates are the open top-level tasks of the cached Todoist snapshot; the snapshot entry decides recurrence. Without a snapshot the task cache stands in.
  p.settings.taskCache = { [candidate.id]: candidate };
  p.getTodoistSnapshot = over.getTodoistSnapshot || (async () => ({ tasks: snapshotTasks.map((s) => Object.assign({}, candidate, s)).filter((s) => s.id === candidate.id), projects: [], sections: [] }));
  return p;
}
const cached = { id: "e1", content: "Submit annual IRGP report to funder", projectId: "p1", sectionId: "", parentId: "", dueDate: "2026-11-01", labels: [], priority: 1, description: "" };
const incoming = () => [{ content: "Submit annual IRGP report funder", projectId: "p1", subtasks: [] }];

test("fix A: cached candidate with a due date and snapshot is_recurring false is matched", async () => {
  const p = matcher(cached, [{ id: "e1", isRecurring: false }]);
  const { holds, degraded } = await p.findDuplicateHolds(incoming(), {});
  assert.equal(degraded, "");
  assert.equal(holds.length, 1);
  assert.equal(holds[0].candidate.id, "e1");
  assert.equal(cached.isRecurring, undefined, "cache entry itself is not mutated");
});

test("fix A: snapshot is_recurring true against a one-off new task is rejected", async () => {
  const p = matcher(cached, [{ id: "e1", isRecurring: true }]);
  assert.equal((await p.findDuplicateHolds(incoming(), {})).holds.length, 0);
});

test("fix A: no snapshot entry or snapshot failure leaves recurrence unknown (no match), logged once, one snapshot read per batch", async () => {
  const logs = [];
  const p = matcher(cached, [], {});
  p.logLocal = (m) => logs.push(m);
  let reads = 0;
  p.getTodoistSnapshot = async () => { reads += 1; throw new Error("offline"); };
  assert.equal((await p.findDuplicateHolds(incoming(), {})).holds.length, 0);
  assert.equal((await p.findDuplicateHolds(incoming(), {})).holds.length, 0);
  assert.equal(reads, 2, "once per batch");
  assert.equal(logs.filter((m) => /recurrence unknown/i.test(m)).length, 1, "logged once");
  const q = matcher(cached, [{ id: "other", isRecurring: false }]);
  assert.equal((await q.findDuplicateHolds(incoming(), {})).holds.length, 0);
});

test("fix A: the snapshot decides recurrence over the cached entry; the task-cache fallback matches only a candidate without a due date", async () => {
  const p = matcher({ ...cached, isRecurring: false }, [{ id: "e1", isRecurring: true }]);
  assert.equal((await p.findDuplicateHolds(incoming(), {})).holds.length, 0);
  const q = matcher({ ...cached, dueDate: "" }, [], { getTodoistSnapshot: async () => { throw new Error("offline"); } });
  assert.equal((await q.findDuplicateHolds(incoming(), {})).holds.length, 1);
});

// ---- Fix B: only tasks about to be written to Todoist are held ----
test("fix B: holdDuplicates false (insert-only note/template run) holds nothing and does no matching", async () => {
  const p = makePlugin();
  const tasks = [{ content: "Dup task", subtasks: [] }, { content: "Other", subtasks: [] }];
  const stats = await p.applyTaskDeduplicationPlan(tasks, { source: "note", holdDuplicates: false });
  assert.equal(tasks.length, 2);
  assert.equal(p.calls.find.length, 0);
  assert.equal(stats.held, 0);
  assert.equal(store0(p), 0);
  const on = await p.applyTaskDeduplicationPlan(tasks, { source: "note", holdDuplicates: true });
  assert.equal(on.held, 1);
  assert.deepEqual(tasks.map((t) => t.content), ["Other"]);
});

test("fix B: prepareGeneratedTasksForTodoistWorkflow passes holdDuplicates: todoistBound (email runs are bound too)", async () => {
  const src = fs.readFileSync(mainPath, "utf8");
  assert.ok(/holdDuplicates:\s*todoistBound\b/.test(src));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); } catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${error && error.stack ? error.stack.split("\n").slice(0, 4).join("\n  ") : error}`); }
  }
  if (failed) process.exit(1);
})();
