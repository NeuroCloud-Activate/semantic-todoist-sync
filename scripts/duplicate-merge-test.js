"use strict";
// F4: Merge subtasks, merge description send, chat Keep both single line, failed Apply, recurring chat rows, preview. All Todoist/vault faked.
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
  p.todoistSync = over.sync || (async (commands) => { p.calls.sync.push(commands); return { sync_status: {}, temp_id_mapping: Object.fromEntries(commands.filter((c) => c.temp_id).map((c, i) => [c.temp_id, "sub" + (p.calls.sync.flat().indexOf(c) + 1)])) }; });
  p.todoistRequest = async (url, method, body) => { p.calls.requests.push({ url, method, body }); return {}; };
  
  if (over.stubLines) p.writeCreatedTaskLines = async (entries) => { p.calls.lines.push(entries); return over.linesFail ? entries.map((e) => e.row.fields.content) : []; };
  return p;
}
const storeOf = (p) => JSON.parse(p.files["plugin-dir/duplicate-review.json"]);

const itemAdds = (p) => p.calls.sync.flat().filter((c) => c.type === "item_add");
const resolveWith = async (p, rec, answer = "merge") => { (await p.loadDuplicateStore()).held.push(rec); return p.resolveHeldDuplicate(rec.id, answer, { by: "user" }); };
const twoSubs = () => Object.assign(heldTask(), { subtasks: [{ content: "Gather figures", oid: "N2", labels: [], priority: 1 }, { content: "Send draft", oid: "N3", labels: [], priority: 1 }] });
const withExistingSub = (p) => { p.snapshot.tasks.push({ id: "x1", content: "gather  FIGURES!", parentId: "e1", isCompleted: false, projectId: "p1", sectionId: "s1", labels: [], priority: 1 }); };

test("chat Keep both writes the note line once (createHeldChatRow no longer writes it)", async () => {
  const p = makePlugin({ stubLines: true });
  const row = { op: "create", fields: { content: "Dup chat task", description: "d", priority: 1, dueDate: null, labels: [] }, target: { projectId: "p1", sectionId: "s1", parentId: "" }, newLabels: [] };
  const rec = record({ kind: "chat", source: { type: "chat", row }, task: { content: "Dup chat task" } });
  assert.equal(await resolveWith(p, rec, "keep"), true);
  assert.equal(itemAdds(p).length, 1);
  assert.equal(p.calls.lines.length, 1, JSON.stringify(p.calls.lines.map((l) => l.length)));
  assert.equal(p.calls.lines[0].length, 1);
});

test("Merge adds only the new incoming subtasks under the existing task; parent gets no item_add; note lines under the merged line", async () => {
  const p = makePlugin({ stubLines: true }); withExistingSub(p);
  assert.equal(await resolveWith(p, record({ task: twoSubs() })), true);
  const adds = itemAdds(p);
  assert.equal(adds.length, 1);
  assert.equal(adds[0].args.content, "Send draft"); assert.equal(adds[0].args.parent_id, "e1");
  const all = p.calls.lines.flat();
  assert.deepEqual(all.map((e) => e.id), ["e1", "sub1"]);
  assert.equal(all[1].row.target.parentId, "e1");
  assert.equal(all[1].row.fields.content, "Send draft");
});

test("Merge subtasks are idempotent: retry after a note-line failure sends no second item_add", async () => {
  const p = makePlugin({ stubLines: true }); withExistingSub(p);
  let first = true; const lines = p.writeCreatedTaskLines;
  p.writeCreatedTaskLines = async (entries, o) => { if (first) { first = false; return entries.map((e) => e.row.fields.content); } return lines(entries, o); };
  const rec = record({ task: twoSubs() });
  assert.equal(await resolveWith(p, rec), false);
  assert.equal(itemAdds(p).length, 1);
  assert.equal(await p.resolveHeldDuplicate("h1", "merge", { by: "user" }), true);
  assert.equal(itemAdds(p).length, 1, "no second item_add");
  assert.deepEqual(p.calls.lines.flat().map((e) => e.id), ["e1", "sub1"]);
});

test("preview lists only the new subtasks; nothing to change says so", () => {
  const p = makePlugin();
  assert.ok(p.duplicateReviewText(record({ task: twoSubs() })).includes("add 2 subtasks"));
  const same = record({ task: { content: "Submit annual IRGP report", description: OLD_DESC, labels: ["finance"], priority: 1, due_date: "2026-11-02", subtasks: [] } });
  const text = p.duplicateReviewText(same);
  assert.ok(text.includes("Merge would not change the existing task; it adds a note line for it."), text);
  assert.ok(!/add this (note|email)/.test(text), text);
});

test("preview says add to sources only when the sources gain an entry", () => {
  const p = makePlugin();
  assert.ok(p.duplicateReviewText(record()).includes("add this note to its sources"), p.duplicateReviewText(record()));
  const seen = record({ task: { content: "Submit annual IRGP report", description: "Annual report for the funder, due every autumn.\n\nSource List:\nSources:\n- [[Old]]", labels: ["finance"], priority: 1, due_date: "2026-11-02", subtasks: [] } });
  assert.ok(!p.duplicateReviewText(seen).includes("to its sources"), p.duplicateReviewText(seen));
});

test("Merge sends a short changed description to Todoist", async () => {
  const p = makePlugin();
  p.snapshot.tasks[0].description = "Short note";
  const rec = record({ candidate: { ...candidate(), description: "Short note" }, task: { content: "Submit annual IRGP report", description: "Extra detail here", labels: ["finance"], priority: 1, subtasks: [] } });
  assert.equal(await resolveWith(p, rec), true);
  const body = p.calls.requests.find((r) => r.url === "/tasks/e1")?.body;
  assert.ok(body && /Extra detail here/.test(body.description || ""), JSON.stringify(p.calls.requests));
  assert.ok(/Short note/.test(body.description));
});

test("Merge never truncates: too-long description stays unchanged, other fields still update, outcome says so", async () => {
  const p = makePlugin({ settings: { todoistDescriptionMaxChars: 60 } });
  p.snapshot.tasks[0].description = "Short existing note";
  const rec = record({ candidate: { ...candidate(), description: "Short existing note" }, task: { content: "Submit annual IRGP report", description: "A much longer incoming description that cannot fit in the limit.", labels: ["finance", "urgent"], priority: 1, subtasks: [] } });
  assert.equal(await resolveWith(p, rec), true);
  const body = p.calls.requests.find((r) => r.url === "/tasks/e1")?.body;
  assert.ok(body, "labels still updated");
  assert.ok(!("description" in body), JSON.stringify(body));
  assert.deepEqual([...body.labels].sort(), ["finance", "urgent"]);
  assert.ok(p.duplicateReviewText(rec).includes("The description was too long to add to."));
  assert.ok(p.logs.some(([m]) => /too long/i.test(m)));
});

test("Merge refuses when the existing task is now a subtask or is completed", async () => {
  const p = makePlugin({ stubLines: true });
  p.snapshot.tasks[0].parentId = "top1";
  assert.equal(await resolveWith(p, record()), false);
  assert.ok(p.logs.some(([, d]) => /now a subtask/.test(JSON.stringify(d))));
  assert.equal(p.calls.requests.length, 0); assert.equal(p.calls.lines.length, 0);
  const q = makePlugin({ stubLines: true }); q.snapshot.tasks[0].isCompleted = true;
  assert.equal(await resolveWith(q, record()), false);
  assert.equal(q.calls.requests.length, 0);
});

// ---- chat Apply helpers (held rows, failed Apply, recurring) ----
const csnap = { tasks: [], projects: [{ id: "p1", name: "Home" }], sections: [{ id: "s1", name: "Later", projectId: "p1" }] };
const crow = (content, f = {}) => ({ op: "create", fields: { content, description: "d", priority: 3, dueDate: "2026-11-02", labels: [], ...f }, target: { projectId: "p1", sectionId: "s1", parentId: "" }, newLabels: [] });
function chatPlugin(over = {}) {
  const p = makePlugin({ stubLines: true });
  p.getTodoistSnapshot = async () => csnap;
  p.requireTodoistAccess = () => {};
  p.refreshTodoistLines = () => {};
  p.judgeHeldDuplicates = async () => {};
  p.noticeDuplicateCheckOff = () => {};
  p.settings.enableTaskDeduplication = true;
  p.findDuplicateHolds = over.find || (async (tasks) => ({ holds: tasks.filter((t) => t.content === "Dup task").map((task) => ({ task, candidate: { id: "e1", content: "Dup task", projectId: "p1" }, score: 0.93, nearIdentical: true })), degraded: "" }));
  return p;
}

test("failed Apply with nothing sent: preview stays applicable, held record removed, a later Keep cannot create from it", async () => {
  const p = chatPlugin();
  p.sendTodoistBatch = async () => { throw new Error("boom"); };
  const changes = { rows: [crow("Dup task"), crow("Other task")], snapshot: csnap };
  await assert.rejects(p.applyTodoistChanges(changes, ["row-0", "row-1"]), /boom/);
  assert.equal(changes.applyState, "");
  assert.equal((await p.loadDuplicateStore()).held.length, 0);
  assert.ok(p.logs.some(([m]) => /held duplicate rows removed/i.test(m)));
  p.sendTodoistBatch = Plugin.prototype.sendTodoistBatch;
  const again = await p.applyTodoistChanges(changes, ["row-0", "row-1"]);
  assert.notEqual(again.refused, true);
});

test("everything held and nothing to send: preview is applied and held record stays", async () => {
  const p = chatPlugin();
  p.sendTodoistBatch = async () => { throw new Error("must not send"); };
  const changes = { rows: [crow("Dup task")], snapshot: csnap };
  const r = await p.applyTodoistChanges(changes, ["row-0"]);
  assert.equal(r.held, 1); assert.equal(changes.applyState, "applied");
  assert.equal(storeOf(p).held.length, 1);
});

test("recurring chat row is not held against a one-off candidate; a one-off row is", async () => {
  const vectors = { "submit annual irgp report funder": [1, 0], "submit annual irgp report to funder": [0.95, Math.sqrt(1 - 0.95 * 0.95)] };
  const mk = () => {
    const p = chatPlugin(); p.findDuplicateHolds = Plugin.prototype.findDuplicateHolds;
    p.settings.embeddingModel = "embeddinggemma-2";
    p.embedTexts = async (texts) => texts.map((t) => vectors[String(t).toLowerCase()] || [0, 1]);
    p.getTodoistSnapshot = async () => ({ ...csnap, tasks: [{ id: "e1", content: "Submit annual IRGP report to funder", projectId: "p1", sectionId: "", parentId: "", dueDate: "2026-11-01", labels: [], priority: 1, description: "", isRecurring: false }] });
    return p;
  };
  const rec = mk(); const held = await rec.holdChatCreateRows([crow("Submit annual IRGP report funder", { dueDate: null, dueString: "every Monday" })], csnap);
  assert.equal(held.size, 0);
  const once = mk(); const held2 = await once.holdChatCreateRows([crow("Submit annual IRGP report funder", { dueDate: "2026-11-02" })], csnap);
  assert.equal(held2.size, 1);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${(error && error.stack || error).toString().split("\n").slice(0, 5).join("\n  ")}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exitCode = 1;
})();
