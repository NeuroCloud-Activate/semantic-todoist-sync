"use strict";
// T3: duplicate review box, Merge / Keep both resolution, unanswered-on-load, recording. Vault, Todoist and models are in-memory fakes.
// DUPBOX_MAIN lets a proposal copy of src/main.js be tested before it is merged.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const mainPath = process.env.DUPBOX_MAIN ? path.resolve(process.env.DUPBOX_MAIN) : path.join(__dirname, "..", "src/main.js");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.join(__dirname, "..", "src"));
let TFileRef;
const notices = [];
const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class Empty { open() {} }
  class TFile {}
  TFileRef = TFile;
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: class { constructor(message) { notices.push(String(message)); } }, Plugin: Empty,
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

const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const OLD_NOTE = "Notes/Old.md";
const NEW_NOTE = "Notes/Meeting.md";
const OLD_DESC = "Annual report for the funder, due every autumn.\nKeep it under ten pages.\n\nSource List:\nSources:\n- [[Old]]";
const NEW_DESC = "Chantal moved the deadline up to 10 November.\n\nSource List:\nSources:\n- [[Meeting]]";

const existingRemote = () => ({ id: "e1", content: "Submit annual IRGP report", description: OLD_DESC, labels: ["finance"], priority: 1, dueDate: "2026-11-02", deadlineDate: "", projectId: "p1", sectionId: "s1", parentId: "", isCompleted: false, projectName: "Work", section: "Reports" });
const candidate = () => ({ id: "e1", oid: "", content: "Submit annual IRGP report", description: OLD_DESC, labels: ["finance"], priority: 1, dueDate: "2026-11-02", deadlineDate: "", projectId: "p1", projectName: "Work", sectionId: "s1", sectionName: "Reports", parentId: "", parentContent: "" });
const heldTask = () => ({ content: "Submit the annual IRGP report", description: NEW_DESC, labels: ["finance", "urgent"], priority: 4, due_date: "2026-11-10", oid: "N1", projectId: "p1", sectionId: "s1",
  subtasks: [{ content: "Gather figures", oid: "N2", labels: [], priority: 1 }] });
const record = (over = {}) => ({ id: "h1", createdAt: "2026-10-25T10:00:00.000Z", status: "waiting", kind: "plan",
  source: { type: "note", path: NEW_NOTE, sectionName: "Meeting", projectId: "p1", projectName: "Work", batchId: "b1", emailSubject: "", emailFrom: "" },
  task: heldTask(), candidate: candidate(), score: 0.93, nearIdentical: false, gate: null, veto: null, ai: { verdict: "unsure", confidence: 0.5, reason: "x" }, outcome: "", ...over });

function makeView(plugin) {
  const view = Object.create(Plugin.SemanticTodoistView.prototype);
  view.plugin = plugin;
  view.messages = [];
  view.renders = 0;
  view.renderMessages = () => { view.renders += 1; };
  return view;
}

function makePlugin(over = {}) {
  const store = new Map([[OLD_NOTE, "- [ ] Submit annual IRGP report %%[tid:: e1]%% %%[oid:: OLDOID]%%\n"], [NEW_NOTE, "Meeting notes\n"]]);
  const tfiles = new Map();
  const fileFor = (p) => { if (!tfiles.has(p)) { const f = new TFileRef(); f.path = p; f.basename = p.split("/").pop().replace(/\.md$/, ""); f.extension = "md"; tfiles.set(p, f); } return tfiles.get(p); };
  for (const p of store.keys()) fileFor(p);
  const files = {};
  const p = Object.create(Plugin.prototype);
  p.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { todoistToken: "tok", taskCache: {}, ...(over.settings || {}) });
  p.manifest = { dir: "plugin-dir" };
  p.files = files;
  p.store = store;
  p.calls = { batch: [], update: [], sync: [], lines: [], chatRow: [], openSidebar: 0, requests: [] };
  p.app = {
    workspace: { getLeavesOfType: () => (p.view ? [{ view: p.view }] : []) },
    vault: {
      adapter: { read: async (f) => { if (!(f in files)) throw new Error("ENOENT"); return files[f]; }, write: async (f, t) => { if (over.failStoreWrite) throw new Error("disk full"); files[f] = t; } },
      getAbstractFileByPath: (q) => (store.has(String(q)) ? fileFor(String(q)) : null),
      getMarkdownFiles: () => [...store.keys()].map(fileFor),
      read: async (f) => store.get(f.path), cachedRead: async (f) => store.get(f.path),
      process: async (f, fn) => { store.set(f.path, fn(store.get(f.path))); },
      create: async (q, t) => { store.set(q, t); fileFor(q); }, createFolder: async () => {}
    }
  };
  p.settings.taskCache.e1 = { oid: "OLDOID", path: OLD_NOTE, lineNumber: 0, content: "Submit annual IRGP report", description: OLD_DESC, labels: ["finance"], priority: 1, due_date: "2026-11-02", isSubtask: false, projectId: "p1", sectionId: "s1", section: "Reports", projectName: "Work",
    noteRefs: [{ id: "e1", oid: "OLDOID", path: OLD_NOTE, lineNumber: 0, isSubtask: false, parentOid: "", parentId: "", content: "Submit annual IRGP report" }] };
  p.logs = [];
  p.logLocal = (m, d) => p.logs.push([m, d]);
  p.setSidebarStatus = () => {};
  p.saveSettings = async () => {};
  for (const name of ["refreshSidebarStatus", "markTaskReferenceStateDirty", "queueTaskReferenceIndexUpdate", "observeSchedulerMemoryForTask"]) p[name] = () => {};
  p.openSidebar = async () => { p.calls.openSidebar += 1; };
  p.snapshot = { tasks: [existingRemote()], projects: [{ id: "p1", name: "Work" }], sections: [{ id: "s1", name: "Reports", projectId: "p1" }] };
  p.getTodoistSnapshot = async () => { if (over.snapshotThrows) throw new Error("offline"); return p.snapshot; };
  p.getTaskProjectId = async () => "p1";
  p.todoistProjectNameForId = async () => "Work";
  p.ensureTodoistSectionId = async (projectId, name) => { p.calls.section = [projectId, name]; return "s9"; };
  p.createTodoistTaskBatch = over.createBatch || (async (section, tasks, sectionId) => {
    p.calls.batch.push({ section, tasks, sectionId });
    for (const t of tasks) { t.id = "new1"; for (const s of t.subtasks || []) s.id = "new2"; }
    return tasks;
  });
  p.todoistSync = async (commands) => { p.calls.sync.push(commands); return { sync_status: {}, temp_id_mapping: Object.fromEntries(commands.filter((c) => c.temp_id).map((c, i) => [c.temp_id, "sub" + (i + 1)])) }; };
  p.todoistRequest = async (url, method, body) => { p.calls.requests.push({ url, method, body }); return {}; };
  p.createHeldChatRow = async (r) => { p.calls.chatRow.push(r.id); return { id: "chat1" }; };
  if (over.stubLines) p.writeCreatedTaskLines = async (entries) => { p.calls.lines.push(entries); return over.linesFail ? entries.map((e) => e.row.fields.content) : []; };
  return p;
}
const storeOf = (p) => JSON.parse(p.files["plugin-dir/duplicate-review.json"]);

test("default: recording is on", () => {
  assert.equal(Plugin.DEFAULT_SETTINGS.taskDuplicateReviewRecording, true);
});

test("post box with the sidebar open: one duplicate-review message with Merge and Keep both, in plain words", async () => {
  const p = makePlugin(); p.view = makeView(p);
  await p.postDuplicateReviewBox(record({ task: Object.assign(heldTask(), { subtasks: [{ content: "a" }, { content: "b" }] }) }));
  assert.equal(p.view.messages.length, 1);
  const m = p.view.messages[0];
  assert.equal(m.kind, "duplicate-review"); assert.equal(m.heldId, "h1");
  assert.deepEqual(m.actions.map((a) => a.label), ["Merge", "Keep both"]);
  assert.ok(m.actions.every((a) => !a.isDisabled()));
  assert.ok(m.text.includes("Possible duplicate") && m.text.includes("with 2 subtasks"), m.text);
  assert.ok(m.text.includes("Existing: Submit annual IRGP report (Work)"), m.text);
  assert.ok(m.text.includes("add label urgent"), m.text);
  assert.ok(m.text.includes("due date 2026-11-02 to 2026-11-10"), m.text);
  assert.ok(m.text.includes("priority rose from P4 to P1") === false, "priority is in the Merge line, not the sentence");
  assert.ok(m.text.includes("priority P4 to P1"), m.text);
  assert.ok(m.text.includes("add this note to its sources"), m.text);
  assert.ok(!m.text.includes("->") && !m.text.includes("\u2192"), "no arrows");
  assert.equal(p.calls.openSidebar, 0);
});

test("post box with the sidebar closed: sidebar not forced open, one notice per batch", async () => {
  const p = makePlugin(); notices.length = 0;
  await p.postDuplicateReviewBox(record());
  await p.postDuplicateReviewBox(record({ id: "h2" }));
  assert.equal(p.calls.openSidebar, 0);
  assert.equal(notices.length, 1);
  await p.postDuplicateReviewBox(record({ id: "h3", source: Object.assign(record().source, { batchId: "b2" }) }));
  assert.equal(notices.length, 2);
});

test("onOpen: every waiting record and this session's resolved records get their box; old finished ones do not", async () => {
  const p = makePlugin();
  const store = await p.loadDuplicateStore();
  store.held.push(record({ id: "w1" }), record({ id: "k1", status: "kept", outcome: "Created separate task." }), record({ id: "old", status: "kept", outcome: "Created separate task." }), record({ id: "c1", status: "checking" }));
  p.duplicateSessionResolved = new Set(["k1"]);
  const view = makeView(p);
  await p.restoreDuplicateReviewBoxes(view);
  assert.deepEqual(view.messages.map((m) => m.heldId).sort(), ["k1", "w1"]);
  assert.ok(view.messages.find((m) => m.heldId === "k1").actions.every((a) => a.isDisabled()), "resolved box has disabled buttons");
  assert.ok(view.messages.find((m) => m.heldId === "k1").text.includes("Created separate task."));
  const source = fs.readFileSync(mainPath, "utf8");
  assert.ok(/async onOpen\(\)\s*\{[\s\S]{0,400}restoreDuplicateReviewBoxes/.test(source), "onOpen calls it");
});

test("Keep both (note): batch created once with source section, note line for main, then subtasks under main id; status kept", async () => {
  const p = makePlugin({ stubLines: true }); p.view = makeView(p);
  const store = await p.loadDuplicateStore(); const rec = record(); store.held.push(rec);
  await p.postDuplicateReviewBox(rec);
  assert.equal(await p.resolveHeldDuplicate("h1", "keep", { by: "user" }), true);
  assert.equal(p.calls.batch.length, 1);
  assert.equal(p.calls.batch[0].section, "Meeting"); assert.equal(p.calls.batch[0].tasks.length, 1);
  assert.deepEqual(p.calls.section, ["p1", "Meeting"]);
  assert.equal(p.calls.lines.length, 2);
  assert.equal(p.calls.lines[0][0].id, "new1");
  assert.deepEqual(p.calls.lines[0][0].row.notePlacement, { path: "note", notePath: NEW_NOTE });
  assert.equal(p.calls.lines[0][0].row.target.parentId, "");
  assert.equal(p.calls.lines[1][0].id, "new2"); assert.equal(p.calls.lines[1][0].row.target.parentId, "new1");
  assert.equal(p.calls.lines[0][0].row.fields.content, "Submit the annual IRGP report");
  assert.equal(rec.status, "kept");
  const m = p.view.messages[0];
  assert.ok(m.text.includes("Created separate task."));
  assert.ok(m.actions.every((a) => a.isDisabled()));
  assert.equal(storeOf(p).answers.length, 1);
  assert.equal(storeOf(p).answers[0].answer, "keep"); assert.equal(storeOf(p).answers[0].by, "user");
  assert.equal(storeOf(p).answers[0].newTitle, "Submit the annual IRGP report"); assert.equal(storeOf(p).answers[0].existingId, "e1");
});

test("Keep both (chat): the chat row creator is used, then the note line", async () => {
  const p = makePlugin({ stubLines: true });
  const row = { op: "create", fields: { content: "Chat task" }, target: { projectId: "p1" } };
  const rec = record({ kind: "chat", source: { type: "chat", row }, task: { content: "Chat task" } });
  (await p.loadDuplicateStore()).held.push(rec);
  await p.resolveHeldDuplicate("h1", "keep", { by: "user" });
  assert.deepEqual(p.calls.chatRow, ["h1"]);
  assert.equal(p.calls.batch.length, 0);
  assert.equal(p.calls.lines[0][0].id, "chat1"); assert.equal(p.calls.lines[0][0].row, row);
  assert.equal(rec.status, "kept");
});

test("Merge: no item_add, existing title, labels only added, every old description line kept, one update", async () => {
  const p = makePlugin({ stubLines: true });
  p.updateTodoistFromParsedTask = async (task, remote) => { p.calls.update.push({ task, remote }); return true; };
  const rec = record(); (await p.loadDuplicateStore()).held.push(rec);
  assert.equal(await p.resolveHeldDuplicate("h1", "merge", { by: "user" }), true);
  assert.equal(p.calls.batch.length, 0, "no item_add path");
  assert.ok(p.calls.sync.flat().every((c) => c.args.parent_id === "e1"), "only subtasks under the existing task are added; the parent gets no item_add");
  assert.equal(p.calls.update.length, 1);
  const sent = p.calls.update[0].task;
  assert.equal(sent.id, "e1"); assert.equal(sent.content, "Submit annual IRGP report", "title is the existing title");
  assert.deepEqual(sent.labels, ["finance", "urgent"]);
  for (const line of OLD_DESC.split("\n").filter((l) => l.trim())) assert.ok(sent.description.includes(line), `kept: ${line}`);
  assert.ok(sent.description.includes("- [[Meeting]]"), "new source added");
  assert.ok(/due date moved from 2026-11-02 to 2026-11-10/.test(sent.description) && !sent.description.includes("->"), sent.description);
  assert.equal(sent.due_date, "2026-11-10"); assert.equal(sent.priority, 4);
  assert.equal(p.calls.lines.length, 2, "merged line, then its new subtask line");
  const entry = p.calls.lines[0][0];
  assert.equal(entry.id, "e1"); assert.equal(entry.row.fields.content, "Submit annual IRGP report");
  assert.deepEqual(entry.row.notePlacement, { path: "note", notePath: NEW_NOTE });
  assert.equal(rec.status, "merged");
  assert.equal(storeOf(p).answers[0].answer, "merge");
});

test("Merge through the real update path sends only changed fields and never drops labels or description lines", async () => {
  const p = makePlugin({ stubLines: true });
  (await p.loadDuplicateStore()).held.push(record());
  await p.resolveHeldDuplicate("h1", "merge", { by: "user" });
  assert.equal(p.calls.requests.length, 1);
  const { url, body } = p.calls.requests[0];
  assert.equal(url, "/tasks/e1");
  assert.equal(body.content, undefined, "title not sent");
  assert.deepEqual([...body.labels].sort(), ["finance", "urgent"]);
  assert.equal(body.due_date, "2026-11-10");
  // Todoist's own description formatter may re-flow the source-list header lines; every prose line and source link must survive.
  for (const line of OLD_DESC.split("\n").filter((l) => l.trim() && !/^(source list|sources):$/i.test(l.trim()))) assert.ok(body.description.includes(line), line);
  assert.ok(body.description.includes("[[Meeting]]"));
  assert.ok(!("project_id" in body) && !("section_id" in body) && !("parent_id" in body));
});

test("Merge note line: second line has a new oid that maps to the existing id; original entry keeps its path; syncing either note never deletes the task", async () => {
  const p = makePlugin();
  p.updateTodoistFromParsedTask = async () => true;
  (await p.loadDuplicateStore()).held.push(record({ task: { ...heldTask(), subtasks: [] } })); // subtask lines have their own home in the note; this test is about the merged line
  await p.resolveHeldDuplicate("h1", "merge", { by: "user" });
  const text = p.store.get(NEW_NOTE);
  assert.ok(text.includes("Submit annual IRGP report") && !text.includes("Submit the annual"), text);
  const entry = p.settings.taskCache.e1;
  assert.equal(entry.path, OLD_NOTE, "original path kept");
  assert.equal(entry.oid, "OLDOID");
  assert.equal(entry.noteRefs.length, 2);
  const newRef = entry.noteRefs.find((r) => r.path === NEW_NOTE);
  assert.ok(newRef && newRef.oid && newRef.oid !== "OLDOID" && text.includes(newRef.oid), "second line cached as a note reference with its own oid");
  assert.equal(newRef.id, "e1");
  const deleted = [];
  p.deleteTodoistTask = async (id) => { deleted.push(id); return true; };
  p.cleanupEmptyTodoistSections = async () => 0;
  await p.deleteTodoistTasksMissingFromFile(NEW_NOTE, new Set(["e1"]));
  await p.deleteTodoistTasksMissingFromFile(NEW_NOTE, new Set());
  await p.deleteTodoistTasksMissingFromFile(OLD_NOTE, new Set(["e1"]));
  assert.deepEqual(deleted, []);
  assert.equal(p.settings.taskCache.e1.path, OLD_NOTE);
  // the new line's oid resolves to the existing task, so a moved line is still recognised
  assert.equal(Plugin.todoistIdForOid ? Plugin.todoistIdForOid(p.settings, newRef.oid) : "e1", "e1");
});

test("double click: the second call does nothing, one creation", async () => {
  const p = makePlugin({ stubLines: true });
  (await p.loadDuplicateStore()).held.push(record());
  const results = await Promise.all([p.resolveHeldDuplicate("h1", "keep", { by: "user" }), p.resolveHeldDuplicate("h1", "keep", { by: "user" }), p.resolveHeldDuplicate("h1", "merge", { by: "user" })]);
  assert.deepEqual(results, [true, false, false]);
  assert.equal(p.calls.batch.length, 1);
  assert.equal(storeOf(p).answers.length, 1);
  assert.equal(await p.resolveHeldDuplicate("h1", "keep", { by: "user" }), false, "after it is finished too");
  assert.equal(p.calls.batch.length, 1);
});

test("failure: back to waiting, buttons enabled, plain failure words, log line, no answer recorded; retry works", async () => {
  let fail = true;
  const p = makePlugin({ stubLines: true, createBatch: async (s, tasks) => { if (fail) throw new Error("Todoist down"); for (const t of tasks) { t.id = "new1"; for (const x of t.subtasks || []) x.id = "new2"; } return tasks; } });
  p.view = makeView(p);
  const rec = record(); (await p.loadDuplicateStore()).held.push(rec);
  await p.postDuplicateReviewBox(rec);
  assert.equal(await p.resolveHeldDuplicate("h1", "keep", { by: "user" }), false);
  assert.equal(rec.status, "waiting");
  const m = p.view.messages[0];
  assert.ok(m.actions.every((a) => !a.isDisabled()), "buttons enabled again");
  assert.ok(m.text.includes("did not finish"), m.text);
  assert.ok(p.logs.some(([msg]) => /resolution failed/.test(msg)));
  assert.equal((p.duplicateStore.answers || []).length, 0);
  assert.equal(p.files["plugin-dir/duplicate-review.json"] && storeOf(p).answers.length, 0);
  fail = false;
  assert.equal(await p.resolveHeldDuplicate("h1", "keep", { by: "user" }), true);
  assert.equal(rec.status, "kept");
  assert.equal(storeOf(p).answers.length, 1);
});

test("failure on Merge when Todoist cannot be read: stays waiting, nothing sent", async () => {
  const p = makePlugin({ stubLines: true, snapshotThrows: true });
  p.updateTodoistFromParsedTask = async () => { p.calls.update.push(1); return true; };
  const rec = record(); (await p.loadDuplicateStore()).held.push(rec);
  assert.equal(await p.resolveHeldDuplicate("h1", "merge", { by: "user" }), false);
  assert.equal(rec.status, "waiting"); assert.equal(p.calls.update.length, 0); assert.equal(p.calls.lines.length, 0);
});

test("note line failure on Keep both is a failure too (task not reported as done)", async () => {
  const p = makePlugin({ stubLines: true, linesFail: true });
  const rec = record(); (await p.loadDuplicateStore()).held.push(rec);
  assert.equal(await p.resolveHeldDuplicate("h1", "keep", { by: "user" }), false);
  assert.equal(rec.status, "waiting");
});

test("recording off: the click works but no answer is appended", async () => {
  const p = makePlugin({ stubLines: true, settings: { taskDuplicateReviewRecording: false } });
  (await p.loadDuplicateStore()).held.push(record());
  await p.resolveHeldDuplicate("h1", "keep", { by: "user" });
  assert.equal(storeOf(p).answers.length, 0);
  assert.equal(storeOf(p).held[0].status, "kept");
});

test("AI-cleared record is created and recorded as cleared, with no box text change needed", async () => {
  const p = makePlugin({ stubLines: true });
  (await p.loadDuplicateStore()).held.push(record({ status: "checking" }));
  await p.resolveHeldDuplicate("h1", "keep", { by: "ai" });
  assert.equal(storeOf(p).held[0].status, "cleared");
  assert.equal(storeOf(p).answers[0].answer, "cleared"); assert.equal(storeOf(p).answers[0].by, "ai");
});

test("unanswered at load: checking, waiting and resolving records are created once as unanswered; a second load does nothing", async () => {
  const p = makePlugin({ stubLines: true });
  p.duplicateSessionStart = "2026-10-26T00:00:00.000Z";
  const store = await p.loadDuplicateStore();
  store.held.push(record({ id: "a", status: "checking" }), record({ id: "b", status: "waiting" }), record({ id: "c", status: "resolving" }), record({ id: "d", status: "kept", outcome: "Created separate task." }));
  await p.resolveUnansweredHeldDuplicates();
  assert.equal(p.calls.batch.length, 3);
  const after = storeOf(p);
  assert.deepEqual(after.held.map((r) => r.status), ["unanswered", "unanswered", "unanswered", "kept"]);
  assert.ok(after.held[0].outcome.includes("no answer before Obsidian closed"));
  assert.deepEqual(after.answers.map((a) => [a.answer, a.by]), [["unanswered", "startup"], ["unanswered", "startup"], ["unanswered", "startup"]]);
  await p.resolveUnansweredHeldDuplicates();
  assert.equal(p.calls.batch.length, 3, "not again on a second load");
  assert.equal(storeOf(p).answers.length, 3);
});

test("unanswered at load leaves this session's own records alone", async () => {
  const p = makePlugin({ stubLines: true });
  p.duplicateSessionStart = "2026-10-25T09:00:00.000Z";
  (await p.loadDuplicateStore()).held.push(record({ createdAt: "2026-10-25T10:00:00.000Z" }));
  await p.resolveUnansweredHeldDuplicates();
  assert.equal(p.calls.batch.length, 0);
  assert.equal(storeOf(p).held[0].status, "waiting");
});

test("settings: recording toggle present, old strictness and AI-sensitivity rows removed from Task Integrity", () => {
  const source = fs.readFileSync(mainPath, "utf8");
  const start = source.indexOf("renderTaskIntegrity(containerEl) {");
  const body = source.slice(start, start + 4000);
  assert.ok(body.includes('"Record duplicate answers"') && body.includes('"taskDuplicateReviewRecording"'));
  assert.ok(!body.includes("taskDeduplicationStrictnessSetting(") && !body.includes("taskDeduplicationAiReviewSensitivitySetting("));
  assert.ok(body.includes("Ask the dedupe model about likely duplicates before showing the box; when off, every likely duplicate gets a box."));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${(error && error.stack || error).toString().split("\n").slice(0, 4).join("\n  ")}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exitCode = 1;
})();
