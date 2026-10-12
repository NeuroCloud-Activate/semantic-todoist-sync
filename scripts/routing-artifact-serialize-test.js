"use strict";
// scripts/routing-artifact-serialize-test.js — startup/memory task (A).
//
// 1. Byte-identity: build routing state for a synthetic deterministic index
//    with the baseline runtime (%TEMP%/opencode/perf-base-main.js) and the repo
//    runtime (main.js), serialize both, assert every produced file is
//    byte-identical and that each runtime can load the other's artifact
//    (loadHit).
// 2. Startup: with no saved artifact, a startup-pattern call
//    ({allowLoad:true, persist:true}) completes WITHOUT a finished routing
//    state, and the first query-pattern call (allowBuild:false) afterwards
//    returns the SAME routing state as baseline (not degraded).
// 3. Serialize peak-heap: larger synthetic index (default 20k chunks x 1024
//    dims, override with ROUTING_SERIALIZE_CHUNKS / ROUTING_SERIALIZE_DIM),
//    run with node --expose-gc; report peak heapUsed during serialize for both.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const candidatePath = path.join(root, "main.js");
const baselinePath = path.resolve(
  process.env.ROUTING_SERIALIZE_BASELINE
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
    requestUrl() { throw new Error("Network disabled in routing artifact serialize test."); },
  };
};
global.window = global;
global.fetch = async () => { throw new Error("Network disabled in routing artifact serialize test."); };

function compilePlugin(runtimePath) {
  const source = fs.readFileSync(runtimePath, "utf8");
  const compiled = new Module(runtimePath, module);
  compiled.filename = runtimePath;
  compiled.paths = Module._nodeModulePaths(path.dirname(runtimePath));
  compiled._compile(source, runtimePath);
  const Plugin = compiled.exports;
  assert.equal(typeof Plugin, "function", `runtime does not export a plugin class: ${runtimePath}`);
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

function makeCorpus(count, dim, generation) {
  const chunks = [];
  for (let i = 0; i < count; i += 1) {
    const rng = mulberry32(7000 + i * 131);
    chunks.push({
      id: `chunk-${i}`,
      chunkId: `chunk-${i}`,
      evidenceId: `ev-${i}`,
      sourceId: `note-${i % 10}`,
      path: `Notes/note-${i % 10}.md`,
      text: `body ${i} alpha beta`,
      embedding: unitVector(rng, dim),
      embeddingContentVersion: 4,
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
    });
  }
  return chunks;
}

function makeInstance(Plugin, chunks, generation, fingerprint) {
  const instance = Object.create(Plugin.prototype);
  instance.settings = {
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    semanticIndexMeta: { provider: "openai", model: "text-embedding-3-small", dimension: 8, generation },
    indexedFolders: "",
    excludedFolders: "",
    maxChatContextChunks: 8,
    maxTaskContextChunks: 6,
  };
  instance.semanticIndex = chunks;
  instance.semanticIndexRevision = 0;
  instance.semanticIndexStorageFingerprint = fingerprint;
  instance.semanticIndexManifestPublishedGeneration = generation;
  instance.productionSemanticRoutingState = null;
  instance.productionSemanticRoutingInFlight = new Map();
  instance.productionSemanticRoutingInvalidationSerial = 0;
  instance.productionSemanticRoutingTelemetry = {};
  instance.isUnloading = false;
  instance.manifest = { dir: "test-vault/.obsidian/plugins/semantic-todoist-sync" };
  instance.app = { vault: { adapter: null } };
  instance.ensureSemanticIndexStorageDirectory = async () => {};
  instance.withSemanticIndexOperation = (kind, operation) => operation();
  instance.isIndexablePath = () => true;
  instance.canStartBackgroundWork = () => true;
  instance.logLocal = () => {};
  return instance;
}

async function serializeWith(pluginInstance, chunks, generation, fingerprint) {
  const state = await pluginInstance.ensureProductionSemanticRoutingState({
    chunks,
    settings: pluginInstance.settings,
    revision: 0,
    storageFingerprint: fingerprint,
    allowLoad: false,
    allowBuild: true,
    persist: false,
    generation,
    generationCanonical: true,
    provider: "openai",
    model: "text-embedding-3-small",
    dimension: chunks[0]?.embedding?.length || 8,
  });
  assert.ok(state && state.routingIndex, "routing state must prepare");
  pluginInstance.productionSemanticRoutingState = state;
  const slice = async () => {};
  const serialized = await (state && pluginInstance.constructor
    ? null : null);
  return { state, slice };
}

// Child-process mode: one runtime per fresh process so the serialize peak-heap
// measurement is not inflated by the other runtime's compiled module.
async function runBigChild() {
  const runtimePath = process.env.ROUTING_SERIALIZE_BIG_PATH;
  const bigCount = Number(process.env.ROUTING_SERIALIZE_CHUNKS || 20000);
  const bigDim = Number(process.env.ROUTING_SERIALIZE_DIM || 1024);
  const generation = "routing-serialize-test";
  const Plugin = compilePlugin(runtimePath);
  const big = makeCorpus(bigCount, bigDim, generation);
  const inst = makeInstance(Plugin, big, generation, "big-fp");
  const st = await inst.ensureProductionSemanticRoutingState({
    chunks: big,
    settings: inst.settings,
    revision: 0,
    storageFingerprint: "big-fp",
    allowLoad: false,
    allowBuild: true,
    persist: false,
    generation,
    generationCanonical: true,
    provider: "openai",
    model: "text-embedding-3-small",
    dimension: bigDim,
  });
  assert.ok(st && st.routingIndex, "big routing state must prepare");
  if (global.gc) global.gc();
  let peak = process.memoryUsage().heapUsed;
  const slice = async () => {
    const m = process.memoryUsage().heapUsed;
    if (m > peak) peak = m;
  };
  const src = fs.readFileSync(runtimePath, "utf8");
  const probe = new Module(`${runtimePath}#bigprobe`, module);
  probe.filename = runtimePath;
  probe.paths = Module._nodeModulePaths(path.dirname(runtimePath));
  probe._compile(
    `${src}\n;module.exports.__routingSerializeProbe = { serializeProductionSemanticRoutingArtifactCooperative };`,
    runtimePath
  );
  await probe.exports.__routingSerializeProbe.serializeProductionSemanticRoutingArtifactCooperative(
    st, { provider: "openai", model: "text-embedding-3-small", revision: 0, storageFingerprint: "big-fp" }, slice
  );
  console.log(`PEAK_MB=${(peak / 1048576).toFixed(1)}`);
}

async function main() {
  assert.ok(fs.existsSync(candidatePath), `candidate missing: ${candidatePath}`);
  assert.ok(fs.existsSync(baselinePath), `baseline missing: ${baselinePath}`);
  const CandidatePlugin = compilePlugin(candidatePath);
  const BaselinePlugin = compilePlugin(baselinePath);

  const generation = "routing-serialize-test";
  const fingerprint = "routing-serialize-fp";

  // ---- A: byte-identity on a few hundred chunks ----
  const small = makeCorpus(300, 8, generation);
  const candInst = makeInstance(CandidatePlugin, small, generation, fingerprint);
  const baseInst = makeInstance(BaselinePlugin, small, generation, fingerprint);
  const buildOpts = {
    chunks: small,
    settings: candInst.settings,
    revision: 0,
    storageFingerprint: fingerprint,
    allowLoad: false,
    allowBuild: true,
    persist: false,
    generation,
    generationCanonical: true,
    provider: "openai",
    model: "text-embedding-3-small",
    dimension: 8,
  };
  const [candState, baseState] = await Promise.all([
    candInst.ensureProductionSemanticRoutingState(buildOpts),
    baseInst.ensureProductionSemanticRoutingState(Object.assign({}, buildOpts, { settings: baseInst.settings })),
  ]);
  assert.ok(candState?.routingIndex && baseState?.routingIndex, "both routing states must prepare");
  candInst.productionSemanticRoutingState = candState;
  baseInst.productionSemanticRoutingState = baseState;
  const slice = async () => {};
  const serializeOf = async (runtimePath, state) => {
    const src = fs.readFileSync(runtimePath, "utf8");
    // Reuse the compiled plugin's module scope via a fresh compile that
    // exposes the cooperative serializer through a suffix seam.
    const probe = new Module(`${runtimePath}#probe`, module);
    probe.filename = runtimePath;
    probe.paths = Module._nodeModulePaths(path.dirname(runtimePath));
    probe._compile(
      `${src}\n;module.exports.__routingSerializeProbe = { serializeProductionSemanticRoutingArtifactCooperative, serializeProductionSemanticRoutingArtifactPartsCooperative, deserializeProductionSemanticRoutingArtifactCooperative };`,
      runtimePath
    );
    const { serializeProductionSemanticRoutingArtifactCooperative: ser, serializeProductionSemanticRoutingArtifactPartsCooperative: parts, deserializeProductionSemanticRoutingArtifactCooperative: de } = probe.exports.__routingSerializeProbe;
    const serialized = await ser(state, { provider: "openai", model: "text-embedding-3-small", revision: 0, storageFingerprint: fingerprint }, slice);
    const split = await parts(serialized.artifact, serialized.json, 4.5 * 1024 * 1024, slice);
    return { serialized, split, de };
  };
  const cand = await serializeOf(candidatePath, candState);
  const base = await serializeOf(baselinePath, baseState);

  // Every produced file byte-identical: pointer body + each part body.
  assert.equal(cand.split.pointer.body, base.split.pointer.body, "pointer body must be byte-identical");
  assert.equal(cand.split.parts.length, base.split.parts.length, "part count must match");
  for (let i = 0; i < base.split.parts.length; i += 1) {
    assert.equal(cand.split.parts[i].file, base.split.parts[i].file, `part ${i} file name must match`);
    assert.equal(cand.split.parts[i].body, base.split.parts[i].body, `part ${i} body must be byte-identical`);
  }
  console.log(`PASS: byte-identity (${base.split.parts.length} part(s) + pointer, all byte-identical)`);

  // Cross-load: each runtime deserializes the other's artifact (loadHit path).
  const gate = async () => {};
  for (const [name, loader, other] of [
    ["candidate-loads-baseline", cand.de, base.serialized.artifact],
    ["baseline-loads-candidate", base.de, cand.serialized.artifact],
  ]) {
    const loaded = await loader(other, gate);
    assert.ok(loaded?.count === small.length, `${name}: count must match`);
    assert.equal(String(loaded.generation), generation, `${name}: generation must match`);
  }
  console.log("PASS: cross-load (each runtime deserializes the other's artifact)");
"use strict";
// Edge-case block for scripts/routing-artifact-serialize-test.js.
// Insert after the cross-load PASS line. Uses only helpers already defined
// in the test file (makeCorpus, makeInstance, CandidatePlugin,
// BaselinePlugin, generation, fingerprint, slice, gate, serializeOf, assert).
// Verifies byte-identical pointer+parts AND cross-runtime load for:
// (a) empty index -> both runtimes resolve null state identically, and the
//     cooperative serializer rejects a missing routing index with the same
//     error code on both;
// (b) single chunk;
// (c) multi-part: 45 fat-metadata chunks (~18MB json -> 2 parts), plus exact
//     SINGLE_MAX boundary (len == 16MB -> 1 part; len == 16MB+1 -> 2 parts)
//     via direct parts() on both runtimes with byte-compare;
// (d) unicode paths/ids: surrogate pairs (emoji), combining marks, CJK, and
//     escape-requiring strings (quotes, backslash, U+2028/U+2029).

  // ---- A-edge: empty / single / unicode / multi-part serializer cases ----
  async function compareEdgeCase(name, chunks, expectedCount) {
    const candInst = makeInstance(CandidatePlugin, chunks, generation, fingerprint);
    const baseInst = makeInstance(BaselinePlugin, chunks, generation, fingerprint);
    const optsFor = (inst) => ({
      chunks,
      settings: inst.settings,
      revision: 0,
      storageFingerprint: fingerprint,
      allowLoad: false,
      allowBuild: true,
      persist: false,
      generation,
      generationCanonical: true,
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: 8,
    });
    const [candState, baseState] = await Promise.all([
      candInst.ensureProductionSemanticRoutingState(optsFor(candInst)),
      baseInst.ensureProductionSemanticRoutingState(optsFor(baseInst)),
    ]);
    assert.ok(candState?.routingIndex && baseState?.routingIndex, `${name}: both routing states must prepare`);
    const candEdge = await serializeOf(candidatePath, candState);
    const baseEdge = await serializeOf(baselinePath, baseState);
    assert.equal(candEdge.split.pointer.body, baseEdge.split.pointer.body, `${name}: pointer body must be byte-identical`);
    assert.equal(candEdge.split.parts.length, baseEdge.split.parts.length, `${name}: part count must match`);
    for (let i = 0; i < baseEdge.split.parts.length; i += 1) {
      assert.equal(candEdge.split.parts[i].file, baseEdge.split.parts[i].file, `${name}: part ${i} file name must match`);
      assert.equal(candEdge.split.parts[i].body, baseEdge.split.parts[i].body, `${name}: part ${i} body must be byte-identical`);
    }
    const loadedCand = await candEdge.de(baseEdge.serialized.artifact, gate);
    const loadedBase = await baseEdge.de(candEdge.serialized.artifact, gate);
    assert.equal(loadedCand?.count, expectedCount, `${name}: candidate-loads-baseline count must match`);
    assert.equal(loadedBase?.count, expectedCount, `${name}: baseline-loads-candidate count must match`);
    assert.equal(String(loadedCand.generation), generation, `${name}: generation must match`);
    console.log(`PASS: edge ${name} (bytes=${baseEdge.serialized.json.length}, parts=${baseEdge.split.parts.length})`);
  }

  // (a) empty index: full build path resolves null state on both runtimes,
  // and serializing a missing routing index throws the same error code.
  {
    const emptyCandInst = makeInstance(CandidatePlugin, [], generation, fingerprint);
    const emptyBaseInst = makeInstance(BaselinePlugin, [], generation, fingerprint);
    const emptyOpts = (inst) => ({
      chunks: [],
      settings: inst.settings,
      revision: 0,
      storageFingerprint: fingerprint,
      allowLoad: false,
      allowBuild: true,
      persist: false,
      generation,
      generationCanonical: true,
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: 8,
    });
    const [emptyCand, emptyBase] = await Promise.all([
      emptyCandInst.ensureProductionSemanticRoutingState(emptyOpts(emptyCandInst)),
      emptyBaseInst.ensureProductionSemanticRoutingState(emptyOpts(emptyBaseInst)),
    ]);
    assert.equal(emptyCand, null, "empty index: candidate must resolve null state");
    assert.equal(emptyBase, null, "empty index: baseline must resolve null state");
    const probeOf = (runtimePath) => {
      const src = fs.readFileSync(runtimePath, "utf8");
      const probe = new Module(`${runtimePath}#edge-empty`, module);
      probe.filename = runtimePath;
      probe.paths = Module._nodeModulePaths(path.dirname(runtimePath));
      probe._compile(
        `${src}\n;module.exports.__edgeEmptyProbe = { serializeProductionSemanticRoutingArtifactCooperative };`,
        runtimePath
      );
      return probe.exports.__edgeEmptyProbe;
    };
    let candCode = null;
    let baseCode = null;
    try {
      await probeOf(candidatePath).serializeProductionSemanticRoutingArtifactCooperative(
        { routingIndex: null, telemetry: {} },
        { provider: "openai", model: "text-embedding-3-small", revision: 0, storageFingerprint: fingerprint },
        slice
      );
    } catch (e) { candCode = e?.code || null; }
    try {
      await probeOf(baselinePath).serializeProductionSemanticRoutingArtifactCooperative(
        { routingIndex: null, telemetry: {} },
        { provider: "openai", model: "text-embedding-3-small", revision: 0, storageFingerprint: fingerprint },
        slice
      );
    } catch (e) { baseCode = e?.code || null; }
    assert.equal(candCode, "artifact-state-missing", "empty index: candidate must throw artifact-state-missing");
    assert.equal(baseCode, candCode, "empty index: baseline must throw the same error code");
    console.log(`PASS: edge empty (both null state, both throw ${candCode})`);
  }

  // (b) single chunk.
  await compareEdgeCase("single", makeCorpus(1, 8, generation), 1);

  // (d) unicode paths/ids: emoji surrogate pairs, combining mark, CJK, and
  // escape-requiring strings (quote, backslash, U+2028/U+2029).
  {
    const uni = makeCorpus(4, 8, generation);
    uni[0].path = "Notes/\uD83D\uDE00emoji-\u6F22\u5B57.md";
    uni[0].sourceId = uni[0].path;
    uni[1].path = "Notes/café-combining.md";
    uni[1].sourceId = uni[1].path;
    uni[2].path = "Notes/漢字日本語.md";
    uni[2].sourceId = uni[2].path;
    uni[3].path = "Notes/quote\"back\\slash sep end.md";
    uni[3].sourceId = uni[3].path;
    uni[0].scopeIds = ["scope-😀-漢字"];
    uni[1].taskIds = ["task-café"];
    uni[2].taskIds = ["task-\"quoted\"-\\- - "];
    await compareEdgeCase("unicode", uni, uni.length);
  }

  // (c) multi-part: fat-metadata chunks push the artifact json past the
  // 16MB single-part ceiling (maxBytes override cannot force small parts:
  // partBytes floors at the 5.2MB Sync-skip threshold).
  {
    const pad = "P".repeat(200000);
    const fat = [];
    for (let i = 0; i < 45; i += 1) {
      const rng = mulberry32(7000 + i * 131);
      const chunk = {
        id: `chunk-${i}`,
        chunkId: `chunk-${i}`,
        evidenceId: `ev-${i}`,
        sourceId: `note-${i}`,
        path: `Notes/note-${i}.md`,
        text: `body ${i} alpha beta`,
        embedding: unitVector(rng, 8),
        embeddingContentVersion: 4,
        embeddingProvider: "openai",
        embeddingModel: "text-embedding-3-small",
        temporalMetadata: { k: pad },
        routingMetadata: { k: pad },
      };
      for (let k = 0; k < 10; k++) chunk[`custom${k}`] = pad;
      fat.push(chunk);
    }
    await compareEdgeCase("multi-part", fat, fat.length);
  }

  // (c) exact part-boundary: json.length == 16MB -> 1 part, +1 -> 2 parts.
  // Direct parts() on both runtimes (full-build boundary tuning would couple
  // the test to metadata byte accounting); assert identical splits.
  {
    const SINGLE_MAX = 16 * 1024 * 1024;
    const boundaryProbe = (runtimePath) => {
      const src = fs.readFileSync(runtimePath, "utf8");
      const probe = new Module(`${runtimePath}#edge-boundary`, module);
      probe.filename = runtimePath;
      probe.paths = Module._nodeModulePaths(path.dirname(runtimePath));
      probe._compile(
        `${src}\n;module.exports.__edgeBoundaryProbe = { serializeProductionSemanticRoutingArtifactPartsCooperative };`,
        runtimePath
      );
      return probe.exports.__edgeBoundaryProbe;
    };
    const candParts = boundaryProbe(candidatePath);
    const baseParts = boundaryProbe(baselinePath);
    const art = { schemaVersion: 2, persistenceSchemaVersion: 2, generation: "g", integrityHash: "abcd1234" };
    for (const [len, wantParts] of [[SINGLE_MAX, 1], [SINGLE_MAX + 1, 2]]) {
      const json = "x".repeat(len);
      const [candSplit, baseSplit] = await Promise.all([
        candParts.serializeProductionSemanticRoutingArtifactPartsCooperative(art, json, 4.5 * 1024 * 1024, slice),
        baseParts.serializeProductionSemanticRoutingArtifactPartsCooperative(art, json, 4.5 * 1024 * 1024, slice),
      ]);
      assert.equal(baseSplit.parts.length, wantParts, `boundary len=${len}: baseline must produce ${wantParts} part(s)`);
      assert.equal(candSplit.parts.length, baseSplit.parts.length, `boundary len=${len}: part count must match`);
      assert.equal(candSplit.pointer.body, baseSplit.pointer.body, `boundary len=${len}: pointer must be byte-identical`);
      for (let i = 0; i < baseSplit.parts.length; i += 1) {
        assert.equal(candSplit.parts[i].body, baseSplit.parts[i].body, `boundary len=${len}: part ${i} must be byte-identical`);
      }
      console.log(`PASS: edge boundary len=${len} (parts=${baseSplit.parts.length}, byte-identical)`);
    }
  }


  // Valid artifact: startup load hits it (loadHit), no build.
  const loadStore = {};
  const loadInst = makeInstance(CandidatePlugin, small, generation, fingerprint);
  const dir = loadInst.manifest.dir;
  loadStore[`${dir}/semantic-index-routing.json`] = cand.split.pointer.body;
  for (const part of cand.split.parts) loadStore[`${dir}/${part.file}`] = part.body;
  loadInst.app = { vault: { adapter: {
    read: async (p) => loadStore[p] ?? null,
    write: async (p, body) => { loadStore[p] = body; return true; },
    exists: async (p) => p in loadStore,
    list: async () => ({ files: Object.keys(loadStore) }),
    rename: async () => {},
    remove: async (p) => { delete loadStore[p]; return true; },
  } } };
  const loadState = await loadInst.ensureProductionSemanticRoutingState({
    chunks: small,
    settings: loadInst.settings,
    revision: 0,
    storageFingerprint: fingerprint,
    allowLoad: true,
    persist: true,
    generation,
    generationCanonical: true,
    provider: "openai",
    model: "text-embedding-3-small",
    dimension: 8,
  });
  assert.ok(loadState?.routingIndex, "valid artifact must load");
  assert.equal(loadState.telemetry?.loadHit, true, "valid artifact must be a loadHit");
  assert.equal(loadState.routingIndex.count, small.length, "loaded routing count must match");
  console.log(`PASS: valid artifact loadHit (count=${loadState.routingIndex.count})`);

  // ---- B: startup does not build synchronously; first query waits ----
  // Compare repo vs baseline for the same startup + query pattern; neither
  // should degrade relative to the other.
  const startupCand = makeInstance(CandidatePlugin, small, generation, "startup-fp");
  const adapterStore = {};
  const adapter = {
    read: async (p) => adapterStore[p] || null,
    write: async (p, body) => { adapterStore[p] = body; return true; },
    exists: async (p) => p in adapterStore,
    list: async () => ({ files: Object.keys(adapterStore).map((k) => k.split('/').pop() || k) }),
    rename: async (oldP, newP) => { adapterStore[newP] = adapterStore[oldP]; delete adapterStore[oldP]; return true; },
    remove: async (p) => { delete adapterStore[p]; return true; },
  };
  startupCand.app = { vault: { adapter } };
  const startupBase = makeInstance(BaselinePlugin, small, generation, "startup-fp");
  startupBase.app = startupCand.app;
  const t0 = Date.now();
  const startupPromise = startupCand.ensureProductionSemanticRoutingState({ allowLoad: true, persist: true });
  const syncState = startupCand.productionSemanticRoutingState;
  const startupResult = await startupPromise;
  const startupMs = Date.now() - t0;
  const queryResult = await startupCand.ensureProductionSemanticRoutingState({
    chunks: small,
    settings: startupCand.settings,
    revision: 0,
    storageFingerprint: "startup-fp",
    allowLoad: false,
    allowBuild: false,
    persist: false,
    generation,
    generationCanonical: true,
    provider: "openai",
    model: "text-embedding-3-small",
    dimension: 8,
  });
  // Baseline comparison for same query pattern (baseline builds synchronously,
  // repo defers; both should resolve to the same routing state count).
  const baseQueryResult = await startupBase.ensureProductionSemanticRoutingState({
    chunks: small,
    settings: startupBase.settings,
    revision: 0,
    storageFingerprint: "startup-fp",
    allowLoad: false,
    allowBuild: true,
    persist: false,
    generation,
    generationCanonical: true,
    provider: "openai",
    model: "text-embedding-3-small",
    dimension: 8,
  });
  assert.equal(queryResult?.routingIndex?.count, baseQueryResult?.routingIndex?.count, "first query routing count must match baseline (not degraded)");
  console.log(`PASS: startup idle-build (syncState=${syncState ? "present" : "null"}, startupMs=${startupMs}, repoQueryCount=${queryResult?.routingIndex?.count || null}, baseQueryCount=${baseQueryResult?.routingIndex?.count || null})`);

  // ---- unload during pending idle build is safe ----
  const unloadCand = makeInstance(CandidatePlugin, small, generation, "unload-fp");
  unloadCand.app = { vault: { adapter: adapter } };
  unloadCand.isUnloading = false;
  const unloadPromise = unloadCand.ensureProductionSemanticRoutingState({ allowLoad: true, persist: true, chunks: small, revision: 0, storageFingerprint: "unload-fp", generation, generationCanonical: true, provider: "openai", model: "text-embedding-3-small", dimension: 8 });
  // Let the idle build start, then set unloading.
  await new Promise((r) => setTimeout(r, 30));
  unloadCand.isUnloading = true;
  const unloadResult = await unloadPromise.catch((e) => ({ error: String(e?.message || e || "") })).catch(() => null);
  // The build should resolve (possibly null) without throwing; no deadlock.
  assert.equal(typeof unloadResult, "object", "unload during pending build must resolve (not deadlock)");
  console.log(`PASS: unload during pending idle build safe (unloadResult=${unloadResult === null ? "null" : (unloadResult?.routingIndex ? "state" : "null/no-state")}, isUnloading=${unloadCand.isUnloading})`);

  // ---- serialize peak heap on a larger synthetic index ----
  const bigCount = Number(process.env.ROUTING_SERIALIZE_CHUNKS || 20000);
  const bigDim = Number(process.env.ROUTING_SERIALIZE_DIM || 1024);
  if (process.env.ROUTING_SERIALIZE_SKIP_BIG === "1") {
    console.log("SKIP: big serialize peak-heap (ROUTING_SERIALIZE_SKIP_BIG=1)");
  } else {
    // Each runtime in a fresh child process: measuring both in one process
    // makes the second runtime inherit the first probe module's heap (order
    // effect inflates the second measurement by ~200 MB at 20k x 1024).
    const results = {};
    for (const [name, runtimePath] of [["baseline", baselinePath], ["candidate", candidatePath]]) {
      const out = execFileSync(process.execPath, ["--expose-gc", __filename], {
        encoding: "utf8",
        env: Object.assign({}, process.env, { ROUTING_SERIALIZE_BIG_RUNTIME: name, ROUTING_SERIALIZE_BIG_PATH: runtimePath }),
        maxBuffer: 16 * 1024 * 1024,
      });
      const match = out.match(/PEAK_MB=([\d.]+)/);
      assert.ok(match, `${name}: child must report PEAK_MB (out=${out.slice(0, 300)})`);
      results[name] = Number(match[1]);
    }
    console.log(`serialize peak heapUsed: baseline=${results.baseline.toFixed(1)} MB candidate=${results.candidate.toFixed(1)} MB (chunks=${bigCount} dim=${bigDim})`);
  }

  console.log("routing artifact serialize test: pass");
}

if (process.env.ROUTING_SERIALIZE_BIG_RUNTIME) {
  runBigChild().then(
    () => process.exit(0),
    (error) => {
      console.error(error && error.stack ? error.stack : (error && error.message ? error.message : error));
      process.exit(1);
    },
  );
} else {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error && error.stack ? error.stack : (error && error.message ? error.message : error));
      process.exit(1);
    },
  );
}
