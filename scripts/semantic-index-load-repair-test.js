"use strict";
// scripts/semantic-index-load-repair-test.js — a damaged persisted semantic
// index must not blank the whole vault index (offline harness, no network).
//
// The harness loads src/main.js through Module with a fake obsidian, writes a
// real persisted index (manifest + binary shards + path-meta artifact) into a
// fake vault adapter, then damages it the way a real vault does:
//
//   (a) one shard .json deleted            -> keep the other shards, re-index the lost note
//   (b) one shard .bin deleted / a shard corrupted (hash mismatch)
//   (c) the path-meta artifact missing      -> fail closed + one automatic rebuild
//   (d) the manifest missing                -> one automatic rebuild
//   (e) the same damage twice in one session-> no second rebuild + one notice
//   (f) an intact index                    -> unchanged load, nothing queued
//   (g) an empty vault                     -> no rebuild
//
// Usage: node scripts/semantic-index-load-repair-test.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = process.env.SEMANTIC_INDEX_REPAIR_MAIN || path.join(__dirname, "..", "src/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

const notices = [];
let TFileClass = null;
const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class Empty {}
  class Notice {
    constructor(message) { notices.push(String(message || "")); }
  }
  class TFile {
    constructor(filePath, options = {}) {
      this.path = String(filePath || "");
      this.name = this.path.split("/").pop();
      this.basename = this.name.replace(/\.md$/i, "");
      this.extension = this.name.includes(".") ? this.name.split(".").pop() : "";
      this.stat = { mtime: Number(options.mtime || 0), ctime: 0, size: 0 };
      this.text = String(options.text || "");
    }
  }
  TFileClass = TFile;
  return {
    ItemView: Empty,
    MarkdownRenderer: {},
    MarkdownView: Empty,
    Modal: Empty,
    Notice,
    Plugin: Empty,
    PluginSettingTab: Empty,
    Setting: Empty,
    TFile,
    setIcon() {},
    requestUrl() { throw new Error("semantic-index-load-repair-test: network disabled"); }
  };
};
global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
global.fetch = async () => { throw new Error("semantic-index-load-repair-test: network disabled"); };

let runtime;
try {
  testModule._compile(
    `${mainSource}\nmodule.exports.__semanticIndexRepair = {\n` +
    "  DEFAULT_SETTINGS, shortHash, utf8ByteLength,\n" +
    "  semanticIndexPathMetaFingerprintForEntries, semanticMaterialityAnchorFingerprint,\n" +
    "  semanticIndexShardBinaryFromChunks,\n" +
    "  SEMANTIC_INDEX_PERSISTENCE_SCHEMA_VERSION, SEMANTIC_INDEX_CONTENT_SCHEMA_VERSION,\n" +
    "  SEMANTIC_EMBEDDING_CONTENT_VERSION, SEMANTIC_TASK_REFERENCE_EMBEDDING_PROJECTION_VERSION,\n" +
    "  SEMANTIC_MATERIALITY_ANCHOR_VERSION, SEMANTIC_INDEX_PATH_META_SCHEMA_VERSION\n" +
    "};\n",
    mainPath
  );
  runtime = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const seam = runtime.__semanticIndexRepair;
const PluginClass = runtime;

const PLUGIN_DIR = "plugins/semantic-todoist-sync";
const INDEX_FILE = "semantic-index.customopenai.json";
const GENERATION = "testgen01";
const EMBEDDING_MODEL = "test-embed-model";
const PROVIDER = "customopenai";
const DIMENSION = 8;
const NOTE_MTIME = 1767225600000;

function settingsFor(priorIndex) {
  return Object.assign({}, seam.DEFAULT_SETTINGS, {
    embeddingProvider: PROVIDER,
    embeddingModel: EMBEDDING_MODEL,
    embeddingModelReference: { provider: PROVIDER, model: EMBEDDING_MODEL },
    embeddingDimension: DIMENSION,
    aiModelProvider: PROVIDER,
    sharedGenerationPrimary: { provider: PROVIDER, model: "test-chat-model" },
    sharedGenerationFallback: { provider: PROVIDER, model: "test-chat-model" },
    customOpenAIBaseUrl: "https://embeddings.invalid/v1",
    autoUpdateSemanticIndex: true,
    semanticIndexDelaySeconds: 30,
    semanticIndexMeta: priorIndex
      ? {
        model: EMBEDDING_MODEL,
        provider: PROVIDER,
        dimension: DIMENSION,
        targetDimension: DIMENSION,
        chunks: 6,
        rebuiltAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        file: INDEX_FILE
      }
      : {}
  });
}

class FakeAdapter {
  constructor() {
    this.files = new Map();
    this.binaries = new Map();
    this.failures = new Map();
  }

  // Makes the next `count` reads of a file fail, like a locked file does.
  failNextReads(filePath, count = 1) {
    this.failures.set(filePath, Number(count || 1));
  }

  async read(filePath) {
    const remaining = Number(this.failures.get(filePath) || 0);
    if (remaining > 0) {
      this.failures.set(filePath, remaining - 1);
      throw new Error(`EBUSY: ${filePath}`);
    }
    if (!this.files.has(filePath)) throw new Error(`ENOENT: ${filePath}`);
    return this.files.get(filePath);
  }

  async write(filePath, body) { this.files.set(filePath, String(body)); }

  async writeBinary(filePath, bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    this.binaries.set(filePath, view.slice().buffer);
  }

  async readBinary(filePath) {
    if (!this.binaries.has(filePath)) throw new Error(`ENOENT: ${filePath}`);
    return this.binaries.get(filePath);
  }

  async remove(filePath) {
    this.files.delete(filePath);
    this.binaries.delete(filePath);
  }

  async exists(filePath) { return this.files.has(filePath) || this.binaries.has(filePath); }

  async list(dir) {
    const prefix = `${dir}/`;
    const files = [];
    for (const key of this.files.keys()) if (key.startsWith(prefix)) files.push(key);
    for (const key of this.binaries.keys()) if (key.startsWith(prefix) && !files.includes(key)) files.push(key);
    return { files, folders: [] };
  }

  getBasePath() { return ""; }
}

function createHarness(options = {}) {
  const priorIndex = options.priorIndex !== false;
  const adapter = options.adapter || new FakeAdapter();
  const vaultFiles = options.vaultFiles || new Map();
  const layoutReadyCallbacks = [];
  const plugin = new PluginClass();
  plugin.app = {
    vault: {
      adapter,
      getAbstractFileByPath: (filePath) => vaultFiles.get(String(filePath || "")) || null,
      getFileByPath: (filePath) => vaultFiles.get(String(filePath || "")) || null,
      getMarkdownFiles: () => Array.from(vaultFiles.values()),
      cachedRead: async (file) => String(file?.text || ""),
      getName: () => "test-vault",
      on: () => ({})
    },
    workspace: {
      on: () => ({}),
      getLeavesOfType: () => [],
      getActiveViewOfType: () => null,
      iterateAllLeaves: () => {},
      // The layout is ready by default; a test can hold it back to prove that
      // the automatic repair waits for the workspace.
      layoutReady: options.layoutReady !== false,
      onLayoutReady: (callback) => {
        layoutReadyCallbacks.push(callback);
        return callback;
      }
    },
    metadataCache: { getFileCache: () => null }
  };
  plugin.manifest = { dir: PLUGIN_DIR, id: "semantic-todoist-sync", version: "0.9.28" };
  plugin.settings = options.settings || settingsFor(priorIndex);
  if (options.autoUpdateSemanticIndex === false) plugin.settings.autoUpdateSemanticIndex = false;
  // Instance state the load path relies on (onload() is not run in this harness).
  plugin.semanticIndexRevision = 0;
  plugin.semanticIndex = [];
  plugin.semanticIndexStats = null;
  plugin.semanticIndexKnownShardFiles = [];
  plugin.semanticIndexStorageFingerprint = "";
  plugin.semanticIndexPathMeta = new Map();
  plugin.semanticIndexPathMetaSnapshotFingerprint = "";
  plugin.semanticIndexManifestPublishedGeneration = "";
  plugin.productionSemanticRoutingState = null;
  plugin.productionSemanticRoutingTelemetry = { state: "cold" };
  plugin.semanticIndexLoadTelemetry = {};
  plugin.semanticIndexCompatibilityRefresh = null;
  plugin.semanticIndexCompatibilityRefreshKeys = new Set();
  plugin.semanticIndexCompatibilityRefreshTimer = null;
  plugin.semanticIndexCompatibilityRefreshPromise = null;
  plugin.semanticIndexLoaded = false;
  plugin.semanticIndexLoadInProgress = false;
  plugin.semanticIndexLoadFailure = "";
  plugin.semanticIndexStartupReconciled = false;
  plugin.semanticIndexStartupQuietUntil = 0;
  plugin.semanticIndexStartupBuffering = false;
  plugin.semanticIndexIncrementalFailure = "";
  plugin.pendingIndexPaths = new Set();
  plugin.semanticIndexTimer = null;
  plugin.semanticChunkTermCache = new Map();
  plugin.semanticRetrievalCache = new Map();
  plugin.semanticExactScoreCache = new Map();
  plugin.isUnloading = false;
  plugin.aiActivity = "";
  plugin.semanticIndexInProgress = false;
  plugin.semanticIndexOperationActive = false;
  plugin.semanticIndexOperationOwner = "";
  plugin.semanticIndexOperationPromise = Promise.resolve();
  plugin.syncInProgress = false;
  plugin.schedulerInProgress = false;
  plugin.emailProcessingInProgress = false;
  plugin.referenceRebuildInProgress = false;
  plugin.internalNoteWriteUntil = new Map();
  // Unrelated heavy work is stubbed: the repair path must not depend on it.
  plugin.saveSettings = async () => {};
  plugin.markActivityLogDirty = () => {};
  plugin.scheduleDeferredTaskReferenceIntegrityScan = () => {};
  plugin.ensureProductionSemanticRoutingState = async () => null;
  plugin.queueSemanticIndexWarmup = () => {};
  plugin.queueSemanticIndexReshard = () => {};
  plugin.writeExternalMcpExport = async () => {};
  const state = { rebuildCalls: 0 };
  plugin.rebuildSemanticIndex = async () => {
    state.rebuildCalls += 1;
    return { ok: true, reasonCode: "rebuilt" };
  };
  return { plugin, adapter, vaultFiles, state, layoutReadyCallbacks };
}

function embeddingFor(seed) {
  const values = [];
  let state = 2166136261;
  for (const character of String(seed)) state = (Math.imul(state, 16777619) ^ character.charCodeAt(0)) >>> 0;
  for (let index = 0; index < DIMENSION; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    values.push((state / 4294967296) * 2 - 1);
  }
  return values;
}

const NOTES = [
  { path: "notes/alpha.md", texts: ["Alpha first passage.", "Alpha second passage."] },
  { path: "notes/beta.md", texts: ["Beta first passage.", "Beta second passage."] },
  { path: "notes/gamma.md", texts: ["Gamma first passage.", "Gamma second passage."] }
];

function buildChunks() {
  const chunks = [];
  for (const note of NOTES) {
    note.texts.forEach((text, ordinal) => {
      chunks.push({
        id: `${note.path}#${ordinal}`,
        path: note.path,
        title: note.path.split("/").pop(),
        text,
        section: "",
        kind: "vault-note",
        source: "vault",
        sourceKind: "note",
        sourceId: `note:${note.path}`,
        evidenceId: `ev:${seam.shortHash(`${note.path}|${text}`)}:${seam.shortHash(text)}:${ordinal}`,
        modifiedAt: NOTE_MTIME,
        createdAt: NOTE_MTIME,
        createdAtSource: "file-mtime",
        embeddingContentVersion: seam.SEMANTIC_EMBEDDING_CONTENT_VERSION,
        embeddingProvider: PROVIDER,
        embeddingModel: EMBEDDING_MODEL,
        embedding: embeddingFor(`${note.path}|${ordinal}`)
      });
    });
  }
  return chunks;
}

// Writes a real persisted index (manifest + binary shards + path-meta artifact)
// into the fake adapter, one shard per note.
async function writePersistedIndex(harness, options = {}) {
  const { plugin, adapter, vaultFiles } = harness;
  for (const note of NOTES) {
    vaultFiles.set(note.path, new TFileClass(note.path, { mtime: NOTE_MTIME, text: note.texts.join("\n\n") }));
  }
  const chunks = buildChunks();
  const manifestMeta = {
    persistenceSchemaVersion: seam.SEMANTIC_INDEX_PERSISTENCE_SCHEMA_VERSION,
    contentSchemaVersion: seam.SEMANTIC_INDEX_CONTENT_SCHEMA_VERSION,
    embeddingContentVersion: seam.SEMANTIC_EMBEDDING_CONTENT_VERSION,
    taskReferenceEmbeddingProjectionVersion: seam.SEMANTIC_TASK_REFERENCE_EMBEDDING_PROJECTION_VERSION,
    generation: GENERATION,
    provider: PROVIDER,
    model: EMBEDDING_MODEL,
    dimension: DIMENSION,
    targetDimension: DIMENSION,
    embeddingMigrationRequired: false,
    file: INDEX_FILE,
    sharded: true,
    shardFormat: "f64le",
    semanticMaterialityAnchors: {
      version: seam.SEMANTIC_MATERIALITY_ANCHOR_VERSION,
      provider: PROVIDER,
      model: EMBEDDING_MODEL,
      dimension: DIMENSION,
      fingerprints: {
        positive: seam.semanticMaterialityAnchorFingerprint("positive"),
        negative: seam.semanticMaterialityAnchorFingerprint("negative")
      },
      vectors: {
        positive: embeddingFor("anchor-positive"),
        negative: embeddingFor("anchor-negative")
      }
    }
  };
  const shards = NOTES.map((note, index) => seam.semanticIndexShardBinaryFromChunks(
    INDEX_FILE,
    manifestMeta,
    index,
    chunks.filter((chunk) => chunk.path === note.path),
    GENERATION
  ));
  // A census without entries cannot say which note owned the chunks of a
  // shard that cannot be read.
  const entries = options.emptyPathMeta ? [] : NOTES.map((note) => ({
    path: note.path,
    chunks: note.texts.length,
    modifiedAt: NOTE_MTIME
  }));
  const pathMetaCore = {
    schemaVersion: seam.SEMANTIC_INDEX_PATH_META_SCHEMA_VERSION,
    generation: GENERATION,
    model: EMBEDDING_MODEL,
    provider: PROVIDER,
    dimension: DIMENSION,
    targetDimension: DIMENSION,
    chunks: options.emptyPathMeta ? 0 : chunks.length,
    shardCount: shards.length,
    shardBytes: shards.reduce((sum, shard) => sum + shard.bytes, 0),
    rebuiltAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    indexFile: INDEX_FILE,
    savedAt: "2026-01-01T00:00:00.000Z",
    entries
  };
  const pathMetaFingerprint = seam.semanticIndexPathMetaFingerprintForEntries(pathMetaCore, entries, plugin.settings);
  const pathMetaFile = `semantic-index-path-meta.${GENERATION}.json`;
  const manifest = {
    meta: Object.assign({}, manifestMeta, {
      chunks: chunks.length,
      shardCount: shards.length,
      shardBytes: shards.reduce((sum, shard) => sum + shard.bytes, 0),
      shardBinBytes: shards.reduce((sum, shard) => sum + shard.binBytes, 0),
      pathMetaFile,
      pathMetaGeneration: GENERATION,
      pathMetaFingerprint
    }),
    shards: shards.map((shard, index) => ({
      file: shard.file,
      bin: shard.binFile,
      chunks: shard.chunkCount,
      bytes: shard.bytes,
      binBytes: shard.binBytes,
      index,
      generation: GENERATION,
      hash: shard.hash,
      binHash: shard.binHash,
      payloadHash: shard.payloadHash
    }))
  };
  await adapter.write(`${PLUGIN_DIR}/${INDEX_FILE}`, JSON.stringify(manifest));
  for (const shard of shards) {
    await adapter.write(`${PLUGIN_DIR}/${shard.file}`, shard.body);
    await adapter.writeBinary(`${PLUGIN_DIR}/${shard.binFile}`, shard.binBody);
  }
  await adapter.write(`${PLUGIN_DIR}/${pathMetaFile}`, JSON.stringify(Object.assign({}, pathMetaCore, { metaFingerprint: pathMetaFingerprint })));
  return { manifest, shards, pathMetaFile, chunks };
}

// Writes a legacy sharded manifest: no generation and no path-meta census,
// with the embeddings inline in every shard.
async function writeLegacyShardedIndex(harness) {
  const { adapter, vaultFiles } = harness;
  for (const note of NOTES) {
    vaultFiles.set(note.path, new TFileClass(note.path, { mtime: NOTE_MTIME, text: note.texts.join("\n\n") }));
  }
  const chunks = buildChunks();
  const base = INDEX_FILE.replace(/\.json$/i, "");
  const shards = NOTES.map((note, index) => ({
    file: `${base}.${String(index).padStart(3, "0")}.json`,
    chunks: chunks.filter((chunk) => chunk.path === note.path)
  }));
  const manifest = {
    meta: {
      provider: PROVIDER,
      model: EMBEDDING_MODEL,
      dimension: DIMENSION,
      file: INDEX_FILE,
      chunks: chunks.length,
      shardCount: shards.length
    },
    shards: shards.map((shard, index) => ({
      file: shard.file,
      chunks: shard.chunks.length,
      bytes: 0,
      index
    }))
  };
  await adapter.write(`${PLUGIN_DIR}/${INDEX_FILE}`, JSON.stringify(manifest));
  for (const shard of shards) {
    await adapter.write(`${PLUGIN_DIR}/${shard.file}`, JSON.stringify({ chunks: shard.chunks }));
  }
  return { manifest, shards };
}

function logMessages(plugin) {
  return (plugin.settings.localLog || []).map((entry) => String(entry?.message || ""));
}

function cleanup(plugin) {
  try { clearTimeout(plugin.semanticIndexTimer); } catch {}
  try { clearTimeout(plugin.semanticIndexAutoRebuildTimer); } catch {}
  plugin.semanticIndexTimer = null;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

const failures = [];
const passed = [];
async function check(name, fn) {
  try {
    await fn();
    passed.push(name);
  } catch (error) {
    failures.push({ name, error });
  }
}

async function main() {
// (a) one shard .json deleted: the surviving shards stay loaded, the notes that
// lost chunks are queued for re-indexing, and no load failure is reported.
await check("(a) a deleted shard keeps the other shards and re-indexes the lost note", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  const written = await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${written.shards[1].file}`);
  try {
    const result = await plugin.loadSemanticIndexInternal();
    assert.equal(plugin.semanticIndexLoadFailure, "", "a salvaged load must not report a load failure");
    assert.equal(plugin.semanticIndex.length, 4, "the four chunks of the two surviving shards must stay loaded");
    assert.notEqual(result?.ok, false, "a salvaged load must not report a failure");
    assert.deepEqual(Array.from(plugin.pendingIndexPaths), ["notes/beta.md"], "only the note that lost chunks may be queued");
    const repaired = logMessages(plugin).find((message) => message.startsWith("Semantic index repaired:"));
    assert.ok(repaired, "the repair must be logged");
    assert.match(repaired, /kept 2 of 3 shards/);
    assert.match(repaired, /re-indexing 1 of 1 affected notes/);
    assert.equal(harness.state.rebuildCalls, 0, "a salvaged load must not trigger a full rebuild");
    const pathMeta = JSON.parse(await adapter.read(`${PLUGIN_DIR}/semantic-index-path-meta.json`));
    const beta = (pathMeta.entries || []).find((entry) => entry.path === "notes/beta.md");
    assert.ok(beta, "the affected note must stay listed in the path metadata");
  } finally {
    cleanup(plugin);
  }
});

// (b) a missing .bin and a corrupted shard (hash mismatch) behave like (a).
await check("(b) a missing .bin keeps the other shards and re-indexes the lost note", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  const written = await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${written.shards[1].binFile}`);
  try {
    await plugin.loadSemanticIndexInternal();
    assert.equal(plugin.semanticIndexLoadFailure, "");
    assert.equal(plugin.semanticIndex.length, 4);
    assert.deepEqual(Array.from(plugin.pendingIndexPaths), ["notes/beta.md"]);
    assert.equal(harness.state.rebuildCalls, 0);
  } finally {
    cleanup(plugin);
  }
});

await check("(b) a corrupted shard keeps the other shards and re-indexes the lost note", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  const written = await writePersistedIndex(harness);
  const shardPath = `${PLUGIN_DIR}/${written.shards[1].file}`;
  const original = await adapter.read(shardPath);
  await adapter.write(shardPath, original.replace("Beta first passage.", "Beta first passage (altered)."));
  try {
    await plugin.loadSemanticIndexInternal();
    assert.equal(plugin.semanticIndexLoadFailure, "");
    assert.equal(plugin.semanticIndex.length, 4);
    assert.deepEqual(Array.from(plugin.pendingIndexPaths), ["notes/beta.md"]);
    assert.equal(harness.state.rebuildCalls, 0);
  } finally {
    cleanup(plugin);
  }
});

// (c) the path-meta artifact is missing: the affected notes are unknowable, so
// the load fails closed and exactly one automatic rebuild is queued.
await check("(c) a missing path-meta artifact fails closed and queues one automatic rebuild", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  const written = await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${written.pathMetaFile}`);
  try {
    await plugin.loadSemanticIndexInternal();
    assert.equal(plugin.semanticIndexLoadFailure, "semantic-index-no-validated-generation", "an unreadable index must still fail closed");
    assert.equal(plugin.semanticIndex.length, 0);
    await settle();
    assert.equal(harness.state.rebuildCalls, 1, "exactly one automatic rebuild must be queued");
    const logged = logMessages(plugin);
    assert.ok(logged.some((message) => message.startsWith("Semantic index unreadable; rebuilding automatically")), "the automatic rebuild must be logged");
  } finally {
    cleanup(plugin);
  }
});

// (d) the manifest is missing while the shards still exist.
await check("(d) a missing manifest queues one automatic rebuild", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${INDEX_FILE}`);
  try {
    await plugin.loadSemanticIndexInternal();
    assert.equal(plugin.semanticIndexLoadFailure, "semantic-index-no-validated-generation");
    await settle();
    assert.equal(harness.state.rebuildCalls, 1, "exactly one automatic rebuild must be queued");
  } finally {
    cleanup(plugin);
  }
});

// (e) the same damage twice in one session: the automatic repair runs once and
// the running rebuild is not mistaken for damage handled in an earlier
// session, so no manual rebuild is asked for while the rebuild is in flight.
await check("(e) the same damage twice in one session runs one automatic rebuild and asks for no manual rebuild", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  const written = await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${written.pathMetaFile}`);
  const before = notices.length;
  try {
    await plugin.loadSemanticIndexInternal();
    await plugin.loadSemanticIndexInternal();
    await settle();
    assert.equal(harness.state.rebuildCalls, 1, "the automatic rebuild must not repeat in the same session");
    const shown = notices.slice(before);
    assert.equal(shown.length, 0, "no manual-rebuild notice may be shown while the automatic rebuild runs");
    const logged = logMessages(plugin);
    assert.ok(logged.some((message) => message.includes("already in progress")), "the running rebuild must be logged");
    assert.equal(logged.some((message) => message.includes("earlier session")), false, "the running rebuild must not be read as an earlier session");
  } finally {
    cleanup(plugin);
  }
});

// (f) an intact index loads exactly as before.
await check("(f) an intact index loads unchanged and queues nothing", async () => {
  const harness = createHarness();
  const { plugin } = harness;
  await writePersistedIndex(harness);
  try {
    const result = await plugin.loadSemanticIndexInternal();
    assert.notEqual(result?.ok, false, "an intact index must load without a failure");
    assert.equal(plugin.semanticIndexLoadFailure, "");
    assert.equal(plugin.semanticIndex.length, 6, "every chunk of an intact index must load");
    assert.equal(plugin.pendingIndexPaths.size, 0, "an intact index must not queue anything");
    assert.equal(logMessages(plugin).some((message) => message.startsWith("Semantic index repaired:")), false, "an intact index must not log a repair");
    await settle();
    assert.equal(harness.state.rebuildCalls, 0, "an intact index must not trigger a rebuild");
  } finally {
    cleanup(plugin);
  }
});

// (g) an empty vault with no index files must never trigger a rebuild.
await check("(g) an empty vault never triggers an automatic rebuild", async () => {
  const harness = createHarness({ priorIndex: false });
  const { plugin } = harness;
  const before = notices.length;
  try {
    await plugin.loadSemanticIndexInternal();
    await settle();
    assert.equal(harness.state.rebuildCalls, 0, "an empty vault must not trigger a rebuild");
    assert.equal(notices.length, before, "an empty vault must not raise a notice");
  } finally {
    cleanup(plugin);
  }
});

// (h) a transient read failure (OneDrive/antivirus lock) must not drop a
// healthy shard: the read is retried once.
await check("(h) a transient shard read failure is retried and the shard is kept", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  const written = await writePersistedIndex(harness);
  adapter.failNextReads(`${PLUGIN_DIR}/${written.shards[1].file}`, 1);
  try {
    await plugin.loadSemanticIndexInternal();
    assert.equal(plugin.semanticIndexLoadFailure, "", "a transient read failure must not report a load failure");
    assert.equal(plugin.semanticIndex.length, 6, "a transient read failure must not drop the shard");
    assert.equal(plugin.pendingIndexPaths.size, 0, "a transient read failure must not queue a re-index");
    assert.equal(logMessages(plugin).some((message) => message.startsWith("Semantic index repaired:")), false, "a transient read failure must not be reported as a repair");
    assert.equal(harness.state.rebuildCalls, 0, "a transient read failure must not trigger a rebuild");
  } finally {
    cleanup(plugin);
  }
});

// (i) a sharded index whose path-meta census is empty cannot say which note
// lost chunks: the load fails closed and the automatic rebuild takes over.
await check("(i) a sharded index without a usable census fails closed and queues an automatic rebuild", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  const written = await writePersistedIndex(harness, { emptyPathMeta: true });
  await adapter.remove(`${PLUGIN_DIR}/${written.shards[1].file}`);
  try {
    await plugin.loadSemanticIndexInternal();
    assert.equal(plugin.semanticIndexLoadFailure, "semantic-index-no-validated-generation", "an index without a census must fail closed");
    assert.equal(plugin.semanticIndex.length, 0, "a partial index must not be loaded silently");
    assert.equal(plugin.pendingIndexPaths.size, 0, "a partial index must not queue a re-index");
    await settle();
    assert.equal(harness.state.rebuildCalls, 1, "the automatic rebuild must take over");
    assert.ok(logMessages(plugin).some((message) => message.startsWith("Semantic index unreadable; rebuilding automatically")), "the automatic rebuild must be logged");
  } finally {
    cleanup(plugin);
  }
});

// (j) a legacy sharded manifest has no generation and no census at all: the
// same fail-closed rule applies.
await check("(j) a legacy sharded manifest without a generation fails closed and queues an automatic rebuild", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  const written = await writeLegacyShardedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${written.shards[1].file}`);
  try {
    await plugin.loadSemanticIndexInternal();
    assert.equal(plugin.semanticIndexLoadFailure, "semantic-index-no-validated-generation", "a legacy manifest without a census must fail closed");
    assert.equal(plugin.semanticIndex.length, 0, "a partial index must not be loaded silently");
    await settle();
    assert.equal(harness.state.rebuildCalls, 1, "the automatic rebuild must take over");
  } finally {
    cleanup(plugin);
  }
});

// (k) the automatic rebuild must wait for the workspace: at startup the note
// list can still be empty, which made the rebuild fail at once.
await check("(k) the automatic rebuild waits for the workspace layout", async () => {
  const harness = createHarness({ layoutReady: false });
  const { plugin, adapter, layoutReadyCallbacks } = harness;
  await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${INDEX_FILE}`);
  try {
    await plugin.loadSemanticIndexInternal();
    await settle();
    assert.equal(harness.state.rebuildCalls, 0, "the rebuild must not run before the workspace is ready");
    assert.equal(layoutReadyCallbacks.length, 1, "the rebuild must wait for the workspace layout");
    for (const callback of layoutReadyCallbacks) callback();
    await settle();
    assert.equal(harness.state.rebuildCalls, 1, "the rebuild must run once the workspace is ready");
  } finally {
    cleanup(plugin);
  }
});

// (l) the same damage in a later session must not be repaired again: the guard
// is persisted, and a clean load clears it.
await check("(l) a second session with the same damage repairs nothing and shows one notice", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  const written = await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${written.shards[1].file}`);
  const before = notices.length;
  try {
    await plugin.loadSemanticIndexInternal();
    assert.deepEqual(Array.from(plugin.pendingIndexPaths), ["notes/beta.md"], "the first session repairs the damage");
    assert.equal(Object.keys(plugin.settings.semanticIndexRepairMarkers || {}).length, 1, "the repair must be remembered in the settings");

    const second = createHarness({ settings: plugin.settings, adapter, vaultFiles: harness.vaultFiles });
    try {
      await second.plugin.loadSemanticIndexInternal();
      assert.equal(second.plugin.pendingIndexPaths.size, 0, "the second session must not repair the same damage again");
      assert.equal(second.state.rebuildCalls, 0, "the second session must not trigger a rebuild");
      const shown = notices.slice(before);
      assert.equal(shown.length, 1, "exactly one notice must be shown");
      assert.match(shown[0], /Rebuild semantic vault index/);

      // The damage is gone: the clean load resets the guard.
      await adapter.write(`${PLUGIN_DIR}/${written.shards[1].file}`, written.shards[1].body);
      await adapter.writeBinary(`${PLUGIN_DIR}/${written.shards[1].binFile}`, written.shards[1].binBody);
      await second.plugin.loadSemanticIndexInternal();
      assert.equal(second.plugin.semanticIndexLoadFailure, "");
      assert.equal(second.plugin.semanticIndex.length, 6, "a repaired index loads every chunk again");
      assert.equal(Object.keys(second.plugin.settings.semanticIndexRepairMarkers || {}).length, 0, "a clean load must clear the repair guard");
    } finally {
      cleanup(second.plugin);
    }
  } finally {
    cleanup(plugin);
  }
});

// (m) the settings metadata is not proof that an index exists: with the index
// files deleted the automatic rebuild stays off.
await check("(m) deleted index files with settings metadata trigger no automatic rebuild", async () => {
  const harness = createHarness();
  const { plugin } = harness;
  const before = notices.length;
  try {
    assert.equal(Number(plugin.settings.semanticIndexMeta?.chunks || 0) > 0, true, "the settings still claim an indexed vault");
    await plugin.loadSemanticIndexInternal();
    await settle();
    assert.equal(harness.state.rebuildCalls, 0, "a vault without index files must not trigger a rebuild");
    assert.equal(notices.length, before, "a vault without index files must not raise a notice");
    assert.ok(logMessages(plugin).some((message) => message.includes("no automatic rebuild queued")), "the suppressed rebuild must be logged");
  } finally {
    cleanup(plugin);
  }
});

// (n) with the automatic index update off, the automatic repair is off too:
// the user decides when the paid rebuild happens.
await check("(n) an unreadable index with the automatic update off queues no rebuild and shows a notice", async () => {
  const harness = createHarness({ autoUpdateSemanticIndex: false });
  const { plugin, adapter } = harness;
  await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${INDEX_FILE}`);
  const before = notices.length;
  try {
    await plugin.loadSemanticIndexInternal();
    await settle();
    assert.equal(harness.state.rebuildCalls, 0, "the automatic rebuild must be off");
    const shown = notices.slice(before);
    assert.equal(shown.length, 1, "exactly one notice must be shown");
    assert.match(shown[0], /Rebuild semantic vault index/);
  } finally {
    cleanup(plugin);
  }
});

// (o) the repair log counts the affected notes, and notes that could not be
// re-indexed are reported.
await check("(o) notes that could not be re-indexed are counted and reported", async () => {
  const harness = createHarness({ autoUpdateSemanticIndex: false });
  const { plugin, adapter } = harness;
  const written = await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${written.shards[1].file}`);
  const before = notices.length;
  try {
    await plugin.loadSemanticIndexInternal();
    const repaired = logMessages(plugin).find((message) => message.startsWith("Semantic index repaired:"));
    assert.ok(repaired, "the repair must be logged");
    assert.match(repaired, /kept 2 of 3 shards/);
    assert.match(repaired, /re-indexing 0 of 1 affected notes/);
    const shown = notices.slice(before);
    assert.equal(shown.length, 1, "exactly one notice must be shown");
    assert.match(shown[0], /Rebuild semantic vault index/);
  } finally {
    cleanup(plugin);
  }
});

// (p) a second load while the automatic rebuild is still running must not be
// read as damage that an earlier session already handled: the started attempt
// is remembered in the settings, and that marker is not an earlier session.
await check("(p) a second load during a pending automatic rebuild asks for no manual rebuild", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${INDEX_FILE}`);
  // The rebuild stays in flight, so its marker is on disk while the automatic
  // work is still running.
  plugin.rebuildSemanticIndex = async () => {
    harness.state.rebuildCalls += 1;
    return new Promise(() => {});
  };
  const before = notices.length;
  try {
    await plugin.loadSemanticIndexInternal();
    await settle();
    assert.equal(harness.state.rebuildCalls, 1, "exactly one automatic rebuild must run");
    assert.equal(Object.keys(plugin.settings.semanticIndexRepairMarkers || {}).length, 1, "the started attempt must be remembered in the settings");
    await plugin.loadSemanticIndexInternal();
    await settle();
    assert.equal(harness.state.rebuildCalls, 1, "the second load must not start a second rebuild");
    const shown = notices.slice(before);
    assert.equal(shown.length, 0, "no manual-rebuild notice may be shown while the rebuild runs");
    const logged = logMessages(plugin);
    assert.equal(logged.some((message) => message.includes("earlier session")), false, "the running rebuild must not be read as an earlier session");
    assert.ok(logged.some((message) => message.includes("already in progress")), "the running rebuild must be logged");
  } finally {
    cleanup(plugin);
  }
});

// (q) with the automatic repair off the notice is shown once per session: a
// repeated load must not stack a second notice on the user.
await check("(q) an unreadable index with the automatic update off shows the notice only once", async () => {
  const harness = createHarness({ autoUpdateSemanticIndex: false });
  const { plugin, adapter } = harness;
  await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${INDEX_FILE}`);
  const before = notices.length;
  try {
    await plugin.loadSemanticIndexInternal();
    await plugin.loadSemanticIndexInternal();
    await settle();
    assert.equal(harness.state.rebuildCalls, 0, "the automatic rebuild must stay off");
    const shown = notices.slice(before);
    assert.equal(shown.length, 1, "the notice must be shown only once");
    assert.match(shown[0], /Rebuild semantic vault index/);
  } finally {
    cleanup(plugin);
  }
});

// (r) the same unreadable index in a later session is not repaired again: the
// persisted marker is an earlier session, so it asks for the manual rebuild.
await check("(r) a second session with an unreadable index repairs nothing and shows one notice", async () => {
  const harness = createHarness();
  const { plugin, adapter } = harness;
  await writePersistedIndex(harness);
  await adapter.remove(`${PLUGIN_DIR}/${INDEX_FILE}`);
  const before = notices.length;
  try {
    await plugin.loadSemanticIndexInternal();
    await settle();
    assert.equal(harness.state.rebuildCalls, 1, "the first session rebuilds automatically");
    assert.equal(Object.keys(plugin.settings.semanticIndexRepairMarkers || {}).length, 1, "the attempt must be remembered in the settings");

    const second = createHarness({ settings: plugin.settings, adapter, vaultFiles: harness.vaultFiles });
    try {
      await second.plugin.loadSemanticIndexInternal();
      await settle();
      assert.equal(second.state.rebuildCalls, 0, "the second session must not rebuild again");
      assert.ok(logMessages(second.plugin).some((message) => message.includes("earlier session")), "the repeated damage must be logged");
      const shown = notices.slice(before);
      assert.equal(shown.length, 1, "exactly one notice must be shown");
      assert.match(shown[0], /Rebuild semantic vault index/);
    } finally {
      cleanup(second.plugin);
    }
  } finally {
    cleanup(plugin);
  }
});

for (const failure of failures) {
  console.error(`FAIL ${failure.name}: ${failure.error?.message || failure.error}`);
  if (globalThis.__lastHarness) {
    for (const entry of (globalThis.__lastHarness.plugin.settings.localLog || [])) console.error("  LOG:", entry.message, JSON.stringify(entry.data));
  }
}
assert.equal(failures.length, 0, `${failures.length} of ${passed.length + failures.length} semantic index load repair case(s) failed`);
console.log(`semantic-index-load-repair-test: PASS (${passed.length} cases)`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
