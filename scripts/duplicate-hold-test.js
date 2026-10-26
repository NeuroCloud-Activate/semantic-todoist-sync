"use strict";
// T2: creation-time duplicate hold. Every Todoist, embedding and model call is stubbed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const mainPath = path.join(__dirname, "..", "src/main.js");
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

const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const flush = () => new Promise((resolve) => setImmediate(resolve));
// Title -> vector. "Submit the annual IRGP report to funder" vs "Submit annual IRGP report to the funder" cosine ~0.95; identical vectors = 1.
const SIM = [1, 0], NEAR = [0.95, Math.sqrt(1 - 0.95 * 0.95)], FAR = [0, 1];
const vectors = { "submit the annual irgp report to funder": SIM, "submit annual irgp report to the funder": NEAR, "water all the plants in the office": FAR, "book flights for the team trip": [0.6, 0.8] };
const existing = { id: "e1", content: "Submit the annual IRGP report to funder", projectId: "p1", sectionId: "", parentId: "", dueDate: "", isRecurring: false, labels: [], priority: 1, description: "" };

function makePlugin(over = {}) {
  const p = Object.create(Plugin.prototype);
  p.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { embeddingModel: "embeddinggemma-2", enableTaskDeduplication: true, enableAiAmbiguousTaskDeduplication: true }, over.settings || {});
  p.manifest = { dir: "plugin-dir" };
  p.files = {};
  p.app = { vault: { adapter: {
    read: async (f) => { if (!(f in p.files)) throw new Error("ENOENT"); return p.files[f]; },
    write: async (f, body) => { p.files[f] = body; },
    exists: async (f) => f in p.files
  } } };
  p.calls = { embed: [], ai: [], post: [], resolve: [], update: 0 };
  p.logLocal = () => {};
  p.setSidebarStatus = () => {};
  p.embedTexts = async (texts) => { p.calls.embed.push(texts.slice()); if (over.embedThrows) throw new Error("embed down"); return texts.map((t) => vectors[String(t).toLowerCase()] || FAR); };
  // Candidates now come from the cached Todoist snapshot (was: taskDeduplicationCandidates).
  p.getTodoistSnapshot = async () => ({ tasks: (over.candidates || [{ id: "e1", task: existing }]).map((c) => c.task), projects: [], sections: [] });
  // Held records are saved "pending" and only judged once the caller releases the batch (the write succeeded).
  const plan = Plugin.prototype.applyTaskDeduplicationPlan;
  p.applyTaskDeduplicationPlan = async (tasks, opts = {}) => { const o = Object.assign({ batchId: "bx" }, opts); const s = await plan.call(p, tasks, o); await p.releaseHeldBatch(o.batchId); return s; };
  p.openaiResponse = over.openaiResponse || (async (req) => { p.calls.ai.push(req); return JSON.stringify({ verdict: "unsure", confidence: 0.5, reason: "x" }); });
  p.postDuplicateReviewBox = async (r) => { p.calls.post.push(r.id); };
  p.resolveHeldDuplicate = async (id, answer, opts) => { p.calls.resolve.push({ id, answer, by: opts && opts.by }); };
  p.updateTodoistFromParsedTask = async () => { p.calls.update += 1; throw new Error("no silent merge"); };
  return p;
}
const batch = () => [
  { content: "Submit annual IRGP report to the funder", oid: "A", projectId: "p1", subtasks: [{ content: "Gather figures", oid: "A1" }] },
  { content: "Water all the plants in the office", oid: "B", projectId: "p1", subtasks: [] },
  { content: "Book flights for the team trip", oid: "C", projectId: "p1", subtasks: [] }
];
const store = (p) => JSON.parse(p.files["plugin-dir/duplicate-review.json"]);

test("batch: one embedding request, held task (with subtasks) leaves the batch, others untouched, record saved as checking, AI not awaited", async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const p = makePlugin({ openaiResponse: async (req) => { p.calls.ai.push(req); await gate; return JSON.stringify({ verdict: "unsure", confidence: 0.4, reason: "" }); } });
  const tasks = batch(); const before = JSON.parse(JSON.stringify(tasks.slice(1)));
  const stats = await p.applyTaskDeduplicationPlan(tasks, { source: "note", path: "n.md", sectionName: "S", projectId: "p1", projectName: "Home", batchId: "b1" });
  assert.equal(p.calls.embed.length, 1);
  assert.equal(p.calls.embed[0].length, 4); // 3 new titles + 1 uncached existing title
  assert.deepEqual(tasks.map((t) => t.oid), ["B", "C"]);
  assert.deepEqual(tasks, before);
  assert.equal(stats.held, 1);
  assert.equal(p.calls.update, 0);
  const rec = store(p).held;
  assert.equal(rec.length, 1);
  assert.equal(rec[0].status, "checking");
  assert.equal(rec[0].kind, "plan");
  assert.equal(rec[0].task.subtasks.length, 1);
  assert.equal(rec[0].candidate.id, "e1");
  assert.equal(rec[0].source.type, "note"); assert.equal(rec[0].source.path, "n.md"); assert.equal(rec[0].source.projectName, "Home");
  assert.equal(rec[0].source.batchId, "b1");
  await flush();
  assert.equal(p.calls.ai.length, 1); // judge started, still pending, plan call already returned
  assert.equal(p.calls.post.length, 0);
  release(); await flush(); await flush();
});

test("judge request uses strict schema, dedupe model and effort", async () => {
  const p = makePlugin({ settings: { taskDeduplicationAiModel: "m-x", taskDeduplicationAiReasoningEffort: "low" } });
  await p.applyTaskDeduplicationPlan(batch(), {});
  await flush(); await flush();
  const req = p.calls.ai[0];
  assert.equal(req.operation, "deduplication"); assert.equal(req.model, "m-x"); assert.equal(req.reasoningEffort, "low");
  assert.deepEqual(req.jsonSchema.required, ["verdict", "confidence", "reason"]);
  assert.match(req.user, /Submit annual IRGP report to the funder/); assert.match(req.user, /Submit the annual IRGP report to funder/);
});

test("unsure verdict -> waiting + box posted", async () => {
  const p = makePlugin();
  await p.applyTaskDeduplicationPlan(batch(), {});
  await flush(); await flush();
  assert.equal(store(p).held[0].status, "waiting");
  assert.equal(store(p).held[0].ai.verdict, "unsure");
  assert.equal(p.calls.post.length, 1);
  assert.equal(p.calls.resolve.length, 0);
});

test("not-duplicate verdict -> resolved keep by ai, no box", async () => {
  const p = makePlugin({ openaiResponse: async () => JSON.stringify({ verdict: "not-duplicate", confidence: 0.9, reason: "different" }) });
  await p.applyTaskDeduplicationPlan(batch(), {});
  await flush(); await flush();
  assert.equal(p.calls.post.length, 0);
  assert.equal(p.calls.resolve.length, 1);
  assert.equal(p.calls.resolve[0].answer, "keep"); assert.equal(p.calls.resolve[0].by, "ai");
});

test("AI failure and AI timeout still show the box", async () => {
  const bad = makePlugin({ openaiResponse: async () => { throw new Error("boom"); } });
  await bad.applyTaskDeduplicationPlan(batch(), {});
  await flush(); await flush();
  assert.equal(bad.calls.post.length, 1);
  assert.ok(store(bad).held[0].ai.error);
  const slow = makePlugin({ openaiResponse: () => new Promise(() => {}) });
  slow.duplicateJudgeTimeoutMs = 20;
  await slow.applyTaskDeduplicationPlan(batch(), {});
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(slow.calls.post.length, 1);
  assert.ok(store(slow).held[0].ai.error);
  assert.equal(store(slow).held[0].status, "waiting");
});

test("near-identical title skips AI and boxes at once; AI setting off boxes without AI", async () => {
  const same = makePlugin({ candidates: [{ id: "e1", task: Object.assign({}, existing, { content: "Submit annual IRGP report to the funder" }) }] });
  await same.applyTaskDeduplicationPlan(batch(), {});
  await flush();
  assert.equal(same.calls.ai.length, 0);
  assert.equal(store(same).held[0].status, "waiting"); assert.equal(store(same).held[0].nearIdentical, true);
  assert.equal(same.calls.post.length, 1);
  const off = makePlugin({ settings: { enableAiAmbiguousTaskDeduplication: false } });
  await off.applyTaskDeduplicationPlan(batch(), {});
  await flush();
  assert.equal(off.calls.ai.length, 0);
  assert.equal(store(off).held[0].status, "waiting");
  assert.equal(off.calls.post.length, 1);
});

test("degraded: uncalibrated embedding model or embedding failure holds nothing and says so", async () => {
  const model = makePlugin({ settings: { embeddingModel: "other-model" } });
  const t1 = batch();
  const s1 = await model.applyTaskDeduplicationPlan(t1, {});
  assert.equal(t1.length, 3); assert.equal(s1.held, 0); assert.equal(model.calls.embed.length, 0);
  assert.ok(s1.degradedReason);
  const fail = makePlugin({ embedThrows: true });
  const t2 = batch();
  const s2 = await fail.applyTaskDeduplicationPlan(t2, {});
  assert.equal(t2.length, 3); assert.equal(s2.held, 0); assert.ok(s2.degradedReason);
});

test("findDuplicateHolds skips self-match and unrelated tasks", async () => {
  const p = makePlugin();
  const tasks = [{ content: "Submit the annual IRGP report to funder", oid: "Z", id: "e1", projectId: "p1" }, { content: "Water all the plants in the office", oid: "B", projectId: "p1" }];
  const { holds, degraded } = await p.findDuplicateHolds(tasks, {});
  assert.equal(holds.length, 0); assert.equal(degraded, "");
});

test("title vectors are cached on disk: second batch embeds only new titles", async () => {
  const p = makePlugin();
  await p.applyTaskDeduplicationPlan(batch(), {});
  const cache = JSON.parse(p.files["plugin-dir/task-title-vectors.json"]);
  assert.equal(cache.model, "embeddinggemma-2");
  assert.ok(cache.vectors["submit the annual irgp report to funder"]);
  const p2 = makePlugin(); p2.files = p.files;
  await p2.applyTaskDeduplicationPlan([{ content: "Water all the plants in the office", oid: "Q", projectId: "p1" }, { content: "Brand new thing to do today", oid: "R", projectId: "p1" }], {});
  assert.equal(p2.calls.embed.length, 1);
  assert.deepEqual(p2.calls.embed[0], ["Brand new thing to do today"]);
});

test("dedupe disabled: nothing checked", async () => {
  const p = makePlugin({ settings: { enableTaskDeduplication: false } });
  const tasks = batch();
  const stats = await p.applyTaskDeduplicationPlan(tasks, {});
  assert.equal(tasks.length, 3); assert.equal(p.calls.embed.length, 0); assert.equal(stats.held, 0);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log("PASS " + name); } catch (error) { failed += 1; console.log("FAIL " + name + "\n  " + (error && error.stack || error)); }
  }
  if (failed) process.exit(1);
})();
