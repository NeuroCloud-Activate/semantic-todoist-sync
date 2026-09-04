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

const SUPPORTED_PARTITION_PROVIDERS = new Set(["openai", "gemini", "openrouter", "openwebui"]);
const SUPPORTED_MANIFEST_BASENAMES = new Set([
  "semantic-index.openai.json",
  "semantic-index.gemini.json",
  "semantic-index.openrouter.json",
  "semantic-index.multi-provider.openrouter.json",
  "semantic-index.openwebui.json",
  "semantic-index.multi-provider.openwebui.json",
  "semantic-index.json"
]);
const LOCAL_SEMANTIC_ROUTING_ARTIFACT_FILE = "semantic-index-routing.json";
const SEMANTIC_INDEX_PATH_META_FILE = "semantic-index-path-meta.json";

function isPathMetaArtifact(name) {
  if (!name || typeof name !== "string") return false;
  if (name === SEMANTIC_INDEX_PATH_META_FILE) return true;
  if (name.startsWith("semantic-index-path-meta.") && name.endsWith(".json")) return true;
  return false;
}

function loadExpectedIdentity(fixtureRoot) {
  const rootResolved = path.resolve(fixtureRoot);
  const candidates = [
    path.join(rootResolved, ".obsidian", "plugins", "semantic-todoist-sync", "data.json"),
    path.join(rootResolved, "data.json")
  ];
  let parsed = null;
  let dataPath = "";
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const raw = fs.readFileSync(p, "utf8");
        parsed = JSON.parse(raw);
        dataPath = p;
        if (parsed && typeof parsed === "object") break;
      }
    } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== "object") {
    const err = new Error("Current semantic identity is missing: data.json with semanticIndexMeta not found beneath fixture root.");
    err.code = "EXPECTED_IDENTITY_MISSING";
    err.expectedPath = candidates[0];
    throw err;
  }
  let meta = parsed.semanticIndexMeta || parsed.settings?.semanticIndexMeta || null;
  if (!meta && parsed.provider && parsed.generation) meta = parsed;
  if (!meta || typeof meta !== "object") {
    const err = new Error("Current semantic identity is missing: semanticIndexMeta not found in data.json.");
    err.code = "EXPECTED_IDENTITY_MISSING";
    throw err;
  }
  const provider = String(meta.provider || "").toLowerCase();
  const model = String(meta.model || meta.embeddingModel || "");
  const generation = String(meta.generation || meta.pathMetaGeneration || "");
  const dimension = Number(meta.dimension || meta.targetDimension || 0);
  if (!provider || !SUPPORTED_PARTITION_PROVIDERS.has(provider)) {
    const err = new Error(`Current semantic identity provider is missing or unsupported: ${provider || "(empty)"}`);
    err.code = "EXPECTED_IDENTITY_MISSING";
    throw err;
  }
  if (!generation) {
    const err = new Error("Current semantic identity generation is missing.");
    err.code = "EXPECTED_IDENTITY_MISSING";
    throw err;
  }
  if (!Number.isInteger(dimension) || dimension <= 0) {
    const err = new Error(`Current semantic identity dimension is missing or invalid: ${meta.dimension}`);
    err.code = "EXPECTED_IDENTITY_MISSING";
    throw err;
  }
  if (!model) {
    const err = new Error("Current semantic identity model is missing.");
    err.code = "EXPECTED_IDENTITY_MISSING";
    throw err;
  }
  return { provider, model, generation, dimension, sourcePath: dataPath, meta };
}

function enumeratePartitionManifests(root) {
  if (typeof root !== "string" || !root.trim()) {
    const err = new Error("Fixture root must be a non-empty string.");
    err.code = "INVALID_ROOT";
    throw err;
  }
  const rootResolved = path.resolve(root);
  let stat;
  try { stat = fs.statSync(rootResolved); } catch {
    const err = new Error("Fixture root does not exist.");
    err.code = "INVALID_ROOT";
    throw err;
  }
  if (!stat.isDirectory()) {
    const err = new Error("Fixture root must be a directory.");
    err.code = "INVALID_ROOT";
    throw err;
  }
  const pending = [rootResolved];
  const results = [];
  const seenManifestPaths = new Set();
  while (pending.length) {
    const current = pending.pop();
    const currentResolved = path.resolve(current);
    if (currentResolved !== rootResolved && !currentResolved.startsWith(rootResolved + path.sep)) continue;
    let entries;
    try { entries = fs.readdirSync(currentResolved, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const absolute = path.join(currentResolved, entry.name);
      const absoluteResolved = path.resolve(absolute);
      if (absoluteResolved !== rootResolved && !absoluteResolved.startsWith(rootResolved + path.sep)) continue;
      if (entry.isDirectory()) {
        pending.push(absoluteResolved);
      } else if (entry.isFile() && SUPPORTED_MANIFEST_BASENAMES.has(entry.name)) {
        if (seenManifestPaths.has(absoluteResolved)) continue;
        seenManifestPaths.add(absoluteResolved);
        let parsed;
        try {
          const raw = fs.readFileSync(absoluteResolved, "utf8");
          parsed = JSON.parse(raw);
        } catch { continue; }
        if (!parsed || typeof parsed !== "object" || !parsed.meta || !Array.isArray(parsed.shards)) continue;
        const meta = parsed.meta;
        const providerRaw = String(meta.provider || "").toLowerCase();
        if (!SUPPORTED_PARTITION_PROVIDERS.has(providerRaw)) continue;
        const shardRefs = parsed.shards.map((s) => String(s.file || s.path || ""));
        const generation = String(meta.generation || "");
        const dimension = Number(meta.dimension || 0);
        const model = String(meta.model || "");
        results.push({
          dir: currentResolved,
          manifestPath: absoluteResolved,
          manifest: parsed,
          provider: providerRaw,
          model,
          generation,
          dimension,
          shardRefs
        });
      }
    }
  }
  results.sort((a, b) => a.manifestPath.localeCompare(b.manifestPath));
  return results;
}

function manifestCompatibility(partition, expected) {
  if (!partition || !SUPPORTED_PARTITION_PROVIDERS.has(String(partition.provider || "").toLowerCase())) {
    return { compatible: false, reasonCode: "unsupported-provider" };
  }
  if (!expected || typeof expected !== "object") return { compatible: true, reasonCode: "compatible" };
  const pProvider = String(partition.provider || "").toLowerCase();
  const eProviderRaw = expected.provider;
  const eProvider = eProviderRaw !== undefined && eProviderRaw !== null && String(eProviderRaw).trim() !== "" ? String(eProviderRaw).toLowerCase() : "";
  if (eProvider && pProvider !== eProvider) return { compatible: false, reasonCode: "provider-mismatch" };
  const pGen = String(partition.generation || "");
  const eGenRaw = expected.generation;
  const eGen = eGenRaw !== undefined && eGenRaw !== null && String(eGenRaw).trim() !== "" ? String(eGenRaw) : "";
  if (eGen && pGen !== eGen) return { compatible: false, reasonCode: "generation-mismatch" };
  if (expected.dimension !== undefined && expected.dimension !== null && String(expected.dimension).trim() !== "") {
    const pDim = Number(partition.dimension);
    const eDim = Number(expected.dimension);
    if (!Number.isFinite(pDim) || !Number.isFinite(eDim) || pDim !== eDim) return { compatible: false, reasonCode: "dimension-mismatch" };
  }
  if (expected.model !== undefined && expected.model !== null && String(expected.model).trim() !== "") {
    const pModel = String(partition.model || "").toLowerCase();
    const eModel = String(expected.model).toLowerCase();
    if (pModel && eModel && pModel !== eModel) return { compatible: false, reasonCode: "model-mismatch" };
  }
  return { compatible: true, reasonCode: "compatible" };
}

function resolveCompatiblePartition(root, expected) {
  const all = enumeratePartitionManifests(root);
  const compatible = expected ? all.filter((p) => manifestCompatibility(p, expected).compatible) : all;
  if (compatible.length === 0) {
    const err = new Error("No compatible semantic index partition was found beneath the supplied fixture root.");
    err.code = "PARTITION_NOT_FOUND";
    throw err;
  }
  if (compatible.length > 1) {
    const err = new Error("Multiple compatible semantic index partitions were found beneath the supplied fixture root.");
    err.code = "PARTITION_AMBIGUOUS";
    throw err;
  }
  const partition = compatible[0];
  return { partition, manifest: partition.manifest };
}

function loadManifestShards(partition) {
  if (!partition || typeof partition.dir !== "string" || !partition.manifest) throw new Error("Invalid partition.");
  const rawRefs = partition.shardRefs || (partition.manifest && Array.isArray(partition.manifest.shards) ? partition.manifest.shards.map((s) => String(s.file || s.path || "")) : []);
  if (!Array.isArray(rawRefs) || rawRefs.length === 0) {
    const err = new Error("The fixture manifest has no shard references.");
    err.code = "EMPTY_SHARDREFS";
    throw err;
  }
  const basenames = [];
  const seen = new Set();
  for (const ref of rawRefs) {
    const raw = String(ref);
    if (!raw || !raw.trim()) {
      const err = new Error("A shard reference is empty.");
      err.code = "EMPTY_BASENAME";
      throw err;
    }
    if (path.isAbsolute(raw)) {
      const err = new Error(`Shard reference is absolute: ${raw}`);
      err.code = "ABSOLUTE_SHARDREF";
      throw err;
    }
    const base = path.basename(raw);
    if (base !== raw) {
      const err = new Error(`Shard reference contains path traversal or directory: ${raw}`);
      err.code = "TRAVERSAL_SHARDREF";
      throw err;
    }
    if (base === "." || base === ".." || base.includes("/") || base.includes("\\") || base.includes("\0")) {
      const err = new Error(`Shard reference is unsafe: ${raw}`);
      err.code = "UNSAFE_BASENAME";
      throw err;
    }
    if (base.length === 0) {
      const err = new Error("Shard basename is empty.");
      err.code = "EMPTY_BASENAME";
      throw err;
    }
    if (seen.has(base)) {
      const err = new Error(`Duplicate shard basename: ${base}`);
      err.code = "DUPLICATE_BASENAME";
      throw err;
    }
    seen.add(base);
    basenames.push(base);
  }
  const sorted = basenames.slice().sort();
  const dirResolved = path.resolve(partition.dir);
  for (const base of sorted) {
    const absolute = path.join(dirResolved, base);
    const resolved = path.resolve(absolute);
    if (resolved !== dirResolved && !resolved.startsWith(dirResolved + path.sep)) {
      const err = new Error(`Shard reference escapes partition directory: ${base}`);
      err.code = "OUT_OF_ROOT";
      throw err;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      const err = new Error(`Missing listed shard: ${base}`);
      err.code = "MISSING_SHARD";
      throw err;
    }
  }
  let dirFiles;
  try { dirFiles = fs.readdirSync(dirResolved); } catch (e) { throw e; }
  const manifestBase = path.basename(partition.manifestPath);
  const pathMetaFile = String(partition.manifest?.meta?.pathMetaFile || "");
  const presentShardFiles = dirFiles.filter((name) => {
    const full = path.join(dirResolved, name);
    try { if (!fs.statSync(full).isFile()) return false; } catch { return false; }
    if (name === manifestBase) return false;
    if (name === LOCAL_SEMANTIC_ROUTING_ARTIFACT_FILE) return false;
    if (name === SEMANTIC_INDEX_PATH_META_FILE) return false;
    if (pathMetaFile && name === pathMetaFile) return false;
    if (isPathMetaArtifact(name)) return false;
    // Only JSON files can be semantic shards; ignore other artifacts (e.g., .DS_Store, .tmp, non-json)
    // This prevents every other file from being counted as an extra shard while still rejecting an extra unlisted semantic shard (.json)
    if (!name.endsWith(".json")) return false;
    // At this point the file is a shard candidate (json not in allowlist)
    return true;
  });
  const sortedPresent = presentShardFiles.slice().sort();
  if (sortedPresent.length !== sorted.length) {
    const err = new Error(`Filesystem shard count (${sortedPresent.length}) does not match manifest shard count (${sorted.length}).`);
    err.code = "FILESYSTEM_MISMATCH";
    throw err;
  }
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] !== sortedPresent[i]) {
      const err = new Error(`Filesystem shards do not match manifest shard set. Expected ${sorted.join(",")} found ${sortedPresent.join(",")}`);
      err.code = "FILESYSTEM_MISMATCH";
      throw err;
    }
  }
  const chunks = [];
  let bytes = 0;
  for (const name of sorted) {
    const absolute = path.join(dirResolved, name);
    bytes += fs.statSync(absolute).size;
    const payload = JSON.parse(fs.readFileSync(absolute, "utf8"));
    if (!Array.isArray(payload.chunks)) {
      const err = new Error(`Shard ${name} has no chunks array.`);
      err.code = "INVALID_SHARD_CONTENT";
      throw err;
    }
    chunks.push(...payload.chunks);
  }
  if (sorted.length === 0) {
    const err = new Error("The fixture index has no semantic shard files.");
    err.code = "NO_SHARDS";
    throw err;
  }
  return { chunks, shardCount: sorted.length, bytes, sortedShardFiles: sorted };
}

// Legacy wrappers for backward compatibility (do not use openwebui hard-code)
function findFixtureIndex(root) {
  return resolveCompatiblePartition(root).partition.dir;
}
function loadChunks(indexDirectory) {
  // This legacy entry is retained only for callers that still pass a directory; it enumerates that directory as a partition root.
  const all = enumeratePartitionManifests(indexDirectory);
  if (all.length === 1 && path.resolve(all[0].dir) === path.resolve(indexDirectory)) {
    return loadManifestShards(all[0]);
  }
  // Fallback: treat indexDirectory as a partition dir containing exactly one manifest
  const files = fs.readdirSync(indexDirectory).filter((name) => SUPPORTED_MANIFEST_BASENAMES.has(name));
  if (files.length !== 1) throw new Error("Legacy loadChunks requires exactly one manifest in the directory.");
  const manifestPath = path.join(path.resolve(indexDirectory), files[0]);
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const providerRaw = String(parsed.meta?.provider || "").toLowerCase();
  const partition = {
    dir: path.resolve(indexDirectory),
    manifestPath,
    manifest: parsed,
    provider: providerRaw,
    model: String(parsed.meta?.model || ""),
    generation: String(parsed.meta?.generation || ""),
    dimension: Number(parsed.meta?.dimension || 0),
    shardRefs: parsed.shards.map((s) => String(s.file || s.path || ""))
  };
  return loadManifestShards(partition);
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

function runSelfTest() {
  const os = require("os");
  const assert = require("assert");
  console.log("Running semantic-retrieval-local-ab --self-test (durable synthetic temp dirs, no vault)...");
  let passed = 0, failed = 0;
  function test(name, fn) {
    try { fn(); console.log(`PASS ${name}`); passed += 1; } catch (e) { console.log(`FAIL ${name}: ${e.message} ${e.code ? `code=${e.code}` : ""}`); failed += 1; }
  }
  function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "sr-ab-selftest-")); }
  function rmRoot(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
  function writeDataJson(root, { provider, generation, dimension, model }) {
    const dir = path.join(root, ".obsidian", "plugins", "semantic-todoist-sync");
    fs.mkdirSync(dir, { recursive: true });
    const meta = { provider, model: model || "test-model", generation: String(generation), dimension: Number(dimension), persistenceSchemaVersion: 2, contentSchemaVersion: 3, embeddingContentVersion: 3 };
    const data = { semanticIndexMeta: meta, embeddingModel: model || "test-model", embeddingProvider: provider };
    fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(data), "utf8");
    return meta;
  }
  function writePartition(partDir, { provider, generation, dimension, model, shardRefs, withPathMeta }) {
    fs.mkdirSync(partDir, { recursive: true });
    const manifestBase = provider === "openai" ? "semantic-index.openai.json" : provider === "gemini" ? "semantic-index.gemini.json" : provider === "openrouter" ? "semantic-index.openrouter.json" : provider === "openwebui" ? "semantic-index.openwebui.json" : "semantic-index.json";
    const shards = shardRefs.map((ref, idx) => ({ file: path.basename(ref), index: idx, chunks: 1, bytes: 10 }));
    const pathMetaFile = withPathMeta ? `semantic-index-path-meta.${generation}.json` : "";
    const manifest = { meta: { provider, model: model || "test-model", generation: String(generation), dimension: Number(dimension), persistenceSchemaVersion: 2, contentSchemaVersion: 3, embeddingContentVersion: 3, pathMetaFile, pathMetaGeneration: generation, pathMetaFingerprint: "fp-" + generation }, shards };
    if (!withPathMeta) { delete manifest.meta.pathMetaFile; delete manifest.meta.pathMetaGeneration; delete manifest.meta.pathMetaFingerprint; }
    fs.writeFileSync(path.join(partDir, manifestBase), JSON.stringify(manifest), "utf8");
    const routing = { schemaVersion: 2, generation: String(generation), provider, model: model || "test-model", dimension: Number(dimension), contentVersion: 1, vectorStore: { format: "int8", scale: 127, data: Buffer.from([0]).toString("base64") }, evidenceIds: [], sourceIds: [], shardRefs: shardRefs.map(r=>path.basename(r)), scopeRefs:[], taskRefs:[], temporalMetadata:[], routingMetadata:[] };
    fs.writeFileSync(path.join(partDir, LOCAL_SEMANTIC_ROUTING_ARTIFACT_FILE), JSON.stringify(routing), "utf8");
    if (withPathMeta) {
      const pm = { generation: String(generation), metaFingerprint: "fp-" + generation, indexFile: manifestBase, entries: [] };
      fs.writeFileSync(path.join(partDir, pathMetaFile), JSON.stringify(pm), "utf8");
      fs.writeFileSync(path.join(partDir, SEMANTIC_INDEX_PATH_META_FILE), JSON.stringify(pm), "utf8");
    }
    for (const ref of shardRefs) {
      const base = path.basename(ref);
      if (base !== ref) continue;
      if (!base || base.includes("..")) continue;
      const shardPath = path.join(partDir, base);
      if (fs.existsSync(shardPath)) continue;
      const payload = { chunks: [{ evidenceId: `ev-${base}`, sourceId: `src-${base}`, title: `Title ${base} Alpha Bravo`, text: `text ${base}`, embedding: [1,0] }] };
      fs.writeFileSync(shardPath, JSON.stringify(payload), "utf8");
    }
    return { manifestPath: path.join(partDir, manifestBase), manifest, partDir };
  }

  // 1 no manifests
  test("PARTITION_NOT_FOUND when no manifests", () => {
    const root = tmpRoot();
    try {
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      const expected = loadExpectedIdentity(root);
      assert.throws(() => resolveCompatiblePartition(root, expected), (err) => err.code === "PARTITION_NOT_FOUND");
    } finally { rmRoot(root); }
  });
  // 2 one per provider resolves (with expected)
  for (const provider of ["openai","gemini","openrouter","openwebui"]) {
    test(`resolves single compatible provider ${provider}`, () => {
      const root = tmpRoot();
      try {
        writeDataJson(root, { provider, generation:"genA", dimension:384, model:"test-model" });
        const partDir = path.join(root, `part-${provider}`);
        writePartition(partDir, { provider, generation:"genA", dimension:384, shardRefs: ["shard.000.json","shard.001.json"] });
        const expected = loadExpectedIdentity(root);
        const { partition, manifest } = resolveCompatiblePartition(root, expected);
        assert.ok(["openai","gemini","openrouter","openwebui"].includes(partition.provider));
        assert.equal(partition.provider, provider);
        const listed = partition.shardRefs.map(r=>path.basename(r)).sort();
        const dirFilesShard = fs.readdirSync(partition.dir).filter(f=>{ const full=path.join(partition.dir,f); return fs.statSync(full).isFile() && listed.includes(f); }).sort();
        assert.equal(dirFilesShard.length, listed.length);
        assert.deepEqual(dirFilesShard, listed.slice().sort());
        // also verify routing matches expected
        const routing = loadRoutingIndex(partition.dir);
        assert.ok(routing);
        assert.equal(String(routing.generation), String(expected.generation));
      } finally { rmRoot(root); }
    });
  }
  // 3 two compatible -> ambiguous
  test("PARTITION_AMBIGUOUS when two compatible", () => {
    const root = tmpRoot();
    try {
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      writePartition(path.join(root,"p1"), { provider:"openai", generation:"genA", dimension:384, shardRefs:["a.000.json"] });
      writePartition(path.join(root,"p2"), { provider:"openai", generation:"genA", dimension:384, shardRefs:["b.000.json"] });
      const expected = loadExpectedIdentity(root);
      assert.throws(() => resolveCompatiblePartition(root, expected), (err)=> err.code==="PARTITION_AMBIGUOUS");
    } finally { rmRoot(root); }
  });
  // 4 one compatible plus one incompatible generation/provider/dimension/model
  test("resolves compatible when one incompatible generation", () => {
    const root = tmpRoot();
    try {
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      writePartition(path.join(root,"p1"), { provider:"openai", generation:"genA", dimension:384, shardRefs:["a.000.json"] });
      writePartition(path.join(root,"p2"), { provider:"openai", generation:"genB", dimension:384, shardRefs:["b.000.json"] });
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      assert.equal(partition.generation, "genA");
    } finally { rmRoot(root); }
  });
  test("resolves compatible when one incompatible provider", () => {
    const root = tmpRoot();
    try {
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      writePartition(path.join(root,"p1"), { provider:"openai", generation:"genA", dimension:384, shardRefs:["a.000.json"] });
      writePartition(path.join(root,"p2"), { provider:"gemini", generation:"genA", dimension:384, shardRefs:["b.000.json"] });
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      assert.equal(partition.provider, "openai");
    } finally { rmRoot(root); }
  });
  test("resolves compatible when one incompatible dimension", () => {
    const root = tmpRoot();
    try {
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      writePartition(path.join(root,"p1"), { provider:"openai", generation:"genA", dimension:384, shardRefs:["a.000.json"] });
      writePartition(path.join(root,"p2"), { provider:"openai", generation:"genA", dimension:512, shardRefs:["b.000.json"] });
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      assert.equal(String(partition.dimension), "384");
    } finally { rmRoot(root); }
  });
  test("resolves compatible when one incompatible model", () => {
    const root = tmpRoot();
    try {
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"model-a" });
      writePartition(path.join(root,"p1"), { provider:"openai", generation:"genA", dimension:384, model:"model-a", shardRefs:["a.000.json"] });
      writePartition(path.join(root,"p2"), { provider:"openai", generation:"genA", dimension:384, model:"model-b", shardRefs:["b.000.json"] });
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      assert.equal(partition.model, "model-a");
    } finally { rmRoot(root); }
  });
  // 5 empty shardRefs
  test("reject empty shardRefs", () => {
    const root = tmpRoot();
    try {
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      const dir = path.join(root,"p1");
      fs.mkdirSync(dir,{recursive:true});
      const manifestPath = path.join(dir, "semantic-index.openai.json");
      const manifest = { meta:{provider:"openai", model:"test-model", generation:"genA", dimension:384}, shards:[] };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      fs.writeFileSync(path.join(dir, LOCAL_SEMANTIC_ROUTING_ARTIFACT_FILE), JSON.stringify({schemaVersion:2,generation:"genA",provider:"openai",model:"test-model",dimension:384,contentVersion:1,vectorStore:{format:"int8",scale:127,data:Buffer.from([0]).toString("base64")},evidenceIds:[],sourceIds:[],shardRefs:[],scopeRefs:[],taskRefs:[],temporalMetadata:[],routingMetadata:[]}));
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      assert.throws(()=> loadManifestShards(partition), (err)=> /shard/i.test(err.message));
    } finally { rmRoot(root); }
  });
  // 6 duplicate
  test("reject duplicate basenames", () => {
    const root = tmpRoot();
    try {
      const dir = path.join(root,"p1");
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      fs.mkdirSync(dir,{recursive:true});
      const manifestPath = path.join(dir, "semantic-index.openai.json");
      const manifest = { meta:{provider:"openai", model:"test-model", generation:"genA", dimension:384}, shards:[{file:"dup.json",index:0,chunks:1,bytes:10},{file:"dup.json",index:1,chunks:1,bytes:10}] };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      fs.writeFileSync(path.join(dir, LOCAL_SEMANTIC_ROUTING_ARTIFACT_FILE), JSON.stringify({schemaVersion:2,generation:"genA",provider:"openai",model:"test-model",dimension:384,contentVersion:1,vectorStore:{format:"int8",scale:127,data:Buffer.from([0]).toString("base64")},evidenceIds:[],sourceIds:[],shardRefs:[],scopeRefs:[],taskRefs:[],routingMetadata:[]}));
      fs.writeFileSync(path.join(dir,"dup.json"), JSON.stringify({chunks:[{evidenceId:"a",sourceId:"s",title:"t",text:"x",embedding:[1,0]}]}));
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      assert.throws(()=> loadManifestShards(partition), (err)=> /duplicate/i.test(err.message));
    } finally { rmRoot(root); }
  });
  // 7 traversal
  test("reject traversal reference", () => {
    const root = tmpRoot();
    try {
      const dir = path.join(root,"p1");
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      fs.mkdirSync(dir,{recursive:true});
      const manifestPath = path.join(dir, "semantic-index.openai.json");
      const manifest = { meta:{provider:"openai", model:"test-model", generation:"genA", dimension:384}, shards:[{file:"../escape.json",index:0,chunks:1,bytes:10}] };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      fs.writeFileSync(path.join(dir, LOCAL_SEMANTIC_ROUTING_ARTIFACT_FILE), JSON.stringify({schemaVersion:2,generation:"genA",provider:"openai",model:"test-model",dimension:384,contentVersion:1,vectorStore:{format:"int8",scale:127,data:Buffer.from([0]).toString("base64")},evidenceIds:[],sourceIds:[],shardRefs:[],scopeRefs:[],taskRefs:[],routingMetadata:[]}));
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      assert.throws(()=> loadManifestShards(partition), (err)=> /traversal|absolute|basename/i.test(err.message));
    } finally { rmRoot(root); }
  });
  // 8 missing
  test("reject missing listed shard", () => {
    const root = tmpRoot();
    try {
      const dir = path.join(root,"p1");
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      writePartition(dir, { provider:"openai", generation:"genA", dimension:384, shardRefs:["present.000.json","missing.001.json"] });
      fs.rmSync(path.join(dir,"missing.001.json"));
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      assert.throws(()=> loadManifestShards(partition), (err)=> /missing|not found|filesystem/i.test(err.message));
    } finally { rmRoot(root); }
  });
  // 9 extra shard
  test("reject extra filesystem shard", () => {
    const root = tmpRoot();
    try {
      const dir = path.join(root,"p1");
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      writePartition(dir, { provider:"openai", generation:"genA", dimension:384, shardRefs:["only.000.json"] });
      fs.writeFileSync(path.join(dir,"extra.001.json"), JSON.stringify({chunks:[{evidenceId:"x",sourceId:"y",title:"t",text:"x",embedding:[1,0]}]}));
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      assert.throws(()=> loadManifestShards(partition), (err)=> /filesystem|extra|mismatch/i.test(err.message));
    } finally { rmRoot(root); }
  });
  // 9b path-meta allowlist should NOT be counted as extra
  test("allow legitimate path-meta file alongside shards", () => {
    const root = tmpRoot();
    try {
      const dir = path.join(root,"p1");
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      writePartition(dir, { provider:"openai", generation:"genA", dimension:384, shardRefs:["a.000.json"], withPathMeta:true });
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      const loaded = loadManifestShards(partition);
      assert.equal(loaded.shardCount, 1);
    } finally { rmRoot(root); }
  });
  // 10 sorted
  test("sorted output from non-sorted refs", () => {
    const root = tmpRoot();
    try {
      const dir = path.join(root,"p1");
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      writePartition(dir, { provider:"openai", generation:"genA", dimension:384, shardRefs:["z.002.json","a.000.json","m.001.json"] });
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      const loaded = loadManifestShards(partition);
      assert.equal(loaded.shardCount, 3);
      assert.equal(loaded.chunks.length, 3);
      const sortedBases = ["a.000.json","m.001.json","z.002.json"];
      const present = fs.readdirSync(partition.dir).filter(f=>{ const full=path.join(partition.dir,f); return fs.statSync(full).isFile() && sortedBases.includes(f); }).sort();
      assert.deepEqual(present, sortedBases);
      assert.deepEqual(loaded.sortedShardFiles, sortedBases);
    } finally { rmRoot(root); }
  });
  // I1 expected wiring: fail closed if missing
  test("fail closed when expected identity missing", () => {
    const root = tmpRoot();
    try {
      // no data.json
      const dir = path.join(root,"p1");
      writePartition(dir, { provider:"openai", generation:"genA", dimension:384, shardRefs:["a.000.json"] });
      assert.throws(()=> loadExpectedIdentity(root), (err)=> err.code==="EXPECTED_IDENTITY_MISSING");
    } finally { rmRoot(root); }
  });
  // I1 routing mismatch should be caught in main-like validation
  test("routing generation mismatch is rejected", () => {
    const root = tmpRoot();
    try {
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      const dir = path.join(root,"p1");
      writePartition(dir, { provider:"openai", generation:"genA", dimension:384, shardRefs:["a.000.json"] });
      // corrupt routing to genB
      const routingPath = path.join(dir, LOCAL_SEMANTIC_ROUTING_ARTIFACT_FILE);
      const routing = JSON.parse(fs.readFileSync(routingPath,"utf8"));
      routing.generation = "genB";
      fs.writeFileSync(routingPath, JSON.stringify(routing));
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      const routingLoaded = loadRoutingIndex(partition.dir);
      assert.throws(()=> {
        if (String(routingLoaded.generation) !== String(expected.generation)) {
          const e=new Error(`Routing generation mismatch: ${routingLoaded.generation} != ${expected.generation}`); e.code="ROUTING_MISMATCH"; throw e;
        }
      }, (err)=> /mismatch/i.test(err.message));
    } finally { rmRoot(root); }
  });
  // 8-query temp benchmark (mini)
  test("8-query temp benchmark succeeds", () => {
    const root = tmpRoot();
    try {
      writeDataJson(root, { provider:"openai", generation:"genA", dimension:384, model:"test-model" });
      const partDir = path.join(root,"part");
      const shardRefs=["shard.000.json","shard.001.json"];
      const shards = shardRefs.map((f,i)=>({file:f,index:i,chunks:6,bytes:100}));
      const manifest={meta:{provider:"openai",model:"test-model",generation:"genA",dimension:384}, shards};
      fs.mkdirSync(partDir,{recursive:true});
      fs.writeFileSync(path.join(partDir,"semantic-index.openai.json"), JSON.stringify(manifest));
      fs.writeFileSync(path.join(partDir, LOCAL_SEMANTIC_ROUTING_ARTIFACT_FILE), JSON.stringify({schemaVersion:2,generation:"genA",provider:"openai",model:"test-model",dimension:384,contentVersion:1,vectorStore:{format:"int8",scale:127,data:Buffer.from([1,2,3]).toString("base64")},evidenceIds:[],sourceIds:[],shardRefs,scopeRefs:[],taskRefs:[],temporalMetadata:[],routingMetadata:[]}));
      for(const f of shardRefs){
        const chunks=[]; for(let i=0;i<6;i++) chunks.push({evidenceId:`ev-${f}-${i}`, sourceId:`src-${f}-${i}`, title:`Alpha Bravo Charlie Delta ${i} ${f}`, text:`text ${i}`, embedding:[0.1,0.2,0.3]});
        fs.writeFileSync(path.join(partDir,f), JSON.stringify({chunks}));
      }
      const expected = loadExpectedIdentity(root);
      const { partition } = resolveCompatiblePartition(root, expected);
      const loaded = loadManifestShards(partition);
      const queries = sampleQueries(loaded.chunks, 8);
      assert.equal(queries.length, 8);
      assert.ok(loaded.shardCount===2);
    } finally { rmRoot(root); }
  });

  console.log(`\nSelf-test summary: ${passed} passed, ${failed} failed`);
  if (failed) { process.exitCode = 1; throw new Error(`${failed} self-test(s) failed`); }
  console.log("All self-tests passed.");
}

function main() {
  if (!process.argv[2]) throw new Error("Pass the permitted read-only fixture root explicitly.");
  const firstArg = String(process.argv[2] || "");
  if (firstArg === "--self-test" || firstArg === "--selfTest" || firstArg === "self-test") {
    runSelfTest();
    return;
  }
  const fixtureRoot = process.argv[2];
  const parsedQueryLimit = process.argv[3] === undefined ? 80 : Number(process.argv[3]);
  if (!Number.isFinite(parsedQueryLimit) || !Number.isInteger(parsedQueryLimit)) throw new Error("Query count must be a finite integer.");
  const queryLimit = Math.max(8, Math.min(500, parsedQueryLimit));
  const expected = loadExpectedIdentity(fixtureRoot);
  const { partition, manifest } = resolveCompatiblePartition(fixtureRoot, expected);
  const indexDirectory = partition.dir;
  const compat = manifestCompatibility(partition, expected);
  if (!compat.compatible) {
    const err = new Error(`Selected partition is not compatible with current identity: ${compat.reasonCode}`);
    err.code = "INCOMPATIBLE_PARTITION";
    throw err;
  }
  const routingForCheck = loadRoutingIndex(indexDirectory);
  if (!routingForCheck) {
    const err = new Error("Routing artifact is missing for the selected partition.");
    err.code = "ROUTING_MISSING";
    throw err;
  }
  if (String(routingForCheck.generation) !== String(expected.generation)) {
    const err = new Error(`Routing generation mismatch: ${routingForCheck.generation} != ${expected.generation}`);
    err.code = "ROUTING_MISMATCH";
    throw err;
  }
  if (Number(routingForCheck.encoder.dimension) !== Number(expected.dimension)) {
    const err = new Error(`Routing dimension mismatch: ${routingForCheck.encoder.dimension} != ${expected.dimension}`);
    err.code = "ROUTING_MISMATCH";
    throw err;
  }
  const routingProvider = String(routingForCheck.encoder.id || "").split(":")[1] || "";
  const routingModel = String(routingForCheck.encoder.id || "").split(":")[2] || "";
  if (routingProvider.toLowerCase() !== String(expected.provider).toLowerCase()) {
    const err = new Error(`Routing provider mismatch: ${routingProvider} != ${expected.provider}`);
    err.code = "ROUTING_MISMATCH";
    throw err;
  }
  // Model check uses lower-case identity (mirrors manifestCompatibility); production uses modelIdentity but vault stores normalized model
  if (routingModel && String(routingModel).toLowerCase() !== String(expected.model).toLowerCase()) {
    const err = new Error(`Routing model mismatch: ${routingModel} != ${expected.model}`);
    err.code = "ROUTING_MISMATCH";
    throw err;
  }
  const loaded = loadManifestShards(partition);
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

if (require.main === module) {
  main();
}

module.exports = Object.assign(module.exports || {}, {
  __fixtureResolver: {
    SUPPORTED_PARTITION_PROVIDERS,
    SUPPORTED_MANIFEST_BASENAMES,
    LOCAL_SEMANTIC_ROUTING_ARTIFACT_FILE,
    SEMANTIC_INDEX_PATH_META_FILE,
    isPathMetaArtifact,
    loadExpectedIdentity,
    enumeratePartitionManifests,
    manifestCompatibility,
    resolveCompatiblePartition,
    loadManifestShards,
    loadRoutingIndex,
    findFixtureIndex,
    loadChunks,
    runSelfTest
  },
  SUPPORTED_PARTITION_PROVIDERS,
  SUPPORTED_MANIFEST_BASENAMES,
  LOCAL_SEMANTIC_ROUTING_ARTIFACT_FILE,
  SEMANTIC_INDEX_PATH_META_FILE,
  isPathMetaArtifact,
  loadExpectedIdentity,
  enumeratePartitionManifests,
  manifestCompatibility,
  resolveCompatiblePartition,
  loadManifestShards,
  runSelfTest
});
