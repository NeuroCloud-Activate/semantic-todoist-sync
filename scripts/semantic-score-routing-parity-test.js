"use strict";

// Provider-free routing contract: background scoring must preserve the
// pre-change retrieval result while covering route rows and required rows.
// The in-memory pool stub isolates routing; the worker-pool suite separately
// checks the production pool, transfers, fallback and disposal behavior.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

const root = path.resolve(__dirname, "..");
const baselinePath = process.env.SEMANTIC_SCORE_BASELINE_MAIN ? path.resolve(process.env.SEMANTIC_SCORE_BASELINE_MAIN) : "";
const candidatePath = path.join(root, "main.js");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return {
    ItemView: Empty,
    MarkdownRenderer: {},
    MarkdownView: Empty,
    Modal: Empty,
    Notice: Empty,
    Plugin: Empty,
    PluginSettingTab: Empty,
    Setting: Empty,
    TFile: Empty,
    setIcon() {},
    requestUrl() { throw new Error("Network disabled in semantic score routing parity test."); }
  };
};
global.window = global;
global.fetch = async () => { throw new Error("Network disabled in semantic score routing parity test."); };

function helperStubSource() {
  return `
function createSemanticScoreWorkerPool() {
  const state = globalThis.__semanticScoreRoutingTestState;
  if (!state) throw new Error("semantic-score-test-state-missing");
  state.created += 1;
  let disposed = false;
  let pending = null;
  const disposedError = () => Object.assign(new Error("semantic score pool disposed"), { code: "semantic-scoring-disposed" });
  const pool = {
    async scorePairs(pairs) {
      if (disposed) throw disposedError();
      const captured = pairs.map(([query, evidence]) => [query, evidence]);
      state.pairs.push(...captured);
      if (typeof state.beforeBatch === "function") state.beforeBatch(captured, state.currentInstance);
      if (state.blockNextBatch) {
        state.blockNextBatch = false;
        return new Promise((resolve, reject) => { pending = { resolve, reject }; });
      }
      await Promise.resolve();
      if (disposed) throw disposedError();
      return pairs.map(([query, evidence]) => cosine(query, evidence));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      state.disposed += 1;
      if (pending) {
        const current = pending;
        pending = null;
        current.reject(disposedError());
      }
    },
    get stats() {
      return { workerBatches: state.pairs.length ? 1 : 0, fallbackBatches: 0, maxPackedBytes: 0 };
    }
  };
  state.pools.push(pool);
  return pool;
}
`;
}

function candidateSourceWithTestPool(source) {
  // If the production fragment is already present, keep it dormant under a
  // private name and bind the route method to this deterministic test pool.
  source = source.replace(/\bfunction createSemanticScoreWorkerPool\s*\(/, "function __productionCreateSemanticScoreWorkerPool(");
  const classMarker = "module.exports = class SemanticTodoistSyncPlugin";
  const offset = source.indexOf(classMarker);
  assert.notStrictEqual(offset, -1, "candidate plugin class marker must exist");
  return `${source.slice(0, offset)}${helperStubSource()}\n${source.slice(offset)}`;
}

function compilePlugin(source, filename) {
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports;
}

function resetPoolState(overrides = {}) {
  global.__semanticScoreRoutingTestState = Object.assign({
    created: 0,
    disposed: 0,
    pairs: [],
    pools: [],
    currentInstance: null,
    beforeBatch: null,
    blockNextBatch: false
  }, overrides);
  return global.__semanticScoreRoutingTestState;
}

function shortHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function canonicalEvidenceId(pathname, text, ordinal = 0) {
  return `ev:${shortHash(`${pathname}\u0000${text}`)}:${shortHash(text)}:${ordinal}`;
}

function makeCorpus(count = 180) {
  const chunks = [];
  for (let index = 0; index < count; index += 1) {
    const pathname = `notes/source-${index}.md`;
    const text = `routing fixture evidence ${index}`;
    const evidenceId = canonicalEvidenceId(pathname, text);
    const sourceId = `source-${index}`;
    chunks.push({
      id: `chunk-${index}`,
      evidenceId,
      sourceId,
      path: pathname,
      text,
      embedding: [2 - index * 0.01, 0.5, 0.3, 0.1],
      embeddingContentVersion: 3,
      sourceKind: "note",
      scopeRefs: [`scope-${index % 3}`],
      taskRefs: [`task-${index % 5}`],
      factIds: [`fact-${index}`],
      provenance: {
        sourceKind: "note",
        sourceId,
        path: pathname,
        taskId: `task-${index % 5}`,
        factIds: [`fact-${index}`],
        temporalRelation: "current"
      },
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      indexMetadata: { provider: "openai", model: "text-embedding-3-small", dimension: 4 }
    });
  }
  return chunks;
}

function makeInstance(Plugin, chunks) {
  const instance = Object.create(Plugin.prototype);
  instance.settings = {
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    semanticIndexMeta: { provider: "openai", model: "text-embedding-3-small", dimension: 4, generation: "test-generation" },
    maxChatContextChunks: 8,
    maxTaskContextChunks: 6
  };
  instance.semanticIndex = chunks;
  instance.semanticIndexRevision = 0;
  instance.semanticIndexStorageFingerprint = "routing-parity-test-fingerprint";
  instance.semanticIndexManifestPublishedGeneration = "test-generation";
  instance.productionSemanticRoutingState = null;
  instance.productionSemanticRoutingInFlight = new Map();
  instance.productionSemanticRoutingInvalidationSerial = 0;
  instance.productionSemanticRoutingTelemetry = {};
  instance.taskReferenceStateRevision = 0;
  instance.manifest = { dir: "test-vault/.obsidian/plugins/semantic-todoist-sync" };
  instance.app = { vault: { adapter: new Proxy({}, { get() { return async () => { throw new Error("vault access is disabled in routing parity test"); }; } }) } };
  instance.ensureSemanticIndexStorageDirectory = async () => {};
  instance.withSemanticIndexOperation = (kind, operation) => operation();
  instance.isIndexablePath = () => true;
  instance.logLocal = () => {};
  instance.embedSemanticTextsWithProvenance = async () => { throw new Error("provider access is disabled in routing parity test"); };
  return instance;
}

async function prepare(Plugin, count = 180) {
  const chunks = makeCorpus(count);
  const instance = makeInstance(Plugin, chunks);
  const routingState = await instance.ensureProductionSemanticRoutingState({
    chunks,
    settings: instance.settings,
    revision: 0,
    storageFingerprint: instance.semanticIndexStorageFingerprint,
    allowLoad: false,
    allowBuild: true,
    persist: false,
    generation: "test-generation",
    provider: "openai",
    model: "text-embedding-3-small",
    dimension: 4
  });
  assert.ok(routingState && routingState.routingIndex, "offline fixture routing state must prepare");
  instance.productionSemanticRoutingState = routingState;
  return { instance, chunks, routingState };
}

function handle(vector) {
  return { provider: "openai", model: "text-embedding-3-small", encoderVersion: 3, dimension: vector.length, vector };
}

function referenceCosine(a, b) {
  let dot = 0, magnitudeA = 0, magnitudeB = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index] * b[index];
    magnitudeA += a[index] * a[index];
    magnitudeB += b[index] * b[index];
  }
  return dot / ((Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB)) || 1);
}

const queryOne = handle([1, 0, 0, 0]);
const queryTwo = handle([0, 1, 0, 0]);

function makeGroups(chunks) {
  return [
    { groupId: "multi-handle", handles: [queryOne, queryTwo], topK: 3 },
    { groupId: "required-outside-pool", handles: [queryOne], topK: 2, requiredEvidenceIds: [chunks[chunks.length - 1].evidenceId] },
    { groupId: "second-handle", handles: [queryTwo], topK: 4 }
  ];
}

function snapshot(result) {
  const plain = (value) => value === undefined ? null : JSON.parse(JSON.stringify(value));
  const project = (candidate) => ({
    id: String(candidate.routingEvidenceId || ""),
    rawSemanticScore: candidate.rawSemanticScore,
    semantic: candidate.semantic,
    winningHandleKey: candidate.winningHandleKey || "",
    requiredIdentity: candidate.requiredIdentity === true,
    provenance: plain(candidate.provenance),
    routingMetadata: plain(candidate.routingMetadata)
  });
  return {
    groups: result.groups.map((group) => ({ groupId: group.groupId, candidates: group.candidates.map(project) })),
    handles: result.handles.map((view) => ({ handleKey: view.handleKey, candidates: view.candidates.map(project) }))
  };
}

async function route(instance, chunks, routingState, groups = makeGroups(chunks), options = {}) {
  return instance.routeProductionSemanticCandidateBatches(groups, chunks, Object.assign({ mode: "chat", routingState }, options));
}

async function main() {
  const candidateSource = fs.readFileSync(candidatePath, "utf8");
  const CandidatePlugin = compilePlugin(candidateSourceWithTestPool(candidateSource), candidatePath);
  const baseline = baselinePath ? await prepare(compilePlugin(fs.readFileSync(baselinePath, "utf8"), baselinePath)) : null;
  const baselineCold = baseline ? await route(baseline.instance, baseline.chunks, baseline.routingState) : null;
  const candidate = await prepare(CandidatePlugin);
  let state = resetPoolState({ currentInstance: candidate.instance });
  const candidateCold = await route(candidate.instance, candidate.chunks, candidate.routingState);

  assert.strictEqual(state.created, 1, "the first cold routing request must lazily create one score pool");
  assert.ok(state.pairs.length > 0, "cold exact-score misses must go through scorePairs");
  if (baselineCold) {
    assert.deepStrictEqual(snapshot(candidateCold), snapshot(baselineCold), "candidate identity/order, exact scores, winners, required rows and provenance must match the saved baseline");
  } else {
    const group = (id) => candidateCold.groups.find((item) => item.groupId === id);
    const expectedIds = (id) => group(id).candidates.map((row) => row.routingEvidenceId);
    assert.deepStrictEqual(expectedIds("multi-handle"), candidate.chunks.slice(0, 3).map((chunk) => chunk.evidenceId), "multi-handle top candidates must retain baseline order");
    assert.deepStrictEqual(expectedIds("required-outside-pool"), [candidate.chunks[candidate.chunks.length - 1].evidenceId, candidate.chunks[0].evidenceId], "required identity must precede the normal top candidate");
    assert.deepStrictEqual(expectedIds("second-handle"), candidate.chunks.slice(-4).reverse().map((chunk) => chunk.evidenceId), "second-handle exact-score ordering must remain deterministic");
    assert.strictEqual(group("multi-handle").candidates[0].rawSemanticScore, referenceCosine(queryOne.vector, candidate.chunks[0].embedding), "cold exact score must match the independently computed cosine");
    assert.strictEqual(group("multi-handle").candidates[0].winningHandleKey, candidateCold.handles.find((view) => view.candidates.some((row) => row.routingEvidenceId === candidate.chunks[0].evidenceId)).handleKey, "winner must be the selected query handle");
  }
  const requiredId = candidate.chunks[candidate.chunks.length - 1].evidenceId;
  const required = candidateCold.groups.find((group) => group.groupId === "required-outside-pool").candidates.find((row) => row.routingEvidenceId === requiredId);
  assert.ok(required, "the required row outside the bounded route pool must be assembled");
  assert.strictEqual(required.requiredIdentity, true, "the required row must retain its required identity flag");
  assert.ok(state.pairs.some(([query, evidence]) => query === queryOne.vector && evidence === candidate.chunks[candidate.chunks.length - 1].embedding), "required rows added after route lookup must be scored before selection");
  assert.ok(required.provenance && required.provenance.taskId === "task-4", "required-row task provenance must survive hydration");

  const coldPairCount = state.pairs.length;
  const candidateWarm = await route(candidate.instance, candidate.chunks, candidate.routingState);
  assert.deepStrictEqual(snapshot(candidateWarm), snapshot(candidateCold), "warm cache output must remain identical");
  assert.strictEqual(state.pairs.length, coldPairCount, "warm exact-score cache hits must not resubmit score pairs");
  assert.ok(Number(candidateWarm.telemetry.exactScoreCacheHits) > 0, "warm requests must report numeric exact-score cache hits");

  const revisionOneBaseline = baseline ? await route(baseline.instance, baseline.chunks, baseline.routingState, makeGroups(baseline.chunks), { indexRevision: 1 }) : candidateCold;
  const candidatePairCountBeforeRevision = state.pairs.length;
  candidate.instance.semanticIndexRevision = 1;
  const revisionOneCandidate = await route(candidate.instance, candidate.chunks, candidate.routingState, makeGroups(candidate.chunks), { indexRevision: 1 });
  assert.ok(state.pairs.length > candidatePairCountBeforeRevision, "a new index revision must use a distinct exact-score cache generation");
  assert.deepStrictEqual(snapshot(revisionOneCandidate), snapshot(revisionOneBaseline), "revision changes must preserve baseline output");

  const nextGenerationState = Object.assign({}, candidate.routingState, {
    routingIndex: Object.assign({}, candidate.routingState.routingIndex, { generation: "test-generation-2" })
  });
  candidate.instance.productionSemanticRoutingState = nextGenerationState;
  const nextGenerationBaseline = baseline ? Object.assign({}, baseline.routingState, {
    routingIndex: Object.assign({}, baseline.routingState.routingIndex, { generation: "test-generation-2" })
  }) : null;
  if (baseline) baseline.instance.productionSemanticRoutingState = nextGenerationBaseline;
  const candidatePairCountBeforeGeneration = state.pairs.length;
  const nextGenerationCandidate = await route(candidate.instance, candidate.chunks, nextGenerationState, makeGroups(candidate.chunks), { indexRevision: 1 });
  const nextGenerationResult = baseline
    ? await route(baseline.instance, baseline.chunks, nextGenerationBaseline, makeGroups(baseline.chunks), { indexRevision: 1 })
    : revisionOneCandidate;
  assert.ok(state.pairs.length > candidatePairCountBeforeGeneration, "a new semantic generation must use a distinct exact-score cache key");
  assert.deepStrictEqual(snapshot(nextGenerationCandidate), snapshot(nextGenerationResult), "generation changes must preserve saved-baseline output");

  const stale = await prepare(CandidatePlugin);
  state = resetPoolState({ currentInstance: stale.instance, beforeBatch(_pairs, instance) { instance.semanticIndexRevision = 1; } });
  const staleResult = await route(stale.instance, stale.chunks, stale.routingState, makeGroups(stale.chunks), { indexRevision: 0 });
  assert.deepStrictEqual(snapshot(staleResult), snapshot(baselineCold || candidateCold), "request-local scores must remain usable after a mid-flight revision change");
  assert.strictEqual(stale.instance.semanticExactScoreCache.size, 0, "late scores from an obsolete revision must not enter the shared numeric cache");

  const yielding = await prepare(CandidatePlugin, 360);
  state = resetPoolState({ currentInstance: yielding.instance });
  const originalPerformance = global.performance;
  let fakeNow = 0;
  global.performance = { now() { fakeNow += 0.125; return fakeNow; } };
  let hostHeartbeat = false;
  setImmediate(() => { hostHeartbeat = true; });
  try {
    await route(yielding.instance, yielding.chunks, yielding.routingState, makeGroups(yielding.chunks));
  } finally {
    global.performance = originalPerformance;
  }
  assert.ok(hostHeartbeat, "an over-budget route must yield to a host task before candidate assembly completes");

  const unloading = await prepare(CandidatePlugin);
  state = resetPoolState({ currentInstance: unloading.instance, blockNextBatch: true });
  const pendingRoute = route(unloading.instance, unloading.chunks, unloading.routingState, makeGroups(unloading.chunks,));
  const pendingOutcome = pendingRoute.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
  assert.ok(state.pools[0], "the in-flight route must have created a worker pool");
  unloading.instance.flushQueuedSettingsSave = async () => {
    assert.strictEqual(state.disposed, 1, "onunload must dispose the pool before its first awaited flush");
  };
  unloading.instance.flushTaskReferenceSnapshotIfDirty = async () => {};
  unloading.instance.flushSchedulerMemoryIfDirty = async () => {};
  unloading.instance.app.workspace = { detachLeavesOfType() {} };
  await unloading.instance.onunload();
  const outcome = await pendingOutcome;
  assert.strictEqual(outcome.ok, false, "unload must stop rather than complete retrieval with a fallback result");
  assert.strictEqual(outcome.error.code, "semantic-scoring-disposed", "unload cancellation must keep its typed disposal code");
  assert.strictEqual(state.disposed, 1, "unload must dispose the score pool once");

  console.log("PASS: staged score routing matches saved baseline, including required rows, winners and provenance");
  console.log("PASS: numeric cache hits, revision separation and stale-write prevention");
  console.log("PASS: over-budget routing performs a host-task yield");
  console.log("PASS: unload disposes before flush and rejects pending retrieval with semantic-scoring-disposed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
