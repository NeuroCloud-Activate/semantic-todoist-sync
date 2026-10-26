"use strict";
// T2: creation-time duplicate hold. Every Todoist, embedding and model call is stubbed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const mainPath = path.resolve(__dirname, "..", process.env.DUPBOX_MAIN || "src/main.js");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class Empty { open() {} }
  return { ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty, TFile: Empty, setIcon() {}, requestUrl: async (req) => { if (global.__req) return global.__req(req); throw new Error("network disabled in test"); } };
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
const SIM = [1, 0];
const mk = (id, content, extra = {}) => Object.assign({ id, content, projectId: "p1", sectionId: "", parentId: "", dueDate: "", isRecurring: false, labels: [], priority: 1, description: "" }, extra);

function makePlugin(over = {}) {
  const p = Object.create(Plugin.prototype);
  p.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { embeddingModel: "embeddinggemma-2", enableTaskDeduplication: true, todoistToken: "t" }, over.settings || {});
  p.manifest = { dir: "plugin-dir" };
  p.files = over.files || {};
  p.app = { vault: { adapter: {
    read: async (f) => { if (!(f in p.files)) throw new Error("ENOENT"); return p.files[f]; },
    write: async (f, body) => { p.files[f] = body; },
    exists: async (f) => f in p.files
  } } };
  p.logLocal = () => {};
  p.saveSettings = async () => {};
  p.embedCalls = [];
  p.embedTexts = over.embedTexts || (async (texts) => { p.embedCalls.push(texts.slice()); return texts.map(() => SIM); });
  return p;
}
const snap = (tasks) => ({ tasks, projects: [], sections: [] });

test("stale snapshot: no awaited fetch, one background refresh across 3 concurrent batches", async () => {
  const p = makePlugin();
  p.lastTodoistSnapshot = { key: "items,projects,sections", snapshot: snap([mk("e1", "Old task")]), fetchedAt: 0 };
  p.todoistSnapshotCache = null;
  let fetches = 0;
  p.getTodoistSnapshot = () => { fetches += 1; return new Promise(() => {}); }; // never resolves
  const results = await Promise.all([p.duplicateCandidates(), p.duplicateCandidates(), p.duplicateCandidates()]);
  assert.deepEqual(results.map((r) => r.map((c) => c.id)), [["e1"], ["e1"], ["e1"]]);
  await flush();
  assert.equal(fetches, 1);
});

test("stale snapshot: cached-only task created after it is a candidate; snapshot ids are not duplicated", async () => {
  const p = makePlugin({ settings: { taskCache: { e1: mk("e1", "Old task"), n2: mk("n2", "New task"), sub: mk("sub", "Child", { parentId: "e1" }), done: mk("done", "Done", { isCompleted: true }) } } });
  p.lastTodoistSnapshot = { key: "items,projects,sections", snapshot: snap([mk("e1", "Old task")]), fetchedAt: 0 };
  p.getTodoistSnapshot = async () => snap([]);
  const ids = (await p.duplicateCandidates()).map((c) => c.id).sort();
  assert.deepEqual(ids, ["e1", "n2"]);
});

test("no snapshot ever seen: the fetch is awaited", async () => {
  const p = makePlugin();
  let fetches = 0;
  p.getTodoistSnapshot = async () => { fetches += 1; return snap([mk("e1", "Old task")]); };
  assert.deepEqual((await p.duplicateCandidates()).map((c) => c.id), ["e1"]);
  assert.equal(fetches, 1);
});

test("getTodoistSnapshot remembers the last good snapshot and a write does not clear it", async () => {
  const p = makePlugin();
  global.__req = async () => ({ status: 200, json: { items: [{ id: "1", content: "A", project_id: "p1" }], projects: [], sections: [] }, text: "" });
  try { await p.getTodoistSnapshot(["items", "projects", "sections"], true); } finally { delete global.__req; }
  p.todoistSnapshotCache = null;
  assert.equal(p.lastTodoistSnapshot.key, "items,projects,sections");
  assert.equal(p.lastTodoistSnapshot.snapshot.tasks.length, 1);
});

test("embedding: overlapping calls with the same 150 titles embed them once", async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const p = makePlugin();
  p.embedTexts = async (texts) => { p.embedCalls.push(texts.slice()); await gate; return texts.map(() => SIM); };
  const titles = Array.from({ length: 150 }, (_, i) => `task number ${i}`);
  const a = p.embedDuplicateTitles(titles), b = p.embedDuplicateTitles(titles);
  await flush(); release();
  const [va, vb] = await Promise.all([a, b]);
  assert.equal(p.embedCalls.reduce((n, c) => n + c.length, 0), 150);
  assert.deepEqual(va("task number 7"), SIM); assert.deepEqual(vb("task number 149"), SIM);
});

test("embedding: a failed in-flight request is not reused forever", async () => {
  const p = makePlugin();
  let fail = true;
  p.embedTexts = async (texts) => { p.embedCalls.push(texts.slice()); if (fail) throw new Error("down"); return texts.map(() => SIM); };
  await assert.rejects(p.embedDuplicateTitles(["alpha task"]), /down/);
  await flush(); fail = false;
  assert.deepEqual((await p.embedDuplicateTitles(["alpha task"]))("alpha task"), SIM);
});

test("cache write after one new title encodes once, not for all 2000 entries", async () => {
  const enc = (v) => Buffer.from(new Float32Array(v).buffer).toString("base64");
  const vectors = {};
  for (let i = 0; i < 2000; i++) vectors[`title ${i}`] = { v: enc([1, 0]), usedAt: "2026-01-01" };
  const p = makePlugin({ files: { "plugin-dir/task-title-vectors.json": JSON.stringify({ model: "embeddinggemma-2", version: 2, vectors }) } });
  const realBtoa = global.btoa; let n = 0;
  global.btoa = (s) => { n += 1; return realBtoa(s); };
  try {
    await p.embedDuplicateTitles(["brand new title"]);
    await flush(); await flush();
  } finally { global.btoa = realBtoa; }
  assert.equal(n, 1);
  const saved = JSON.parse(p.files["plugin-dir/task-title-vectors.json"]);
  assert.ok(saved.vectors["brand new title"].v && saved.vectors["title 5"].v);
});

test("same-batch pair with the same due date: second task is held", async () => {
  const p = makePlugin();
  p.duplicateCandidates = async () => [];
  const due = { dueDate: "2026-11-01", projectId: "p1" };
  const holds = await p.computeDuplicateHolds([
    Object.assign({ content: "Submit the annual IRGP report to funder", oid: "A" }, due),
    Object.assign({ content: "Submit the annual IRGP report to funder", oid: "B" }, due)
  ]);
  assert.equal(holds.length, 1);
  assert.equal(holds[0].task.oid, "B");
});

let finished = false;
process.on("exit", (code) => { if (!finished && !code) { console.log("FAIL test run hung (awaited a never-resolving call)"); process.exitCode = 1; } });
(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log("PASS " + name); } catch (error) { failed += 1; console.log("FAIL " + name + "\n  " + (error && error.stack || error)); }
  }
  finished = true;
  if (failed) process.exit(1);
})();