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
const OTHER = "Notes/Shed.md";
const projects = [{ id: "p1", name: "Home", isInbox: false }, { id: "p2", name: "Work", isInbox: false }];
const snapshotOf = (tasks, list = projects) => ({ tasks, projects: list, sections: [], fetchedAt: "2026-10-25T10:00:00" });
const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const DAY = 24 * 3600 * 1000;

function makePlugin(notes) {
  const store = new Map(Object.entries(notes));
  const files = new Map([...store.keys()].map((k) => { const f = new TFileRef(); f.path = k; f.basename = k.split("/").pop().replace(/\.md$/, ""); f.extension = "md"; return [k, f]; }));
  const p = Object.create(Plugin.prototype);
  p.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { taskCache: {}, todoistToken: "tok" });
  p.app = { vault: {
    getAbstractFileByPath: (x) => files.get(x) || null,
    getMarkdownFiles: () => [...files.values()],
    read: async (f) => store.get(f.path), cachedRead: async (f) => store.get(f.path),
    modify: async (f, t) => { store.set(f.path, t); },
    process: async (f, fn) => { store.set(f.path, fn(store.get(f.path))); }
  } };
  p.taskReferenceStateRevision = 0;
  p.store = store;
  p.snapshot = snapshotOf([]);
  p.exists = true;
  p.commands = [];
  p.server = new Map(); // id -> args of the one task Todoist holds
  p.byUuid = new Map(); // fake Todoist dedupes commands by uuid like the real one
  p.failAfterApply = 0; // next N /sync calls apply on the server, then throw (lost response)
  p.saves = 0;
  p.logs = [];
  p.ensured = [];
  let n = 0;
  p.saveSettings = async () => { p.saves += 1; };
  for (const name of ["setSidebarStatus", "refreshSidebarStatus", "queueTaskReferenceSnapshotWrite", "queueTaskReferenceIndexUpdate", "observeSchedulerMemoryForTask"]) p[name] = () => {};
  p.logLocal = (m) => { p.logs.push(m); };
  p.getTodoistSnapshot = async () => p.snapshot;
  p.requireTodoistAccess = () => {};
  p.getTaskProjectId = async () => "p1";
  p.todoistProjectNameForId = async (id) => (projects.find((x) => x.id === id) || {}).name || "Home";
  p.ensureTodoistSectionId = async (projectId) => { p.ensured.push(projectId); return `s-${projectId}`; };
  p.todoistTaskExists = async () => p.exists;
  p.todoistConflictForLocalUpdate = async () => null;
  p.cleanupEmptyTodoistSections = async () => 0;
  p.deleteTodoistTask = async () => true;
  p.todoistRequest = async () => ({});
  globalThis.__testRequestUrl = async ({ url, method }) => {
    const m = /\/tasks\/([^/]+)\/(close|reopen)$/.exec(url);
    if (m && method === "POST") return { status: m[2] === "reopen" && !p.exists ? 404 : 204, text: "" };
    return { status: 404, text: "" };
  };
  p.todoistSync = async (commands) => {
    const mapping = {};
    for (const c of commands) {
      p.commands.push(c);
      if (!p.byUuid.has(c.uuid)) { const id = `N${++n}`; p.server.set(id, c.args); p.byUuid.set(c.uuid, id); }
      mapping[c.temp_id] = p.byUuid.get(c.uuid);
    }
    if (p.failAfterApply > 0) { p.failAfterApply -= 1; throw new Error("Todoist sync answered with an unreadable response; it may or may not have applied the changes."); }
    return { temp_id_mapping: mapping };
  };
  return p;
}
const read = (p, path = NOTE) => p.store.get(path);
const lineWith = (p, needle, path = NOTE) => read(p, path).split("\n").find((l) => l.includes(needle));
const uncheck = (p, needle) => p.store.set(NOTE, read(p).split("\n").map((l) => (l.includes(needle) ? l.replace("[x]", "[ ]") : l)).join("\n"));
const created = (p) => p.commands.filter((c) => c.type === "item_add");
const pending = (p) => p.settings.pendingTodoistCreateCommands || {};

async function closedRemotely(text = "- [ ] Buy mulch #STsync\n") {
  const p = makePlugin({ [NOTE]: text });
  await p.syncFileNotes(NOTE, false);
  p.snapshot = snapshotOf([]);
  await p.reconcileTodoistTaskCache();
  assert.match(lineWith(p, "Buy mulch"), /\[x\]/, "setup: checked off on first detection");
  return p;
}

test("(a) create applied on server but response lost: retry reuses uuid/temp_id, one task, line links to it", async () => {
  const p = makePlugin({ [NOTE]: "- [ ] Buy mulch #STsync\n" });
  p.failAfterApply = 1;
  await assert.rejects(p.syncFileNotes(NOTE, false), /unreadable/);
  assert.equal(p.server.size, 1);
  await p.syncFileNotes(NOTE, false);
  const [first, second] = created(p);
  assert.equal(created(p).length, 2);
  assert.equal(second.uuid, first.uuid, "same command uuid");
  assert.equal(second.temp_id, first.temp_id, "same temp_id");
  assert.equal(p.server.size, 1, "exactly one Todoist task");
  assert.match(lineWith(p, "Buy mulch"), /oid::/);
  assert.deepEqual(Object.keys(p.settings.taskCache), ["N1"]);
  assert.equal(Object.keys(pending(p)).length, 0, "pending cleared after success");
});

test("(a4) lost response, retry relinks by title: one task, linked, pending entry cleared", async () => {
  const p = makePlugin({ [NOTE]: "- [ ] Buy mulch #STsync\n" });
  p.failAfterApply = 1;
  await assert.rejects(p.syncFileNotes(NOTE, false), /unreadable/);
  assert.equal(Object.keys(pending(p)).length, 1, "setup: pending entry kept after the lost response");
  p.snapshot = snapshotOf([{ id: "N1", content: "Buy mulch", description: "", projectId: "p1", projectName: "Home", sectionId: "", section: "", labels: [], priority: 1, isCompleted: false }]);
  await p.syncFileNotes(NOTE, false);
  assert.equal(created(p).length, 1, "retry did not create again");
  assert.equal(p.server.size, 1, "exactly one Todoist task");
  assert.match(lineWith(p, "Buy mulch"), /oid::/, "line linked");
  assert.deepEqual(Object.keys(p.settings.taskCache), ["N1"], "linked to the existing task");
  assert.equal(Object.keys(pending(p)).length, 0, "pending entry cleared after relink");
});

test("(a2) recreated line (deleted remotely): lost response then retry makes one new task", async () => {
  const p = await closedRemotely();
  p.exists = false;
  uncheck(p, "Buy mulch");
  p.failAfterApply = 1;
  await assert.rejects(p.syncFileNotes(NOTE, false), /unreadable/);
  await p.syncFileNotes(NOTE, false);
  const [, a, b] = created(p);
  assert.equal(b.uuid, a.uuid);
  assert.equal(b.temp_id, a.temp_id);
  assert.equal(p.server.size, 2, "original + exactly one recreate");
  assert.ok(p.settings.taskCache.N2 && !p.settings.taskCache.N1);
});

test("(b) two notes holding the same pasted oid line, synced concurrently: one Todoist task", async () => {
  const line = "- [ ] Buy mulch #STsync %%[oid:: ABCDE]%%\n";
  const p = makePlugin({ [NOTE]: line, [OTHER]: line });
  await Promise.all([p.syncFileNotes(NOTE, false), p.syncFileNotes(OTHER, false)]);
  assert.equal(p.server.size, 1, "one task");
  assert.equal(new Set(created(p).map((c) => c.uuid)).size, 1, "same uuid in both batches");
  assert.equal(Object.keys(pending(p)).length, 0);
});

test("(c) stale (>7 days) pending entries are dropped, fresh ones reused, success clears", async () => {
  const line = "- [ ] Buy mulch #STsync %%[oid:: ABCDE]%%\n";
  let p = makePlugin({ [NOTE]: line });
  p.settings.pendingTodoistCreateCommands = {
    ABCDE: { uuid: "stale-uuid", tempId: "stale-temp", at: new Date(Date.now() - 8 * DAY).toISOString() },
    ZZZZZ: { uuid: "z-uuid", tempId: "z-temp", at: new Date(Date.now() - 9 * DAY).toISOString() }
  };
  p.todoistSync = async () => { throw new Error("boom"); };
  await assert.rejects(p.syncFileNotes(NOTE, false));
  assert.equal(pending(p).ZZZZZ, undefined, "unrelated stale entry dropped");
  assert.ok(pending(p).ABCDE && pending(p).ABCDE.uuid !== "stale-uuid", "stale entry replaced by a fresh one");
  p = makePlugin({ [NOTE]: line });
  p.settings.pendingTodoistCreateCommands = { ABCDE: { uuid: "fresh-uuid", tempId: "fresh-temp", at: new Date(Date.now() - DAY).toISOString() } };
  await p.syncFileNotes(NOTE, false);
  assert.equal(created(p)[0].uuid, "fresh-uuid");
  assert.equal(created(p)[0].temp_id, "fresh-temp");
  assert.equal(Object.keys(pending(p)).length, 0, "cleared after success");
});

test("(a3) pending entry is saved before the sync call", async () => {
  const p = makePlugin({ [NOTE]: "- [ ] Buy mulch #STsync %%[oid:: ABCDE]%%\n" });
  let atSync = null;
  const real = p.todoistSync;
  p.todoistSync = async (c) => { atSync = { saves: p.saves, entry: pending(p).ABCDE }; return real(c); };
  await p.syncFileNotes(NOTE, false);
  assert.ok(atSync.saves >= 1 && atSync.entry, "persisted before todoistSync");
});

test("(d) recreated task goes to old project when it is in the snapshot, default project otherwise; new line uses default", async () => {
  let p = await closedRemotely("- [ ] Buy mulch #STsync\n- [ ] Water roses #STsync\n");
  p.exists = false;
  p.settings.taskCache.N1.projectId = "p2";
  p.snapshot = snapshotOf([]);
  uncheck(p, "Buy mulch");
  p.store.set(NOTE, read(p) + "- [ ] Brand new #STsync\n");
  p.ensured.length = 0;
  p.commands.length = 0;
  await p.syncFileNotes(NOTE, false);
  const byContent = (c) => created(p).find((x) => x.args.content.includes(c));
  assert.equal(byContent("Buy mulch").args.section_id, "s-p2", "recreated: old project's section");
  assert.equal(byContent("Brand new").args.section_id, "s-p1", "new line: default project");
  assert.equal(p.settings.taskCache[Object.keys(p.settings.taskCache).find((id) => p.settings.taskCache[id].content.includes("Buy mulch") && !p.settings.taskCache[id].isCompleted)].projectId, "p2");

  p = await closedRemotely();
  p.exists = false;
  p.settings.taskCache.N1.projectId = "gone";
  uncheck(p, "Buy mulch");
  p.commands.length = 0;
  await p.syncFileNotes(NOTE, false);
  assert.equal(created(p)[0].args.section_id, "s-p1", "old project missing: default");

  p = makePlugin({ [NOTE]: "" });
  const task = { content: "X", tempId: "t1", uuid: "u1", labels: [], priority: 1, isSubtask: false, section: "", lineNumber: 0, allLines: [], indent: 0, recreateProjectId: "p2", recreateProjectName: "Work" };
  await p.createTodoistTasksFromNote([task], new Map());
  assert.equal(created(p)[0].args.project_id, "p2", "no section: item_add carries old project_id");
});

test("(e) recreated entry keeps knowledge, noteRefs and description", async () => {
  const p = await closedRemotely();
  p.exists = false;
  const old = p.settings.taskCache.N1;
  old.description = "Remember the red wheelbarrow.";
  old.noteRefs = [...(old.noteRefs || []), { path: "Notes/Shed.md", lineNumber: 4, oid: "QQQQQ" }];
  uncheck(p, "Buy mulch");
  await p.syncFileNotes(NOTE, false);
  const next = p.settings.taskCache.N2;
  assert.ok(next && !p.settings.taskCache.N1);
  assert.ok(next.knowledge && next.knowledge.fingerprint, "knowledge present on the new entry");
  const own = next.noteRefs.find((r) => r.path === NOTE);
  assert.ok(own, "own noteRef present");
  assert.equal(own.id, "N2", "primary noteRef carries the new task id");
  assert.ok(next.noteRefs.some((r) => r.path === "Notes/Shed.md" && r.oid === "QQQQQ"), "extra noteRef carried");
  assert.equal(next.description, "Remember the red wheelbarrow.");
});

test("(e3) recreated entry with same knowledge fingerprint keeps old enrichment", async () => {
  const p = await closedRemotely();
  p.exists = false;
  p.settings.taskCache.N1.knowledge = Object.assign({}, p.settings.taskCache.N1.knowledge, { enriched: "SENTINEL" });
  uncheck(p, "Buy mulch");
  await p.syncFileNotes(NOTE, false);
  assert.equal(p.settings.taskCache.N2.knowledge.enriched, "SENTINEL", "same-fingerprint old knowledge kept");
});
test("(e2) recreated entry with stale knowledge fingerprint gets fresh knowledge", async () => {
const p = await closedRemotely();
p.exists = false;
const old = p.settings.taskCache.N1;
old.knowledge = Object.assign({}, old.knowledge, { fingerprint: "STALE", enriched: "SENTINEL" });
uncheck(p, "Buy mulch");
await p.syncFileNotes(NOTE, false);
const next = p.settings.taskCache.N2;
assert.ok(next && next.knowledge.fingerprint && next.knowledge.fingerprint !== "STALE", "fresh fingerprint");
assert.equal(next.knowledge.enriched, undefined, "stale enrichment dropped");
});
test("(f) reconcile twice on an already-preserved task: second run does nothing; first detection still checks off", async () => {
  const p = makePlugin({ [NOTE]: "- [ ] Buy mulch #STsync\n" });
  await p.syncFileNotes(NOTE, false);
  p.snapshot = snapshotOf([]);
  await p.reconcileTodoistTaskCache();
  assert.match(lineWith(p, "Buy mulch"), /\[x\]/, "first detection checks the line");
  assert.equal(p.settings.taskCache.N1.isCompleted, true);
  const before = JSON.stringify(p.settings.taskCache.N1);
  const note = read(p);
  p.saves = 0;
  p.logs.length = 0;
  let reads = 0;
  const realRead = p.app.vault.read;
  p.app.vault.read = async (f) => { reads += 1; return realRead(f); };
  await p.reconcileTodoistTaskCache();
  assert.equal(p.saves, 0, "no saveSettings");
  assert.equal(p.logs.length, 0, "no log");
  assert.equal(JSON.stringify(p.settings.taskCache.N1), before, "no timestamp change");
  assert.equal(read(p), note);
  assert.equal(reads, 0, "note not read");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); } catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${String(error && error.message).split("\n").slice(0, 8).join("\n  ")}`); }
  }
  console.log(`${cases.length - failed}/${cases.length}`);
  if (failed) process.exit(1);
})();