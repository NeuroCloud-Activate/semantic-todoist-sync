"use strict";
// scripts/semantic-index-save-repair-test.js — offline regression harness for
// the semantic-index save path.
//
// Two defects are covered:
//   1. A shard file that disappeared from disk stayed referenced by every
//      later manifest, so the next load failed on the missing shard.
//   2. Obsidian's adapter refuses to rename over an existing file, so the
//      manifest promotion always took the verified fallback write and still
//      reported a misleading "Destination file already exists!" error.
//
// Read-only and offline: src/main.js is compiled through Module with a fake
// obsidian and a fake vault adapter; nothing touches the vault.
//
// Usage:
//   node scripts/semantic-index-save-repair-test.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = process.env.SEMANTIC_INDEX_REPAIR_MAIN || path.join(__dirname, "..", "src/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
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
    requestUrl() { throw new Error("semantic-index-save-repair-test: network disabled"); }
  };
};

// The plugin defers work through window.setTimeout; Node has no window.
if (typeof global.window === "undefined") {
  global.window = { setTimeout, clearTimeout, setInterval, clearInterval };
}

let runtime;
try {
  testModule._compile(
    `${mainSource}\nmodule.exports.__semanticIndexSave = {\n` +
      "  DEFAULT_SETTINGS, shortHash,\n" +
      "  SEMANTIC_MATERIALITY_ANCHOR_VERSION, SEMANTIC_MATERIALITY_ANCHOR_TEXTS,\n" +
      "  SEMANTIC_MATERIALITY_ANCHOR_KEYS\n" +
      "};\n",
    mainPath
  );
  runtime = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const PluginClass = runtime;
const {
  DEFAULT_SETTINGS,
  shortHash,
  SEMANTIC_MATERIALITY_ANCHOR_VERSION,
  SEMANTIC_MATERIALITY_ANCHOR_TEXTS,
  SEMANTIC_MATERIALITY_ANCHOR_KEYS
} = runtime.__semanticIndexSave;

const PLUGIN_DIR = ".obsidian/plugins/semantic-todoist-sync";
const DIMENSION = 8;
const PROVIDER = "customopenai";
const MODEL = "qwen3-embedding-0.6b-8k:latest";

// A vault adapter that behaves like Obsidian's: rename never overwrites an
// existing file, and a directory listing reports the files of one folder.
function createAdapter(options = {}) {
  const files = new Map();
  const writes = [];
  const state = {
    listFails: Boolean(options.listFails),
    renameRefusesExistingTarget: options.renameRefusesExistingTarget !== false,
    failWritePaths: new Set(options.failWritePaths || []),
    remainingFailures: Number(options.remainingFailures || 0)
  };
  return {
    files,
    writes,
    state,
    async read(filePath) {
      if (!files.has(filePath)) throw new Error(`ENOENT: ${filePath}`);
      const value = files.get(filePath);
      return typeof value === "string" ? value : Buffer.from(value).toString("utf8");
    },
    async write(filePath, body) {
      if (state.remainingFailures > 0 && state.failWritePaths.has(filePath)) {
        state.remainingFailures -= 1;
        // A failed write can leave a broken file behind.
        files.set(filePath, "CORRUPTED");
        throw new Error(`EACCES: ${filePath}`);
      }
      files.set(filePath, String(body));
      writes.push({ path: filePath, kind: "text" });
    },
    async writeBinary(filePath, bytes) {
      const view = bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      files.set(filePath, view);
      writes.push({ path: filePath, kind: "binary" });
    },
    async readBinary(filePath) {
      if (!files.has(filePath)) throw new Error(`ENOENT: ${filePath}`);
      return files.get(filePath);
    },
    async remove(filePath) {
      if (!files.has(filePath)) throw new Error(`ENOENT: ${filePath}`);
      files.delete(filePath);
    },
    async exists(filePath) { return files.has(filePath); },
    async list(dir) {
      if (state.listFails) throw new Error(`EIO: ${dir}`);
      const prefix = `${dir}/`;
      const listed = [];
      for (const filePath of files.keys()) if (filePath.startsWith(prefix)) listed.push(filePath);
      return { files: listed, folders: [] };
    },
    async rename(from, to) {
      if (state.renameRefusesExistingTarget && files.has(to)) throw new Error("Destination file already exists!");
      if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
      files.set(to, files.get(from));
      files.delete(from);
    }
  };
}

function buildSettings() {
  const anchors = {
    version: SEMANTIC_MATERIALITY_ANCHOR_VERSION,
    provider: PROVIDER,
    model: MODEL,
    dimension: DIMENSION,
    fingerprints: {},
    vectors: {}
  };
  for (const kind of SEMANTIC_MATERIALITY_ANCHOR_KEYS) {
    anchors.fingerprints[kind] = shortHash(SEMANTIC_MATERIALITY_ANCHOR_TEXTS[kind]);
    anchors.vectors[kind] = Array.from({ length: DIMENSION }, (_, index) => (index + 1) / 100);
  }
  return Object.assign({}, DEFAULT_SETTINGS, {
    embeddingProvider: PROVIDER,
    embeddingModel: MODEL,
    embeddingModelReference: { provider: PROVIDER, model: MODEL },
    semanticIndexMeta: { dimension: DIMENSION, semanticMaterialityAnchors: anchors }
  });
}

function buildChunks(count, startIndex = 0) {
  const chunks = [];
  for (let index = startIndex; index < startIndex + count; index += 1) {
    chunks.push({
      id: `chunk-${index}`,
      evidenceId: `evidence-${index}`,
      sourceId: `note-${index}`,
      sourceKind: "note",
      path: `Notes/note-${index}.md`,
      text: `Body text of chunk ${index} for the semantic index save repair harness.`,
      embeddingDimension: DIMENSION,
      embeddingProvider: PROVIDER,
      embeddingModel: MODEL,
      embedding: Array.from({ length: DIMENSION }, (_, position) => ((position + 1) * (index + 3)) / 97)
    });
  }
  return chunks;
}

function createPlugin(adapter, settings) {
  const plugin = Object.create(PluginClass.prototype);
  plugin.app = { vault: { adapter } };
  plugin.manifest = { dir: PLUGIN_DIR };
  plugin.settings = settings;
  plugin.semanticIndex = [];
  plugin.semanticIndexPathMeta = new Map();
  plugin.semanticIndexRevision = 0;
  plugin.logs = [];
  plugin.logLocal = (message, data = {}) => { plugin.logs.push({ message, data: data || {} }); };
  plugin.setSidebarStatus = () => {};
  plugin.recordSemanticIndexLoadYield = () => {};
  plugin.ensureProductionSemanticRoutingState = async () => ({ ok: true });
  plugin.writeExternalMcpExport = async () => ({ ok: true });
  return plugin;
}

async function saveIndex(plugin, chunks) {
  plugin.semanticIndex = chunks;
  await plugin.saveSemanticIndex({ previousIndex: chunks });
}

function manifestOf(adapter, indexFile) {
  const body = adapter.files.get(`${PLUGIN_DIR}/${indexFile}`);
  assert.ok(body, "the manifest must be on disk");
  return JSON.parse(body);
}

// Every file the published manifest references has to exist, and the index has
// to load with its full chunk count.
async function assertManifestIsLoadable(plugin, adapter, indexFile, expectedChunks) {
  const manifest = manifestOf(adapter, indexFile);
  for (const shard of manifest.shards) {
    assert.ok(adapter.files.has(`${PLUGIN_DIR}/${shard.file}`), `shard ${shard.file} must exist after the save`);
    assert.ok(adapter.files.has(`${PLUGIN_DIR}/${shard.bin}`), `shard ${shard.bin} must exist after the save`);
  }
  const loaded = await plugin.readSemanticIndexFile(indexFile);
  assert.equal(loaded.chunks.length, expectedChunks, "the published index must load every chunk");
  return manifest;
}

// A shard file that vanished from disk must be rewritten by the next save
// instead of staying referenced by the manifest.
async function scenarioDeletedShard(kind, { sameInstance }) {
  const adapter = createAdapter();
  const settings = buildSettings();
  const chunks = buildChunks(4);

  const first = createPlugin(adapter, settings);
  await saveIndex(first, chunks);

  const indexFile = first.semanticIndexFileName();
  const manifest = manifestOf(adapter, indexFile);
  assert.ok(manifest.shards.length >= 1, "the first save must write a shard");
  const shard = manifest.shards[0];
  const deletedPath = `${PLUGIN_DIR}/${kind === "json" ? shard.file : shard.bin}`;
  assert.ok(adapter.files.has(deletedPath), "the shard file must exist before it is deleted");
  adapter.files.delete(deletedPath);

  const second = sameInstance ? first : createPlugin(adapter, settings);
  await saveIndex(second, chunks);

  await assertManifestIsLoadable(second, adapter, indexFile, chunks.length);
  const reported = second.logs.find((entry) => entry.message === "Semantic index shard rewritten: file missing");
  assert.ok(reported, "the save must report the rewritten shard");
  assert.equal(Number(reported.data.count), 1, "the report must count the rewritten shard");
}

// Obsidian's adapter refuses to rename over the existing manifest: the
// verified fallback write is the supported path, not a failure.
async function scenarioManifestPromotionWithoutError() {
  const adapter = createAdapter({ renameRefusesExistingTarget: true });
  const settings = buildSettings();
  const chunks = buildChunks(4);

  const first = createPlugin(adapter, settings);
  await saveIndex(first, chunks);

  const indexFile = first.semanticIndexFileName();
  const grown = chunks.concat(buildChunks(1, 4));
  const second = createPlugin(adapter, settings);
  await saveIndex(second, grown);

  assert.ok(
    !second.lastSemanticIndexPersistenceError,
    `a successful save must not report a persistence error, got ${JSON.stringify(second.lastSemanticIndexPersistenceError)}`
  );
  const manifest = await assertManifestIsLoadable(second, adapter, indexFile, grown.length);
  assert.equal(Number(manifest.meta.chunks), grown.length, "the manifest on disk must be the new one");
}

// When the fallback write fails too, the error is reported, the previous
// manifest is restored and the save rejects.
async function scenarioManifestFallbackFailure() {
  const adapter = createAdapter({ renameRefusesExistingTarget: true });
  const settings = buildSettings();
  const chunks = buildChunks(4);

  const first = createPlugin(adapter, settings);
  await saveIndex(first, chunks);

  const indexFile = first.semanticIndexFileName();
  const manifestPath = `${PLUGIN_DIR}/${indexFile}`;
  const previousManifest = adapter.files.get(manifestPath);

  adapter.state.failWritePaths.add(manifestPath);
  adapter.state.remainingFailures = 1;

  const grown = chunks.concat(buildChunks(1, 4));
  const second = createPlugin(adapter, settings);
  await assert.rejects(() => saveIndex(second, grown), /EACCES/);
  assert.ok(second.lastSemanticIndexPersistenceError, "a failed fallback write must record an error");
  assert.equal(adapter.files.get(manifestPath), previousManifest, "the previous manifest must be restored");
}

// An unchanged index keeps its shards by reference: no shard is rewritten.
async function scenarioReuseByReference() {
  const adapter = createAdapter();
  const settings = buildSettings();
  const chunks = buildChunks(4);

  const first = createPlugin(adapter, settings);
  await saveIndex(first, chunks);

  const indexFile = first.semanticIndexFileName();
  const manifest = manifestOf(adapter, indexFile);
  const shardNames = manifest.shards.flatMap((shard) => [shard.file, shard.bin]);
  const writesBefore = adapter.writes.length;

  const second = createPlugin(adapter, settings);
  await saveIndex(second, chunks);

  const shardWrites = adapter.writes.slice(writesBefore).filter((write) => shardNames.includes(write.path.split("/").pop()));
  assert.equal(shardWrites.length, 0, "an unchanged index must reuse its shards instead of rewriting them");
  const next = manifestOf(adapter, indexFile);
  assert.deepEqual(
    next.shards.map((shard) => shard.file),
    manifest.shards.map((shard) => shard.file),
    "the reused shards keep their file names"
  );
  await assertManifestIsLoadable(second, adapter, indexFile, chunks.length);
}

// A directory listing that fails must not break the save: the shards are
// rewritten instead of referenced.
async function scenarioListingFailure() {
  const adapter = createAdapter();
  const settings = buildSettings();
  const chunks = buildChunks(4);

  const first = createPlugin(adapter, settings);
  await saveIndex(first, chunks);

  const indexFile = first.semanticIndexFileName();
  adapter.state.listFails = true;

  const second = createPlugin(adapter, settings);
  await saveIndex(second, chunks);

  await assertManifestIsLoadable(second, adapter, indexFile, chunks.length);
}

// An unchanged index that is already on disk takes the short path: the
// persistence error of an earlier save is not a current failure.
async function scenarioAlreadyPersistedClearsPersistenceError() {
  const adapter = createAdapter();
  const settings = buildSettings();
  const chunks = buildChunks(4);

  const plugin = createPlugin(adapter, settings);
  await saveIndex(plugin, chunks);
  plugin.lastSemanticIndexPersistenceError = { phase: "stale", message: "an earlier save failed" };
  await saveIndex(plugin, chunks);
  assert.equal(
    plugin.lastSemanticIndexPersistenceError,
    null,
    "an index that is already persisted must not report a persistence error"
  );
}

const failures = [];
const passed = [];

async function check(name, fn) {
  try {
    await fn();
    passed.push(name);
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${(error && error.message) || error}`);
    console.error(`FAIL: ${name}: ${(error && error.message) || error}`);
  }
}

async function main() {
  await check("a deleted shard json is rewritten and the index still loads", () => scenarioDeletedShard("json", { sameInstance: false }));
  await check("a deleted shard bin is rewritten and the index still loads", () => scenarioDeletedShard("bin", { sameInstance: false }));
  await check("a deleted shard is rewritten by the next save of the same session", () => scenarioDeletedShard("json", { sameInstance: true }));
  await check("the manifest promotion reports no error when the fallback write succeeds", scenarioManifestPromotionWithoutError);
  await check("a failed fallback write reports the error and restores the previous manifest", scenarioManifestFallbackFailure);
  await check("an unchanged index keeps its shards by reference", scenarioReuseByReference);
  await check("a failed directory listing still saves a loadable index", scenarioListingFailure);
  await check("an already persisted index clears the persistence error", scenarioAlreadyPersistedClearsPersistenceError);
}

main().then(() => {
  console.log(`\n${passed.length}/${passed.length + failures.length} checks passed`);
  if (failures.length) process.exitCode = 1;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
