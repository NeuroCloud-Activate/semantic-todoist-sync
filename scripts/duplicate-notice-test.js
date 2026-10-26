// Duplicate check-off notice survives a closed sidebar; template sync failure after insert keeps held records.
// DUPBOX_MAIN lets a proposal copy of src/main.js be tested before it is merged.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const mainPath = process.env.DUPBOX_MAIN ? path.resolve(process.env.DUPBOX_MAIN) : path.join(__dirname, "..", "src/main.js");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.join(__dirname, "..", "src"));
const originalLoad = Module._load;
class FakeTFile {}
let FakeView;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class Empty { open() {} }
  FakeView = Empty;
  return { ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: class {}, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty, TFile: FakeTFile, setIcon() {}, requestUrl: async () => { throw new Error("network disabled in test"); } };
};
let Plugin;
try {
  global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
  testModule._compile(fs.readFileSync(mainPath, "utf8"), mainPath);
  Plugin = testModule.exports;
} finally { Module._load = originalLoad; }

const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const DIR = "plugin-dir";

function makePlugin() {
  const p = Object.create(Plugin.prototype);
  const files = {};
  p.logs = []; p.view = null;
  p.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { todoistToken: "tok", taskCache: {} });
  p.manifest = { dir: DIR };
  p.logLocal = (m, d) => p.logs.push([m, d]);
  p.app = {
    workspace: { getLeavesOfType: () => (p.view ? [{ view: p.view }] : []) },
    vault: {
      getAbstractFileByPath: () => new FakeTFile(),
      read: async () => "", modify: async () => {},
      adapter: {
        exists: async (f) => f in files,
        read: async (f) => { if (!(f in files)) throw new Error("ENOENT"); return files[f]; },
        write: async (f, t) => { files[f] = t; },
        remove: async (f) => { delete files[f]; },
        rename: async (a, b) => { files[b] = files[a]; delete files[a]; }
      }
    }
  };
  return p;
}
function makeView(posted) {
  const v = Object.create(Plugin.SemanticTodoistView?.prototype || FakeView.prototype);
  v.addMessage = (role, text) => posted.push(text);
  return v;
}

// ---- 1. check-off notice
test("closed sidebar: no message, onOpen posts exactly one", async () => {
  const p = makePlugin(); const posted = [];
  p.noticeDuplicateCheckOff("embeddings down");
  assert.equal(posted.length, 0);
  assert.ok(p.logs.some(([m]) => m === "Duplicate check is off"), "log line written");
  p.noticeDuplicateCheckOff("embeddings down");
  const view = makeView(posted);
  p.flushPendingDuplicateNotice(view);
  assert.equal(posted.length, 1);
  assert.match(posted[0], /Duplicate check is off.*embeddings down/);
  p.noticeDuplicateCheckOff("again");
  p.flushPendingDuplicateNotice(view);
  assert.equal(posted.length, 1, "never a second message");
});
test("open sidebar: one message immediately, none for a second degraded run", async () => {
  const p = makePlugin(); const posted = [];
  const view = makeView(posted); p.view = view;
  const orig = p.openSidebarView; 
  p.openSidebarView = () => view;
  p.noticeDuplicateCheckOff("x");
  assert.equal(posted.length, 1);
  p.noticeDuplicateCheckOff("y");
  assert.equal(posted.length, 1);
  assert.equal(p.logs.filter(([m]) => m === "Duplicate check is off").length, 1);
  void orig;
});

// ---- 2. template sync failure
function templatePlugin({ insert, syncThrows }) {
  const p = makePlugin();
  const task = { content: "New", oid: "N", subtasks: [] };
  p.duplicateStore = { version: 1, held: [{ id: "h1", createdAt: new Date().toISOString(), status: "pending", kind: "plan", source: { type: "note", path: "Notes/M.md", batchId: "b1" }, task, candidate: { id: "e1", content: "Old" }, score: 0.9, outcome: "" }], answers: [] };
  p.ensureCompatibleEmbeddingForChatModel = async () => {};
  p.requireAiAccess = () => {}; p.requireTodoistAccess = () => {};
  p.setSidebarStatus = () => {};
  p.beginProviderCapture = () => ({});
  p.createTaskPlanWithLocalActivity = async () => ({ sectionName: "S", tasks: [task] });
  p.prepareGeneratedTasksForTodoistWorkflow = async () => ({ batchId: "b1", sectionName: "S", sectionId: "sec" });
  p.savePendingTaskDescriptions = () => {}; p.savePendingTaskReferences = () => {};
  p.saveSettings = async () => {};
  p.cancelQueuedNoteSync = () => {}; p.markInternalNoteWrite = () => {};
  p.saveDuplicateStore = async () => {};
  p.loadDuplicateStore = async () => p.duplicateStore;
  p.syncFileNotes = async () => { if (syncThrows) throw new Error("sync boom"); };
  p.releaseHeldBatch = async () => {};
  const active = { path: "Notes/M.md", title: "M", text: "text" };
  return { p, run: () => p.generateTaskListFromTemplate({ name: "T", prompt: "", insertResponse: insert, syncAfterInsert: insert }, { active }) };
}
test("sync throws after insert: held records stay pending, one log line", async () => {
  const { p, run } = templatePlugin({ insert: true, syncThrows: true });
  await assert.rejects(run(), /sync boom/);
  assert.equal(p.duplicateStore.held.length, 1);
  assert.equal(p.duplicateStore.held[0].status, "pending");
  assert.equal(p.logs.filter(([m]) => m === "held duplicates kept for next load").length, 1);
});
test("insert never happened: batch is dropped (unchanged)", async () => {
  const { p, run } = templatePlugin({ insert: false, syncThrows: false });
  await run();
  assert.equal(p.duplicateStore.held.length, 0);
});
test("insert write itself fails: batch is dropped", async () => {
  const { p, run } = templatePlugin({ insert: true, syncThrows: false });
  p.app.vault.modify = async () => { throw new Error("write boom"); };
  await assert.rejects(run(), /write boom/);
  assert.equal(p.duplicateStore.held.length, 0);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`ok - ${name}`); } catch (e) { failed += 1; console.log(`not ok - ${name}\n  ${e.stack || e}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
})();
