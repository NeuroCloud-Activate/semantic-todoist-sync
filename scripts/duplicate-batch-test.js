"use strict";
// F3: duplicate hold timing (after the quality gate), pending/release/drop, same-batch candidates, light candidates, bounded wait.
// Every Todoist, embedding and model call is stubbed. DUPBOX_MAIN lets a copy of src/main.js be tested.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const mainPath = process.env.DUPBOX_MAIN ? path.resolve(process.env.DUPBOX_MAIN) : path.join(__dirname, "..", "src/main.js");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.join(__dirname, "..", "src"));
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

const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const SIM = [1, 0], NEAR = [0.95, Math.sqrt(1 - 0.95 * 0.95)], FAR = [0, 1];
const vectors = { "submit the annual irgp report to funder": SIM, "submit annual irgp report to the funder": NEAR, "water all the plants in the office": FAR };
const existing = { id: "e1", content: "Submit the annual IRGP report to funder", projectId: "p1", sectionId: "", parentId: "", dueDate: "", isRecurring: false, labels: [], priority: 1, description: "" };

function makePlugin(over = {}) {
  const p = Object.create(Plugin.prototype);
  p.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { embeddingModel: "embeddinggemma-2", enableTaskDeduplication: true, enableAiAmbiguousTaskDeduplication: true, taskCache: {} }, over.settings || {});
  p.manifest = { dir: "plugin-dir" };
  p.files = {};
  p.app = { vault: { adapter: {
    read: async (f) => { if (!(f in p.files)) throw new Error("ENOENT"); return p.files[f]; },
    write: async (f, body) => { if (over.saveThrows && f.endsWith("duplicate-review.json")) throw new Error("disk full"); p.files[f] = body; },
    exists: async (f) => f in p.files
  } } };
  p.calls = { embed: [], ai: [], snapshot: 0, logs: [], resolve: [] };
  p.logLocal = (m, d) => { p.calls.logs.push(m + (d ? " " + JSON.stringify(d) : "")); };
  p.setSidebarStatus = () => {};
  p.addAssistantMessageIfViewOpen = () => {};
  p.embedTexts = over.embedTexts || (async (texts) => { p.calls.embed.push(texts.slice()); return texts.map((t) => vectors[String(t).toLowerCase()] || FAR); });
  p.getTodoistSnapshot = over.getTodoistSnapshot || (async () => { p.calls.snapshot += 1; return { tasks: over.snapshotTasks || [existing], projects: [], sections: [] }; });
  // The judge never answers, so released records stay "checking" for the assertions.
  p.openaiResponse = (req) => { p.calls.ai.push(req); return new Promise(() => {}); };
  p.duplicateJudgeTimeoutMs = 60000;
  p.postDuplicateReviewBox = async () => {};
  p.resolveHeldDuplicate = async (id, answer, opts) => { p.calls.resolve.push({ id, answer, by: opts && opts.by }); };
  return p;
}
const store = (p) => JSON.parse(p.files["plugin-dir/duplicate-review.json"] || '{"held":[]}');
const hold = (p, tasks, opts = {}) => p.applyTaskDeduplicationPlan(tasks, Object.assign({ source: "note", path: "n.md", batchId: "b1" }, opts));
const dup = () => ({ content: "Submit annual IRGP report to the funder", oid: "A", projectId: "p1", subtasks: [] });

// ---- 1: hold only after the quality gate ----
function preparePlugin(tasks, issues) {
  const p = makePlugin();
  p.semanticTaskContextDispatchGate = async () => null;
  p.ensureRequiredModelDueDates = async () => null;
  p.generateTaskSectionName = async () => "Section";
  p.refineTaskDescriptionsWithLocalActivity = async () => ({ attempted: 0, generated: 0, failed: 0, failures: [] });
  p.postTaskDescriptionFailureReport = async () => {};
  p.getTaskProjectId = async () => "p1";
  p.todoistProjectNameForId = async () => "Home";
  p.ensureTodoistSectionId = async () => "s1";
  p.holdCalls = 0;
  const real = p.applyTaskDeduplicationPlan;
  p.applyTaskDeduplicationPlan = async (...args) => { p.holdCalls += 1; return real.apply(p, args); };
  return p;
}
const readyTask = () => ({ content: "Submit annual IRGP report to the funder", oid: "A", description: "Why and what.", priority: 1, labels: [], subtasks: [] });
const prepareOptions = { source: "note", path: "n.md", prepareTodoistSection: true };

test("quality gate failure holds nothing; a passing run holds once, after the gate", async () => {
  const bad = preparePlugin();
  const badTasks = [Object.assign(readyTask(), { due_date: "not-a-date" })];
  await assert.rejects(bad.prepareGeneratedTasksForTodoistWorkflow(badTasks, { sourceContract: { id: "c" } }, prepareOptions), /blocking local quality/);
  assert.equal(bad.holdCalls, 0);
  assert.equal("plugin-dir/duplicate-review.json" in bad.files, false);
  const good = preparePlugin();
  const tasks = [readyTask()];
  const prepared = await good.prepareGeneratedTasksForTodoistWorkflow(tasks, { sourceContract: { id: "c" } }, prepareOptions);
  assert.equal(good.holdCalls, 1);
  assert.ok(prepared.batchId);
  assert.equal(tasks.length, 0); // held task left the batch
  assert.equal(store(good).held[0].status, "pending");
  assert.equal(store(good).held[0].source.batchId, prepared.batchId);
});

// ---- 2: pending, release, drop ----
test("held records are saved pending and are not judged until released", async () => {
  const p = makePlugin();
  await hold(p, [dup()]);
  await flush();
  assert.equal(store(p).held[0].status, "pending");
  assert.equal(p.calls.ai.length, 0);
  await p.releaseHeldBatch("b1");
  await flush();
  assert.equal(store(p).held[0].status, "checking");
  assert.equal(p.calls.ai.length, 1);
  await p.releaseHeldBatch("b1"); await flush();
  assert.equal(p.calls.ai.length, 1, "a second release judges nothing again");
});

test("release makes near-identical or AI-off records waiting; dropHeldBatch removes only that batch's pending records", async () => {
  const off = makePlugin({ settings: { enableAiAmbiguousTaskDeduplication: false } });
  await hold(off, [dup()]);
  await off.releaseHeldBatch("b1");
  assert.equal(store(off).held[0].status, "waiting");
  const p = makePlugin();
  await hold(p, [dup()], { batchId: "b1" });
  await hold(p, [Object.assign(dup(), { oid: "Z" })], { batchId: "b2" });
  await p.releaseHeldBatch("b2");
  await p.dropHeldBatch("b1", "test");
  const held = store(p).held;
  assert.deepEqual(held.map((r) => r.source.batchId), ["b2"]);
  assert.notEqual(held[0].status, "pending");
  assert.ok(p.calls.logs.some((m) => /Dropped pending/.test(m)));
});

function emailPlugin(over = {}) {
  const p = makePlugin(over);
  const tasks = [dup()];
  p.workerJson = async () => ({ raw: "From: a@b.c\r\nSubject: S\r\n\r\nPlease submit the report.", subject: "S", from: "a@b.c", receivedAt: "2026-10-12T09:30:00.000Z" });
  p.emailFailureHoldFor = () => null;
  p.beginProviderCapture = () => null;
  p.createTaskPlanWithLocalActivity = async () => ({ sectionName: "Sec", tasks, sourceSummary: "x", contextNotes: [], semanticContext: [] });
  p.prepareGeneratedTasksForTodoistWorkflow = async (t) => { const batchId = "eb1"; await p.applyTaskDeduplicationPlan(t, { source: "email", batchId }); return { sectionName: "Sec", sectionId: "s1", batchId }; };
  p.generateEmailLogSummary = async () => "";
  p.createTodoistTaskBatch = over.createThrows ? async () => { throw new Error("todoist down"); } : async () => [];
  p.appendEmailLog = over.logThrows ? async () => { throw new Error("vault locked"); } : async () => "Emails/log.md";
  p.setHeldBatchPath = over.pathThrows ? async () => { throw new Error("save failed"); } : Plugin.prototype.setHeldBatchPath;
  p.holds = [];
  p.recordEmailFailureHoldSafely = async (...args) => { p.holds.push(args); };
  p.clearEmailFailureHold = async () => {};
  return p;
}

test("email: success releases the batch (checking, judge started once, path linked); a write throw leaves no records", async () => {
  const ok = emailPlugin();
  await ok.processPendingEmailItem({ id: "m1" });
  await flush();
  assert.equal(store(ok).held[0].status, "checking");
  assert.equal(store(ok).held[0].source.path, "Emails/log.md");
  assert.equal(ok.calls.ai.length, 1);
  assert.equal(ok.holds.length, 0);
  for (const over of [{ logThrows: true }, { createThrows: true }]) {
    const bad = emailPlugin(over);
    await assert.rejects(bad.processPendingEmailItem({ id: "m1" }));
    assert.deepEqual(store(bad).held, [], JSON.stringify(over));
    assert.equal(bad.calls.ai.length, 0);
    assert.equal(bad.holds.length, 1, "the email itself is still held for reconciliation");
  }
});

test("email: a setHeldBatchPath failure neither holds the email nor stops the release", async () => {
  const p = emailPlugin({ pathThrows: true });
  const result = await p.processPendingEmailItem({ id: "m1" });
  await flush();
  assert.equal(p.holds.length, 0);
  assert.equal(result.id, "m1");
  assert.equal(store(p).held[0].status, "checking");
});

test("rollback on a failed save removes exactly the added records and keeps the batch", async () => {
  const p = makePlugin({ saveThrows: true });
  const store0 = await p.loadDuplicateStore();
  store0.held.push({ id: "old", kind: "plan", status: "waiting", source: {} });
  const tasks = [dup()];
  const stats = await hold(p, tasks);
  assert.equal(tasks.length, 1);
  assert.equal(stats.held, 0);
  assert.deepEqual(store0.held.map((r) => r.id), ["old"]);
  // chat rows: same rollback
  const chat = makePlugin({ saveThrows: true });
  const s = await chat.loadDuplicateStore();
  s.held.push({ id: "old", kind: "plan", status: "waiting", source: {} });
  const held = await chat.holdChatCreateRows([{ op: "create", fields: { content: "Submit annual IRGP report to the funder" }, target: { projectId: "p1" } }], { projects: [], sections: [] });
  assert.equal(held.size, 0);
  assert.deepEqual(s.held.map((r) => r.id), ["old"]);
});

// ---- 3: same-batch candidates ----
const twoNear = () => [
  { content: "Submit the annual IRGP report to funder", oid: "A", projectId: "p1", subtasks: [] },
  { content: "Submit annual IRGP report to the funder", oid: "B", projectId: "p1", subtasks: [] }
];

test("same batch: the later near-identical task is held against the earlier one's oid; release fills its Todoist id", async () => {
  const p = makePlugin({ snapshotTasks: [] });
  const tasks = twoNear();
  const first = tasks[0];
  await hold(p, tasks);
  const rec = store(p).held;
  assert.equal(rec.length, 1);
  assert.equal(rec[0].task.oid, "B");
  assert.equal(rec[0].candidate.oid, "A");
  assert.equal(rec[0].candidate.id, "");
  assert.deepEqual(tasks.map((t) => t.oid), ["A"]);
  first.id = "todoist-A"; // the batch write assigns ids
  await p.releaseHeldBatch("b1");
  await flush();
  assert.equal(store(p).held[0].candidate.id, "todoist-A");
  assert.equal(store(p).held[0].status, "checking");
});

test("same batch: a candidate that was never created resolves as keep with a log line; an earlier held task is not a candidate", async () => {
  const p = makePlugin({ snapshotTasks: [] });
  await hold(p, twoNear());
  await p.releaseHeldBatch("b1");
  await flush();
  assert.ok(p.calls.logs.some((m) => /same-batch candidate not created/i.test(m)));
  assert.equal(p.calls.resolve.length, 1);
  assert.equal(p.calls.resolve[0].answer, "keep");
  assert.equal(p.calls.ai.length, 0);
  // A near-identical to existing e1 is held; B is near A but A is held, so B is compared only with existing tasks (it also matches e1).
  const q = makePlugin();
  const tasks = twoNear();
  await hold(q, tasks);
  assert.ok(store(q).held.every((r) => r.candidate.id === "e1"), JSON.stringify(store(q).held.map((r) => r.candidate)));
  assert.equal(tasks.length, 0);
});

// ---- 4: light candidates ----
test("candidates are open top-level snapshot tasks: subtasks and completed ones are never matched; snapshot recurrence is used", async () => {
  const sub = Object.assign({}, existing, { id: "s1", parentId: "e0" });
  const done = Object.assign({}, existing, { id: "d1", isCompleted: true });
  const p = makePlugin({ snapshotTasks: [sub, done] });
  p.taskDeduplicationCandidates = async () => { throw new Error("the heavy scan must not run"); };
  assert.equal((await p.findDuplicateHolds([dup()], {})).holds.length, 0);
  const due = Object.assign({}, existing, { dueDate: "2026-11-01" });
  const one = makePlugin({ snapshotTasks: [Object.assign({}, due, { isRecurring: false })] });
  one.settings.taskCache = { e1: { oid: "OLD" } };
  const r = await one.findDuplicateHolds([dup()], {});
  assert.equal(r.holds.length, 1);
  assert.equal(r.holds[0].candidate.oid, "OLD");
  const rec = makePlugin({ snapshotTasks: [Object.assign({}, due, { isRecurring: true })] });
  assert.equal((await rec.findDuplicateHolds([dup()], {})).holds.length, 0);
});

test("no snapshot: the top-level task cache stands in (no due date matches, one with a due date does not), logged once", async () => {
  const p = makePlugin({ getTodoistSnapshot: async () => { throw new Error("offline"); } });
  p.settings.taskCache = {
    e1: { content: existing.content, oid: "O1", projectId: "p1", parentId: "" },
    e2: { content: existing.content, oid: "O2", projectId: "p1", parentId: "e1" },
    e3: { content: existing.content, oid: "O3", projectId: "p1", parentId: "", dueDate: "2026-11-01" }
  };
  const r = await p.findDuplicateHolds([dup()], {});
  assert.equal(r.holds.length, 1);
  assert.equal(r.holds[0].candidate.id, "e1");
  await p.findDuplicateHolds([dup()], {});
  assert.equal(p.calls.logs.filter((m) => /recurrence unknown/i.test(m)).length, 1);
});

// ---- 5: bounded wait ----
test("a never-resolving embedding times out, degrades, pauses the check for a minute and logs once per run", async () => {
  const p = makePlugin({ embedTexts: () => new Promise(() => {}) });
  p.duplicateCheckTimeoutMs = 30;
  const started = Date.now();
  const tasks = [dup()];
  const stats = await hold(p, tasks);
  assert.ok(Date.now() - started < 1000);
  assert.equal(stats.held, 0); assert.equal(tasks.length, 1);
  assert.equal(stats.degradedReason, "the duplicate check took too long");
  assert.ok(p.duplicateCheckPausedUntil > Date.now() + 50000);
  // paused: no embedding request at all, still degraded
  let embeds = 0; p.embedTexts = async (t) => { embeds += 1; return t.map(() => FAR); };
  const again = await p.findDuplicateHolds([dup()], {});
  assert.equal(embeds, 0); assert.equal(again.holds.length, 0); assert.ok(again.degraded);
  p.duplicateCheckPausedUntil = Date.now() - 1; // pause over: works again
  const resumed = await p.findDuplicateHolds([dup()], {});
  assert.equal(embeds, 0); // same titles are still in flight from the timed-out call: shared, not re-requested
  assert.match(resumed.degraded, /too long/);
});

test("an embedding failure also pauses the check", async () => {
  const p = makePlugin({ embedTexts: async () => { throw new Error("embed down"); } });
  const r = await p.findDuplicateHolds([dup()], {});
  assert.match(r.degraded, /embedding check failed/);
  assert.ok(p.duplicateCheckPausedUntil > Date.now());
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log("PASS " + name); } catch (error) { failed += 1; console.log("FAIL " + name + "\n  " + (error && error.stack || error).toString().split("\n").slice(0, 5).join("\n  ")); }
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
})();
