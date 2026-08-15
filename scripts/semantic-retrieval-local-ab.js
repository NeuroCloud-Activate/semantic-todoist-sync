"use strict";

const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const Module = require("module");
const http = require("http");
const https = require("https");
const net = require("net");

const networkDisabled = () => { throw new Error("Network access is disabled in the local semantic benchmark."); };
http.request = networkDisabled;
http.get = networkDisabled;
https.request = networkDisabled;
https.get = networkDisabled;
net.connect = networkDisabled;
net.createConnection = networkDisabled;
global.fetch = networkDisabled;

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
    requestUrl() { throw new Error("Network calls are disabled in the local semantic benchmark."); }
  };
};
global.window = global;

const PluginModule = require(path.join(__dirname, "..", "main.js"));
const semantic = PluginModule.__semanticRetrieval;

function findFixtureIndex(root) {
  const pending = [path.resolve(root)];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.name === "semantic-index.openwebui.json") return current;
    }
  }
  throw new Error("No OpenWebUI semantic index manifest was found beneath the supplied fixture root.");
}

function loadChunks(indexDirectory) {
  const shardPattern = /^semantic-index\.openwebui\..+\.\d{3}\.json$/;
  const files = fs.readdirSync(indexDirectory).filter((name) => shardPattern.test(name)).sort();
  if (!files.length) throw new Error("The fixture index has no semantic shard files.");
  const chunks = [];
  let bytes = 0;
  for (const name of files) {
    const absolute = path.join(indexDirectory, name);
    bytes += fs.statSync(absolute).size;
    const payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
    if (!Array.isArray(payload.chunks)) throw new Error("A semantic shard has no chunks array.");
    chunks.push(...payload.chunks);
  }
  return { chunks, shardCount: files.length, bytes };
}

function loadRoutingIndex(indexDirectory) {
  const artifactPath = path.join(indexDirectory, "semantic-index-routing.json");
  if (!fs.existsSync(artifactPath)) return null;
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const store = artifact.vectorStore || {};
  const bytes = Buffer.from(String(store.data || ""), "base64");
  return {
    schemaVersion: Number(artifact.schemaVersion),
    generation: String(artifact.generation || ""),
    encoder: {
      id: `indexed-routing:${String(artifact.provider || "")}:${String(artifact.model || "")}`,
      version: Number(artifact.contentVersion),
      dimension: Number(artifact.dimension),
      normalization: "l2",
      quantization: { type: String(store.format || "int8"), scale: Number(store.scale) }
    },
    evidenceIds: artifact.evidenceIds || [],
    sourceIds: artifact.sourceIds || [],
    shardRefs: artifact.shardRefs || [],
    scopeRefs: artifact.scopeRefs || [],
    taskRefs: artifact.taskRefs || [],
    temporalMetadata: artifact.temporalMetadata || [],
    routingMetadata: artifact.routingMetadata || [],
    vectorStore: { values: Int8Array.from(bytes) }
  };
}

function benchmarkIntegrityHash(index) {
  if (!index) return { available: false };
  const legacyStartedAt = performance.now();
  const descriptor = index.encoder || {};
  let fingerprint = [index.schemaVersion, index.generation, descriptor.id, descriptor.version, descriptor.dimension, descriptor.normalization, descriptor.quantization?.type, descriptor.quantization?.scale].join("|");
  for (let row = 0; row < index.evidenceIds.length; row += 1) {
    fingerprint += `|${index.evidenceIds[row]}|${index.sourceIds[row]}|${index.shardRefs[row]}|${JSON.stringify(index.scopeRefs[row])}|${JSON.stringify(index.taskRefs[row])}|${JSON.stringify(index.temporalMetadata[row])}|${JSON.stringify(index.routingMetadata?.[row])}`;
  }
  for (let indexValue = 0; indexValue < index.vectorStore.values.length; indexValue += 1) fingerprint += `|${index.vectorStore.values[indexValue]}`;
  const legacyHash = semantic.localSemanticRoutingStableHash(fingerprint);
  const legacyElapsedMs = performance.now() - legacyStartedAt;
  const optimizedStartedAt = performance.now();
  const optimizedHash = semantic.localSemanticRoutingIndexIntegrity(index);
  const optimizedElapsedMs = performance.now() - optimizedStartedAt;
  if (legacyHash !== optimizedHash) throw new Error("The streaming routing-integrity hash changed the persisted hash contract.");
  return {
    available: true,
    valueCount: index.vectorStore.values.length,
    legacyElapsedMs: Number(legacyElapsedMs.toFixed(3)),
    optimizedElapsedMs: Number(optimizedElapsedMs.toFixed(3)),
    speedup: Number((legacyElapsedMs / Math.max(0.000001, optimizedElapsedMs)).toFixed(2)),
    contractCompatible: true
  };
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function sampleQueries(chunks, limit) {
  const eligible = chunks.map((chunk) => {
    const title = String(chunk.title || chunk.heading || chunk.provenance?.title || "");
    const terms = semantic.localSemanticTextSeedTerms(title)
      .filter((term) => /^[a-z0-9][a-z0-9_-]{1,63}$/.test(term));
    return { chunk, query: terms.slice(0, 16).join(" ") };
  }).filter(({ chunk, query }) => String(chunk.evidenceId || chunk.id || "")
    && Array.isArray(chunk.embedding)
    && chunk.embedding.length
    && query.split(" ").filter(Boolean).length >= 2);
  if (!eligible.length) throw new Error("The fixture has no eligible title-based benchmark records.");
  const result = [];
  const stride = Math.max(1, Math.floor(eligible.length / limit));
  for (let index = 0; index < eligible.length && result.length < limit; index += stride) {
    const { chunk, query } = eligible[index];
    result.push({
      query,
      evidenceId: String(chunk.evidenceId || chunk.id || ""),
      sourceId: String(chunk.sourceId || chunk.provenance?.sourceId || chunk.path || "")
    });
  }
  return result;
}

function selectedIdentitySets(result) {
  return {
    evidenceIds: new Set((result.handles || []).flatMap((handle) => handle.sourceEvidenceIds || []).map(String)),
    sourceIds: new Set((result.handles || []).flatMap((handle) => handle.sourceIds || []).map(String))
  };
}

function runVariant(name, queries, execute) {
  const elapsed = [];
  let exactHits = 0;
  let sourceHits = 0;
  let candidateTotal = 0;
  let postingVisits = 0;
  const selections = [];
  for (const benchmark of queries) {
    const startedAt = performance.now();
    const result = execute(benchmark.query);
    elapsed.push(performance.now() - startedAt);
    if (Number(result.telemetry?.externalQueryEmbeddingCalls || 0) !== 0 || Number(result.telemetry?.runtimeExternalCalls || 0) !== 0) {
      throw new Error(`${name} attempted an external call.`);
    }
    candidateTotal += Number(result.telemetry?.candidateCount || 0);
    postingVisits += Number(result.telemetry?.postingVisits || 0);
    const selected = selectedIdentitySets(result);
    if (selected.evidenceIds.has(benchmark.evidenceId)) exactHits += 1;
    if (benchmark.sourceId && selected.sourceIds.has(benchmark.sourceId)) sourceHits += 1;
    selections.push(selected.evidenceIds);
  }
  return {
    name,
    queryCount: queries.length,
    latencyMs: {
      mean: elapsed.reduce((sum, value) => sum + value, 0) / Math.max(1, elapsed.length),
      p50: percentile(elapsed, 0.5),
      p95: percentile(elapsed, 0.95),
      max: Math.max(...elapsed, 0)
    },
    exactEvidenceRecallAt4: exactHits / Math.max(1, queries.length),
    sourceRecallAt4: sourceHits / Math.max(1, queries.length),
    averageCandidateCount: candidateTotal / Math.max(1, queries.length),
    averagePostingVisits: postingVisits / Math.max(1, queries.length),
    selections
  };
}

function roundMetrics(result) {
  return {
    name: result.name,
    queryCount: result.queryCount,
    latencyMs: Object.fromEntries(Object.entries(result.latencyMs).map(([key, value]) => [key, Number(value.toFixed(3))])),
    exactEvidenceRecallAt4: Number(result.exactEvidenceRecallAt4.toFixed(4)),
    sourceRecallAt4: Number(result.sourceRecallAt4.toFixed(4)),
    averageCandidateCount: Number(result.averageCandidateCount.toFixed(2)),
    averagePostingVisits: Number(result.averagePostingVisits.toFixed(2))
  };
}

function benchmarkTaskContextDeduplication(chunks) {
  const base = chunks.filter((chunk) => String(chunk?.evidenceId || chunk?.id || "")).slice(0, 12);
  const scoped = base.slice(0, 6).map((chunk, index) => ({
    ...chunk,
    queryId: `local-scope-${index}`,
    queryTaskId: `local-task-${index}`,
    queryScopeId: `local-scope-${index}`,
    selectionReasonCode: "local-ab-overlap"
  }));
  const combined = [...base, ...scoped];
  const deduplicated = semantic.uniqueSemanticEvidenceChunks(combined);
  const identities = (values) => new Set(values.map((chunk) => String(chunk?.evidenceId || chunk?.id || "")).filter(Boolean));
  const beforeIdentities = identities(combined);
  const afterIdentities = identities(deduplicated);
  const deduplicatedById = new Map(deduplicated.map((chunk) => [String(chunk?.evidenceId || chunk?.id || ""), chunk]));
  const scopedAssociationsPreserved = scoped.every((chunk, index) => {
    const retained = deduplicatedById.get(String(chunk?.evidenceId || chunk?.id || ""));
    return (retained?.taskScopeAssociations || []).some((association) => association.taskId === `local-task-${index}` && association.scopeId === `local-scope-${index}`);
  });
  const beforeChars = JSON.stringify(combined).length;
  const afterChars = JSON.stringify(deduplicated).length;
  return {
    inputCount: combined.length,
    outputCount: deduplicated.length,
    duplicateCountRemoved: combined.length - deduplicated.length,
    serializedCharReductionProxy: beforeChars - afterChars,
    measurementScope: "in-memory context objects; not provider-token usage",
    evidenceSetPreserved: beforeIdentities.size === afterIdentities.size && Array.from(beforeIdentities).every((id) => afterIdentities.has(id)),
    scopedAssociationCount: deduplicated.reduce((count, chunk) => count + Number(chunk.taskScopeAssociations?.length || 0), 0),
    scopedAssociationsPreserved
  };
}

function verifyUnicodeExpansion() {
  const chunks = [
    { evidenceId: "unicode-a", sourceId: "unicode-source-a", title: "\u0391\u03b8\u03ae\u03bd\u03b1 \u03ad\u03c1\u03b3\u03bf", text: "\u0391\u03b8\u03ae\u03bd\u03b1 \u03ad\u03c1\u03b3\u03bf", embedding: [1, 0] },
    { evidenceId: "unicode-b", sourceId: "unicode-source-b", title: "\u6771\u4eac \u4f1a\u8b70", text: "\u6771\u4eac \u4f1a\u8b70", embedding: [0, 1] }
  ];
  const textSeedIndex = semantic.buildLocalSemanticTextSeedIndex(chunks);
  const queries = ["\u0391\u03b8\u03ae\u03bd\u03b1 \u03ad\u03c1\u03b3\u03bf", "\u6771\u4eac \u4f1a\u8b70"];
  const optimizedHits = queries.filter((query) => semantic.resolveIndexedLocalTextSeedQueryHandles({ query, compatibleChunks: chunks, textSeedIndex, maxSeeds: 2, dimension: 2 }).handles.length > 0).length;
  const legacyHits = queries.filter((query) => semantic.resolveIndexedLocalTextSeedQueryHandlesLegacy({ query, compatibleChunks: chunks, maxSeeds: 2, dimension: 2 }).handles.length > 0).length;
  if (optimizedHits !== queries.length || legacyHits !== 0) throw new Error("Unicode expansion contract did not match expectations.");
  return { queryCount: queries.length, legacyHits, optimizedHits, measurementScope: "synthetic behavior-expansion assertion; excluded from parity metrics" };
}

function verifyCacheInvalidationContracts() {
  const prototype = PluginModule.prototype;
  const instance = Object.create(prototype);
  instance.settings = { semanticIndexMeta: {}, useNoteCreatedTimeForSemanticIndex: true };
  instance.semanticIndexRevision = 7;
  instance.semanticIndexStorageFingerprint = "storage-a";
  instance.taskReferenceStateRevision = 3;
  const key = (prompt) => prototype.semanticRetrievalCacheKey.call(instance, "same query", 4, { mode: "chat", prompt });
  const baseline = key("seed prompt a");
  const promptSensitive = baseline !== key("seed prompt b");
  instance.semanticIndexRevision += 1;
  const revisionSensitive = baseline !== key("seed prompt a");
  instance.semanticIndexRevision -= 1;
  instance.semanticIndexStorageFingerprint = "storage-b";
  const storageSensitive = baseline !== key("seed prompt a");
  instance.semanticRetrievalCache = new Map([["x", {}]]);
  instance.taskSemanticContextCache = new Map([["x", {}]]);
  instance.semanticRoutingRouteCache = new Map([["x", {}]]);
  instance.semanticExactScoreCache = new Map([["x", 1]]);
  instance.productionSemanticRoutingState = { stale: true };
  const revisionBeforeInvalidation = instance.semanticIndexRevision;
  prototype.invalidateSemanticRetrievalCache.call(instance);
  const invalidationCleared = instance.semanticRetrievalCache.size === 0
    && instance.taskSemanticContextCache.size === 0
    && instance.semanticRoutingRouteCache.size === 0
    && instance.semanticExactScoreCache.size === 0
    && instance.productionSemanticRoutingState === null
    && instance.semanticIndexRevision === revisionBeforeInvalidation + 1;
  if (!promptSensitive || !revisionSensitive || !storageSensitive || !invalidationCleared) {
    throw new Error("A semantic cache identity or invalidation contract failed.");
  }
  return { promptSensitive, revisionSensitive, storageSensitive, invalidationCleared };
}

function main() {
  if (!process.argv[2]) throw new Error("Pass the permitted read-only fixture root explicitly.");
  const fixtureRoot = process.argv[2];
  const parsedQueryLimit = process.argv[3] === undefined ? 80 : Number(process.argv[3]);
  if (!Number.isFinite(parsedQueryLimit) || !Number.isInteger(parsedQueryLimit)) throw new Error("Query count must be a finite integer.");
  const queryLimit = Math.max(8, Math.min(500, parsedQueryLimit));
  const indexDirectory = findFixtureIndex(fixtureRoot);
  const loaded = loadChunks(indexDirectory);
  const queries = sampleQueries(loaded.chunks, queryLimit);
  if (!queries.length) throw new Error("The benchmark produced no queries.");
  const taskContextDeduplication = benchmarkTaskContextDeduplication(loaded.chunks);
  if (!taskContextDeduplication.evidenceSetPreserved || !taskContextDeduplication.scopedAssociationsPreserved) throw new Error("Task context deduplication lost evidence identity or scoped associations.");
  const unicodeExpansion = verifyUnicodeExpansion();
  const cacheInvalidation = verifyCacheInvalidationContracts();
  const beforeBuild = process.memoryUsage().heapUsed;
  const buildStartedAt = performance.now();
  const textSeedIndex = semantic.buildLocalSemanticTextSeedIndex(loaded.chunks);
  const buildElapsedMs = performance.now() - buildStartedAt;
  const buildHeapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - beforeBuild);
  const integrityBenchmark = benchmarkIntegrityHash(loadRoutingIndex(indexDirectory));
  const shared = { compatibleChunks: loaded.chunks, maxSeeds: 4, indexRevision: 0 };
  const legacy = runVariant("legacy-full-corpus-regex", queries, (query) => semantic.resolveIndexedLocalTextSeedQueryHandlesLegacy({ ...shared, query }));
  const optimized = runVariant("idf-inverted-index", queries, (query) => semantic.resolveIndexedLocalTextSeedQueryHandles({ ...shared, query, textSeedIndex }));
  let identicalSelectionCount = 0;
  for (let index = 0; index < queries.length; index += 1) {
    const left = Array.from(legacy.selections[index]).sort().join("|");
    const right = Array.from(optimized.selections[index]).sort().join("|");
    if (left === right) identicalSelectionCount += 1;
  }
  const report = {
    privacy: {
      fixtureAccess: "read-only",
      networkCallsObserved: 0,
      contentIncludedInReport: false,
      identifiersIncludedInReport: false,
      processNetworkGuard: "best-effort common transports blocked"
    },
    corpus: {
      shardCount: loaded.shardCount,
      chunkCount: loaded.chunks.length,
      bytes: loaded.bytes,
      vocabularyTerms: textSeedIndex.postings.size
    },
    indexBuild: {
      elapsedMs: Number(buildElapsedMs.toFixed(3)),
      heapDeltaEstimateBytes: buildHeapDeltaBytes,
      heapMeasurement: "point-in-time estimate"
    },
    routingIntegrityHash: integrityBenchmark,
    taskContextDeduplication,
    unicodeExpansion,
    cacheInvalidation,
    variants: [roundMetrics(legacy), roundMetrics(optimized)],
    comparison: {
      meanLatencySpeedup: Number((legacy.latencyMs.mean / Math.max(0.000001, optimized.latencyMs.mean)).toFixed(2)),
      p95LatencySpeedup: Number((legacy.latencyMs.p95 / Math.max(0.000001, optimized.latencyMs.p95)).toFixed(2)),
      exactEvidenceRecallDelta: Number((optimized.exactEvidenceRecallAt4 - legacy.exactEvidenceRecallAt4).toFixed(4)),
      sourceRecallDelta: Number((optimized.sourceRecallAt4 - legacy.sourceRecallAt4).toFixed(4)),
      identicalSelectionSetRate: Number((identicalSelectionCount / queries.length).toFixed(4)),
      workload: "deterministic ASCII title-term to source parity proxy",
      qualityClaim: "local microbenchmark only; not an end-user relevance evaluation"
    }
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main();
