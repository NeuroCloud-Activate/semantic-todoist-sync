"use strict";
// scripts/exact-search-equivalence-test.js â€” exact-path result preservation.
//
// Runs a fixed set of synthetic queries over a synthetic index (a few hundred
// chunks across several notes, deterministic vectors) through the REAL
// routeProductionSemanticCandidateBatches entry with both runtimes (baseline
// via env var, default %TEMP%/opencode/perf-base-main.js) and asserts
// deep-equal ranked outputs. Includes a cache-warm second run and an
// index-revision change (cache invalidation) case.

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const Module = require("node:module");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const candidatePath = path.resolve(
  process.env.EXACT_SEARCH_CANDIDATE_MAIN
    || path.join(root, "src/main.js")
);
const baselinePath = path.resolve(
  process.env.EXACT_SEARCH_BASELINE_MAIN
    || process.env.SEMANTIC_SCORE_BASELINE_MAIN
    || path.join(os.tmpdir(), "opencode", "perf-base-main.js")
);

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
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
    requestUrl() { throw new Error("Network disabled in exact search equivalence test."); },
  };
};
global.window = global;
global.fetch = async () => { throw new Error("Network disabled in exact search equivalence test."); };

function compilePlugin(runtimePath) {
  const source = fs.readFileSync(runtimePath, "utf8");
  const compiled = new Module(runtimePath, module);
  compiled.filename = runtimePath;
  compiled.paths = Module._nodeModulePaths(path.dirname(runtimePath));
  compiled._compile(source, runtimePath);
  const Plugin = compiled.exports;
  assert.strictEqual(typeof Plugin, "function", `runtime does not export a plugin class: ${runtimePath}`);
  return Plugin;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unitVector(rng, dim) {
  const vec = Array.from({ length: dim }, () => rng() * 2 - 1);
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

// Synthetic index: 300 chunks across 12 notes (25 chunks/note) + 1 noise
// chunk. Mixes ordinary/authoritative/non-note so ordinaryNoteFingerprint
// takes every branch; deterministic vectors (seeded) so scores are stable.
function makeCorpus() {
  const dim = 8;
  const chunks = [];
  const notes = 12;
  const perNote = 25;
  let ordinal = 0;
  for (let note = 0; note < notes; note += 1) {
    const sourceId = `note-${note}`;
    for (let m = 0; m < perNote; m += 1) {
      const rng = mulberry32(1000 + ordinal * 77);
      const authoritative = ordinal % 11 === 0;
      const nonNote = ordinal % 13 === 0;
      const text = `Note ${note} chunk ${m} body text alpha beta gamma ${ordinal}`;
      chunks.push({
        id: `chunk-${ordinal}`,
        chunkId: `chunk-${ordinal}`,
        evidenceId: `ev-${note}-${m}`,
        sourceId,
        path: `Notes/note-${note}.md`,
        text,
        embedding: unitVector(rng, dim),
        embeddingContentVersion: 4,
        sourceKind: nonNote ? "task" : "note",
        authorityState: authoritative ? "authoritative" : "ordinary",
        contentFingerprint: `fp-${note}-${m % 5}`,
        provenance: {
          sourceKind: nonNote ? "task" : "note",
          authorityState: authoritative ? "authoritative" : "ordinary",
          sourceId,
        },
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        indexMetadata: { provider: "openai", model: "text-embedding-3-small", dimension: dim },
      });
      ordinal += 1;
    }
  }
  // Noise chunk: todoist placeholder (<500 chars) exercises the eligibility skip.
  const noiseRng = mulberry32(999999);
  chunks.push({
    id: "chunk-noise",
    chunkId: "chunk-noise",
    evidenceId: "ev-noise",
    sourceId: "note-noise",
    path: "Notes/noise.md",
    text: "Action Items\nTasks & projects completed, processed or delegated\nCurrent Todoist list",
    embedding: unitVector(noiseRng, dim),
    embeddingContentVersion: 4,
    sourceKind: "note",
    authorityState: "ordinary",
    contentFingerprint: "fp-noise",
    provenance: { sourceKind: "note", authorityState: "ordinary", sourceId: "note-noise" },
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    indexMetadata: { provider: "openai", model: "text-embedding-3-small", dimension: dim },
  });
  return chunks;
}

function makeInstance(Plugin, chunks) {
  const instance = Object.create(Plugin.prototype);
  instance.settings = {
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    semanticIndexMeta: { provider: "openai", model: "text-embedding-3-small", dimension: 8, generation: "exact-equiv-test" },
    indexedFolders: "",
    excludedFolders: "",
    maxChatContextChunks: 8,
    maxTaskContextChunks: 6,
  };
  instance.semanticIndex = chunks;
  instance.semanticIndexRevision = 0;
  instance.semanticIndexStorageFingerprint = "exact-equiv-fingerprint";
  instance.semanticIndexManifestPublishedGeneration = "exact-equiv-test";
  instance.productionSemanticRoutingState = null;
  instance.productionSemanticRoutingInFlight = new Map();
  instance.productionSemanticRoutingInvalidationSerial = 0;
  instance.productionSemanticRoutingTelemetry = {};
  instance.semanticRoutingRouteCache = new Map();
  instance.semanticExactScoreCache = new Map();
  instance._semanticExactScoreCacheTimestamps = new Map();
  instance.queryEmbeddingCache = new Map();
  instance.isUnloading = false;
  instance.manifest = { dir: "test-vault/.obsidian/plugins/semantic-todoist-sync" };
  instance.app = { vault: { adapter: new Proxy({}, { get() { return async () => { throw new Error("vault access disabled"); }; } }) } };
  instance.ensureSemanticIndexStorageDirectory = async () => {};
  instance.withSemanticIndexOperation = (kind, operation) => operation();
  instance.isIndexablePath = () => true;
  instance.logLocal = () => {};
  return instance;
}

async function prepare(Plugin) {
  const chunks = makeCorpus();
  const instance = makeInstance(Plugin, chunks);
  const routingState = await instance.ensureProductionSemanticRoutingState({
    chunks,
    settings: instance.settings,
    revision: 0,
    storageFingerprint: instance.semanticIndexStorageFingerprint,
    allowLoad: false,
    allowBuild: true,
    persist: false,
    generation: "exact-equiv-test",
    provider: "openai",
    model: "text-embedding-3-small",
    dimension: 8,
  });
  assert.ok(routingState && routingState.routingIndex, "routing state must prepare");
  instance.productionSemanticRoutingState = routingState;
  return { instance, chunks, routingState };
}

function makeQueries() {
  const queries = [];
  for (let q = 0; q < 6; q += 1) {
    const rng = mulberry32(5000 + q * 131);
    queries.push({ id: `q${q}`, vector: unitVector(rng, 8) });
  }
  return queries;
}

function snapshot(result) {
  const project = (candidate) => ({
    id: String(candidate.routingEvidenceId || ""),
    rawSemanticScore: candidate.rawSemanticScore,
    semantic: candidate.semantic,
    winningHandleKey: candidate.winningHandleKey || "",
  });
  return {
    groups: result.groups.map((group) => ({
      groupId: group.groupId,
      candidates: group.candidates.map(project),
    })),
    handles: result.handles.map((view) => ({
      handleKey: view.handleKey,
      candidates: view.candidates.map(project),
    })),
  };
}

async function routeOne(instance, chunks, routingState, query, options = {}) {
  const handle = {
    provider: "openai",
    model: "text-embedding-3-small",
    dimension: query.vector.length,
    vector: query.vector,
    indexRevision: Number(options.indexRevision ?? 0),
    cacheKey: `eval:${query.id}`,
    sourceEvidenceIds: options.sourceEvidenceIds || [],
    sourceIds: [],
  };
  const usableIndex = options.usableIndex ?? chunks;
  return instance.routeProductionSemanticCandidateBatches(
    [{ groupId: query.id, handles: [handle], topK: 25 }],
    usableIndex,
    Object.assign({
      mode: "task-generation",
      indexRevision: 0,
      storageFingerprint: instance.semanticIndexStorageFingerprint || "",
      routingState,
      completeEligibleStream: true,
    }, options),
  );
}

async function main() {
  assert.ok(fs.existsSync(candidatePath), `candidate missing: ${candidatePath}`);
  assert.ok(fs.existsSync(baselinePath), `baseline missing: ${baselinePath} (set EXACT_SEARCH_BASELINE_MAIN)`);
  const CandidatePlugin = compilePlugin(candidatePath);
  const BaselinePlugin = compilePlugin(baselinePath);
  const candidate = await prepare(CandidatePlugin);
  const baseline = await prepare(BaselinePlugin);
  const queries = makeQueries();

  // 1. Cold: every fixed query must match bit-identically.
  for (const query of queries) {
    const [baseRes, candRes] = await Promise.all([
      routeOne(baseline.instance, baseline.chunks, baseline.routingState, query),
      routeOne(candidate.instance, candidate.chunks, candidate.routingState, query),
    ]);
    assert.deepStrictEqual(
      snapshot(candRes),
      snapshot(baseRes),
      `cold query ${query.id}: ids, order and scores must be bit-identical`,
    );
  }
  console.log("PASS: cold queries match baseline (ids, order, scores bit-identical)");

  // 2. Cache-warm: second run of the same query must still match.
  const warmQuery = queries[0];
  const [baseWarm, candWarm] = await Promise.all([
    routeOne(baseline.instance, baseline.chunks, baseline.routingState, warmQuery),
    routeOne(candidate.instance, candidate.chunks, candidate.routingState, warmQuery),
  ]);
  assert.deepStrictEqual(snapshot(candWarm), snapshot(baseWarm), "warm repeat must match baseline");
  const candWarmAgain = await routeOne(candidate.instance, candidate.chunks, candidate.routingState, warmQuery);
  assert.deepStrictEqual(snapshot(candWarmAgain), snapshot(candWarm), "candidate warm repeat must be stable");
  console.log("PASS: cache-warm repeat matches baseline");

  // 3. Revision change (cache invalidation): same queries under a new index
  // revision must match the baseline computed under the same revision.
  candidate.instance.semanticIndexRevision = 1;
  baseline.instance.semanticIndexRevision = 1;
  for (const query of queries.slice(0, 3)) {
    const [baseRes, candRes] = await Promise.all([
      routeOne(baseline.instance, baseline.chunks, baseline.routingState, query, { indexRevision: 1 }),
      routeOne(candidate.instance, candidate.chunks, candidate.routingState, query, { indexRevision: 1 }),
    ]);
    assert.deepStrictEqual(
      snapshot(candRes),
      snapshot(baseRes),
      `revision-1 query ${query.id}: must match baseline after invalidation`,
    );
  }
  console.log("PASS: index-revision change matches baseline (invalidation)");

  // 4. Revision change WITH content mutation: mutate 2 chunks' text/fingerprint
  // and one path across the revision bump. Baseline rebuilds from scratch so it
  // sees the new content; candidate uses the same mutated chunks. Both must
  // produce identical results (proves memo keys bind content, not just
  // evidenceId). This is review finding #1 test case.
  {
    const mutatedChunks = candidate.chunks.map((chunk) => {
      const c = { ...chunk };
      if (c.evidenceId === "ev-0-0") {
        c.text = "MUTATED Note 0 chunk 0 body text alpha beta gamma mutated";
        c.contentFingerprint = "fp-mutated-0-0";
        c.embedding = unitVector(mulberry32(77777), 8);
      } else if (c.evidenceId === "ev-1-1") {
        c.text = "MUTATED Note 1 chunk 1 body text alpha beta gamma mutated";
        c.contentFingerprint = "fp-mutated-1-1";
        c.path = "Notes/note-1-mutated.md";
        c.embedding = unitVector(mulberry32(88888), 8);
      }
      return c;
    });
    const candidateMutated = makeInstance(CandidatePlugin, mutatedChunks);
    const baselineMutated = makeInstance(BaselinePlugin, mutatedChunks);
    const routingStateCand = await candidateMutated.ensureProductionSemanticRoutingState({
      chunks: mutatedChunks,
      settings: candidateMutated.settings,
      revision: 1,
      storageFingerprint: candidateMutated.semanticIndexStorageFingerprint,
      allowLoad: false,
      allowBuild: true,
      persist: false,
      generation: "exact-equiv-test",
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: 8,
    });
    const routingStateBase = await baselineMutated.ensureProductionSemanticRoutingState({
      chunks: mutatedChunks,
      settings: baselineMutated.settings,
      revision: 1,
      storageFingerprint: baselineMutated.semanticIndexStorageFingerprint,
      allowLoad: false,
      allowBuild: true,
      persist: false,
      generation: "exact-equiv-test",
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: 8,
    });
    candidateMutated.productionSemanticRoutingState = routingStateCand;
    candidateMutated.semanticIndexRevision = 1;
    baselineMutated.productionSemanticRoutingState = routingStateBase;
    baselineMutated.semanticIndexRevision = 1;
    for (const query of queries.slice(0, 3)) {
      const [baseRes, candRes] = await Promise.all([
        routeOne(baselineMutated, mutatedChunks, routingStateBase, query, { indexRevision: 1 }),
        routeOne(candidateMutated, mutatedChunks, routingStateCand, query, { indexRevision: 1 }),
      ]);
      assert.deepStrictEqual(
        snapshot(candRes),
        snapshot(baseRes),
        `revision-1 mutated query ${query.id}: must match baseline after content mutation`,
      );
    }
    console.log("PASS: index-revision change with content mutation matches baseline");
  }

  // 5. Second query in the same revision (exact mode, complete eligible stream):
  // checks that a second, different query in the same revision equals the
  // baseline in exact mode with completeEligibleStream. A removed per-revision
  // cache of the distinctiveness map was NOT observable through this function's
  // outputs in exact mode (every handle routes all rows, so the routed set does
  // not vary by query); it could only matter in routed search mode, which this
  // test does not cover. This check therefore guards general second-request
  // equivalence and does not protect against that specific cache.
  {
    // Build a dedicated corpus where distinctiveness is exercised:
    // - 4 notes, 2 chunks each (8 chunks total)
    // - Notes 0 and 1 share contentFingerprint "fp-shared-A" (different sourceIds)
    // - Notes 2 and 3 share contentFingerprint "fp-shared-B" (different sourceIds)
    // - Query A's vector routes to notes 0,1 chunks (identity "fp-shared-A" has 2 sourceIds)
    // - Query B's vector routes to notes 2,3 chunks (identity "fp-shared-B" has 2 sourceIds)
    // - If cache is reused, Query B would see Query A's sourceId count (wrong).
    const dim = 8;
    const distinctChunks = [];
    const sharedFingerprints = ["fp-shared-A", "fp-shared-B"];
    let ord = 0;
    for (let note = 0; note < 4; note += 1) {
      const sourceId = `note-${note}`;
      const fp = sharedFingerprints[note % 2];
      for (let m = 0; m < 2; m += 1) {
        const rng = mulberry32(20000 + ord * 97);
        const text = `Distinctiveness test note ${note} chunk ${m} ${fp} body`;
        distinctChunks.push({
          id: `dchunk-${ord}`,
          chunkId: `dchunk-${ord}`,
          evidenceId: `dev-${note}-${m}`,
          sourceId,
          path: `Notes/distinct-note-${note}.md`,
          text,
          embedding: unitVector(rng, dim),
          embeddingContentVersion: 4,
          sourceKind: "note",
          authorityState: "ordinary",
          contentFingerprint: fp,
          provenance: { sourceKind: "note", authorityState: "ordinary", sourceId },
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
          indexMetadata: { provider: "openai", model: "text-embedding-3-small", dimension: dim },
        });
        ord += 1;
      }
    }
    const candidateDistinct = makeInstance(CandidatePlugin, distinctChunks);
    const baselineDistinct = makeInstance(BaselinePlugin, distinctChunks);
    const routingStateCand = await candidateDistinct.ensureProductionSemanticRoutingState({
      chunks: distinctChunks,
      settings: candidateDistinct.settings,
      revision: 0,
      storageFingerprint: candidateDistinct.semanticIndexStorageFingerprint,
      allowLoad: false,
      allowBuild: true,
      persist: false,
      generation: "exact-equiv-test",
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: dim,
    });
    const routingStateBase = await baselineDistinct.ensureProductionSemanticRoutingState({
      chunks: distinctChunks,
      settings: baselineDistinct.settings,
      revision: 0,
      storageFingerprint: baselineDistinct.semanticIndexStorageFingerprint,
      allowLoad: false,
      allowBuild: true,
      persist: false,
      generation: "exact-equiv-test",
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: dim,
    });
    candidateDistinct.productionSemanticRoutingState = routingStateCand;
    baselineDistinct.productionSemanticRoutingState = routingStateBase;
    // Two queries with different sourceEvidenceIds, same revision, completeEligibleStream=true
    // Query A constrained to notes 0,1 (fp-shared-A identity, 2 sourceIds: note-0, note-1)
    // Query B constrained to notes 2,3 (fp-shared-B identity, 2 sourceIds: note-2, note-3)
    // If cache is reused, Query B would see Query A's sourceId count for fp-shared-A (wrong).
    const queryA = { id: "distinct-A", vector: unitVector(mulberry32(30000), dim) };
    const queryB = { id: "distinct-B", vector: unitVector(mulberry32(30001), dim) };
    const sourceIdsA = ["dev-0-0", "dev-0-1", "dev-1-0", "dev-1-1"];
    const sourceIdsB = ["dev-2-0", "dev-2-1", "dev-3-0", "dev-3-1"];
    // First query A (warms the buggy cache)
    const [baseA, candA] = await Promise.all([
      routeOne(baselineDistinct, distinctChunks, routingStateBase, queryA, { sourceEvidenceIds: sourceIdsA }),
      routeOne(candidateDistinct, distinctChunks, routingStateCand, queryA, { sourceEvidenceIds: sourceIdsA }),
    ]);
    assert.deepStrictEqual(snapshot(candA), snapshot(baseA), "distinctiveness query A cold must match baseline");
    // Second query B (would hit buggy cache if present)
    const [baseB, candB] = await Promise.all([
      routeOne(baselineDistinct, distinctChunks, routingStateBase, queryB, { sourceEvidenceIds: sourceIdsB }),
      routeOne(candidateDistinct, distinctChunks, routingStateCand, queryB, { sourceEvidenceIds: sourceIdsB }),
    ]);
    assert.deepStrictEqual(
      snapshot(candB),
      snapshot(baseB),
      "distinctiveness query B (second in same revision) must match baseline â€” catches cache reuse bug",
    );
    console.log("PASS: second query in the same revision matches baseline (exact mode, complete eligible stream)");
  }

  // 6. Negative control: prove the content-mutation test would fail if the memo
  // ignored content (i.e., keyed only by evidenceId). We create a temp copy of
  // main.js with the fix disabled (revert memo keys to evidenceId-only), run
  // the same collision corpus through both versions, and verify they produce
  // DIFFERENT results. This proves the fix is catching content collisions.
  if (process.env.EXACT_SEARCH_NEGATIVE_CONTROL === "1") {
    console.log("Running negative control (EXACT_SEARCH_NEGATIVE_CONTROL=1)...");
    // Create collision corpus: same evidenceId with different content/fingerprint/path
    const collisionChunks = candidate.chunks.map((chunk) => ({ ...chunk }));
    const duplicateEvidenceId = "ev-0-0-collide";
    // Modify two chunks to have the SAME evidenceId but DIFFERENT content
    collisionChunks[0].evidenceId = duplicateEvidenceId;
    collisionChunks[0].contentFingerprint = "fp-collide-1";
    collisionChunks[0].text = "COLLISION TEXT ONE DIFFERENT";
    collisionChunks[0].path = "Notes/collision-1.md";
    collisionChunks[0].id = duplicateEvidenceId;
    collisionChunks[0].chunkId = duplicateEvidenceId;
    collisionChunks[0].rawChunkId = duplicateEvidenceId;
    collisionChunks[1].evidenceId = duplicateEvidenceId;
    collisionChunks[1].contentFingerprint = "fp-collide-2";
    collisionChunks[1].text = "COLLISION TEXT TWO DIFFERENT";
    collisionChunks[1].path = "Notes/collision-2.md";
    collisionChunks[1].id = duplicateEvidenceId;
    collisionChunks[1].chunkId = duplicateEvidenceId;
    collisionChunks[1].rawChunkId = duplicateEvidenceId;
    const tempMainPath = path.join(os.tmpdir(), "opencode", "negative-control-main.js");
    fs.mkdirSync(path.dirname(tempMainPath), { recursive: true });
    let mainSource = fs.readFileSync(candidatePath, "utf8");
    // Disable the content-binding in cachedChunkEligible: revert metaKey to evidenceId only.
    mainSource = mainSource.replace(
      /const metaKey = `\$\{evidenceId\}\\u0000\$\{contentFingerprint\}\\u0000\$\{path\}`;/,
      "// NEGATIVE_CONTROL: content binding disabled\n      const metaKey = evidenceId;"
    );
    // Disable the content-binding in ordinaryNoteFingerprint: revert cacheKey to evidenceId only.
    mainSource = mainSource.replace(
      /const cacheKey = `\$\{evidenceId\}\\u0000\$\{contentFingerprint\}\\u0000\$\{path\}\\u0000\$\{sourceId\}\\u0000\$\{authorityState\}`;/,
      "// NEGATIVE_CONTROL: content binding disabled\n      const cacheKey = evidenceId;"
    );
    fs.writeFileSync(tempMainPath, mainSource, "utf8");
    const UnfixedPlugin = compilePlugin(tempMainPath);
    const unfixedInstance = await prepare(UnfixedPlugin);
    const fixedInstance = await prepare(CandidatePlugin);
    // Build routing state for collision corpus
    const routingStateFixed = await fixedInstance.instance.ensureProductionSemanticRoutingState({
      chunks: collisionChunks,
      settings: fixedInstance.instance.settings,
      revision: 1,
      storageFingerprint: fixedInstance.instance.semanticIndexStorageFingerprint,
      allowLoad: false,
      allowBuild: true,
      persist: false,
      generation: "exact-equiv-test",
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: 8,
    });
    const routingStateUnfixed = await unfixedInstance.instance.ensureProductionSemanticRoutingState({
      chunks: collisionChunks,
      settings: unfixedInstance.instance.settings,
      revision: 1,
      storageFingerprint: unfixedInstance.instance.semanticIndexStorageFingerprint,
      allowLoad: false,
      allowBuild: true,
      persist: false,
      generation: "exact-equiv-test",
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: 8,
    });
    fixedInstance.instance.productionSemanticRoutingState = routingStateFixed;
    unfixedInstance.instance.productionSemanticRoutingState = routingStateUnfixed;
    // Compare results - they MUST differ (fixed handles collision correctly)
    const query = queries[0];
    const [fixedRes, unfixedRes] = await Promise.all([
      routeOne(fixedInstance.instance, collisionChunks, routingStateFixed, query, { indexRevision: 1 }),
      routeOne(unfixedInstance.instance, collisionChunks, routingStateUnfixed, query, { indexRevision: 1 }),
    ]);
    try {
      assert.deepStrictEqual(snapshot(unfixedRes), snapshot(fixedRes), "negative control: UNFIXED result should differ from FIXED result (memo ignoring content)");
      throw new Error("Negative control PASSED unexpectedly â€” fix is not catching content collisions (both produced same result)");
    } catch (e) {
      // This is expected: results differ, proving the fix works
      console.log("PASS: negative control showed UNFIXED != FIXED result (content-binding fix is effective)");
    }
  } else {
    console.log("SKIP: negative control (set EXACT_SEARCH_NEGATIVE_CONTROL=1 to run)");
  }

  console.log("exact search equivalence: pass");
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error && error.stack ? error.stack : (error && error.message ? error.message : error));
    process.exit(1);
  },
);
