"use strict";
// scripts/lib/vault-harness.js — shared READ-ONLY vault harness (Task 1, Steps 1-3).
//
// Builds the real plugin class from main.js over a fake fs-backed adapter so
// retrieval/dedup evals run locally without Obsidian. The vault is never
// written: every adapter mutator throws `vault-harness: read-only`, and the
// stubbed Plugin.saveData is a memory-only no-op (it records the payload for
// debugging and never touches disk).
//
// Opt-in `inMemoryWrites` mode (used by loadPlugin for the plugin's own data
// files): mutators targeting paths under `.obsidian/plugins/semantic-todoist-sync/`
// are accepted-and-discarded IN MEMORY (overlay map + tombstones, reads see
// the overlay, disk is never touched). Writes to any NON-plugin path still
// throw `vault-harness: read-only`. This covers the benign v4 load-path
// persistence (path-meta snapshot, routing artifact, model/device state)
// whose read-after-write verification would otherwise fail closed.
//
// Settings loading: SemanticTodoistSyncPlugin has NO loadSettings method
// (verified: zero `loadSettings` hits in main.js). onload (main.js:4357-4359)
// does `await this.loadData()` + `Object.assign({}, DEFAULT_SETTINGS,
// loadedData)`. loadPlugin mirrors exactly that — the stub Plugin.loadData
// reads `<manifest.dir>/data.json` through the read-only adapter ({} when
// absent, like a fresh vault) — then forces `settings.semanticSearchMode =
// mode` and awaits the real `loadSemanticIndex()`. onload() itself is never
// called (timers, workspace views, network side effects).

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");

const READONLY_MESSAGE = "vault-harness: read-only";
const QUERY_EMBEDDINGS_FILE = "query-embeddings.json";
const QUERY_EMBEDDING_CACHE_VERSION = 1;
const BOOTSTRAP_DEFAULT_N = 1000;
const BOOTSTRAP_DEFAULT_SEED = 20261009;
const PLUGIN_ID = "semantic-todoist-sync";
const PLUGIN_DIR = `.obsidian/plugins/${PLUGIN_ID}`;
const EVAL_DIR_NAME = "eval-private";

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const out = { vault: "", runtime: "", out: "", mode: "", baseline: "", withAi: false };
  const takeValue = (i, flag) => {
    const value = args[i + 1];
    if (value === undefined || String(value).startsWith("--")) {
      throw new Error(`vault-harness: ${flag} needs a value`);
    }
    return value;
  };
  for (let i = 2; i < args.length; i += 1) {
    const arg = String(args[i]);
    if (arg === "--vault") out.vault = takeValue(i++, "--vault");
    else if (arg === "--runtime") out.runtime = takeValue(i++, "--runtime");
    else if (arg === "--out") out.out = takeValue(i++, "--out");
    else if (arg === "--mode") out.mode = takeValue(i++, "--mode");
    else if (arg === "--baseline") out.baseline = takeValue(i++, "--baseline");
    else if (arg === "--with-ai") {
      const next = args[i + 1];
      if (next !== undefined && !String(next).startsWith("--")) {
        i += 1;
        out.withAi = !/^(false|0|no|off)$/i.test(String(next));
      } else {
        out.withAi = true;
      }
    } else {
      throw new Error(`vault-harness: unknown arg: ${arg}`);
    }
  }
  if (!out.vault) throw new Error("vault-harness: missing --vault <path>");
  if (!out.runtime) out.runtime = path.resolve(__dirname, "..", "..", "main.js");
  if (!out.mode) out.mode = "exact";
  if (!out.out) out.out = path.join(out.vault, ".obsidian", "plugins", PLUGIN_ID, EVAL_DIR_NAME);
  return out;
}

function resolveVaultPath(vaultRoot, vaultPath) {
  const rel = String(vaultPath ?? "").replace(/\\/g, "/");
  if (!rel || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) {
    throw new Error(`vault-harness: outside vault: ${vaultPath}`);
  }
  const segments = rel.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new Error(`vault-harness: outside vault: ${vaultPath}`);
    }
  }
  return path.join(vaultRoot, ...segments);
}

const toVaultRel = (vaultRoot, abs) => path.relative(vaultRoot, abs).split(path.sep).join("/");

const normVaultRel = (vaultPath) => String(vaultPath ?? "").replace(/\\/g, "/").replace(/^\.\//, "");

function isPluginOwnPath(vaultPath) {
  const rel = normVaultRel(vaultPath);
  return rel === PLUGIN_DIR || rel.startsWith(`${PLUGIN_DIR}/`);
}

// Typed-array-safe vector probe (mirrors main.js isEmbeddingVector): v4
// shards store embeddings as Float64Array, not plain Array.
function isVector(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function vectorLength(value) {
  return isVector(value) ? Number(value.length) || 0 : 0;
}

function createReadOnlyAdapter(vaultRoot, options = {}) {
  const root = path.resolve(vaultRoot);
  const inMemoryWrites = Boolean(options && options.inMemoryWrites === true);
  // In-memory overlay for plugin-internal persistence: accepted-and-discarded,
  // never reaches disk. Tombstones hide disk files "removed" through the
  // overlay (e.g. stale-generation cleanup) without deleting them.
  const overlay = new Map();
  const tombstones = new Set();
  const overlayGet = (vaultPath) => {
    const rel = normVaultRel(vaultPath);
    if (overlay.has(rel)) return { rel, value: overlay.get(rel) };
    return { rel, value: undefined };
  };
  const readThrough = (vaultPath) => {
    const { rel, value } = overlayGet(vaultPath);
    if (value !== undefined) return value;
    if (tombstones.has(rel)) throw new Error(`vault-harness: no such file: ${vaultPath}`);
    return fs.readFileSync(resolveVaultPath(root, vaultPath));
  };
  const requireInMemoryWrite = (vaultPath) => {
    if (!inMemoryWrites) throw new Error(READONLY_MESSAGE);
    if (!isPluginOwnPath(vaultPath)) throw new Error(READONLY_MESSAGE);
  };
  const adapter = {
    __inMemoryWrites: inMemoryWrites,
    getBasePath: () => root,
    read: async (vaultPath) => {
      const value = readThrough(vaultPath);
      return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
    },
    readBinary: async (vaultPath) => {
      const value = readThrough(vaultPath);
      return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value), "utf8");
    },
    exists: async (vaultPath) => {
      const { rel, value } = overlayGet(vaultPath);
      if (value !== undefined) return true;
      if (tombstones.has(rel)) return false;
      try {
        fs.statSync(resolveVaultPath(root, vaultPath));
        return true;
      } catch {
        return false;
      }
    },
    stat: async (vaultPath) => {
      const { rel, value } = overlayGet(vaultPath);
      if (value !== undefined) {
        const size = Buffer.isBuffer(value) ? value.length : Buffer.byteLength(String(value));
        const now = Date.now();
        return { type: "file", size, mtime: now, ctime: now };
      }
      const st = fs.statSync(resolveVaultPath(root, vaultPath));
      if (tombstones.has(rel) && !st.isDirectory()) {
        throw new Error(`vault-harness: no such file: ${vaultPath}`);
      }
      return {
        type: st.isDirectory() ? "folder" : "file",
        size: st.size,
        mtime: st.mtimeMs,
        ctime: st.ctimeMs,
      };
    },
    // Obsidian DataAdapter.list: one level, full vault-relative paths.
    list: async (vaultPath) => {
      const dir = vaultPath === "" || vaultPath === "/" ? root : resolveVaultPath(root, vaultPath);
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const files = [];
      const folders = [];
      for (const entry of entries) {
        const rel = toVaultRel(root, path.join(dir, entry.name));
        if (tombstones.has(rel)) continue;
        if (entry.isDirectory()) folders.push(rel);
        else if (entry.isFile()) files.push(rel);
      }
      if (inMemoryWrites) {
        const dirRel = normVaultRel(vaultPath === "" || vaultPath === "/" ? "" : vaultPath);
        const prefix = dirRel ? `${dirRel}/` : "";
        for (const rel of overlay.keys()) {
          if (tombstones.has(rel)) continue;
          if (prefix && !rel.startsWith(prefix)) continue;
          const rest = prefix ? rel.slice(prefix.length) : rel;
          if (!rest || rest.includes("/")) continue;
          if (!files.includes(rel)) files.push(rel);
        }
        files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      }
      return { files, folders };
    },
    write: async (vaultPath, data) => {
      requireInMemoryWrite(vaultPath);
      const { rel } = overlayGet(vaultPath);
      overlay.set(rel, Buffer.isBuffer(data) ? Buffer.from(data) : String(data));
      tombstones.delete(rel);
    },
    writeBinary: async (vaultPath, data) => {
      requireInMemoryWrite(vaultPath);
      const { rel } = overlayGet(vaultPath);
      overlay.set(rel, Buffer.from(data));
      tombstones.delete(rel);
    },
    append: async (vaultPath, data) => {
      requireInMemoryWrite(vaultPath);
      const { rel, value } = overlayGet(vaultPath);
      let current = value;
      if (current === undefined && !tombstones.has(rel)) {
        try {
          current = fs.readFileSync(resolveVaultPath(root, vaultPath));
        } catch {
          current = "";
        }
      } else if (current === undefined) {
        current = "";
      }
      if (Buffer.isBuffer(current) || Buffer.isBuffer(data)) {
        const left = Buffer.isBuffer(current) ? current : Buffer.from(String(current), "utf8");
        const right = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
        overlay.set(rel, Buffer.concat([left, right]));
      } else {
        overlay.set(rel, String(current) + String(data));
      }
      tombstones.delete(rel);
    },
    remove: async (vaultPath) => {
      requireInMemoryWrite(vaultPath);
      const { rel } = overlayGet(vaultPath);
      overlay.delete(rel);
      tombstones.add(rel);
    },
    rename: async (vaultPath, nextPath) => {
      requireInMemoryWrite(vaultPath);
      requireInMemoryWrite(nextPath);
      const content = readThrough(vaultPath);
      const { rel: nextRel } = overlayGet(nextPath);
      overlay.set(nextRel, content);
      tombstones.delete(nextRel);
      const { rel } = overlayGet(vaultPath);
      overlay.delete(rel);
      tombstones.add(rel);
    },
    mkdir: async (vaultPath) => {
      requireInMemoryWrite(vaultPath);
    },
    rmdir: async (vaultPath) => {
      requireInMemoryWrite(vaultPath);
    },
    copy: async (vaultPath, nextPath) => {
      requireInMemoryWrite(vaultPath);
      requireInMemoryWrite(nextPath);
      const content = readThrough(vaultPath);
      const { rel: nextRel } = overlayGet(nextPath);
      overlay.set(nextRel, content);
      tombstones.delete(nextRel);
    },
    process: async (vaultPath, fn) => {
      requireInMemoryWrite(vaultPath);
      if (typeof fn !== "function") return;
      let current = "";
      try {
        const value = readThrough(vaultPath);
        current = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
      } catch {
        current = "";
      }
      const next = await fn(current);
      if (next !== undefined) {
        const { rel } = overlayGet(vaultPath);
        overlay.set(rel, String(next));
        tombstones.delete(rel);
      }
    },
  };
  return adapter;
}

function parseFrontmatterScalar(raw) {
  let value = String(raw).trim();
  if (value === "") return "";
  // Non-scalars (lists, maps, block scalars) are out of scope: skip the key.
  if (/^[[{|>&*]/.test(value)) return undefined;
  const quoted = value.match(/^("([^"]*)"|'([^']*)')$/);
  if (quoted) return quoted[2] !== undefined ? quoted[2] : quoted[3];
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^[+-]?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

// Naive note cache: frontmatter `key: value` scalars only + `[[link]]` targets.
// (Verified: main.js has zero metadataCache/getFileCache references, so no
// consumer dictates the shape; this mirrors Obsidian's {frontmatter, links}.)
function parseNoteCache(text) {
  const src = String(text ?? "");
  const frontmatter = {};
  const fm = src.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
      if (!m) continue;
      const value = parseFrontmatterScalar(m[2]);
      if (value !== undefined) frontmatter[m[1]] = value;
    }
  }
  const links = [];
  const re = /\[\[([^\]|#\]]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(src))) {
    const target = m[1].trim();
    if (target) links.push({ link: target });
  }
  return { frontmatter, links };
}

function listVaultMarkdownFiles(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name === ".obsidian") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) found.push(abs);
    }
  };
  walk(root);
  return found;
}

function buildFakeApp(vaultRoot, adapter, TFile) {
  const root = path.resolve(vaultRoot);
  const files = [];
  const byPath = new Map();
  for (const abs of listVaultMarkdownFiles(root)) {
    const rel = toVaultRel(root, abs);
    const st = fs.statSync(abs);
    const name = rel.split("/").pop();
    const file = new TFile();
    Object.assign(file, {
      path: rel,
      name,
      basename: name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name,
      extension: "md",
      stat: { ctime: st.ctimeMs, mtime: st.mtimeMs },
    });
    files.push(file);
    byPath.set(rel, file);
  }
  const normPath = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  const readFile = (fileOrPath) =>
    adapter.read(typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path);
  const refuse = async () => {
    throw new Error(READONLY_MESSAGE);
  };
  const noteCache = new Map();
  const vault = {
    adapter,
    getMarkdownFiles: () => files.slice(),
    getAbstractFileByPath: (p) => byPath.get(normPath(p)) || null,
    cachedRead: (fileOrPath) => readFile(fileOrPath),
    read: (fileOrPath) => readFile(fileOrPath),
    create: refuse,
    modify: refuse,
    append: refuse,
    delete: refuse,
    on: () => () => {},
    off: () => {},
  };
  const metadataCache = {
    getFileCache: (fileOrPath) => {
      const key = typeof fileOrPath === "string" ? fileOrPath : fileOrPath.path;
      if (!noteCache.has(key)) {
        const text = fs.readFileSync(resolveVaultPath(root, key), "utf8");
        noteCache.set(key, parseNoteCache(text));
      }
      return noteCache.get(key);
    },
  };
  const workspace = {
    getLeavesOfType: () => [],
    getActiveViewOfType: () => null,
    detachLeavesOfType: () => {},
    on: () => () => {},
    off: () => {},
  };
  return { vault, metadataCache, workspace };
}

function makeObsidianStub() {
  class TFile {}
  class Empty {}
  class Plugin {
    constructor(app, manifest) {
      this.app = app;
      this.manifest = manifest;
    }
    // Mirrors Obsidian's data.json load through the vault adapter.
    async loadData() {
      try {
        const raw = await this.app.vault.adapter.read(`${this.manifest.dir}/data.json`);
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    // Read-only harness: never touches disk; records the payload for debugging.
    async saveData(data) {
      this.__vaultHarnessLastSavedData = data;
    }
    registerEvent() {}
    addCommand() {}
    registerView() {}
    addSettingTab() {}
    addRibbonIcon() {
      return {};
    }
  }
  class Notice {}
  return {
    ItemView: Empty,
    MarkdownRenderer: {},
    MarkdownView: Empty,
    Modal: Empty,
    Notice,
    Plugin,
    PluginSettingTab: Empty,
    Setting: Empty,
    TFile,
    setIcon() {},
    requestUrl() {
      throw new Error("vault-harness: network disabled");
    },
    // Internal handles the harness itself needs (file stubs, base class).
    __harness: { TFile, Plugin },
  };
}

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
  for (const [key, fn] of Object.entries(timers)) {
    if (typeof g.window[key] !== "function") g.window[key] = fn;
  }
}

function compileRuntime(source, runtimePath, obsidianStub) {
  const compiled = new Module(runtimePath, module);
  compiled.filename = runtimePath;
  compiled.paths = Module._nodeModulePaths(path.dirname(runtimePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "obsidian") return obsidianStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    compiled._compile(
      `${source}\n;module.exports.__vaultHarnessPluginClass = module.exports;\n`,
      runtimePath
    );
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
    delete require.cache[runtimePath];
  }
}

// Behavior-neutral counters for the lexical-union regions (harness-level
// trace only): applied to the in-memory runtime source before compile, so the
// repo main.js is never touched. Both union-selection sites and both
// lexical-row push sites are counted; patterns must match exactly twice or
// the load fails loudly (shape drift guard).
function instrumentFusionTraceSource(source) {
  const text = String(source ?? "");
  const unionPattern = "const unionSelection = taskWorkflowSelectScoreEvidence(";
  const unionCount = (text.split(unionPattern).length - 1);
  if (unionCount !== 2) {
    throw new Error(`vault-harness: fusion-trace union pattern matches ${unionCount} (want 2)`);
  }
  const rowPattern = "lexicalSelectorRows.push({ evidenceId, text: String(chunk.text || \"\") });";
  const rowCount = (text.split(rowPattern).length - 1);
  if (rowCount !== 2) {
    throw new Error(`vault-harness: fusion-trace lexical-row pattern matches ${rowCount} (want 2)`);
  }
  return text
    .split(unionPattern).join(
      "globalThis.__fusionUnionInvocations=(globalThis.__fusionUnionInvocations||0)+1;" +
      "const unionSelection = taskWorkflowSelectScoreEvidence("
    )
    .split(rowPattern).join(
      "lexicalSelectorRows.push({ evidenceId, text: String(chunk.text || \"\") });" +
      "globalThis.__fusionLexRowPushes=(globalThis.__fusionLexRowPushes||0)+1;" +
      "if(String((lexicalSelectorRows[lexicalSelectorRows.length-1]||{}).text||'').trim())" +
      "globalThis.__fusionLexNonEmpty=(globalThis.__fusionLexNonEmpty||0)+1;"
    );
}

async function loadPlugin({ vault: vaultRoot, runtime, mode, inMemoryWrites = true, instrumentFusionTrace = false } = {}) {
  if (!vaultRoot) throw new Error("vault-harness: loadPlugin requires vault");
  const runtimePath = runtime || path.resolve(__dirname, "..", "..", "main.js");
  const searchMode = mode || "exact";
  let source = fs.readFileSync(runtimePath, "utf8");
  if (instrumentFusionTrace) source = instrumentFusionTraceSource(source);
  ensureNodeGlobals();
  const obsidianStub = makeObsidianStub();
  const compiled = compileRuntime(source, runtimePath, obsidianStub);
  const PluginClass = compiled.__vaultHarnessPluginClass || compiled;
  if (typeof PluginClass !== "function") {
    throw new Error("vault-harness: runtime does not export a plugin class");
  }
  const manifest = { id: PLUGIN_ID, dir: PLUGIN_DIR };
  const adapter = createReadOnlyAdapter(vaultRoot, { inMemoryWrites });
  const app = buildFakeApp(vaultRoot, adapter, obsidianStub.__harness.TFile);
  const plugin = new PluginClass(app, manifest);
  // Real settings load (mirrors onload): data.json + DEFAULT_SETTINGS.
  const loaded = await plugin.loadData().catch(() => ({}));
  plugin.settings = Object.assign({}, compiled.DEFAULT_SETTINGS, loaded);
  plugin.settings.semanticSearchMode = searchMode;
  await plugin.loadSemanticIndex();
  return plugin;
}

function writeResult(outDir, name, obj) {
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, name);
  const tmp = `${dest}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, dest);
  return dest;
}

function sha8(input) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 8);
}

async function cachedQueryEmbeddings(plugin, texts, outDir) {
  const list = (Array.isArray(texts) ? texts : []).map((text) => String(text ?? ""));
  const model = String(plugin?.settings?.embeddingModel || "");
  const keyFor = (text) =>
    crypto.createHash("sha256").update(`${model}\n${text}`, "utf8").digest("hex");
  // Keys already bind the model via the hash, so entries cached under another
  // model simply miss; the stored `model` is provenance only.
  let entries = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(outDir, QUERY_EMBEDDINGS_FILE), "utf8"));
    if (parsed && typeof parsed.entries === "object" && parsed.entries) entries = parsed.entries;
  } catch {
    entries = {};
  }
  const missing = [...new Set(list.filter((text) => !Array.isArray(entries[keyFor(text)])))];
  if (missing.length) {
    let vectors;
    try {
      vectors = await plugin.embedTexts(missing, "query");
    } catch (error) {
      throw new Error(
        `query embedding unavailable: ${missing.length} uncached; start the embedding server once`
      );
    }
    for (let i = 0; i < missing.length; i += 1) entries[keyFor(missing[i])] = vectors[i];
    writeResult(outDir, QUERY_EMBEDDINGS_FILE, {
      version: QUERY_EMBEDDING_CACHE_VERSION,
      model,
      entries,
    });
  }
  return list.map((text) => entries[keyFor(text)]);
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

// Paired bootstrap over per-query scores: resamples queries with replacement
// (seeded mulberry32) and reports the mean of (candidate − baseline) with its
// 95% percentile interval.
function pairedBootstrap(
  baselineScores,
  candidateScores,
  { n = BOOTSTRAP_DEFAULT_N, seed = BOOTSTRAP_DEFAULT_SEED } = {}
) {
  const base = Array.from(baselineScores || []);
  const cand = Array.from(candidateScores || []);
  if (base.length !== cand.length) {
    throw new Error("vault-harness: pairedBootstrap needs equal-length score arrays");
  }
  if (!base.length) return { mean: 0, lo: 0, hi: 0 };
  const diffs = base.map((b, i) => Number(cand[i]) - Number(b));
  const mean = diffs.reduce((sum, d) => sum + d, 0) / diffs.length;
  const rng = mulberry32(seed);
  const means = new Array(n);
  for (let r = 0; r < n; r += 1) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i += 1) sum += diffs[Math.floor(rng() * diffs.length)];
    means[r] = sum / diffs.length;
  }
  means.sort((a, b) => a - b);
  return { mean, lo: means[Math.floor(0.025 * n)], hi: means[Math.floor(0.975 * n)] };
}

module.exports = {
  parseArgs,
  createReadOnlyAdapter,
  isPluginOwnPath,
  isVector,
  vectorLength,
  loadPlugin,
  cachedQueryEmbeddings,
  writeResult,
  sha8,
  pairedBootstrap,
};
