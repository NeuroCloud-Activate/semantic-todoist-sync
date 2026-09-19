"use strict";

// Provider-free measurement of the real prepared-routing production path.
// The benchmark is intentionally an executable/report pair rather than a
// synthetic scoring harness: fixture work is outside timed sections, and all
// timed routing is delegated to Plugin.prototype.routeProductionSemanticCandidateBatches.

const crypto = require("crypto");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const childProcess = require("child_process");

const SCHEMA = "semantic-responsiveness-benchmark/2";
const BODY_BYTES = 256;
const SCHEDULING_INTERVAL_MS = 16;
const MAX_SCHEDULING_SAMPLES = 10000;
const CHILD_TIMEOUT_MS = 120000;
const PARENT_DEADLINE_MS = 240000;
const DEFAULTS = Object.freeze({
  rows: 7000,
  dimensions: 1024,
  scopes: 8,
  runs: 30,
  seed: 20260915,
  network: "deny"
});
const MAXIMA = Object.freeze({ rows: 7000, dimensions: 1024, scopes: 8, runs: 30 });
const USAGE = "Usage: node scripts/semantic-responsiveness-benchmark.js --runtime <main.js> [--rows N --dimensions N --scopes N --runs N --seed N --network deny] OR --baseline <saved-main.js> --candidate <main.js> [same options]";
const CANARY_TEXT = "CANARY_T4_ROUTING_BODY";
const CANARY_COORDINATE = 0.73191528;

function benchmarkFailure(reasonCode) {
  const error = new Error(String(reasonCode || "benchmark-failed"));
  error.code = String(reasonCode || "benchmark-failed");
  return error;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || String(value).startsWith("--")) throw benchmarkFailure(`missing-value-${flag.slice(2)}`);
  return String(value);
}

function parsePositiveInteger(value, flag, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || (maximum !== undefined && number > maximum)) {
    throw benchmarkFailure(`invalid-${flag.slice(2)}`);
  }
  return number;
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.map(String) : [];
  if (!args.length) throw benchmarkFailure("usage");
  const config = Object.assign({}, DEFAULTS);
  const seen = new Set();
  let runtime = "";
  let baseline = "";
  let candidate = "";
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith("--")) throw benchmarkFailure("stray-positional-argument");
    if (seen.has(flag)) throw benchmarkFailure(`duplicate-${flag.slice(2)}`);
    seen.add(flag);
    if (flag === "--runtime" || flag === "--baseline" || flag === "--candidate") {
      const value = requireValue(args, index, flag).trim();
      if (!value) throw benchmarkFailure(`missing-value-${flag.slice(2)}`);
      if (flag === "--runtime") runtime = value;
      else if (flag === "--baseline") baseline = value;
      else candidate = value;
      index += 1;
      continue;
    }
    if (["--rows", "--dimensions", "--scopes", "--runs"].includes(flag)) {
      config[flag.slice(2)] = parsePositiveInteger(requireValue(args, index, flag), flag, MAXIMA[flag.slice(2)]);
      index += 1;
      continue;
    }
    if (flag === "--seed") {
      const value = Number(requireValue(args, index, flag));
      if (!Number.isSafeInteger(value) || value < 0) throw benchmarkFailure("invalid-seed");
      config.seed = value;
      index += 1;
      continue;
    }
    if (flag === "--network") {
      config.network = requireValue(args, index, flag);
      index += 1;
      continue;
    }
    throw benchmarkFailure(`unknown-flag-${flag.slice(2)}`);
  }
  if (runtime && (baseline || candidate)) throw benchmarkFailure("mixed-runtime-modes");
  if (!runtime && !baseline && !candidate) throw benchmarkFailure("usage");
  if (baseline && !candidate) throw benchmarkFailure("missing-candidate");
  if (candidate && !baseline) throw benchmarkFailure("missing-baseline");
  if (config.network !== "deny") throw benchmarkFailure("network-must-be-deny");
  return Object.freeze(Object.assign(config, {
    mode: runtime ? "single-runtime" : "comparison",
    runtime,
    baseline,
    candidate
  }));
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(absolutePath) {
  return sha256Bytes(fs.readFileSync(absolutePath));
}

function stableJsonHash(value) {
  return sha256Bytes(JSON.stringify(value));
}

function nowMs() {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  } catch {}
  return Date.now();
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function stageReport(samples, counters) {
  return {
    count: samples.length,
    samplesMs: samples.slice(),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: samples.length ? Math.max(...samples) : null,
    counters: Object.assign({}, counters)
  };
}

// Schedules the next due time from the actual callback time. The default
// implementation uses a real timer; tests inject a clock/scheduler to prove
// the due-time math without asserting a machine-dependent delay.
function createSchedulingDelayProbe(options = {}) {
  const clock = typeof options.now === "function" ? options.now : nowMs;
  const schedule = typeof options.schedule === "function" ? options.schedule : (callback, delay) => setTimeout(callback, delay);
  const cancel = typeof options.cancel === "function" ? options.cancel : (handle) => clearTimeout(handle);
  const intervalMs = Math.max(1, Number(options.intervalMs || SCHEDULING_INTERVAL_MS));
  const maxSamples = Math.max(1, Number(options.maxSamples || MAX_SCHEDULING_SAMPLES));
  const samples = [];
  let stopped = false;
  let handle = null;
  let dueAt = clock() + intervalMs;
  const tick = () => {
    if (stopped) return;
    const callbackAt = clock();
    if (samples.length < maxSamples) samples.push(Math.max(0, callbackAt - dueAt));
    dueAt = callbackAt + intervalMs;
    handle = schedule(tick, intervalMs);
  };
  handle = schedule(tick, intervalMs);
  return {
    samples,
    stop() {
      if (stopped) return;
      stopped = true;
      if (handle !== null && handle !== undefined) {
        try { cancel(handle); } catch {}
      }
      handle = null;
    }
  };
}

function runIsolatedChild(command, args, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs || CHILD_TIMEOUT_MS));
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    env: options.env || process.env
  });
  const timedOut = Boolean(result.error && (result.error.code === "ETIMEDOUT" || /timed out/i.test(String(result.error.message || ""))));
  return {
    status: result.status,
    signal: result.signal || null,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    timedOut,
    errorCode: result.error ? String(result.error.code || "child-error") : ""
  };
}

function installObsidianStub(counters) {
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
      requestUrl() {
        counters.networkCalls += 1;
        throw benchmarkFailure("network-call");
      }
    };
  };
  return () => { Module._load = originalLoad; };
}

function mulberry32(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicVector(rng, dimensions) {
  const vector = new Array(dimensions);
  for (let index = 0; index < dimensions; index += 1) vector[index] = 0.05 + (rng() * 0.9);
  return vector;
}

function fixedBody(label) {
  const text = String(label || "benchmark-row");
  return (text + "|" + "b".repeat(BODY_BYTES)).slice(0, BODY_BYTES);
}

function makeFixture(config) {
  const rng = mulberry32(config.seed);
  const uniqueHandleCount = Math.max(1, Math.ceil(config.scopes / 2));
  const queryVectors = [];
  for (let index = 0; index < uniqueHandleCount; index += 1) queryVectors.push(deterministicVector(rng, config.dimensions));
  const chunks = [];
  const byEvidenceId = new Map();
  const controlIndices = new Set();
  for (let index = 0; index < config.rows; index += 1) {
    const pathName = `benchmark-note-${index % Math.max(1, config.scopes)}.md`;
    const scopeId = index === 5 ? "foreign-scope-control" : `scope-${index % Math.max(1, config.scopes)}`;
    let text = fixedBody(`benchmark-row-${index}-${scopeId}`);
    let embedding = deterministicVector(rng, config.dimensions);
    const over = {};
    if (index === 0) {
      // A zero-score control must remain a valid normalized vector: production
      // preparation rejects a zero-magnitude indexed vector. For dimensions
      // >=2, this vector is orthogonal to the first query vector.
      if (config.dimensions >= 2) {
        embedding = new Array(config.dimensions).fill(0);
        embedding[0] = queryVectors[0][1];
        embedding[1] = -queryVectors[0][0];
      } else embedding = [1];
      controlIndices.add(index);
    } else if (index === 1) {
      embedding = new Array(config.dimensions).fill(-0.25);
      controlIndices.add(index);
    } else if (index === 2 || index === 3) {
      text = fixedBody("benchmark-equal-body-control");
      controlIndices.add(index);
    } else if (index === 4) {
      over.metadataOnly = true;
      over.semanticUnitKind = "frontmatter";
      controlIndices.add(index);
    } else if (index === 5) {
      controlIndices.add(index);
    } else if (index === config.rows - 1 && config.rows > 6) {
      text = fixedBody(CANARY_TEXT);
      embedding[0] = CANARY_COORDINATE;
      controlIndices.add(index);
    }
    const evidenceId = `benchmark-evidence-${index}`;
    const chunk = Object.assign({
      id: `benchmark-chunk-${index}`,
      evidenceId,
      sourceId: pathName,
      path: pathName,
      scopeId,
      text,
      content: text,
      excerpt: text,
      embedding,
      embeddingContentVersion: 3,
      sourceKind: "note",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      indexMetadata: { provider: "openai", model: "text-embedding-3-small", dimension: config.dimensions },
      provenance: { sourceId: pathName, path: pathName, scopeId, lineStart: 1, lineEnd: 2 },
      sourceLineRange: { lineStart: 1, lineEnd: 2 },
      lineStart: 1,
      lineEnd: 2
    }, over);
    chunks.push(chunk);
    byEvidenceId.set(evidenceId, chunk);
  }
  const serializedHash = crypto.createHash("sha256");
  let serializedBytes = 0;
  const addSerialized = (value) => {
    const line = JSON.stringify(value) + "\n";
    serializedHash.update(line);
    serializedBytes += Buffer.byteLength(line, "utf8");
  };
  addSerialized({ seed: config.seed, rows: config.rows, dimensions: config.dimensions, scopes: config.scopes, bodyBytes: BODY_BYTES });
  for (const chunk of chunks) addSerialized(chunk);
  for (const vector of queryVectors) addSerialized({ queryVector: vector });
  const fixtureSha256 = serializedHash.digest("hex");
  const generation = `benchmark-generation-${fixtureSha256.slice(0, 16)}`;
  const queryHandles = queryVectors.map((vector, index) => ({
    provider: "openai",
    model: "text-embedding-3-small",
    encoderVersion: 3,
    dimension: config.dimensions,
    vector,
    handleId: `benchmark-handle-${index}`
  }));
  const groups = [];
  const controlEvidenceIds = Array.from(controlIndices).map((index) => chunks[index].evidenceId);
  for (let scope = 0; scope < config.scopes; scope += 1) {
    const handle = queryHandles[scope % uniqueHandleCount];
    groups.push({
      groupId: `benchmark-scope-${scope}`,
      handles: [handle, handle],
      topK: Math.max(1, Math.min(40, config.rows)),
      requiredEvidenceIds: scope === 0 ? controlEvidenceIds.slice() : []
    });
  }
  const policyFingerprint = stableJsonHash({
    schema: SCHEMA,
    mode: "chat",
    bodyBytes: BODY_BYTES,
    preparationPolicyVersion: 1,
    routeOptions: { allowLoad: false, allowBuild: true, persist: false },
    groupCount: groups.length,
    uniqueHandleCount
  });
  return {
    chunks,
    byEvidenceId,
    groups,
    queryHandles,
    controlEvidenceIds,
    fixtureSha256,
    generation,
    policyFingerprint,
    serializedBytes,
    uniqueHandleCount
  };
}

function makeRoutingInstance(Plugin, fixture, counters, config) {
  const instance = Object.create(Plugin.prototype);
  instance.settings = {
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    aiModelProvider: "openai",
    chatModel: "gpt-4o-mini",
    semanticIndexMeta: {
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: config.dimensions,
      generation: fixture.generation
    },
    maxChatContextChunks: Math.max(8, Math.min(40, config.rows)),
    maxTaskContextChunks: Math.max(8, Math.min(40, config.rows))
  };
  instance.semanticIndex = fixture.chunks;
  instance.semanticIndexRevision = 0;
  instance.semanticIndexStorageFingerprint = fixture.fixtureSha256;
  instance.semanticIndexManifestPublishedGeneration = fixture.generation;
  instance.productionSemanticRoutingState = null;
  instance.productionSemanticRoutingInFlight = new Map();
  instance.productionSemanticRoutingInvalidationSerial = 0;
  instance.productionSemanticRoutingRequestSerial = 0;
  instance.productionSemanticRoutingLatestRequest = null;
  instance.productionSemanticRoutingTelemetry = {};
  instance.currentPreparedViewRef = null;
  instance.semanticIndexPreparedView = null;
  instance.semanticIndexLoaded = true;
  instance.semanticRoutingRouteCache = new Map();
  instance.semanticExactScoreCache = new Map();
  instance.semanticRetrievalCache = new Map();
  instance.semanticCacheResourceTelemetry = Object.create(null);
  instance.taskReferenceStateRevision = 0;
  instance.isUnloading = false;
  instance.logLocal = () => {};
  instance.recordDebugDiagnostic = () => {};
  instance.schedulePendingSemanticIndexFlush = () => {};
  instance.manifest = { dir: "vault/.obsidian/plugins/semantic-todoist-sync" };
  const adapter = {};
  for (const name of ["read", "write", "remove", "rename", "exists", "stat", "mkdir"]) {
    adapter[name] = async () => {
      counters.vaultCalls += 1;
      if (["write", "remove", "rename", "mkdir"].includes(name)) counters.writeCalls += 1;
      throw benchmarkFailure("vault-call");
    };
  }
  instance.app = {
    vault: { adapter, on: () => ({}), off: () => {} },
    workspace: { getActiveViewOfType: () => null, on: () => ({}), off: () => {} }
  };
  instance.ensureSemanticIndexStorageDirectory = async () => {};
  instance.withSemanticIndexOperation = (kind, fn) => fn();
  instance.isIndexablePath = () => true;
  instance.loadData = async () => ({});
  const providerDisabled = async () => {
    counters.providerCalls += 1;
    throw benchmarkFailure("provider-call");
  };
  instance.embedSemanticChunks = providerDisabled;
  instance.embedSemanticTextsWithProvenance = providerDisabled;
  return instance;
}

function runtimeMetadata(absolutePath) {
  return {
    sha256: sha256File(absolutePath),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  };
}

function workloadReport(config, fixture) {
  return {
    fixtureSha256: fixture.fixtureSha256,
    rows: config.rows,
    dimensions: config.dimensions,
    scopes: config.scopes,
    seed: config.seed,
    bodyBytes: BODY_BYTES,
    uniqueHandles: fixture.uniqueHandleCount,
    groupCount: fixture.groups.length,
    serializedBytes: fixture.serializedBytes,
    policyFingerprint: fixture.policyFingerprint
  };
}

function hashProvenance(provenance) {
  const value = provenance && typeof provenance === "object" ? provenance : {};
  return stableJsonHash({
    sourceId: String(value.sourceId || ""),
    path: String(value.path || ""),
    scopeId: String(value.scopeId || ""),
    lineStart: Number(value.lineStart || 0),
    lineEnd: Number(value.lineEnd || 0)
  });
}

function hashBody(text) {
  return sha256Bytes(String(text || "")).slice(0, 24);
}

function validateBatch(batch, fixture, label) {
  let identityMismatchCount = 0;
  let scoreMismatchCount = 0;
  const identityRows = [];
  const scoreRows = [];
  const groups = Array.isArray(batch && batch.groups) ? batch.groups : [];
  if (groups.length !== fixture.groups.length) identityMismatchCount += 1;
  const canary = JSON.stringify(batch && batch.telemetry || {});
  if (canary.includes(CANARY_TEXT) || canary.includes(String(CANARY_COORDINATE))) identityMismatchCount += 1;
  for (let groupIndex = 0; groupIndex < fixture.groups.length; groupIndex += 1) {
    const expectedGroup = fixture.groups[groupIndex];
    const actualGroup = groups[groupIndex];
    const candidates = Array.isArray(actualGroup && actualGroup.candidates) ? actualGroup.candidates : [];
    const seen = new Set();
    const groupIdentityRows = [];
    const groupScoreRows = [];
    if (!actualGroup || String(actualGroup.groupId || "") !== String(expectedGroup.groupId)) identityMismatchCount += 1;
    for (const candidate of candidates) {
      const id = String(candidate && (candidate.routingEvidenceId || candidate.evidenceId || candidate.chunk?.evidenceId || candidate.chunk?.id) || "");
      const source = fixture.byEvidenceId.get(id);
      if (!id || !source || seen.has(id)) {
        identityMismatchCount += 1;
        continue;
      }
      seen.add(id);
      const chunk = candidate.chunk || {};
      if (String(chunk.evidenceId || "") !== id || String(chunk.text || "") !== String(source.text || "")) identityMismatchCount += 1;
      if (String(chunk.sourceId || "") !== String(source.sourceId || "") || String(chunk.path || "") !== String(source.path || "")) identityMismatchCount += 1;
      const provenance = chunk.provenance || {};
      if (hashProvenance(provenance) !== hashProvenance(source.provenance)) identityMismatchCount += 1;
      const routingScore = Number(candidate.routingScore);
      const rawScore = Number(candidate.rawSemanticScore);
      if (!Number.isFinite(routingScore) || !Number.isFinite(rawScore)) scoreMismatchCount += 1;
      groupIdentityRows.push({ id, bodyHash: hashBody(source.text), provenanceHash: hashProvenance(source.provenance), scopeHash: stableJsonHash(String(source.scopeId || "")) });
      groupScoreRows.push({ id, routingScore: Number.isFinite(routingScore) ? routingScore : null, rawScore: Number.isFinite(rawScore) ? rawScore : null });
    }
    for (const requiredId of expectedGroup.requiredEvidenceIds) if (!seen.has(String(requiredId))) identityMismatchCount += 1;
    groupIdentityRows.sort((left, right) => left.id.localeCompare(right.id));
    groupScoreRows.sort((left, right) => left.id.localeCompare(right.id));
    identityRows.push({ groupId: expectedGroup.groupId, rows: groupIdentityRows });
    scoreRows.push({ groupId: expectedGroup.groupId, rows: groupScoreRows });
  }
  return {
    matched: identityMismatchCount === 0 && scoreMismatchCount === 0,
    identityMismatchCount,
    scoreMismatchCount,
    identityFingerprint: stableJsonHash(identityRows),
    scoreFingerprint: stableJsonHash(scoreRows),
    selectionFingerprint: stableJsonHash(identityRows),
    label
  };
}

function compareValidation(left, right) {
  let identityMismatchCount = 0;
  let scoreMismatchCount = 0;
  if (!left || !right || left.identityFingerprint !== right.identityFingerprint) identityMismatchCount += 1;
  if (!left || !right || left.scoreFingerprint !== right.scoreFingerprint) scoreMismatchCount += 1;
  return {
    matched: identityMismatchCount === 0 && scoreMismatchCount === 0,
    identityMismatchCount,
    scoreMismatchCount
  };
}

function routeOptions(instance, fixture) {
  return {
    mode: "chat",
    routingState: instance.currentPreparedViewRef?.routingState || instance.productionSemanticRoutingState,
    indexRevision: instance.semanticIndexRevision,
    storageFingerprint: fixture.fixtureSha256
  };
}

async function routeOnce(instance, fixture) {
  return instance.routeProductionSemanticCandidateBatches(fixture.groups, fixture.chunks, routeOptions(instance, fixture));
}

function clearMeasuredCaches(instance) {
  for (const name of ["semanticRoutingRouteCache", "semanticExactScoreCache"]) {
    const cache = instance[name];
    if (!cache || typeof cache.clear !== "function") throw benchmarkFailure(`missing-${name}`);
    cache.clear();
  }
}

function routeCounters(batch) {
  const telemetry = batch && batch.telemetry || {};
  const number = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  return {
    routingRowsScanned: number(telemetry.routingRowsScanned),
    exactScorePairCount: number(telemetry.exactScorePairCount),
    routingCacheHits: number(telemetry.routingCacheHits),
    exactScoreCacheHits: number(telemetry.exactScoreCacheHits)
  };
}

function addCounters(target, value) {
  for (const name of Object.keys(target)) target[name] += Number(value[name] || 0);
}

async function measureStage(instance, fixture, runs, kind, schedulingSamples) {
  const counters = { routingRowsScanned: 0, exactScorePairCount: 0, routingCacheHits: 0, exactScoreCacheHits: 0 };
  if (kind === "warm-hit") {
    clearMeasuredCaches(instance);
    const primed = await routeOnce(instance, fixture);
    const primedValidation = validateBatch(primed, fixture, "warm-hit-prime");
    if (!primedValidation.matched) throw benchmarkFailure("warm-hit-prime-correctness");
  }
  const probe = createSchedulingDelayProbe();
  const samples = [];
  let firstValidation = null;
  let workError = null;
  try {
    for (let run = 0; run < runs; run += 1) {
      if (kind === "warm-miss") clearMeasuredCaches(instance);
      const started = nowMs();
      try {
        const batch = await routeOnce(instance, fixture);
        const elapsed = Math.max(0, nowMs() - started);
        const validation = validateBatch(batch, fixture, `${kind}-${run}`);
        if (!firstValidation) firstValidation = validation;
        if (!validation.matched) throw benchmarkFailure(`${kind}-correctness`);
        samples.push(elapsed);
        addCounters(counters, routeCounters(batch));
        if (kind === "warm-miss" && counters.routingRowsScanned <= 0 && run === 0) throw benchmarkFailure("warm-miss-did-not-traverse");
        if (kind === "warm-hit" && counters.routingRowsScanned > 0) throw benchmarkFailure("warm-hit-traversed");
      } catch (error) {
        workError = error;
        break;
      }
    }
  } finally {
    try { await new Promise((resolve) => setTimeout(resolve, SCHEDULING_INTERVAL_MS * 2)); } catch {}
    probe.stop();
    schedulingSamples.push(...probe.samples.slice());
  }
  if (workError) throw workError;
  if (samples.length !== runs) throw benchmarkFailure(`${kind}-sample-count`);
  if (kind === "warm-hit" && counters.routingCacheHits + counters.exactScoreCacheHits <= 0) throw benchmarkFailure("warm-hit-did-not-hit-cache");
  return { samples, counters, firstValidation };
}

function schedulingReport(samples) {
  const p99 = samples.length >= 1000 ? percentile(samples, 0.99) : null;
  return {
    sampleCount: samples.length,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: p99,
    maxMs: samples.length ? Math.max(...samples) : null,
    tailStatus: p99 === null ? "insufficient-samples" : "measured"
  };
}

function resourceReport(beforeUsage, afterUsage, beforeMemory, afterMemory) {
  return {
    cpuUserMicros: Math.max(0, Number(afterUsage.userCPUTime || 0) - Number(beforeUsage.userCPUTime || 0)),
    cpuSystemMicros: Math.max(0, Number(afterUsage.systemCPUTime || 0) - Number(beforeUsage.systemCPUTime || 0)),
    rssBeforeBytes: Number(beforeMemory.rss || 0),
    rssAfterBytes: Number(afterMemory.rss || 0),
    heapAfterBytes: Number(afterMemory.heapUsed || 0)
  };
}

function safetyReport(counters) {
  return {
    networkCalls: Number(counters.networkCalls || 0),
    vaultCalls: Number(counters.vaultCalls || 0),
    writeCalls: Number(counters.writeCalls || 0),
    childTimeouts: 0,
    providerCalls: Number(counters.providerCalls || 0)
  };
}

function baseFailureReport(status, mode, reasonCode, runtime = null) {
  return {
    schema: SCHEMA,
    status,
    mode,
    reasonCode,
    runtime,
    workload: null,
    correctness: { matched: false, identityMismatchCount: 0, scoreMismatchCount: 0, identityFingerprint: "", selectionFingerprint: "", scoreFingerprint: "" },
    stages: { coldPreparationMs: null, warmMiss: stageReport([], {}), warmHit: stageReport([], {}) },
    schedulingDelay: schedulingReport([]),
    resources: resourceReport({}, {}, {}, {}),
    safety: { networkCalls: 0, vaultCalls: 0, writeCalls: 0, childTimeouts: 0, providerCalls: 0 },
    comparison: { comparable: false, medianDeltasMs: null, reasonCode: "" }
  };
}

async function loadRuntime(absolutePath, counters) {
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return { unsupported: true, reasonCode: "runtime-missing" };
  let Plugin;
  try {
    delete require.cache[require.resolve(absolutePath)];
    Plugin = require(absolutePath);
  } catch {
    return { unsupported: true, reasonCode: "runtime-load-failed" };
  }
  if (!Plugin || !Plugin.prototype || typeof Plugin.prototype.ensureProductionSemanticRoutingState !== "function" || typeof Plugin.prototype.routeProductionSemanticCandidateBatches !== "function") {
    return { unsupported: true, reasonCode: "runtime-interface-unsupported" };
  }
  return { Plugin, runtime: runtimeMetadata(absolutePath) };
}

async function runSingleRuntime(config, runtimePath) {
  const absolutePath = path.resolve(runtimePath);
  const counters = { networkCalls: 0, vaultCalls: 0, writeCalls: 0, providerCalls: 0 };
  const restoreObsidian = installObsidianStub(counters);
  const originalFetch = global.fetch;
  const originalRequestUrl = global.requestUrl;
  global.fetch = () => {
    counters.networkCalls += 1;
    throw benchmarkFailure("network-call");
  };
  global.requestUrl = () => {
    counters.networkCalls += 1;
    throw benchmarkFailure("network-call");
  };
  let runtime = null;
  try {
    const loaded = await loadRuntime(absolutePath, counters);
    if (loaded.unsupported) return baseFailureReport("NONCOMPARABLE", "single-runtime", loaded.reasonCode, null);
    runtime = loaded.runtime;
    const fixture = makeFixture(config);
    const instance = makeRoutingInstance(loaded.Plugin, fixture, counters, config);
    const beforeUsage = process.resourceUsage();
    const beforeMemory = process.memoryUsage();
    const coldStarted = nowMs();
    const routingState = await instance.ensureProductionSemanticRoutingState({
      chunks: fixture.chunks,
      settings: instance.settings,
      revision: instance.semanticIndexRevision,
      storageFingerprint: fixture.fixtureSha256,
      generation: fixture.generation,
      provider: "openai",
      model: "text-embedding-3-small",
      dimension: config.dimensions,
      allowLoad: false,
      allowBuild: true,
      persist: false
    });
    const coldPreparationMs = Math.max(0, nowMs() - coldStarted);
    if (!routingState || !routingState.routingIndex || !instance.currentPreparedViewRef) throw benchmarkFailure("cold-preparation-not-ready");
    if (counters.networkCalls || counters.vaultCalls || counters.providerCalls) throw benchmarkFailure("preparation-performed-forbidden-io");
    const warmup = await routeOnce(instance, fixture);
    const warmupValidation = validateBatch(warmup, fixture, "warmup");
    if (!warmupValidation.matched) throw benchmarkFailure("warmup-correctness");
    const schedulingSamples = [];
    const warmMiss = await measureStage(instance, fixture, config.runs, "warm-miss", schedulingSamples);
    const warmHit = await measureStage(instance, fixture, config.runs, "warm-hit", schedulingSamples);
    const between = compareValidation(warmMiss.firstValidation, warmHit.firstValidation);
    const afterUsage = process.resourceUsage();
    const afterMemory = process.memoryUsage();
    const correctness = {
      matched: between.matched,
      identityMismatchCount: between.identityMismatchCount,
      scoreMismatchCount: between.scoreMismatchCount,
      identityFingerprint: warmMiss.firstValidation?.identityFingerprint || "",
      selectionFingerprint: warmMiss.firstValidation?.selectionFingerprint || "",
      scoreFingerprint: warmMiss.firstValidation?.scoreFingerprint || ""
    };
    const safety = safetyReport(counters);
    const status = correctness.matched && safety.networkCalls === 0 && safety.vaultCalls === 0 && safety.providerCalls === 0
      && warmMiss.samples.length === config.runs && warmHit.samples.length === config.runs
      ? "PASS" : "FAIL";
    const report = {
      schema: SCHEMA,
      status,
      mode: "single-runtime",
      reasonCode: status === "PASS" ? "" : "correctness-or-safety-failed",
      runtime,
      workload: workloadReport(config, fixture),
      correctness,
      stages: {
        coldPreparationMs,
        warmMiss: stageReport(warmMiss.samples, warmMiss.counters),
        warmHit: stageReport(warmHit.samples, warmHit.counters)
      },
      schedulingDelay: schedulingReport(schedulingSamples),
      resources: resourceReport(beforeUsage, afterUsage, beforeMemory, afterMemory),
      safety,
      comparison: { comparable: false, medianDeltasMs: null, reasonCode: "single-runtime-no-comparison-claim" }
    };
    return report;
  } catch (error) {
    const report = baseFailureReport("FAIL", "single-runtime", String(error && error.code || "runtime-measurement-failed"), runtime);
    report.safety = safetyReport(counters);
    return report;
  } finally {
    global.fetch = originalFetch;
    if (originalRequestUrl === undefined) delete global.requestUrl;
    else global.requestUrl = originalRequestUrl;
    restoreObsidian();
  }
}

function childArgs(config, runtimePath) {
  return [
    __filename,
    "--runtime", runtimePath,
    "--rows", String(config.rows),
    "--dimensions", String(config.dimensions),
    "--scopes", String(config.scopes),
    "--runs", String(config.runs),
    "--seed", String(config.seed),
    "--network", "deny"
  ];
}

function parseChildReport(result) {
  if (result.timedOut) return { errorCode: "child-timeout" };
  if (result.status === null && result.errorCode) return { errorCode: "child-process-failed" };
  try {
    const report = JSON.parse(String(result.stdout || "").trim());
    if (!report || report.schema !== SCHEMA) return { errorCode: "child-invalid-report" };
    return { report };
  } catch {
    return { errorCode: "child-invalid-report" };
  }
}

function comparableWorkload(left, right) {
  const fields = ["fixtureSha256", "rows", "dimensions", "scopes", "seed", "bodyBytes", "uniqueHandles", "groupCount", "serializedBytes", "policyFingerprint"];
  return fields.every((field) => left && right && left[field] === right[field]);
}

async function runComparison(config) {
  const baselinePath = path.resolve(config.baseline);
  const candidatePath = path.resolve(config.candidate);
  if (!fs.existsSync(baselinePath) || !fs.statSync(baselinePath).isFile()) return baseFailureReport("NONCOMPARABLE", "comparison", "baseline-artifact-missing", null);
  if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) return baseFailureReport("NONCOMPARABLE", "comparison", "candidate-artifact-missing", null);
  const started = Date.now();
  const runChild = (runtimePath) => {
    const remaining = PARENT_DEADLINE_MS - (Date.now() - started);
    if (remaining <= 0) return { timedOut: true, status: null, stdout: "", stderr: "", errorCode: "parent-deadline" };
    return runIsolatedChild(process.execPath, childArgs(config, runtimePath), {
      timeoutMs: Math.min(CHILD_TIMEOUT_MS, remaining),
      cwd: process.cwd()
    });
  };
  const baselineResult = parseChildReport(runChild(baselinePath));
  if (baselineResult.errorCode) {
    const status = baselineResult.errorCode === "child-timeout" ? "FAIL" : "NONCOMPARABLE";
    return baseFailureReport(status, "comparison", `baseline-${baselineResult.errorCode}`, null);
  }
  const candidateResult = parseChildReport(runChild(candidatePath));
  if (candidateResult.errorCode) {
    return baseFailureReport("FAIL", "comparison", `candidate-${candidateResult.errorCode}`, null);
  }
  const baseline = baselineResult.report;
  const candidate = candidateResult.report;
  if (baseline.status !== "PASS") return baseFailureReport(baseline.status === "NONCOMPARABLE" ? "NONCOMPARABLE" : "FAIL", "comparison", `baseline-${baseline.reasonCode || "not-pass"}`, { baseline: baseline.runtime, candidate: candidate.runtime });
  if (candidate.status !== "PASS") return baseFailureReport("FAIL", "comparison", `candidate-${candidate.reasonCode || "not-pass"}`, { baseline: baseline.runtime, candidate: candidate.runtime });
  const sameEnvironment = baseline.runtime && candidate.runtime
    && baseline.runtime.nodeVersion === candidate.runtime.nodeVersion
    && baseline.runtime.platform === candidate.runtime.platform
    && baseline.runtime.arch === candidate.runtime.arch;
  if (!sameEnvironment || !comparableWorkload(baseline.workload, candidate.workload)) {
    return baseFailureReport("NONCOMPARABLE", "comparison", "workload-or-environment-mismatch", { baseline: baseline.runtime, candidate: candidate.runtime });
  }
  if (!baseline.correctness.matched || !candidate.correctness.matched
      || baseline.correctness.selectionFingerprint !== candidate.correctness.selectionFingerprint
      || baseline.correctness.scoreFingerprint !== candidate.correctness.scoreFingerprint) {
    return baseFailureReport("NONCOMPARABLE", "comparison", "correctness-membership-mismatch", { baseline: baseline.runtime, candidate: candidate.runtime });
  }
  const sameRuntime = baseline.runtime.sha256 === candidate.runtime.sha256;
  const medianDeltasMs = sameRuntime ? null : {
    coldPreparationMs: Number(candidate.stages.coldPreparationMs) - Number(baseline.stages.coldPreparationMs),
    warmMissP50Ms: Number(candidate.stages.warmMiss.p50Ms) - Number(baseline.stages.warmMiss.p50Ms),
    warmHitP50Ms: Number(candidate.stages.warmHit.p50Ms) - Number(baseline.stages.warmHit.p50Ms)
  };
  return {
    schema: SCHEMA,
    status: "PASS",
    mode: "comparison",
    reasonCode: "",
    runtime: { baseline: baseline.runtime, candidate: candidate.runtime },
    workload: baseline.workload,
    correctness: {
      matched: true,
      identityMismatchCount: 0,
      scoreMismatchCount: 0,
      identityFingerprint: baseline.correctness.identityFingerprint,
      selectionFingerprint: baseline.correctness.selectionFingerprint,
      scoreFingerprint: baseline.correctness.scoreFingerprint
    },
    stages: { baseline: baseline.stages, candidate: candidate.stages },
    schedulingDelay: { baseline: baseline.schedulingDelay, candidate: candidate.schedulingDelay },
    resources: { baseline: baseline.resources, candidate: candidate.resources },
    safety: { baseline: baseline.safety, candidate: candidate.safety, childTimeouts: 0 },
    comparison: {
      comparable: true,
      medianDeltasMs,
      reasonCode: sameRuntime ? "same-runtime-self-control-no-speedup-claim" : "descriptive-candidate-minus-baseline",
      speedupClaim: false
    }
  };
}

async function main() {
  let config;
  try {
    config = parseArgs(process.argv.slice(2));
  } catch (error) {
    const report = baseFailureReport("FAIL", "invalid-arguments", String(error && error.code || "invalid-arguments"), null);
    report.usage = USAGE;
    console.log(JSON.stringify(report));
    process.exitCode = 1;
    return;
  }
  const report = config.mode === "single-runtime"
    ? await runSingleRuntime(config, config.runtime)
    : await runComparison(config);
  console.log(JSON.stringify(report));
  if (report.status !== "PASS") process.exitCode = 1;
}

module.exports = Object.freeze({
  SCHEMA,
  parseArgs,
  percentile,
  createSchedulingDelayProbe,
  runIsolatedChild,
  comparableWorkload
});

if (require.main === module) {
  main().catch((error) => {
    const report = baseFailureReport("FAIL", "runtime", String(error && error.code || "benchmark-execution-failed"), null);
    console.log(JSON.stringify(report));
    process.exitCode = 1;
  });
}
