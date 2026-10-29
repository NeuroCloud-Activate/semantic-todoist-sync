"use strict";
// A task deleted or completed in Todoist is checked off in its note; unchecking it later must bring it back
// (recreate if deleted, reopen if completed) instead of being re-checked by the next sync. Vault and Todoist are fakes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const mainPath = path.join(__dirname, "..", "src/main.js");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
let TFileRef;
const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class Empty {}
  class TFile {}
  TFileRef = TFile;
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: class {}, Plugin: Empty,
    PluginSettingTab: Empty, Setting: Empty, TFile, setIcon() {}, requestUrl: async (opts) => { if (!globalThis.__testRequestUrl) throw new Error("network disabled in test"); return globalThis.__testRequestUrl(opts); }
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

const NOTE = "Notes/Garden.md";
const projects = [{ id: "p1", name: "Home", isInbox: false }];
const snapshotOf = (tasks) => ({ tasks, projects, sections: [], fetchedAt: "2026-10-25T10:00:00" });
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

function makePlugin(text) {
  const store = new Map([[NOTE, text]]);
  const file = new TFileRef();
  file.path = NOTE; file.basename = "Garden"; file.extension = "md";
  const p = Object.create(Plugin.prototype);
  p.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { taskCache: {}, todoistToken: "tok" });
  p.app = { vault: {
    getAbstractFileByPath: (x) => (x === NOTE ? file : null),
    getMarkdownFiles: () => [file],
    read: async () => store.get(NOTE), cachedRead: async () => store.get(NOTE),
    modify: async (f, t) => { store.set(NOTE, t); },
    process: async (f, fn) => { store.set(NOTE, fn(store.get(NOTE))); }
  } };
  p.taskReferenceStateRevision = 0;
  p.store = store;
  p.snapshot = snapshotOf([]);
  p.snapshotFails = false;
  p.exists = true; // answer of todoistTaskExists for ids missing from the snapshot (false = 404 = deleted)
  p.commands = []; // item_add commands sent to Todoist
  p.reopened = [];
  p.closed = [];
  let n = 0;
  p.saveSettings = async () => {};
  for (const name of ["logLocal", "setSidebarStatus", "refreshSidebarStatus", "queueTaskReferenceSnapshotWrite", "queueTaskReferenceIndexUpdate", "observeSchedulerMemoryForTask"]) p[name] = () => {};
  p.getTodoistSnapshot = async () => { if (p.snapshotFails) throw new Error("offline"); return p.snapshot; };
  p.requireTodoistAccess = () => {};
  p.getTaskProjectId = async () => "p1";
  p.todoistProjectNameForId = async () => "Home";
  p.ensureTodoistSectionId = async () => "s1";
  p.todoistTaskExists = async () => p.exists;
  p.todoistConflictForLocalUpdate = async () => null;
  p.cleanupEmptyTodoistSections = async () => 0;
  p.deleteTodoistTask = async () => true;
  p.todoistRequest = async () => ({});
  // The real setTodoistTaskCompletionState runs; only HTTP is faked. POST /reopen answers 404 for a deleted task (p.exists = false).
  globalThis.__testRequestUrl = async ({ url, method }) => {
    const m = /\/tasks\/([^/]+)\/(close|reopen)$/.exec(url);
    if (m && method === "POST") { (m[2] === "close" ? p.closed : p.reopened).push(m[1]); return { status: m[2] === "reopen" && !p.exists ? 404 : 204, text: "" }; }
    return { status: 404, text: "" }; // GET /tasks/{id} is no valid probe for completed tasks
  };
  p.todoistSync = async (commands) => {
    const mapping = {};
    for (const c of commands) { p.commands.push(c); mapping[c.temp_id] = `N${++n}`; }
    return { temp_id_mapping: mapping };
  };
  return p;
}
const read = (p) => p.store.get(NOTE);
const lineWith = (p, needle) => read(p).split("\n").find((l) => l.includes(needle));
const uncheck = (p, needle) => p.store.set(NOTE, read(p).split("\n").map((l) => (l.includes(needle) ? l.replace("[x]", "[ ]") : l)).join("\n"));
const oidOf = (line) => /oid::\s*([A-Za-z0-9]+)/.exec(line)[1];
const created = (p) => p.commands.filter((c) => c.type === "item_add");
const fullSync = async (p) => { await p.reconcileTodoistTaskCache(); await p.syncFileNotes(NOTE, false); };

// Task is created from the note, then vanishes from the active snapshot (deleted or completed in Todoist) and is checked off.
async function closedRemotely(text = "- [ ] Buy mulch #STsync\n") {
  const p = makePlugin(text);
  await p.syncFileNotes(NOTE, false);
  assert.equal(created(p).length, 1, "setup: task created once");
  p.snapshot = snapshotOf([]);
  await p.reconcileTodoistTaskCache();
  assert.match(lineWith(p, "Buy mulch"), /\[x\]/, "setup: missing task checked off (first detection)");
  return p;
}

test("deleted in Todoist, then unchecked: recreated once, oid maps to the new id, no duplicates on next sync", async () => {
  const p = await closedRemotely();
  const oid = oidOf(lineWith(p, "Buy mulch"));
  p.exists = false;
  uncheck(p, "Buy mulch");
  await p.reconcileTodoistTaskCache();
  assert.match(lineWith(p, "Buy mulch"), /\[ \]/, "reconcile must not re-check a line the user reopened");
  await p.syncFileNotes(NOTE, false);
  assert.equal(created(p).length, 2, "exactly one new task (plus the original)");
  const line = lineWith(p, "Buy mulch");
  assert.match(line, /\[ \]/);
  assert.equal(oidOf(line), oid, "oid marker kept");
  const newId = created(p)[1].temp_id && Object.keys(p.settings.taskCache).find((id) => p.settings.taskCache[id].oid === oid);
  assert.equal(newId, "N2");
  assert.equal(Boolean(p.settings.taskCache.N1), false, "old entry gone");
  assert.equal(p.settings.taskCache.N2.isCompleted, false);
  p.snapshot = snapshotOf([{ id: "N2", content: "Buy mulch", description: "", parentId: "", sectionId: "", projectId: "p1", labels: [], priority: 1, dueDate: "", deadlineDate: "", duration: null, isCompleted: false }]);
  await fullSync(p);
  await fullSync(p);
  assert.equal(created(p).length, 2, "repeated syncs create nothing more");
  assert.match(lineWith(p, "Buy mulch"), /\[ \]/);
});

test("completed in Todoist, then unchecked: reopened on the original id, not recreated", async () => {
  const p = await closedRemotely();
  p.exists = true;
  uncheck(p, "Buy mulch");
  await fullSync(p);
  assert.match(lineWith(p, "Buy mulch"), /\[ \]/);
  assert.deepEqual(p.reopened, ["N1"], "reopened exactly once");
  assert.equal(created(p).length, 1, "no create");
  assert.equal(p.settings.taskCache.N1.isCompleted, false, "cache open");
});

test("first detection (cache open, missing in Todoist) still checks the line off", async () => {
  const p = makePlugin("- [ ] Buy mulch #STsync\n");
  await p.syncFileNotes(NOTE, false);
  p.snapshot = snapshotOf([]);
  await p.reconcileTodoistTaskCache();
  assert.match(lineWith(p, "Buy mulch"), /\[x\]/);
  assert.equal(p.settings.taskCache.N1.isCompleted, true);
});

test("deleted and still checked: stays checked, nothing created", async () => {
  const p = await closedRemotely();
  p.exists = false;
  await fullSync(p);
  await fullSync(p);
  assert.match(lineWith(p, "Buy mulch"), /\[x\]/);
  assert.equal(created(p).length, 1);
});

test("snapshot unavailable: unchecked completed line is not recreated or re-checked", async () => {
  const p = await closedRemotely();
  p.exists = false;
  uncheck(p, "Buy mulch");
  p.snapshotFails = true;
  await fullSync(p);
  assert.match(lineWith(p, "Buy mulch"), /\[ \]/);
  assert.equal(created(p).length, 1);
});

test("failed create leaves the old cache entry so the next sync retries without duplicating", async () => {
  const p = await closedRemotely();
  p.exists = false;
  uncheck(p, "Buy mulch");
  const realSync = p.todoistSync;
  p.todoistSync = async () => { throw new Error("boom"); };
  await assert.rejects(p.syncFileNotes(NOTE, false));
  assert.ok(p.settings.taskCache.N1, "old entry restored after failed create");
  p.todoistSync = realSync;
  await fullSync(p);
  assert.equal(created(p).length, 2);
  assert.ok(p.settings.taskCache.N2 && !p.settings.taskCache.N1);
});

test("subtask under a recreated parent gets the new parent id", async () => {
  const p = makePlugin("- [ ] Parent #STsync\n    - [ ] Child #STSubSync\n");
  await p.syncFileNotes(NOTE, false);
  assert.equal(created(p).length, 2);
  p.snapshot = snapshotOf([]);
  await p.reconcileTodoistTaskCache();
  p.exists = false;
  uncheck(p, "Parent");
  uncheck(p, "Child");
  await fullSync(p);
  const cmds = created(p).slice(2);
  assert.equal(cmds.length, 2);
  const parentCmd = cmds.find((c) => c.args.content === "Parent");
  const childCmd = cmds.find((c) => c.args.content === "Child");
  assert.ok(parentCmd && childCmd);
  assert.equal(childCmd.args.parent_id, parentCmd.temp_id, "child points at the new parent's temp id, not the deleted one");
});

const openTask = { id: "N1", content: "Buy mulch", description: "", parentId: "", sectionId: "", projectId: "p1", labels: [], priority: 1, dueDate: "", deadlineDate: "", duration: null, isCompleted: false };

test("(a) completed task whose GET would 404: reopen succeeds, no create, line stays open, next sync idle", async () => {
  const p = await closedRemotely();
  uncheck(p, "Buy mulch");
  await p.syncFileNotes(NOTE, false);
  assert.deepEqual(p.reopened, ["N1"]);
  assert.equal(created(p).length, 1, "no duplicate create");
  assert.equal(p.settings.taskCache.N1.isCompleted, false);
  assert.match(lineWith(p, "Buy mulch"), /\[ \]/);
  p.snapshot = snapshotOf([openTask]);
  await fullSync(p);
  assert.deepEqual(p.reopened, ["N1"], "second sync does not reopen again");
  assert.equal(created(p).length, 1);
  assert.match(lineWith(p, "Buy mulch"), /\[ \]/);
});

test("(b) deleted task: reopen POST 404 gives exactly one create", async () => {
  const p = await closedRemotely();
  p.exists = false;
  uncheck(p, "Buy mulch");
  await p.syncFileNotes(NOTE, false);
  assert.equal(created(p).length, 2);
  assert.deepEqual(p.reopened, ["N1"], "one probe");
  assert.ok(p.settings.taskCache.N2 && !p.settings.taskCache.N1);
});

const withEvent = (p, type) => { p.todoistRequest = async (url) => (url === "/activities" ? { results: [{ id: "e1", object_id: "N1", event_type: type }] } : {}); };

test("(c) completed event for a task cached completed with an unchecked line leaves the line unchecked", async () => {
  const p = await closedRemotely();
  uncheck(p, "Buy mulch");
  withEvent(p, "completed");
  await p.pullTodoistUpdates();
  assert.match(lineWith(p, "Buy mulch"), /\[ \]/);
  assert.ok(p.settings.processedTodoistEventIds.includes("e1"), "event still marked processed");
});

test("(c2) completed event on an open task still checks the line", async () => {
  const p = makePlugin("- [ ] Buy mulch #STsync\n");
  await p.syncFileNotes(NOTE, false);
  withEvent(p, "completed");
  await p.pullTodoistUpdates();
  assert.match(lineWith(p, "Buy mulch"), /\[x\]/);
  assert.equal(p.settings.taskCache.N1.isCompleted, true);
});

test("(c3) uncompleted event unchecks a completed line", async () => {
  const p = await closedRemotely();
  withEvent(p, "uncompleted");
  await p.pullTodoistUpdates();
  assert.match(lineWith(p, "Buy mulch"), /\[ \]/);
});

test("(d) removal event for a cached-completed task with an unchecked line keeps the line and the cache entry", async () => {
  const p = await closedRemotely();
  p.exists = false;
  uncheck(p, "Buy mulch");
  withEvent(p, "deleted");
  await p.pullTodoistUpdates();
  assert.match(lineWith(p, "Buy mulch"), /\[ \]/, "line kept");
  assert.ok(p.settings.taskCache.N1);
});

test("(e) failed create: restored entry is visible in the task reference index and state is marked dirty", async () => {
  const p = await closedRemotely();
  p.exists = false;
  uncheck(p, "Buy mulch");
  const queued = [];
  p.queueTaskReferenceIndexUpdate = (path) => queued.push(path);
  p.todoistSync = async () => { throw new Error("boom"); };
  let afterForget = -1;
  const realForget = p.forgetCachedTaskReference;
  p.forgetCachedTaskReference = function (id) { const r = realForget.call(this, id); afterForget = this.taskReferenceStateRevision; return r; };
  await assert.rejects(p.syncFileNotes(NOTE, false));
  assert.ok(p.taskReferenceStateRevision > afterForget, "restore bumped the revision after the forget");
  assert.ok(queued.filter((x) => x === NOTE).length >= 2, "index update queued again for the restored entry");
  assert.ok(JSON.stringify(p.getTaskReferenceIndex()).includes("N1"), "restored entry visible in the index");
});

test("(f) create returns no mapping: old entry restored and the next sync does not abort", async () => {
  const p = await closedRemotely();
  p.exists = false;
  uncheck(p, "Buy mulch");
  const realSync = p.todoistSync;
  p.todoistSync = async (commands) => { for (const c of commands) p.commands.push(c); return { temp_id_mapping: {} }; };
  await p.syncFileNotes(NOTE, false);
  assert.ok(p.settings.taskCache.N1, "old entry restored");
  p.todoistSync = realSync;
  p.reopened.length = 0;
  await p.syncFileNotes(NOTE, false); // must not throw
  assert.match(lineWith(p, "Buy mulch"), /\[ \]/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); } catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${String(error && error.message).split("\n").slice(0, 8).join("\n  ")}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
})();
