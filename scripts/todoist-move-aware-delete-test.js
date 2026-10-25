"use strict";

// Move-aware delete check: a task line that left note A but sits in another
// note (or whose note was renamed/deleted) must not be deleted in Todoist.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = path.join(__dirname, "..", "src/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

let TFileRef = null;
const notices = [];
const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class TFile {}
  TFileRef = TFile;
  class Empty {}
  class Notice { constructor(message) { notices.push(String(message)); } }
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice,
    Plugin: Empty, PluginSettingTab: Empty, Setting: Empty, TFile, setIcon() {},
    requestUrl() { throw new Error("network disabled in local test"); },
  };
};

let pluginApi;
try {
  testModule._compile(`${mainSource}`, mainPath);
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const ID = "6hmCc84rCV224xjV";
const OID = "Q7X2Z";
const A = "Notes/A.md";
const B = "Notes/B.md";
const MISC = "Semantic Todoist Sync/Miscellaneous Tasks/2026-10 Tasks.md";
const MISC_RENAMED = "Semantic Todoist Sync/Miscellaneous Tasks/2026-10 Renamed.md";
const line = `- [ ] Ship it %%[tid:: ${ID}]%% %%[oid:: ${OID}]%%`;

function makePlugin(files, cachePath) {
  const store = new Map(Object.entries(files));
  const tfiles = new Map();
  for (const p of store.keys()) { const f = new TFileRef(); f.path = p; tfiles.set(p, f); }
  const settings = Object.assign({}, pluginApi.DEFAULT_SETTINGS, { taskCache: {} });
  settings.taskCache[ID] = { oid: OID, path: cachePath, isCompleted: false, content: "Ship it" };
  const plugin = Object.create(pluginApi.prototype);
  plugin.settings = settings;
  plugin.app = { vault: {
    getAbstractFileByPath: (p) => tfiles.get(String(p)) || null,
    getMarkdownFiles: () => [...tfiles.values()],
    read: async (f) => store.get(f.path),
    cachedRead: async (f) => store.get(f.path),
  } };
  plugin.deletes = [];
  plugin.logLocal = () => {};
  plugin.markTaskReferenceStateDirty = () => { plugin.taskReferenceStateRevision = (plugin.taskReferenceStateRevision || 0) + 1; };
  plugin.queueTaskReferenceIndexUpdate = () => {};
  plugin.deleteTodoistTask = async (id) => { plugin.deletes.push(id); return true; };
  plugin.cleanupEmptyTodoistSections = async () => 0;
  return plugin;
}

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("line moved from note A into note B: no Todoist delete, taskCache path updated", async () => {
  const p = makePlugin({ [A]: "# A\n", [B]: `${line}\n` }, A);
  const r = await p.deleteTodoistTasksMissingFromFile(A, new Set());
  assert.deepEqual(p.deletes, []);
  assert.equal(r.deleted, 0);
  assert.equal(p.settings.taskCache[ID].path, B);
});

test("moved line, note B synced first: cache already points at B, A sync deletes nothing", async () => {
  const p = makePlugin({ [A]: "# A\n", [B]: `${line}\n` }, B);
  await p.deleteTodoistTasksMissingFromFile(A, new Set());
  assert.deepEqual(p.deletes, []);
  assert.equal(p.settings.taskCache[ID].path, B);
});

test("line truly removed everywhere: deleted today", async () => {
  const p = makePlugin({ [A]: "# A\n", [B]: "# B\n" }, A);
  const r = await p.deleteTodoistTasksMissingFromFile(A, new Set());
  assert.deepEqual(p.deletes, [ID]);
  assert.equal(r.deleted, 1);
  assert.equal(p.settings.taskCache[ID], undefined);
});

test("deleted monthly note: no Todoist deletes, one warning notice", async () => {
  notices.length = 0;
  const p = makePlugin({ [A]: "# A\n" }, MISC);
  const r = await p.deleteTodoistTasksMissingFromFile(MISC, new Set());
  assert.deepEqual(p.deletes, []);
  assert.equal(r.deleted, 0);
  assert.equal(notices.length, 1);
  assert.ok(p.settings.taskCache[ID], "cache entry kept");
});

test("renamed monthly note: taskCache paths follow", async () => {
  notices.length = 0;
  const p = makePlugin({ [MISC_RENAMED]: `${line}\n` }, MISC);
  await p.deleteTodoistTasksMissingFromFile(MISC, new Set());
  assert.deepEqual(p.deletes, []);
  assert.equal(p.settings.taskCache[ID].path, MISC_RENAMED);
  assert.equal(notices.length, 0);
});

test("isMiscTasksPath honors setting and default", () => {
  assert.equal(pluginApi.isMiscTasksPath(MISC, {}), true);
  assert.equal(pluginApi.isMiscTasksPath("Other/x.md", {}), false);
  assert.equal(pluginApi.isMiscTasksPath("Other/x.md", { miscTasksFolder: "Other" }), true);
});

function addTask(p, id, oid, path) { p.settings.taskCache[id] = { oid, path, isCompleted: false, content: id }; }

test("N missing tasks: each other note read at most once per call", async () => {
  const files = { [A]: "# A\n" };
  for (let i = 0; i < 5; i++) files[`Notes/N${i}.md`] = "nothing\n";
  const p = makePlugin(files, A);
  for (let i = 0; i < 4; i++) addTask(p, `extra${i}xxxxx`, `E${i}`, A);
  const reads = new Map();
  const count = async (f) => { reads.set(f.path, (reads.get(f.path) || 0) + 1); return files[f.path]; };
  p.app.vault.read = count; p.app.vault.cachedRead = count;
  const r = await p.deleteTodoistTasksMissingFromFile(A, new Set());
  assert.equal(r.deleted, 5);
  assert.ok(reads.size > 0);
  for (const [f, n] of reads) assert.ok(n <= 1, `${f} read ${n} times`);
});

test("unreadable candidate does not abort; others still checked", async () => {
  const p = makePlugin({ [A]: "# A\n", "Notes/Bad.md": "x", [B]: `${line}\n` }, A);
  const ok = p.app.vault.cachedRead;
  p.app.vault.cachedRead = async (f) => { if (f.path === "Notes/Bad.md") throw new Error("locked"); return ok(f); };
  p.app.vault.read = p.app.vault.cachedRead;
  await p.deleteTodoistTasksMissingFromFile(A, new Set());
  assert.deepEqual(p.deletes, []);
  assert.equal(p.settings.taskCache[ID].path, B);
});

test("unreadable candidate and no match: delete still goes through", async () => {
  const p = makePlugin({ [A]: "# A\n", "Notes/Bad.md": "x" }, A);
  const fail = async () => { throw new Error("locked"); };
  p.app.vault.cachedRead = fail; p.app.vault.read = fail;
  const r = await p.deleteTodoistTasksMissingFromFile(A, new Set());
  assert.deepEqual(p.deletes, [ID]);
  assert.equal(r.deleted, 1);
});

test("oid-only line in another note keeps the task", async () => {
  const p = makePlugin({ [A]: "# A\n", [B]: `- [ ] Ship it %%[oid:: ${OID}]%%\n` }, A);
  await p.deleteTodoistTasksMissingFromFile(A, new Set());
  assert.deepEqual(p.deletes, []);
  assert.equal(p.settings.taskCache[ID].path, B);
});

test("a moved line carrying a noteRefs oid keeps the task", async () => {
  const p = makePlugin({ [A]: "# A\n", [B]: "- [ ] Ship it %%[oid:: BBBBB]%%\n" }, A);
  p.settings.taskCache[ID].noteRefs = [{ path: A, oid: "BBBBB" }];
  await p.deleteTodoistTasksMissingFromFile(A, new Set());
  assert.deepEqual(p.deletes, []);
  assert.equal(p.settings.taskCache[ID].path, B);
});

test("a lowercase oid on the moved line keeps the task", async () => {
  const p = makePlugin({ [A]: "# A\n", [B]: `- [ ] Ship it %%[oid:: ${OID.toLowerCase()}]%%\n` }, A);
  await p.deleteTodoistTasksMissingFromFile(A, new Set());
  assert.deepEqual(p.deletes, []);
  assert.equal(p.settings.taskCache[ID].path, B);
});

(async () => {
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}: ${error && error.message || error}`); process.exitCode = 1; }
  }
})();
