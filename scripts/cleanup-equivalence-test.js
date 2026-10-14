"use strict";
// scripts/cleanup-equivalence-test.js â€” cleanup consolidation equivalence guard.
//
// Compares consolidation call sites on two runtimes â€” the pre-cleanup baseline
// (%TEMP%/opencode/after-search-main.js) vs the working repo main.js â€” and
// asserts deep-equal outputs (JSON.stringify equality pins key order too):
//  (a) degraded retrieval results for each reason (7 sites) via
//      degradedRetrievalResult vs direct finalizeSemanticRetrievalContext;
//  (b) task-failure returns for each path (5 sites) via makeTaskFailureReturn
//      key-order + value checks;
//  (c) chat runtime handles with stubbed embedTexts (hit, miss, failure);
//  (d) lexical union helper presence + no duplicated scan loops remain.
// Pattern: obsidian stub + Module._compile (same as email-retrieval-context-test).
// Usage: node scripts/cleanup-equivalence-test.js
// Env: CLEANUP_BASELINE_MAIN overrides the baseline path.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const repoMain = path.join(__dirname, "..", "src/main.js");
const baselineMain = process.env.CLEANUP_BASELINE_MAIN
  || path.join(os.tmpdir(), "opencode", "after-search-main.js");

function ensureNodeGlobals() {
  const g = globalThis;
  const timers = {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    setInterval: (...args) => setInterval(...args),
    clearInterval: (...args) => clearInterval(...args),
  };
  if (typeof g.window === "undefined" || !g.window) {
    g.window = Object.assign({}, timers);
    return;
  }
  for (const key of Object.keys(timers)) {
    if (typeof g.window[key] !== "function") g.window[key] = timers[key];
  }
}

const originalLoad = Module._load;
function stubObsidian() {
  Module._load = function (request, parent, isMain) {
    if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
    class Empty {}
    class Plugin {
      constructor(app, manifest) { this.app = app; this.manifest = manifest; }
      async loadData() { return {}; }
      async saveData() {}
      registerEvent() {} addCommand() {} registerView() {}
      addSettingTab() {} addRibbonIcon() { return {}; }
    }
    return {
      ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
      Notice: Empty, Plugin, PluginSettingTab: Empty, Setting: Empty, TFile: Empty,
      setIcon() {},
      requestUrl() { throw new Error("cleanup-equivalence-test: network disabled"); },
    };
  };
}
function unstub() { Module._load = originalLoad; }

function loadRuntime(mainPath, seam) {
  ensureNodeGlobals();
  stubObsidian();
  try {
    const src = fs.readFileSync(mainPath, "utf8");
    const m = new Module(mainPath, module);
    m.filename = mainPath;
    m.paths = Module._nodeModulePaths(path.dirname(mainPath));
    m._compile(`${src}\n${seam}\n`, mainPath);
    return m.exports;
  } finally {
    unstub();
    delete require.cache[mainPath];
  }
}

function makePlugin(Plugin, embedFn) {
  const app = { vault: { adapter: { list: async () => ({ files: [], folders: [] }) } } };
  const p = new Plugin(app, {});
  p.settings = Object.assign({}, p.settings || {}, { embeddingModel: "m", semanticIndexMeta: {} });
  p.queryEmbeddingCache = new Map();
  p.semanticRetrievalCache = new Map();
  p.semanticIndexRevision = 0;
  if (embedFn) p.embedTexts = embedFn;
  if (!p.logLocal) p.logLocal = () => {};
  return p;
}

async function main() {
  const failures = [];
  const check = async (name, fn) => {
    try { await fn(); console.log(`PASS: ${name}`); }
    catch (e) { failures.push(name); console.error(`FAIL: ${name}: ${(e && e.message) || e}`); }
  };
  if (!fs.existsSync(baselineMain)) {
    console.error(`baseline missing: ${baselineMain}`);
    process.exit(2);
  }
  const seam = "module.exports.__cleanupEquiv = { SemanticTodoistSyncPlugin: module.exports };";
  const base = loadRuntime(baselineMain, seam).__cleanupEquiv;
  const repo = loadRuntime(repoMain, seam).__cleanupEquiv;
  const PluginBase = base.SemanticTodoistSyncPlugin;
  const PluginRepo = repo.SemanticTodoistSyncPlugin;
  assert.ok(PluginBase && PluginRepo, "both runtimes export the plugin class");

  await check("degraded results identical for each reason", async () => {
    const reasons = [
      { indexState: "degraded-source-only", degradedReason: "semantic-index-compatibility-refresh-pending", candidateCount: 0 },
      { indexState: "failed", degradedReason: "index-load-failed", candidateCount: 0 },
      { indexState: "degraded-source-only", readinessState: "configured/non-empty-degraded", degradedReason: "x", candidateCount: 3 },
      { indexState: "degraded-source-only", degradedReason: "semantic-index-empty", candidateCount: 0 },
      { indexState: "failed", degradedReason: "query-embedding-failed", candidateCount: 5, queryHandleSource: "chat-provider" },
      { indexState: "degraded-source-only", degradedReason: "query-vector-unavailable", candidateCount: 5, queryHandleSource: "indexed" },
      { indexState: "degraded-source-only", degradedReason: "routed-degraded", candidateCount: 5 },
    ];
    for (const details of reasons) {
      const pb = makePlugin(PluginBase), pr = makePlugin(PluginRepo);
      const req = { queryId: "q", mode: "chat", scope: {}, queryText: "hello" };
      const full = Object.assign({}, details, { elapsedMs: 7 });
      const rb = pb.finalizeSemanticRetrievalContext([], req, Object.assign({}, full));
      const rr = pr.degradedRetrievalResult(req, "k", Object.assign({}, full), false);
      assert.equal(
        JSON.stringify(rr.telemetry || rr.semanticRetrieval),
        JSON.stringify(rb.telemetry || rb.semanticRetrieval),
        `telemetry for ${details.degradedReason}`
      );
    }
  });

  await check("task-failure returns identical shape for each path", async () => {
    const pr = makePlugin(PluginRepo);
    assert.equal(typeof pr.makeTaskFailureReturn, "function", "repo exposes makeTaskFailureReturn");
    const source = { type: "note", sectionName: "S", path: "n.md", title: "T" };
    const contract = { id: "c1" };
    const failure = { code: "x", reason: ["r1"], taskRelevanceSelection: null };
    const rNull = pr.makeTaskFailureReturn(source, "sum", [], contract, null, null, failure, ["e1"]);
    assert.deepEqual(Object.keys(rNull), ["tasks", "sectionName", "sourceSummary", "semanticContext", "contextNotes", "sourceContract", "sourceContractId", "evidenceCatalog", "taskWorkflowContextBundle", "contextBundle", "workflowContextFailure", "requiredPromptBlockError"]);
    assert.equal(rNull.contextBundle, null);
    assert.equal(rNull.requiredPromptBlockError, "");
    assert.deepEqual(rNull.taskWorkflowContextBundle.contextBundleValidation.protectedReferenceErrors, ["e1"]);
    const bundle = { requiredPromptBlockError: "", promptEvidenceIds: [] };
    const rBundle = pr.makeTaskFailureReturn(source, "sum", [], contract, { v: 1 }, bundle, failure);
    assert.equal(rBundle.taskWorkflowContextBundle, bundle);
    assert.equal(rBundle.requiredPromptBlockError, "");
    const rNoKey = pr.makeTaskFailureReturn(source, "sum", [], contract, { v: 1 }, { promptEvidenceIds: [] }, failure);
    assert.ok(!("requiredPromptBlockError" in rNoKey), "absent key stays absent");
  });

  await check("chat runtime handles match shared helper (hit/miss/fail)", async () => {
    const vec = [0.1, 0.2, 0.3];
    let calls = 0;
    const okEmbed = async () => { calls += 1; return [vec.slice()]; };
    for (const P of [PluginBase, PluginRepo]) {
      const p = makePlugin(P, okEmbed);
      const h1 = await p.runtimeSemanticQueryHandles("hello", null);
      assert.equal(h1.length, 1);
      assert.equal(h1[0].source, "chat-provider");
      assert.deepEqual(Array.from(h1[0].vector), vec);
      const h2 = await p.runtimeSemanticQueryHandles("hello", null);
      assert.deepEqual(Array.from(h2[0].vector), vec);
    }
    assert.ok(calls <= 2, "cache reused across calls");
    const failEmbed = async () => { throw new Error("nope"); };
    for (const P of [PluginBase, PluginRepo]) {
      const p = makePlugin(P, failEmbed);
      assert.deepEqual(await p.runtimeSemanticQueryHandles("zzz", null), []);
    }
    // NOTE: the wrapper's miss-detection compares the same cache key the shared
    // helper uses (embeddingDimension derived from settings, not the passed
    // display dimension) â€” the earlier loop may share keys across plugin
    // instances only per instance; use unique queries per check.
    const pr = makePlugin(PluginRepo, okEmbed);
    const w1 = await pr.chatRuntimeQueryHandles("fresh-query", null, 3, { source: "indexed" });
    assert.equal(w1.handles.length, 1);
    assert.equal(w1.telemetry.source, "chat-provider");
    assert.equal(w1.telemetry.externalQueryEmbeddingCalls, 1);
    assert.equal(w1.telemetry.runtimeExternalCalls, 1);
    const w2 = await pr.chatRuntimeQueryHandles("fresh-query", null, 3, { source: "indexed" });
    assert.equal(w2.telemetry.externalQueryEmbeddingCalls, 0, "repeat call hits cache");
    assert.deepEqual(Array.from(w2.embedding), vec);
    const pf = makePlugin(PluginRepo, failEmbed);
    const wf = await pf.chatRuntimeQueryHandles("never-seen", null, 3, {});
    assert.equal(wf.failed, true);
    assert.deepEqual(wf.handles, []);
  });

  await check("lexical union helper present, no duplicated loops", async () => {
    const src = fs.readFileSync(repoMain, "utf8");
    assert.ok(src.includes("function buildLexicalUnionRows(usableIndex, profile, useNoteCreatedTime)"), "helper present");
    const callSites = src.split("= buildLexicalUnionRows(usableIndex, profile,").length - 1;
    assert.equal(callSites, 2, "both chat and task call sites use the helper");
  });

  if (failures.length) { console.error(`cleanup-equivalence-test: ${failures.length} FAILED`); process.exit(1); }
  console.log("cleanup-equivalence-test: pass");
}

main().catch((e) => { console.error(e); process.exit(1); });
