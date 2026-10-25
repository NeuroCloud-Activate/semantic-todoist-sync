"use strict";
// Task 7b: chat-created task lines, the misc folder, and project moves inside monthly notes. Vault and Todoist are in-memory fakes.
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
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: class { constructor(message) { (global.__notices = global.__notices || []).push(String(message)); } }, Plugin: Empty,
    PluginSettingTab: Empty, Setting: Empty, TFile, setIcon() {}, requestUrl: async () => { throw new Error("network disabled in test"); }
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

const FOLDER = "Semantic Todoist Sync/Miscellaneous Tasks";
const OCT = `${FOLDER}/2026-10 Tasks.md`;
const NOV = `${FOLDER}/2026-11 Tasks.md`;
const NOTE = "Notes/Garden.md";
const OTHER = "Notes/Other.md";
const OCT_DATE = new Date(2026, 9, 25);
const NOV_DATE = new Date(2026, 10, 2);
const projects = [{ id: "p1", name: "Home", isInbox: false }, { id: "p2", name: "Work", isInbox: false }, { id: "pin", name: "Inbox", isInbox: true }];
const snapshotOf = (tasks, list = projects) => ({ tasks, projects: list, sections: [], fetchedAt: "2026-10-25T10:00:00" });
const remote = (o) => ({ id: "n1", content: "Buy mulch", description: "", parentId: "", sectionId: "", projectId: "p1", labels: [], priority: 1, dueDate: "", deadlineDate: "", duration: null, isCompleted: false, ...o });
const createRow = (o = {}, target = {}) => ({ op: "create", fields: { content: "Buy mulch" }, target: { projectId: "p1", ...target }, newLabels: [], ...o });
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

function makePlugin(files = {}) {
  const store = new Map(Object.entries(files));
  const tfiles = new Map();
  const fileFor = (p) => { if (!tfiles.has(p)) { const f = new TFileRef(); f.path = p; f.basename = p.split("/").pop().replace(/\.md$/, ""); f.extension = "md"; tfiles.set(p, f); } return tfiles.get(p); };
  for (const p of store.keys()) fileFor(p);
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { taskCache: {}, todoistToken: "tok" });
  plugin.writes = []; // every write: { kind, path }
  plugin.failProcess = false;
  plugin.app = { vault: {
    getAbstractFileByPath: (p) => (store.has(String(p)) ? fileFor(String(p)) : null),
    getMarkdownFiles: () => [...store.keys()].map(fileFor),
    read: async (f) => store.get(f.path), cachedRead: async (f) => store.get(f.path),
    modify: async (f, text) => { plugin.writes.push({ kind: "modify", path: f.path }); store.set(f.path, text); },
    process: async (f, fn) => { if (plugin.failProcess) throw new Error("disk full"); plugin.writes.push({ kind: "process", path: f.path }); store.set(f.path, fn(store.get(f.path))); },
    create: async (p, text) => { plugin.writes.push({ kind: "create", path: p }); store.set(p, text); fileFor(p); },
    createFolder: async () => {}
  } };
  plugin.store = store;
  plugin.snapshot = snapshotOf([]);
  plugin.created = [];
  plugin.deleted = [];
  plugin.saveSettings = async () => {};
  for (const name of ["logLocal", "setSidebarStatus", "refreshSidebarStatus", "markTaskReferenceStateDirty", "queueTaskReferenceIndexUpdate", "observeSchedulerMemoryForTask"]) plugin[name] = () => {};
  plugin.getTodoistSnapshot = async () => plugin.snapshot;
  plugin.requireTodoistAccess = () => {};
  plugin.createTodoistTasksFromNote = async (tasks) => { plugin.created.push(...tasks); return {}; };
  plugin.todoistConflictForLocalUpdate = async () => null;
  plugin.updateTodoistFromParsedTask = async () => false;
  plugin.cleanupEmptyTodoistSections = async () => 0;
  plugin.deleteTodoistTask = async (id) => { plugin.deleted.push(id); return true; };
  plugin.todoistProjectNameForId = async (id) => (projects.find((p) => p.id === id) || {}).name || "";
  return plugin;
}
const lineOf = (store, p, needle = "Buy mulch") => store.get(p).split("\n").find((l) => l.includes(needle));

test("misc folder is not indexed but is synced", () => {
  const p = makePlugin();
  p.settings.excludedFolders = "";
  p.settings.indexedFolders = "";
  assert.equal(p.isIndexablePath(OCT), false, "misc note must not be indexed");
  assert.equal(p.isIndexablePath(NOTE), true);
  p.settings.excludedFolders = "Semantic Todoist Sync";
  assert.equal(p.isSyncableTaskPath(OCT), true, "misc note must stay syncable inside an excluded plugin folder");
  assert.equal(Plugin.DEFAULT_SETTINGS.miscTasksFolder, FOLDER);
});

test("created task goes to this month's note under its project, and is cached", async () => {
  const p = makePlugin();
  const failed = await p.writeCreatedTaskLines([{ id: "n1", row: createRow() }], { snapshot: snapshotOf([remote()]), now: OCT_DATE });
  assert.deepEqual(failed, []);
  const text = p.store.get(OCT);
  assert.ok(text.startsWith("This note is kept in step"), text);
  assert.ok(/\n## Home\n- \[ \] Buy mulch .*%%\[p:: Home\]%%.*%%\[oid:: [A-Z0-9]+\]%%/.test(text), text);
  const cached = p.settings.taskCache.n1;
  assert.equal(cached.path, OCT);
  assert.ok(cached.oid && text.includes(`oid:: ${cached.oid}`));
  assert.ok(p.writes.every((w) => w.kind !== "modify"), "never vault.modify");
});

test("Inbox task goes under an Inbox heading with no project marker", async () => {
  const p = makePlugin();
  await p.writeCreatedTaskLines([{ id: "n1", row: createRow({}, { projectId: "pin" }) }], { snapshot: snapshotOf([remote({ projectId: "pin" })]), now: OCT_DATE });
  const text = p.store.get(OCT);
  assert.ok(text.includes("\n## Inbox\n- [ ] Buy mulch") && !text.includes("%%[p::"), text);
});

test("month rollover creates a new note; the old one is untouched", async () => {
  const p = makePlugin();
  await p.writeCreatedTaskLines([{ id: "n1", row: createRow() }], { snapshot: snapshotOf([remote()]), now: OCT_DATE });
  const octBefore = p.store.get(OCT);
  await p.writeCreatedTaskLines([{ id: "n2", row: createRow({ fields: { content: "Sow beans" } }) }], { snapshot: snapshotOf([remote()]), now: NOV_DATE });
  assert.equal(p.store.get(OCT), octBefore);
  assert.ok(p.store.get(NOV).includes("Sow beans"));
});

test("task about the active note is appended there, user text kept", async () => {
  const p = makePlugin({ [NOTE]: "# Garden\nmy own text" });
  const row = createRow(); row.notePlacement = { path: "note", notePath: NOTE, reason: "request refers open note" };
  await p.writeCreatedTaskLines([{ id: "n1", row }], { snapshot: snapshotOf([remote()]), now: OCT_DATE });
  const text = p.store.get(NOTE);
  assert.ok(text.startsWith("# Garden\nmy own text\n- [ ] Buy mulch"), JSON.stringify(text));
  assert.equal(p.store.has(OCT), false, "no monthly note when a note was named");
  assert.equal(p.settings.taskCache.n1.path, NOTE);
});

test("subtask goes under its parent's line after the parent's existing subtasks", async () => {
  const parent = "- [ ] Parent #STsync !!1 %%[oid:: PAR01]%%";
  const sub = "    - [ ] Existing #STSubSync %%[oid:: SUB01]%%";
  const p = makePlugin({ [NOTE]: `# N\n${parent}\n${sub}\n- [ ] After #STsync %%[oid:: AFT01]%%\n` });
  p.settings.taskCache.par = { oid: "PAR01", path: NOTE, content: "Parent" };
  const row = createRow({}, { parentId: "par" });
  await p.writeCreatedTaskLines([{ id: "n1", row }], { snapshot: snapshotOf([remote({ parentId: "par" })]), now: OCT_DATE });
  const lines = p.store.get(NOTE).split("\n");
  assert.equal(lines[1], parent);
  assert.equal(lines[2], sub);
  assert.ok(/^ {4}- \[ \] Buy mulch/.test(lines[3]), lines.join("|"));
  assert.ok(lines[4].startsWith("- [ ] After"));
  assert.equal(p.settings.taskCache.n1.path, NOTE);
});

test("subtask whose parent has no line in the vault goes to the monthly note", async () => {
  const p = makePlugin();
  await p.writeCreatedTaskLines([{ id: "n1", row: createRow({}, { parentId: "ghost" }) }], { snapshot: snapshotOf([remote()]), now: OCT_DATE });
  assert.ok(p.store.get(OCT).includes("## Home\n- [ ] Buy mulch"));
});

test("next normal sync of the written note creates no duplicate and leaves the line alone", async () => {
  const p = makePlugin();
  await p.writeCreatedTaskLines([{ id: "n1", row: createRow() }], { snapshot: snapshotOf([remote()]), now: OCT_DATE });
  const before = p.store.get(OCT);
  p.snapshot = snapshotOf([remote()]);
  await p.syncFileNotes(OCT, false);
  assert.deepEqual(p.created, []);
  assert.equal(p.store.get(OCT), before);
  assert.deepEqual(p.deleted, []);
});

test("write failure is reported, never thrown, and Apply keeps its result", async () => {
  const p = makePlugin();
  p.failProcess = true;
  const failed = await p.writeCreatedTaskLines([{ id: "n1", row: createRow() }], { snapshot: snapshotOf([remote()]), now: OCT_DATE });
  assert.deepEqual(failed, ["Buy mulch"]);
  p.todoistSync = async (commands) => ({ sync_status: Object.fromEntries(commands.map((c) => [c.uuid, "ok"])), temp_id_mapping: Object.fromEntries(commands.filter((c) => c.temp_id).map((c) => [c.temp_id, "n9"])) });
  p.refreshTodoistLines = async () => {};
  const changes = { rows: [createRow()], snapshot: snapshotOf([]) };
  const result = await p.applyTodoistChanges(changes, ["row-0"]);
  assert.equal(result.applied, 1);
  assert.deepEqual(result.noteWriteFailed, ["Buy mulch"]);
  const lines = Plugin.describeTodoistApplyResult(result, changes);
  assert.ok(lines.some((l) => l === 'Created in Todoist but couldn\'t write note line "Buy mulch".'), lines.join("|"));
  assert.ok(p.settings.todoistChatLastUndo, "undo record kept");
});

test("Apply writes the created line and Undo removes it again", async () => {
  const p = makePlugin();
  p.todoistSync = async (commands) => ({ sync_status: Object.fromEntries(commands.map((c) => [c.uuid, "ok"])), temp_id_mapping: Object.fromEntries(commands.filter((c) => c.temp_id).map((c) => [c.temp_id, "n9"])) });
  p.refreshTodoistLines = async () => {};
  const row = createRow(); row.notePlacement = { path: "monthly", reason: "none" };
  const result = await p.applyTodoistChanges({ rows: [row], snapshot: snapshotOf([]) }, ["row-0"]);
  assert.deepEqual(result.noteWriteFailed || [], []);
  const monthly = [...p.store.keys()].find((k) => k.startsWith(FOLDER));
  assert.ok(monthly && p.store.get(monthly).includes("Buy mulch") && p.settings.taskCache.n9, "line written and cached");
  p.snapshot = snapshotOf([remote({ id: "n9" })]);
  await p.undoLastTodoistChanges(false);
  assert.ok(!p.store.get(monthly).includes("Buy mulch"), p.store.get(monthly));
  assert.equal(p.settings.taskCache.n9, undefined);
});

const monthlyWith = (...blocks) => `This note is kept in step with Todoist. Edits to tasks here sync both ways.\n\n${blocks.join("\n\n")}\n`;
const taskLine = (title, oid, project, extra = "") => `- [ ] ${title} #STsync !!1${project ? ` %%[p:: ${project}]%%` : ""}${extra} %%[oid:: ${oid}]%%`;
function monthlyPlugin(text, extraFiles = {}) {
  const p = makePlugin({ [OCT]: text, ...extraFiles });
  p.settings.taskCache.n1 = { oid: "AAA11", path: OCT, content: "Buy mulch", projectId: "p1", projectName: "Home", labels: [], priority: 1, isCompleted: false };
  p.settings.taskCache.n2 = { oid: "BBB22", path: OCT, content: "Fix tap", projectId: "p1", projectName: "Home", labels: [], priority: 1, isCompleted: false };
  p.settings.taskCache.n3 = { oid: "CCC33", path: OCT, content: "Ship report", projectId: "p2", projectName: "Work", labels: [], priority: 1, isCompleted: false };
  return p;
}
const START = monthlyWith(`## Home\n${taskLine("Buy mulch", "AAA11", "Home")}\n${taskLine("Fix tap", "BBB22", "Home")}`, `## Work\n${taskLine("Ship report", "CCC33", "Work")}`);
const allRemote = (o = {}) => [remote({ id: "n1", ...o.n1 }), remote({ id: "n2", content: "Fix tap", ...o.n2 }), remote({ id: "n3", content: "Ship report", projectId: "p2", ...o.n3 })];

test("project change in Todoist moves the line between headings only; no other file is touched", async () => {
  const p = monthlyPlugin(START, { [OTHER]: "untouched" });
  p.snapshot = snapshotOf(allRemote({ n1: { projectId: "p2" } }));
  await p.syncFileNotes(OCT, false);
  const text = p.store.get(OCT);
  assert.ok(/## Home\n- \[ \] Fix tap/.test(text), text);
  assert.ok(/## Work\n- \[ \] Ship report[^\n]*\n- \[ \] Buy mulch[^\n]*%%\[p:: Work\]%%/.test(text), text);
  assert.equal(p.store.get(OTHER), "untouched");
  assert.ok(p.writes.every((w) => w.path === OCT), JSON.stringify(p.writes));
  assert.deepEqual(p.created, []);
});

test("last task leaving a project removes its heading", async () => {
  const p = monthlyPlugin(START);
  p.snapshot = snapshotOf(allRemote({ n3: { projectId: "p1" } }));
  await p.syncFileNotes(OCT, false);
  const text = p.store.get(OCT);
  assert.ok(!text.includes("## Work") && text.includes("Ship report") && /%%\[p:: Home\]%%[^\n]*\n$/.test(text.replace(/\n+$/, "\n")), text);
});

test("project renamed in Todoist: marker and heading renamed on next sync", async () => {
  const p = monthlyPlugin(START);
  p.snapshot = snapshotOf(allRemote(), [{ id: "p1", name: "House", isInbox: false }, projects[1], projects[2]]);
  await p.syncFileNotes(OCT, false);
  const text = p.store.get(OCT);
  assert.ok(text.includes("## House\n") && !text.includes("## Home") && !text.includes("[p:: Home]"), text);
  assert.ok(text.includes("## Work\n"), text);
});

test("October task stays in October note when Todoist moves it in November; subtask block moves with it", async () => {
  const sub = "    - [ ] Wet soil #STSubSync %%[oid:: SUB01]%%";
  const p = monthlyPlugin(monthlyWith(`## Home\n${taskLine("Buy mulch", "AAA11", "Home")}\n${sub}\n${taskLine("Fix tap", "BBB22", "Home")}`, `## Work\n${taskLine("Ship report", "CCC33", "Work")}`));
  p.settings.taskCache.n4 = { oid: "SUB01", path: OCT, content: "Wet soil", projectId: "p1", projectName: "Home", labels: [], priority: 1, isCompleted: false, isSubtask: true, parentOid: "AAA11" };
  await p.writeCreatedTaskLines([{ id: "n5", row: createRow({ fields: { content: "Sow beans" } }) }], { snapshot: snapshotOf([remote()]), now: NOV_DATE });
  p.snapshot = snapshotOf([...allRemote({ n1: { projectId: "p2" } }), remote({ id: "n4", content: "Wet soil", parentId: "n1", projectId: "p2" })]);
  await p.syncFileNotes(OCT, false);
  const text = p.store.get(OCT);
  assert.ok(/## Work\n[^\n]*Ship report[^\n]*\n- \[ \] Buy mulch[^\n]*\[p:: Work\][^\n]*\n {4}- \[ \] Wet soil/.test(text), text);
  assert.ok(/## Home\n- \[ \] Fix tap/.test(text), text);
  assert.ok(!p.store.get(NOV).includes("Buy mulch") && p.store.get(NOV).includes("Sow beans"));
  assert.equal(p.settings.taskCache.n1.path, OCT);
});

test("hand-renamed heading over Home tasks is put back", async () => {
  const p = monthlyPlugin(START.replace("## Home", "## Foo"));
  p.snapshot = snapshotOf(allRemote());
  await p.syncFileNotes(OCT, false);
  const text = p.store.get(OCT);
  assert.ok(/## Home\n- \[ \] Buy mulch/.test(text) && !text.includes("## Foo"), text);
});
test("project archived or deleted: lines and heading stay, nothing removed", async () => {
  const p = monthlyPlugin(START);
  p.snapshot = snapshotOf([remote({ id: "n2", content: "Fix tap" }), remote({ id: "n1" })], [projects[0], projects[2]]);
  await p.syncFileNotes(OCT, false);
  const text = p.store.get(OCT);
  assert.ok(text.includes("## Work\n- [ ] Ship report") && text.includes("[p:: Work]"), text);
  assert.deepEqual(p.deleted, []);
  assert.ok(p.settings.taskCache.n3);
});

test("delete event from an archived project keeps the monthly line", async () => {
  const p = monthlyPlugin(START);
  p.snapshot = snapshotOf([remote({ id: "n1" }), remote({ id: "n2", content: "Fix tap" })], [projects[0], projects[2]]);
  p.todoistRequest = async () => ({ results: [{ id: "ev1", object_id: "n3", event_type: "deleted" }] });
  p.todoistTaskExists = async () => false;
  await p.pullTodoistUpdates();
  assert.ok(p.store.get(OCT).includes("Ship report"));
  assert.ok(p.settings.taskCache.n3);
});

test("heading edited or line dragged under another heading is put back by its marker", async () => {
  const dragged = monthlyWith(`## Home\n${taskLine("Buy mulch", "AAA11", "Home")}`, `## Work\n${taskLine("Ship report", "CCC33", "Work")}\n${taskLine("Fix tap", "BBB22", "Home")}`);
  const p = monthlyPlugin(dragged);
  p.snapshot = snapshotOf(allRemote());
  await p.syncFileNotes(OCT, false);
  assert.ok(/## Home\n- \[ \] Buy mulch[^\n]*\n- \[ \] Fix tap/.test(p.store.get(OCT)), p.store.get(OCT));
  assert.ok(/## Work\n- \[ \] Ship report/.test(p.store.get(OCT)));
});

test("note task's project change edits only its marker; no monthly note appears", async () => {
  const original = `# Garden\n- [ ] Buy mulch #STsync !!1 ///Notes_Garden %%[p:: Home]%% %%[oid:: AAA11]%%\nuser text\n`;
  const p = makePlugin({ [NOTE]: original });
  p.settings.taskCache.n1 = { oid: "AAA11", path: NOTE, content: "Buy mulch", projectId: "p1", projectName: "Home", labels: [], priority: 1, isCompleted: false };
  p.snapshot = snapshotOf([remote({ projectId: "p2" })]);
  await p.syncFileNotes(NOTE, false);
  const text = p.store.get(NOTE);
  assert.ok(text.includes("%%[p:: Work]%%") && !text.includes("[p:: Home]"), text);
  assert.equal(text.replace("%%[p:: Work]%%", "%%[p:: Home]%%"), original.replace(/\n$/, "\n"), "only the marker changed");
  assert.equal([...p.store.keys()].filter((k) => k.startsWith(FOLDER)).length, 0);
});

test("project change made in chat (Apply refresh) moves the monthly line", async () => {
  const p = monthlyPlugin(START);
  p.snapshot = snapshotOf(allRemote({ n1: { projectId: "p2" } }));
  p.getTodoistProjects = async () => projects;
  await p.updateTaskLineFromTodoist("n1", remote({ id: "n1", projectId: "p2" }));
  assert.ok(/## Work\n[^\n]*Ship report[^\n]*\n- \[ \] Buy mulch[^\n]*\[p:: Work\]/.test(p.store.get(OCT)), p.store.get(OCT));
});

const GARDEN = "# Garden\n## Work\n- [ ] Buy mulch #STsync !!1 ///Notes_Garden %%[p:: Home]%% %%[oid:: AAA11]%%\n## Home\n";

test("miscTasksFolder set to an ordinary folder leaves its notes byte-identical on sync", async () => {
  const p = makePlugin({ "Notes/Garden.md": GARDEN });
  p.settings.miscTasksFolder = "Notes";
  p.settings.taskCache.n1 = { oid: "AAA11", path: "Notes/Garden.md", content: "Buy mulch", projectId: "p1", projectName: "Home", labels: [], priority: 1, isCompleted: false };
  p.snapshot = snapshotOf([remote()]);
  await p.syncFileNotes("Notes/Garden.md", false);
  assert.equal(p.store.get("Notes/Garden.md"), GARDEN);
  assert.deepEqual(p.deleted, []);
});

test("miscTasksFolder equal to, containing or inside the email log folder falls back to the default", () => {
  const log = Plugin.DEFAULT_SETTINGS.emailLogFolder;
  for (const folder of [log, "Semantic Todoist Sync", `${log}/Sub`]) {
    const s = Object.assign({}, Plugin.DEFAULT_SETTINGS, { miscTasksFolder: folder });
    assert.equal(Plugin.isMiscTasksPath(`${log}/2026-10-01 mail.md`, s), false, folder);
    assert.equal(Plugin.isMiscTasksPath(OCT, s), true, folder);
  }
});

test("hand-typed task in a monthly note gets no auto Notes section", async () => {
  const p = monthlyPlugin(monthlyWith(`## Home\n${taskLine("Buy mulch", "AAA11", "Home")}\n- [ ] Hand typed #STsync !!1`));
  p.snapshot = snapshotOf(allRemote());
  await p.syncFileNotes(OCT, false);
  assert.ok(!p.store.get(OCT).includes("///Notes_"), p.store.get(OCT));
});

test("text typed during a monthly sync survives and the sync's id write-back is kept", async () => {
  const p = monthlyPlugin(monthlyWith(`## Home\n${taskLine("Buy mulch", "AAA11", "Home")}\n- [ ] Hand typed #STsync !!1`));
  p.snapshot = snapshotOf(allRemote());
  p.createTodoistTasksFromNote = async (tasks) => {
    p.store.set(OCT, `${p.store.get(OCT)}typed meanwhile\n`);
    return { [tasks[0].tempId]: "n7" };
  };
  await p.syncFileNotes(OCT, false);
  const text = p.store.get(OCT);
  assert.ok(text.includes("typed meanwhile"), text);
  assert.ok(/Hand typed[^\n]*%%\[oid:: [A-Z0-9]+\]%%/.test(text) && p.settings.taskCache.n7, text);
});

test("chat-written line during an in-flight sync of the same note survives; no Todoist delete", async () => {
  const p = makePlugin({ [NOTE]: GARDEN.replace("%%[p:: Home]%%", "%%[p:: Work]%%") });
  p.settings.taskCache.n1 = { oid: "AAA11", path: NOTE, content: "Buy mulch", projectId: "p1", projectName: "Home", labels: [], priority: 1, isCompleted: false };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  p.getTodoistSnapshot = async () => { await gate; return p.snapshot; };
  p.snapshot = snapshotOf([remote()]);
  const sync = p.syncFileNotes(NOTE, false);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const row = createRow({ fields: { content: "Sow beans" } }); row.notePlacement = { path: "note", notePath: NOTE, reason: "named" };
  const write = p.writeCreatedTaskLines([{ id: "n9", row }], { snapshot: snapshotOf([remote()]), now: OCT_DATE });
  await new Promise((resolve) => setTimeout(resolve, 5));
  release();
  await Promise.all([sync, write]);
  assert.ok(p.store.get(NOTE).includes("Sow beans"), p.store.get(NOTE));
  assert.ok(p.store.get(NOTE).includes("%%[p:: Home]%%"), "sync's own edit also kept");
  assert.deepEqual(p.deleted, []);
  assert.ok(p.settings.taskCache.n9);
});

test("a task cached after the sync read its note is not deleted as missing", async () => {
  const p = makePlugin({ [NOTE]: GARDEN });
  p.settings.taskCache.n1 = { oid: "AAA11", path: NOTE, content: "Buy mulch", projectId: "p1", projectName: "Home", labels: [], priority: 1, isCompleted: false };
  p.snapshot = snapshotOf([remote()]);
  p.getTodoistSnapshot = async () => { p.settings.taskCache.n9 = { oid: "ZZZ99", path: NOTE, content: "Sow beans", projectId: "p1", projectName: "Home", labels: [], priority: 1, isCompleted: false }; return p.snapshot; };
  await p.syncFileNotes(NOTE, false);
  assert.deepEqual(p.deleted, []);
  assert.ok(p.settings.taskCache.n9);
});

test("Apply pairs created ids with their rows when the middle create is rejected", async () => {
  const p = makePlugin({ [NOTE]: "# Garden\n" });
  const rows = ["One", "Two", "Three"].map((title) => { const r = createRow({ fields: { content: title } }); r.notePlacement = { path: "note", notePath: NOTE, reason: "named" }; return r; });
  rows[1].notePlacement = { path: "note", notePath: OTHER, reason: "named" };
  p.store.set(OTHER, "# Other\n");
  p.todoistSync = async (commands) => {
    const adds = commands.filter((c) => c.type === "item_add");
    const bad = adds.find((c) => c.args.content === "Two");
    return { sync_status: Object.fromEntries(commands.map((c) => [c.uuid, c === bad ? { error: "no" } : "ok"])), temp_id_mapping: Object.fromEntries(adds.filter((c) => c !== bad).map((c) => [c.temp_id, `id-${c.args.content}`])) };
  };
  p.refreshTodoistLines = async () => {};
  await p.applyTodoistChanges({ rows, snapshot: snapshotOf([]) }, ["row-0", "row-1", "row-2"]);
  assert.ok(p.store.get(NOTE).includes("One") && p.store.get(NOTE).includes("Three") && !p.store.get(NOTE).includes("Two"), p.store.get(NOTE));
  assert.equal(p.store.get(OTHER), "# Other\n", "rejected row writes nothing anywhere");
  assert.equal(p.settings.taskCache["id-Two"], undefined);
});

test("Preview names the monthly note and Apply writes exactly there, even after midnight", async () => {
  const p = makePlugin({ [NOTE]: "# Garden\n" });
  const snap = snapshotOf([remote({ id: "t0", content: "Existing" })]);
  const turn = { snapshot: snap, allowedIds: new Set(["p1", "pin"]), labels: [], prompt: "buy mulch" };
  const built = p.buildTodoistChanges({ changes: [{ op: "create", content: "Buy mulch", projectId: "p1" }, { op: "create", content: "Sow beans", projectId: "p1", placement: { kind: "active" } }] }, turn, [], [], { path: NOTE });
  const monthlyRow = built.rows[0];
  const previewed = built.preview.groups.flatMap((g) => g.rows).find((r) => r.sentence.includes("Buy mulch")).writesTo;
  assert.equal(monthlyRow.notePlacement.monthlyPath, previewed);
  assert.equal(built.rows[1].notePlacement.notePath, NOTE);
  p.todoistSync = async (commands) => ({ sync_status: Object.fromEntries(commands.map((c) => [c.uuid, "ok"])), temp_id_mapping: Object.fromEntries(commands.filter((c) => c.temp_id).map((c) => [c.temp_id, `id-${c.args.content}`])) });
  p.refreshTodoistLines = async () => {};
  const failed = await p.writeCreatedTaskLines([{ id: "n1", row: monthlyRow }], { snapshot: snap, now: new Date(2099, 0, 1) });
  assert.deepEqual(failed, []);
  assert.ok(p.store.get(previewed).includes("Buy mulch"), `${previewed} ${[...p.store.keys()]}`);
  assert.equal(p.store.has(`${FOLDER}/2099-01 Tasks.md`), false);
  await p.applyTodoistChanges(built, ["row-1"]);
  assert.ok(p.store.get(NOTE).includes("Sow beans"), p.store.get(NOTE));
});

test("deleting a monthly note shows one notice and touches neither Todoist nor the cache", async () => {
  const p = monthlyPlugin(START);
  global.__notices = [];
  const file = new TFileRef(); file.path = OCT; file.extension = "md";
  p.handleMonthlyNoteDeleted(file);
  assert.equal(global.__notices.length, 1, JSON.stringify(global.__notices));
  assert.ok(/doesn't delete/i.test(global.__notices[0]));
  assert.deepEqual(p.deleted, []);
  assert.equal(p.settings.taskCache.n1.path, OCT);
  const other = new TFileRef(); other.path = NOTE; other.extension = "md";
  p.handleMonthlyNoteDeleted(other);
  assert.equal(global.__notices.length, 1, "ordinary note delete shows nothing");
});

test("renaming a monthly note re-points its cached tasks", () => {
  const p = monthlyPlugin(START);
  const renamed = `${FOLDER}/Renamed.md`;
  const file = new TFileRef(); file.path = renamed; file.extension = "md";
  p.handleMonthlyNoteRenamed(file, OCT);
  assert.ok(["n1", "n2", "n3"].every((id) => p.settings.taskCache[id].path === renamed));
  p.settings.taskCache.n4 = { oid: "X", path: NOTE };
  p.handleMonthlyNoteRenamed(file, NOTE.replace("Garden", "Elsewhere"));
  assert.equal(p.settings.taskCache.n4.path, NOTE, "unrelated paths untouched");
});
test("deleted monthly note recreated with one new chat line: old cached tasks are not deleted in Todoist", async () => {
  const p = monthlyPlugin(START);
  const file = new TFileRef(); file.path = OCT; file.extension = "md";
  p.store.delete(OCT);
  p.handleMonthlyNoteDeleted(file);
  const row = createRow({ fields: { content: "Sow beans" } }); row.notePlacement = { path: "monthly", reason: "none" };
  const failed = await p.writeCreatedTaskLines([{ id: "n9", row }], { snapshot: snapshotOf([]), now: OCT_DATE });
  assert.deepEqual(failed, []);
  p.snapshot = snapshotOf(allRemote().concat([remote({ id: "n9", content: "Sow beans" })]));
  await p.syncFileNotes(OCT, false);
  assert.deepEqual(p.deleted, []);
  assert.ok(p.store.get(OCT).includes("Sow beans"), p.store.get(OCT));
  assert.ok(p.settings.taskCache.n1 && p.settings.taskCache.n2 && p.settings.taskCache.n3);
  assert.ok(!p.settings.taskCache.n9.noteDeleted);
});

test("ordinary note delete leaves cache entries unmarked and a task whose line is gone is still deleted", async () => {
  const p = makePlugin({ [NOTE]: GARDEN.replace(/^- \[ \].*$/m, "") });
  p.settings.taskCache.n1 = { oid: "AAA11", path: NOTE, content: "Buy mulch", projectId: "p1", projectName: "Home", labels: [], priority: 1, isCompleted: false };
  const file = new TFileRef(); file.path = NOTE; file.extension = "md";
  p.handleMonthlyNoteDeleted(file);
  assert.ok(!p.settings.taskCache.n1.noteDeleted);
  p.snapshot = snapshotOf([remote()]);
  await p.syncFileNotes(NOTE, false);
  assert.deepEqual(p.deleted, ["n1"]);
});

test("writeCreatedTaskLines skips a note still being synced after the wait times out", async () => {
  const p = makePlugin({ [NOTE]: GARDEN });
  p.fileSyncInProgress = new Set([NOTE]);
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => realSetTimeout(fn, 0);
  try {
    const row = createRow({ fields: { content: "Sow beans" } }); row.notePlacement = { path: "note", notePath: NOTE, reason: "named" };
    const failed = await p.writeCreatedTaskLines([{ id: "n9", row }], { snapshot: snapshotOf([remote()]), now: OCT_DATE });
    assert.deepEqual(failed, ["Sow beans"]);
  } finally { global.setTimeout = realSetTimeout; }
  assert.deepEqual(p.writes, []);
  assert.ok(p.fileSyncInProgress.has(NOTE), "someone else's guard left alone");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); } catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${error && error.stack ? String(error.message).split("\n").slice(0, 14).join("\n  ") : error}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
})();
