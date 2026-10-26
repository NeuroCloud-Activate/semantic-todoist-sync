// Duplicate hold lifecycle: startup pass vs clicks, resume, store read errors, release saves, retired boxes, email log wording, pruning/caps.
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
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class Empty { open() {} }
  return { ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: class {}, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty, TFile: class {}, setIcon() {}, requestUrl: async () => { throw new Error("network disabled in test"); } };
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
const DIR = "plugin-dir", STORE = `${DIR}/duplicate-review.json`;
const DAY = 86400000;
const iso = (agoMs) => new Date(Date.now() - agoMs).toISOString();

function makePlugin(over = {}) {
  const p = Object.create(Plugin.prototype);
  const files = { ...(over.files || {}) };
  p.files = files; p.logs = []; p.ops = []; p.said = []; p.view = over.view || null;
  p.writeFailures = over.writeFailures || 0;
  p.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { todoistToken: "tok", taskCache: {}, enableAiAmbiguousTaskDeduplication: true }, over.settings || {});
  p.manifest = { dir: DIR };
  p.logLocal = (m, d) => p.logs.push([m, d]);
  p.addAssistantMessageIfViewOpen = (text) => p.said.push(text);
  p.refreshSidebarStatus = () => {};
  p.saveSettings = async () => {};
  p.app = {
    workspace: { getLeavesOfType: () => (p.view ? [{ view: p.view }] : []) },
    vault: {
      getAbstractFileByPath: () => ({ path: "x" }),
      adapter: {
        exists: async (f) => f in files,
        read: async (f) => { if (over.readError) throw new Error(over.readError); if (!(f in files)) throw new Error("ENOENT"); return files[f]; },
        write: async (f, t) => { if (p.writeFailures > 0 && f.endsWith(".tmp")) { p.writeFailures -= 1; throw new Error("disk full"); } files[f] = t; },
        remove: async (f) => { delete files[f]; },
        rename: async (a, b) => { p.ops.push(["rename", a, b]); files[b] = files[a]; delete files[a]; }
      }
    }
  };
  return p;
}
const rec = (over = {}) => ({ id: "h1", createdAt: iso(DAY), status: "waiting", kind: "plan", source: { type: "note", path: "Notes/M.md", batchId: "b1" }, task: { content: "New", oid: "N", subtasks: [] }, candidate: { id: "e1", content: "Old" }, score: 0.9, outcome: "", ...over });
const seed = (p, ...records) => { p.duplicateStore = { version: 1, held: records, answers: [] }; return p.duplicateStore; };

// ---- 1. startup pass vs a click
test("startup pass skips a record the user merged while the pass was busy on an earlier one", async () => {
  const p = makePlugin();
  seed(p, rec({ id: "A" }), rec({ id: "B" }));
  let release; const gate = new Promise((r) => { release = r; });
  const kept = [];
  p.getTodoistSnapshot = async () => ({ tasks: [], projects: [], sections: [] });
  p.keepHeldDuplicate = async (record) => { kept.push(record.id); if (record.id === "A") await gate; };
  p.mergeHeldDuplicate = async () => {};
  const pass = p.resolveUnansweredHeldDuplicates();
  await flush();
  assert.equal(await p.resolveHeldDuplicate("B", "merge", { by: "user" }), true);
  assert.equal(p.duplicateStore.held[1].status, "merged");
  release();
  await pass;
  assert.deepEqual(kept, ["A"], "B was never created separately");
  assert.equal(p.duplicateStore.held[1].status, "merged");
  assert.equal(p.duplicateStore.held[0].status, "unanswered");
});
test("startup pass still resolves records nobody touched", async () => {
  const p = makePlugin();
  seed(p, rec({ id: "A" }), rec({ id: "C", status: "kept", outcome: "x" }));
  const kept = [];
  p.getTodoistSnapshot = async () => ({});
  p.keepHeldDuplicate = async (record) => { kept.push(record.id); };
  await p.resolveUnansweredHeldDuplicates();
  assert.deepEqual(kept, ["A"]);
});

// ---- 2. resume a clicked Merge
test("a resolving Merge without mergeSent resumes as Merge (by resume), not an unanswered keep", async () => {
  const p = makePlugin();
  seed(p, rec({ id: "R", status: "resolving", answer: "merge" }));
  const calls = [];
  p.getTodoistSnapshot = async () => ({});
  p.mergeHeldDuplicate = async () => { calls.push("merge"); };
  p.keepHeldDuplicate = async () => { calls.push("keep"); };
  await p.resolveUnansweredHeldDuplicates();
  assert.deepEqual(calls, ["merge"]);
  assert.equal(p.duplicateStore.held[0].status, "merged");
  assert.equal(p.duplicateStore.held[0].answerBy, "resume");
});
test("a resumed Merge that fails goes back to waiting and is never kept automatically", async () => {
  const p = makePlugin();
  seed(p, rec({ id: "R", status: "resolving", answer: "merge" }));
  const calls = [];
  p.getTodoistSnapshot = async () => ({});
  p.mergeHeldDuplicate = async () => { throw new Error("the existing task is not open in Todoist"); };
  p.keepHeldDuplicate = async () => { calls.push("keep"); };
  await p.resolveUnansweredHeldDuplicates();
  assert.deepEqual(calls, []);
  assert.equal(p.duplicateStore.held[0].status, "waiting");
  assert.equal(p.duplicateStore.held[0].failed, true);
});

// ---- 3. read errors are not corruption
test("a read error keeps the file: no rename, saves blocked, one log line, one sidebar message", async () => {
  const text = '{"version":1,"held":[],"answers":[]}';
  const p = makePlugin({ files: { [STORE]: text }, readError: "EBUSY: resource busy" });
  const s = await p.loadDuplicateStore();
  await p.loadDuplicateStore();
  assert.deepEqual(s.held, []);
  assert.equal(p.ops.length, 0, "nothing renamed");
  assert.equal(p.duplicateSaveBlocked, true);
  await assert.rejects(p.saveDuplicateStore());
  assert.equal(p.files[STORE], text);
  assert.equal(p.logs.length, 1);
  assert.deepEqual(p.said, ["Held duplicate tasks could not be read; they are kept on disk and will load next time."]);
});
test("a successful read of bad content is still renamed to .corrupt and does not block saving", async () => {
  const p = makePlugin({ files: { [STORE]: "{not json" } });
  await p.loadDuplicateStore();
  assert.equal(p.ops.length, 1);
  assert.ok(!p.duplicateSaveBlocked);
  assert.deepEqual(p.said, []);
});

// ---- 4. release save failure, released marker
const pendingEmail = (over = {}) => rec({ id: "E1", status: "pending", source: { type: "email", path: "Emails/l.md", batchId: "eb1", emailSubject: "S" }, ...over });
test("release: one failed save is retried; two failures keep memory state and a later save persists released", async () => {
  const once = makePlugin({ writeFailures: 1 });
  seed(once, pendingEmail());
  once.judgeHeldDuplicates = async () => {};
  await once.releaseHeldBatch("eb1");
  assert.equal(JSON.parse(once.files[STORE]).held[0].source.released, true);

  const p = makePlugin({ writeFailures: 2 });
  seed(p, pendingEmail());
  p.judgeHeldDuplicates = async () => {};
  await p.releaseHeldBatch("eb1");
  assert.equal(p.duplicateStore.held[0].status, "checking");
  assert.equal(p.duplicateStore.held[0].source.released, true);
  assert.ok(!(STORE in p.files));
  assert.ok(p.logs.length >= 1);
  await p.saveDuplicateStore();
  assert.equal(JSON.parse(p.files[STORE]).held[0].source.released, true);
});
test("startup: pending email record with released is kept (waiting); one without is dropped", async () => {
  const p = makePlugin();
  seed(p, pendingEmail(), pendingEmail({ id: "E2", source: { type: "email", batchId: "eb2" } }));
  p.duplicateStore.held[0].source.released = true;
  p.getTodoistSnapshot = async () => ({});
  const kept = [];
  p.keepHeldDuplicate = async (record) => { kept.push(record.id); };
  await p.resolveUnansweredHeldDuplicates();
  assert.deepEqual(p.duplicateStore.held.map((r) => r.id), ["E1"]);
  assert.deepEqual(kept, ["E1"]);
});

// ---- 5. retired boxes
test("judge: a record removed from the store during the AI call gets no box and no resolve", async () => {
  const p = makePlugin();
  const record = rec({ status: "checking", ai: null });
  seed(p, record);
  let answer; p.openaiResponse = () => new Promise((r) => { answer = r; });
  let posted = 0, resolved = 0;
  p.postDuplicateReviewBox = async () => { posted += 1; };
  p.resolveHeldDuplicate = async () => { resolved += 1; };
  const judging = p.judgeHeldDuplicate(record);
  await flush();
  p.duplicateStore.held = [];
  answer(JSON.stringify({ verdict: "unsure", confidence: 0.5, reason: "x" }));
  await judging;
  assert.equal(posted + resolved, 0);
});
test("judge: a record still in the store is boxed as before", async () => {
  const p = makePlugin();
  const record = rec({ status: "checking", ai: null });
  seed(p, record);
  p.openaiResponse = async () => JSON.stringify({ verdict: "unsure", confidence: 0.5, reason: "x" });
  let posted = 0;
  p.postDuplicateReviewBox = async () => { posted += 1; };
  await p.judgeHeldDuplicate(record);
  assert.equal(posted, 1);
});
test("failed Apply removes the retired held records' boxes from the open view", async () => {
  const view = Object.create(Plugin.SemanticTodoistView.prototype);
  view.messages = [{ role: "assistant", text: "hi" }]; view.renderMessages = () => {};
  const p = makePlugin({ view });
  view.plugin = p;
  const snap = { tasks: [], projects: [{ id: "p1", name: "Home" }], sections: [{ id: "s1", name: "Later", projectId: "p1" }] };
  const row = (content) => ({ op: "create", fields: { content, description: "d", priority: 3, dueDate: "2026-11-02", labels: [] }, target: { projectId: "p1", sectionId: "s1", parentId: "" }, newLabels: [] });
  p.getTodoistSnapshot = async () => snap;
  p.requireTodoistAccess = () => {};
  p.refreshTodoistLines = () => {};
  p.noticeDuplicateCheckOff = () => {};
  p.setSidebarStatus = () => {};
  p.settings.enableTaskDeduplication = true;
  p.findDuplicateHolds = async (tasks) => ({ holds: tasks.filter((t) => t.content === "Dup task").map((task) => ({ task, candidate: { id: "e1", content: "Dup task", projectId: "p1" }, score: 0.93, nearIdentical: true })), degraded: "" });
  p.judgeHeldDuplicates = async (records) => { for (const r of records) view.upsertDuplicateReviewBox(r, "t"); };
  p.sendTodoistBatch = async () => { throw new Error("boom"); };
  await assert.rejects(p.applyTodoistChanges({ rows: [row("Dup task"), row("Other")], snapshot: snap }, ["row-0", "row-1"]), /boom/);
  assert.equal(view.messages.filter((m) => m.kind === "duplicate-review").length, 0);
  assert.equal(view.messages.length, 1, "other messages stay");
});

// ---- 6. email log wording
async function emailLog(extra) {
  const p = makePlugin();
  let body = "";
  p.app.vault.createFolder = async () => {};
  p.app.vault.create = async (f, t) => { body = t; return { path: f }; };
  p.markInternalNoteWrite = () => {};
  p.cacheLoggedTasks = async () => 0;
  p.syncFileNotes = async () => ({});
  p.queueSemanticIndexUpdate = () => ({ queued: 0 });
  p.app.vault.getAbstractFileByPath = () => null;
  await p.appendEmailLog({ subject: "S", from: "a@b.c", receivedAt: "2026-10-12T09:30:00.000Z", cloudflareReceivedAt: "2026-10-12T09:31:00.000Z", sectionName: "Sec", tasks: [], summary: "", ...extra });
  return body;
}
test("email log: all tasks held says they wait for an answer; none held keeps the old line", async () => {
  assert.ok((await emailLog({ heldCount: 2 })).includes("- 2 task(s) are waiting for a duplicate answer in the sidebar."));
  assert.ok(!(await emailLog({ heldCount: 2 })).includes("No actionable tasks"));
  assert.ok((await emailLog({})).includes("- No actionable tasks were found."));
});

// ---- 7. surviving mutants
test("resume with mergeSent sends no Todoist update", async () => {
  const p = makePlugin();
  seed(p, rec({ id: "R", status: "resolving", answer: "merge", mergeSent: true }));
  const remote = { id: "e1", content: "Old", description: "", labels: [], priority: 1, dueDate: "", projectId: "p1", sectionId: "", parentId: "", isCompleted: false };
  p.getTodoistSnapshot = async () => ({ tasks: [remote], projects: [], sections: [] });
  let updates = 0, syncs = 0;
  p.updateTodoistFromParsedTask = async () => { updates += 1; return true; };
  p.todoistSync = async () => { syncs += 1; return {}; };
  p.writeCreatedTaskLines = async () => [];
  await p.resolveUnansweredHeldDuplicates();
  assert.equal(p.duplicateStore.held[0].status, "merged", JSON.stringify(p.logs));
  assert.equal(updates, 0);
  assert.equal(syncs, 0);
});
test("startup prunes finished records older than 30 days and keeps 29-day-old ones", async () => {
  const p = makePlugin();
  seed(p, rec({ id: "old", status: "kept", createdAt: iso(31 * DAY) }), rec({ id: "new", status: "kept", createdAt: iso(29 * DAY) }));
  await p.resolveUnansweredHeldDuplicates();
  assert.deepEqual(p.duplicateStore.held.map((r) => r.id), ["new"]);
});
test("after 2001 answers the store holds the newest 2000", async () => {
  const p = makePlugin();
  seed(p);
  for (let i = 0; i < 2001; i++) await p.recordDuplicateAnswer(rec({ id: `h${i}` }), "keep", "user");
  assert.equal(p.duplicateStore.answers.length, 2000);
  assert.equal(p.duplicateStore.answers[0].heldId, "h1");
  assert.equal(p.duplicateStore.answers[1999].heldId, "h2000");
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
