// Duplicate-review store I/O, title-vector cache, resume/in-flight safety, newChat restore, startup scheduling.
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
const DIR = "plugin-dir", STORE = `${DIR}/duplicate-review.json`, VECS = `${DIR}/task-title-vectors.json`;

function makePlugin(over = {}) {
  const p = Object.create(Plugin.prototype);
  const files = { ...(over.files || {}) };
  const ops = [];
  p.files = files; p.ops = ops; p.logs = [];
  p.settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { todoistToken: "tok", taskCache: {}, embeddingModel: "m1" });
  p.manifest = { dir: DIR };
  p.logLocal = (m, d) => p.logs.push([m, d]);
  const delay = over.writeDelay ? () => new Promise((r) => setTimeout(r, over.writeDelay)) : async () => {};
  p.app = {
    workspace: { getLeavesOfType: () => (p.view ? [{ view: p.view }] : []) },
    vault: {
      getAbstractFileByPath: (q) => (over.existing || []).includes(q) ? { path: q } : null,
      adapter: {
        exists: async (f) => f in files,
        read: async (f) => { if (!(f in files)) throw new Error("ENOENT"); if (over.readFails) throw new Error("EIO"); return files[f]; },
        write: async (f, t) => { ops.push(["write:start", f]); await delay(); files[f] = t; ops.push(["write:end", f]); },
        remove: async (f) => { ops.push(["remove", f]); delete files[f]; },
        rename: async (a, b) => { ops.push(["rename", a, b]); if (over.renameFails) throw new Error("locked"); files[b] = files[a]; delete files[a]; }
      }
    }
  };
  p.refreshSidebarStatus = () => {};
  return p;
}
const record = (over = {}) => ({ id: "h1", createdAt: "2026-10-25T10:00:00.000Z", status: "waiting", kind: "plan", source: { type: "note", path: "Notes/Meeting.md", batchId: "b1" }, task: { content: "New", oid: "N" }, candidate: { id: "e1", content: "Old" }, score: 0.9, outcome: "", ...over });
const storeOf = (p) => JSON.parse(p.files[STORE]);

// ---- 1. corrupt / missing store
test("missing store file: empty store, nothing renamed", async () => {
  const p = makePlugin();
  const s = await p.loadDuplicateStore();
  assert.deepEqual(s.held, []);
  assert.equal(p.ops.length, 0);
});
test("corrupt store: file kept under a .corrupt-<timestamp> name, bytes intact, start empty, no write before rename", async () => {
  const p = makePlugin({ files: { [STORE]: "{not json" } });
  const s = await p.loadDuplicateStore();
  assert.deepEqual(s.held, []);
  const kept = Object.keys(p.files).filter((f) => /duplicate-review\.corrupt-.+\.json$/.test(f));
  assert.equal(kept.length, 1);
  assert.equal(p.files[kept[0]], "{not json");
  assert.ok(!(STORE in p.files));
  assert.ok(p.ops.every((o) => o[0] === "rename"), "only the rename touched disk");
  assert.equal(p.logs.length, 1);
});
test("unreadable store (read error) is kept too; a wrong-shape store counts as corrupt", async () => {
  const p = makePlugin({ files: { [STORE]: "{}".replace("{}", '{"held":"x"}') } });
  await p.loadDuplicateStore();
  assert.ok(Object.keys(p.files).some((f) => f.includes("corrupt")));
  const q = makePlugin({ files: { [STORE]: '{"held":[]}' }, readFails: true });
  await q.loadDuplicateStore();
  assert.ok(!Object.keys(q.files).some((f) => f.includes("corrupt")), "a read error is not corruption");
  assert.equal(q.duplicateSaveBlocked, true);
});
test("corrupt store and rename fails: every save is blocked, original bytes untouched", async () => {
  const p = makePlugin({ files: { [STORE]: "garbage" }, renameFails: true });
  const s = await p.loadDuplicateStore();
  s.held.push(record());
  await assert.rejects(p.saveDuplicateStore());
  assert.equal(p.files[STORE], "garbage");
  assert.ok(!p.ops.some((o) => o[0].startsWith("write")));
});

// ---- 2. memoised load, serialised atomic save
test("two concurrent first loads share one store object", async () => {
  const p = makePlugin({ files: { [STORE]: JSON.stringify({ version: 1, held: [record()], answers: [] }) } });
  const [a, b] = await Promise.all([p.loadDuplicateStore(), p.loadDuplicateStore()]);
  assert.equal(a, b);
  assert.equal(a.held.length, 1);
  assert.equal(await p.loadDuplicateStore(), a);
});
test("save writes a .tmp then replaces the target (old file never left half-written)", async () => {
  const p = makePlugin({ files: { [STORE]: JSON.stringify({ version: 1, held: [], answers: [] }) } });
  (await p.loadDuplicateStore()).held.push(record());
  await p.saveDuplicateStore();
  assert.deepEqual(p.ops.map((o) => o[0] + ":" + (o[1] || "").split("/").pop()), ["write:start:duplicate-review.json.tmp", "write:end:duplicate-review.json.tmp", "remove:duplicate-review.json", "rename:duplicate-review.json.tmp"]);
  assert.equal(storeOf(p).held.length, 1);
  assert.ok(!(`${STORE}.tmp` in p.files));
});
test("startup finds a store that only exists as .tmp (crash between remove and rename)", async () => {
  const p = makePlugin({ files: { [`${STORE}.tmp`]: JSON.stringify({ version: 1, held: [record()], answers: [] }) } });
  assert.equal((await p.loadDuplicateStore()).held.length, 1);
});
test("5 concurrent saves: one write at a time, last write holds the final state", async () => {
  const p = makePlugin({ writeDelay: 5, files: { [STORE]: JSON.stringify({ version: 1, held: [], answers: [] }) } });
  const s = await p.loadDuplicateStore();
  const saves = [];
  for (let i = 0; i < 5; i++) { s.held.push(record({ id: `h${i}` })); saves.push(p.saveDuplicateStore()); }
  await Promise.all(saves);
  let open = 0, max = 0;
  for (const o of p.ops) { if (o[0] === "write:start") max = Math.max(max, ++open); if (o[0] === "write:end") open--; }
  assert.equal(max, 1);
  assert.equal(storeOf(p).held.length, 5);
  assert.ok(p.ops.filter((o) => o[0] === "write:start").length <= 2, "later calls coalesced into one follow-up");
});

// ---- 3. title vector cache
const unit = (vec) => async () => [vec];
test("vectors are stored as base64 and read back equal to the rounded vector", async () => {
  const p = makePlugin();
  p.embedTexts = async (texts) => texts.map(() => [0.1234567, -0.5, 3]);
  const vectorOf = await p.embedDuplicateTitles(["Hello"]);
  await flush();
  const file = JSON.parse(p.files[VECS]);
  assert.equal(typeof file.vectors.hello.v, "string");
  assert.ok(!Array.isArray(file.vectors.hello));
  const q = makePlugin({ files: { [VECS]: p.files[VECS] } });
  q.embedTexts = async () => { throw new Error("must not embed"); };
  assert.deepEqual((await q.embedDuplicateTitles(["hello"]))("hello"), [0.123457, -0.5, 3]);
  assert.deepEqual(vectorOf("Hello"), [0.123457, -0.5, 3]);
});
test("old number-array cache files are still read", async () => {
  const p = makePlugin({ files: { [VECS]: JSON.stringify({ model: "m1", vectors: { hello: [0.5, 0.25] } }) } });
  p.embedTexts = async () => { throw new Error("must not embed"); };
  assert.deepEqual((await p.embedDuplicateTitles(["Hello"]))("hello"), [0.5, 0.25]);
});
const bigCache = (n, extra = {}) => {
  const vectors = {};
  for (let i = 0; i < n; i++) vectors[`k${i}`] = { v: "AAAAPw==", usedAt: "2026-01-01" };
  return JSON.stringify({ model: "m1", vectors: { ...vectors, ...extra } });
};
test("eviction keeps at most 2000 and never drops a title used in this call", async () => {
  const p = makePlugin({ files: { [VECS]: bigCache(2000) } });
  p.embedTexts = async (texts) => texts.map(() => [1]);
  const vectorOf = await p.embedDuplicateTitles(["brand new", "k0"]); // k0 is old but in use now
  await flush();
  const keys = Object.keys(JSON.parse(p.files[VECS]).vectors);
  assert.equal(keys.length, 2000);
  assert.ok(keys.includes("brand new") && keys.includes("k0"));
  assert.ok(vectorOf("k0") && vectorOf("brand new"));
});
test("a numeric-looking title is evicted by least-recent use, not because it sorts first", async () => {
  const p = makePlugin({ files: { [VECS]: bigCache(1999, { "5": { v: "AAAAPw==", usedAt: "2026-10-24" } }) } });
  p.embedTexts = async (texts) => texts.map(() => [1]);
  await p.embedDuplicateTitles(["fresh one", "fresh two"]);
  await flush();
  const keys = Object.keys(JSON.parse(p.files[VECS]).vectors);
  assert.equal(keys.length, 2000);
  assert.ok(keys.includes("5"), "recently used numeric title survives");
  assert.ok(!keys.includes("k0") && !keys.includes("k1"), "oldest-used titles went");
});
test("cache write is not awaited, and a failed write is only logged", async () => {
  const p = makePlugin();
  p.app.vault.adapter.write = () => new Promise(() => {}); // never resolves
  p.embedTexts = async (texts) => texts.map(() => [1]);
  await p.embedDuplicateTitles(["a"]); // would hang if awaited
  const q = makePlugin();
  q.app.vault.adapter.write = async () => { throw new Error("disk full"); };
  q.embedTexts = async (texts) => texts.map(() => [1]);
  await q.embedDuplicateTitles(["a"]);
  await flush();
  assert.ok(q.logs.some((l) => l[0] === "Title vector cache not saved"));
});
test("chunks embedded before a later chunk fails are kept, then the error is rethrown", async () => {
  const p = makePlugin();
  let calls = 0;
  p.embedTexts = async (texts) => { if (++calls === 2) throw new Error("embedder down"); return texts.map(() => [1]); };
  const titles = Array.from({ length: 101 }, (_, i) => `title ${i}`);
  await assert.rejects(p.embedDuplicateTitles(titles), /embedder down/);
  await flush();
  assert.equal(Object.keys(JSON.parse(p.files[VECS]).vectors).length, 100);
});

// ---- 4. resume / in-flight
function resolvePlugin(records, over = {}) {
  const p = makePlugin(over);
  p.duplicateStore = { version: 1, held: records, answers: [] };
  p.duplicateSessionStart = "2026-10-26T00:00:00.000Z";
  p.calls = { keep: [], merge: [], snap: [] };
  p.getTodoistSnapshot = async (kinds, force) => { p.calls.snap.push(force); return {}; };
  p.keepHeldDuplicate = async (r) => { p.calls.keep.push({ id: r.id, source: { ...r.source }, savedAnswer: p.files[STORE] && JSON.parse(p.files[STORE]).held.find((h) => h.id === r.id)?.answer, status: r.status }); };
  p.mergeHeldDuplicate = async (r) => { p.calls.merge.push(r.id); };
  return p;
}
test("a resolve saves record.answer first; Merge asks for a fresh snapshot, Keep may use the cached one", async () => {
  const p = resolvePlugin([record({ id: "a" }), record({ id: "b" })]);
  assert.equal(await p.resolveHeldDuplicate("a", "keep"), true);
  assert.equal(await p.resolveHeldDuplicate("b", "merge"), true);
  assert.deepEqual(p.calls.snap, [false, true]);
  assert.equal(p.calls.keep[0].savedAnswer, "keep");
  assert.equal(p.calls.keep[0].status, "resolving");
  assert.equal(p.duplicateInFlight.size, 0);
});
test("an in-flight record id is skipped by the startup pass", async () => {
  const p = resolvePlugin([record({ id: "a", status: "resolving", answer: "keep" })]);
  p.duplicateInFlight = new Set(["a"]);
  await p.resolveUnansweredHeldDuplicates();
  assert.equal(p.calls.keep.length, 0);
  assert.equal(p.duplicateStore.held[0].status, "resolving");
});
test("startup: resolving + saved keep finishes as keep", async () => {
  const p = resolvePlugin([record({ id: "a", status: "resolving", answer: "keep" })]);
  await p.resolveUnansweredHeldDuplicates();
  assert.equal(p.calls.keep.length, 1);
  assert.equal(p.duplicateStore.held[0].status, "kept");
});
test("startup: resolving + merge with mergeSent finishes the merge", async () => {
  const p = resolvePlugin([record({ id: "a", status: "resolving", answer: "merge", mergeSent: true })]);
  await p.resolveUnansweredHeldDuplicates();
  assert.deepEqual(p.calls.merge, ["a"]);
  assert.equal(p.calls.keep.length, 0);
  assert.equal(p.duplicateStore.held[0].status, "merged");
});
test("startup: resolving + merge without mergeSent, or no saved answer, is an unanswered keep", async () => {
  const p = resolvePlugin([record({ id: "a", status: "resolving", answer: "merge" }), record({ id: "b", status: "resolving" }), record({ id: "c", status: "waiting" })]);
  await p.resolveUnansweredHeldDuplicates();
  assert.deepEqual(p.calls.merge, ["a"], "a clicked Merge resumes as Merge");
  assert.equal(p.calls.keep.length, 2);
  assert.deepEqual(p.duplicateStore.held.map((h) => h.status), ["merged", "unanswered", "unanswered"]);
});
test("startup: pending email record is dropped with a log line; pending note record is an unanswered keep", async () => {
  const p = resolvePlugin([record({ id: "e", status: "pending", source: { type: "email", batchId: "b9" } }), record({ id: "n", status: "pending" }), record({ id: "t", status: "pending", source: { type: "template" } })]);
  await p.resolveUnansweredHeldDuplicates();
  assert.deepEqual(p.duplicateStore.held.map((h) => [h.id, h.status]), [["n", "unanswered"], ["t", "unanswered"]]);
  assert.ok(p.logs.some((l) => /Dropped held email/.test(l[0])));
  assert.equal(p.calls.keep.length, 2);
});
test("startup leaves this session's own pending records alone", async () => {
  const p = resolvePlugin([record({ id: "n", status: "pending", createdAt: "2026-10-27T00:00:00.000Z" })]);
  await p.resolveUnansweredHeldDuplicates();
  assert.equal(p.calls.keep.length, 0);
  assert.equal(p.duplicateStore.held[0].status, "pending");
});

// ---- 5. newChat
test("newChat brings waiting duplicate boxes back", async () => {
  const p = makePlugin();
  p.duplicateStore = { version: 1, held: [record({ id: "w", status: "waiting" })], answers: [] };
  p.duplicateReviewText = () => "text";
  const view = Object.create(Plugin.SemanticTodoistView.prototype);
  view.plugin = p; view.messages = []; view.shown = [];
  view.renderMessages = () => {}; view.renderRelevantNotes = () => {}; view.setStatus = () => {};
  view.hasDuplicateReviewBox = (id) => view.shown.includes(id);
  view.upsertDuplicateReviewBox = (r) => view.shown.push(r.id);
  view.newChat();
  await flush();
  assert.deepEqual(view.shown, ["w"]);
});

// ---- 6. plan Keep both with a deleted source note
test("plan keep: a source note that no longer exists is cleared so lines go to the monthly note", async () => {
  const p = resolvePlugin([record({ id: "a" })]);
  await p.resolveHeldDuplicate("a", "keep");
  assert.equal(p.calls.keep[0].source.path, "");
  assert.equal(p.logs.filter((l) => /source note is gone/.test(l[0])).length, 1);
});
test("plan keep: an existing source note is left alone; chat records are never touched", async () => {
  const p = resolvePlugin([record({ id: "a" }), record({ id: "c", kind: "chat", source: { type: "chat", path: "Gone.md" } })], { existing: ["Notes/Meeting.md"] });
  await p.resolveHeldDuplicate("a", "keep");
  await p.resolveHeldDuplicate("c", "keep");
  assert.equal(p.calls.keep[0].source.path, "Notes/Meeting.md");
  assert.equal(p.calls.keep[1].source.path, "Gone.md");
});

// ---- 7. startup scheduling
test("startup pass: not scheduled without a Todoist token; scheduled exactly once with one", () => {
  const timers = [];
  const saved = global.window.setTimeout;
  global.window.setTimeout = (fn, ms) => { timers.push([fn, ms]); return timers.length; };
  try {
    const p = makePlugin();
    p.registerInterval = (id) => id;
    p.settings.todoistToken = "";
    assert.equal(p.scheduleUnansweredDuplicatePass(), false);
    assert.equal(timers.length, 0);
    p.settings.todoistToken = "tok";
    let ran = 0;
    p.resolveUnansweredHeldDuplicates = async () => { ran++; };
    assert.equal(p.scheduleUnansweredDuplicatePass(), true);
    assert.equal(timers.length, 1);
    timers[0][0]();
    assert.equal(ran, 1);
  } finally { global.window.setTimeout = saved; }
  const onload = fs.readFileSync(mainPath, "utf8");
  assert.equal((onload.match(/this\.scheduleUnansweredDuplicatePass\(\)/g) || []).length, 1, "onload calls it once");
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
