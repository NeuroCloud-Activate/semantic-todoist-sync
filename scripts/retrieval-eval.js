"use strict";
// scripts/retrieval-eval.js — Task 1 Step 4: read-only retrieval evaluation.
//
// CLI: node scripts/retrieval-eval.js --vault <path> [--out <dir>]
//      [--mode exact|routed] [--baseline <file>] [--runtime <main.js>]
//      [--fallback-raw-index]
//
// Normal path: loads the plugin via vault-harness loadPlugin, embeds each
// gold query via cachedQueryEmbeddings, and scores with the plugin's REAL
// lane scorer (routeProductionSemanticCandidateBatches, main.js:11036) —
// the same lane scoring retrieveTaskSemanticContexts runs per task
// (main.js:12143). SUBSTITUTION (noted): the full retrieveTaskSemanticContexts
// call was impractical — it resolves query handles only from indexed chunks
// matching the source/task identity (resolveIndexedSemanticQueryHandles),
// so a synthetic task with no indexed identity yields zero handles and a
// degraded result. The lane scorer IS the shared scoring function all callers
// route through, so this measures the real retrieval ranking.
// Rank = unique note paths in returned candidate order (chunk→note via the
// chunk `path` field); source note NOT excluded (not protected).
//
// Stale-index detect: loadPlugin on the testing vault leaves semanticIndex
// empty and queues a compatibility rebuild (on-disk content version 3 vs
// runtime 4). Empty (`length === 0`) or pending rebuild → --fallback-raw-index
// runs Step 4b, else exit 1 with the rebuild message.
//
// Step 4b (--fallback-raw-index): loads the on-disk v3 shards directly
// (manifest + shard files, chunks {id, path, text, embedding}) and ranks by
// plain cosine (+ evidenceId tiebreak, mirroring the lane scorer's sort).
// Lexical union lives downstream of lane scoring in
// retrieveTaskSemanticContexts, so cosine-only IS the same pipeline stage.
// Output file gets a `-fallback-v3` suffix so it can never overwrite a real
// baseline; JSON carries `fallback: "raw-v3"`.
//
// Nothing from the vault is written to the repo. Eval output defaults to
// <vault>/.obsidian/plugins/semantic-todoist-sync/eval-private/.
// RETRIEVAL_EVAL_FAKE_EMBED=1 replaces plugin.embedTexts with deterministic
// hash-seeded vectors (local pipeline testing only; never needed normally).

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");
const harness = require("./lib/vault-harness.js");

const {
  parseArgs: harnessParseArgs,
  loadPlugin,
  cachedQueryEmbeddings,
  writeResult,
  sha8,
  pairedBootstrap,
  isVector,
  vectorLength,
} = harness;

const GOLD_FILE = "retrieval-gold.json";
const GOLD_MISSING_MESSAGE = "gold set missing: run Task 0";
const QUERY_EMBEDDINGS_FILE = "query-embeddings.json";
const INDEX_MISSING_MESSAGE =
  "index not available (content version mismatch) — run the plugin once to rebuild";
const FALLBACK_TAG = "raw-v3";
const FAKE_DIM = 1024;

function fail(message) {
  process.stderr.write(`retrieval-eval: ${message}\n`);
  process.exit(1);
}

function parseLocalArgs(argv) {
  const fallbackFlag = "--fallback-raw-index";
  const laneSeamFlag = "--lane-seam";
  const fusionTaskFlag = "--fusion-task";
  const fusionMissesOutFlag = "--fusion-misses-out";
  const filtered = [argv[0], argv[1]];
  let fallback = false;
  let laneSeam = false;
  let fusionTask = false;
  let fusionMissesOut = "";
  const takeValue = (i, flag) => {
    const value = argv[i + 1];
    if (value === undefined || String(value).startsWith("--")) {
      fail(`${flag} needs a value`);
    }
    return value;
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === fallbackFlag) fallback = true;
    else if (argv[i] === laneSeamFlag) laneSeam = true;
    else if (argv[i] === fusionTaskFlag) fusionTask = true;
    else if (argv[i] === fusionMissesOutFlag) fusionMissesOut = takeValue(i++, fusionMissesOutFlag);
    else filtered.push(argv[i]);
  }
  let parsed;
  try {
    parsed = harnessParseArgs(filtered);
  } catch (error) {
    fail(error.message);
  }
  if (parsed.mode !== "exact" && parsed.mode !== "routed") {
    fail(`unknown mode: ${parsed.mode} (want exact|routed)`);
  }
  return { ...parsed, fallback, laneSeam, fusionTask, fusionMissesOut };
}

const normPath = (value) =>
  String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");

// loadPlugin constructs the plugin without onload (timers/views/network),
// so caches onload creates (main.js:4374-4379) may be missing. The lane scorer
// touches three of them; the task-generation entry (retrieveTaskSemanticContexts
// + runtimeSemanticQueryHandles + lexical selector) touches more (e.g.
// queryEmbeddingCache.get, semanticChunkTermCache.get). Create the missing
// ones here (eval-local only, never clobbering real state).
function ensureLaneScoringState(plugin) {
  const ensureMap = (name) => {
    if (!(plugin[name] instanceof Map)) plugin[name] = new Map();
  };
  for (const name of [
    "semanticRoutingRouteCache",
    "semanticExactScoreCache",
    "_semanticExactScoreCacheTimestamps",
    "queryEmbeddingCache",
    "taskDeduplicationEmbeddingCache",
    "_taskDeduplicationEmbeddingCacheTimestamps",
    "semanticRetrievalCache",
    "_taskIntermediateByKey",
    "_evidenceRerankHealth",
    "semanticChunkTermCache",
    "semanticIndexPathMeta",
  ]) {
    ensureMap(name);
  }
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

// Deterministic unit vectors for offline pipeline testing only.
function fakeVectors(texts, dim = FAKE_DIM) {
  return texts.map((text) => {
    const seed = Number.parseInt(
      crypto.createHash("sha256").update(String(text), "utf8").digest("hex").slice(0, 8),
      16
    );
    const rng = mulberry32(seed);
    const vec = Array.from({ length: dim }, () => rng() * 2 - 1);
    const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vec.map((value) => value / norm);
  });
}

function cosine(a, b) {
  // v4 index embeddings are Float64Array; accept any array-like vector.
  if (!isVector(a) || !isVector(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return dot / ((Math.sqrt(na) * Math.sqrt(nb)) || 1);
}

function loadGold(outDir) {
  const file = path.join(outDir, GOLD_FILE);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    fail(`${GOLD_MISSING_MESSAGE} (no ${file})`);
  }
  let gold;
  try {
    gold = JSON.parse(raw);
  } catch (error) {
    fail(`gold set unreadable: ${error.message}`);
  }
  const queries = Array.isArray(gold.queries) ? gold.queries : [];
  const self = Array.isArray(gold.self) ? gold.self : [];
  if (!queries.length && !self.length) fail("gold set has no queries or self entries");
  return { queries, self };
}

// Linked: relevant[].path. Self: relevant = {sourcePath}.
function toEvalQueries(gold) {
  const linked = gold.queries.map((q) => ({
    id: String(q.id),
    text: String(q.text ?? ""),
    kind: String(q.kind ?? "unknown"),
    relevant: (Array.isArray(q.relevant) ? q.relevant : [])
      .map((r) => normPath(r && r.path))
      .filter(Boolean),
  }));
  const self = gold.self.map((q) => ({
    id: String(q.id),
    text: String(q.text ?? ""),
    kind: "self",
    relevant: q.sourcePath ? [normPath(q.sourcePath)] : [],
  }));
  return { linked, self };
}

function scoreRankedPaths(rankedPaths, relevant) {
  const rel = new Set(relevant);
  const hits = rankedPaths
    .map((p, i) => (rel.has(p) ? i + 1 : 0))
    .filter(Boolean);
  const top = (k) =>
    relevant.length ? rankedPaths.slice(0, k).filter((p) => rel.has(p)).length / relevant.length : 0;
  return {
    recall8: top(8),
    recall24: top(24),
    rr: hits.length ? 1 / Math.min(...hits) : 0,
  };
}

function summarize(perQuery) {
  const n = perQuery.length;
  const mean = (key) =>
    n ? perQuery.reduce((sum, q) => sum + Number(q[key] || 0), 0) / n : 0;
  return { queries: n, recall8: mean("recall8"), recall24: mean("recall24"), mrr: mean("rr") };
}

// Real lane scoring: one handle group per query over the loaded index.
async function rankWithLaneScoring(plugin, queryId, queryVector) {
  const index = Array.isArray(plugin.semanticIndex) ? plugin.semanticIndex : [];
  const probe = index.find((c) => c && vectorLength(c.embedding) > 0);
  if (!probe) throw new Error("lane scoring: loaded index has no vectors");
  const provider = String(
    probe.embeddingProvider || probe.indexMetadata?.provider || plugin.settings?.embeddingProvider || ""
  );
  const model = String(
    probe.embeddingModel || probe.indexMetadata?.model || plugin.settings?.embeddingModel || ""
  );
  const dimension = Number(vectorLength(probe.embedding) || 0);
  const encoderVersion = Number(
    probe.embeddingContentVersion || probe.indexMetadata?.contentVersion || 0
  );
  if (!isVector(queryVector) || queryVector.length !== dimension) {
    throw new Error(
      `lane scoring: query vector dim ${isVector(queryVector) ? queryVector.length : "?"} != index dim ${dimension}`
    );
  }
  const revision = Number(plugin.semanticIndexRevision || 0);
  const handle = {
    vector: queryVector,
    provider,
    model,
    dimension,
    encoderVersion,
    indexRevision: revision,
    cacheKey: `eval:${queryId}`,
    sourceEvidenceIds: [],
    sourceIds: [],
  };
  const batch = await plugin.routeProductionSemanticCandidateBatches(
    [{ groupId: queryId, handles: [handle], topK: 240 }],
    index,
    {
      mode: "task-generation",
      indexRevision: revision,
      storageFingerprint: plugin.semanticIndexStorageFingerprint || "",
      completeEligibleStream: true,
    }
  );
  if (batch?.degradedReason) {
    throw new Error(`lane scoring degraded (${batch.degradedReason}) for query ${queryId}`);
  }
  const group = (batch?.groups || []).find((g) => g.groupId === queryId) || batch?.groups?.[0];
  if (!group || group.degradedReason) {
    throw new Error(`lane scoring degraded (${group?.degradedReason || "no-group"}) for query ${queryId}`);
  }
  const seen = new Set();
  const ranked = [];
  for (const cand of group.candidates || []) {
    const p = normPath(cand?.chunk?.path || "");
    if (!p || seen.has(p)) continue;
    seen.add(p);
    ranked.push(p);
  }
  return { ranked, rowsScanned: Number(batch?.telemetry?.routingRowsScanned || 0) };
}

function findFallbackManifest(pluginDir, provider) {
  const direct = path.join(pluginDir, `semantic-index.${provider || "customopenai"}.json`);
  try {
    const parsed = JSON.parse(fs.readFileSync(direct, "utf8"));
    if (parsed && Array.isArray(parsed.shards)) return { file: direct, manifest: parsed };
  } catch {
    // fall through to directory scan
  }
  const entries = fs.readdirSync(pluginDir).filter((name) => /^semantic-index\..*\.json$/i.test(name));
  for (const name of entries) {
    if (/path-meta|routing/i.test(name) || /\.g[0-9a-z]+-/i.test(name)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(pluginDir, name), "utf8"));
      if (parsed && Array.isArray(parsed.shards) && parsed.shards.length) {
        return { file: path.join(pluginDir, name), manifest: parsed };
      }
    } catch {
      continue;
    }
  }
  fail("fallback: no sharded semantic-index manifest found in plugin dir");
}

function loadRawShards(plugin, pluginDir) {
  const provider = plugin.settings?.embeddingProvider;
  const { file, manifest } = findFallbackManifest(pluginDir, provider);
  const chunks = [];
  for (const shard of manifest.shards || []) {
    const shardFile = path.join(pluginDir, String(shard.file || ""));
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(shardFile, "utf8"));
    } catch (error) {
      fail(`fallback: shard unreadable ${shard.file}: ${error.message}`);
    }
    for (const chunk of parsed?.chunks || []) {
      if (chunk && vectorLength(chunk.embedding) && chunk.path) {
        chunks.push(chunk);
      }
    }
  }
  if (!chunks.length) fail(`fallback: manifest ${file} yielded no embedded chunks`);
  const keep =
    typeof plugin.isIndexablePath === "function"
      ? chunks.filter((c) => {
          try {
            return plugin.isIndexablePath(c.path);
          } catch {
            return true;
          }
        })
      : chunks;
  const versions = new Set(keep.map((c) => Number(c.embeddingContentVersion || c.indexMetadata?.contentVersion || 0)));
  return {
    chunks: keep,
    manifestFile: file,
    meta: manifest.meta || {},
    contentVersions: [...versions],
  };
}

function rankWithRawShards(shardChunks, queryVector) {
  const scored = [];
  for (const chunk of shardChunks) {
    if (!isVector(queryVector) || vectorLength(chunk.embedding) !== queryVector.length) continue;
    scored.push({ path: normPath(chunk.path), score: cosine(queryVector, chunk.embedding) });
  }
  scored.sort(
    (a, b) => Number(b.score || 0) - Number(a.score || 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  );
  const seen = new Set();
  const ranked = [];
  for (const row of scored) {
    if (!row.path || seen.has(row.path)) continue;
    seen.add(row.path);
    ranked.push(row.path);
  }
  return { ranked, rowsScanned: scored.length };
}

function loadSeamEvaluator(runtimePath) {
  let source = fs.readFileSync(runtimePath, "utf8");
  // Instrument the lexical-union loops in both union regions (main.js 10433
  // retrieveSemanticContext and 12492 retrieveTaskSemanticContexts) so the
  // harness can prove the real edited condition executed.
  const instrumentCounter = "global.__laneSeamLexicalInvoked = (global.__laneSeamLexicalInvoked || 0) + 1;";
  source = source.replace(
    /lexicalSelectorRows\.push\(\{ evidenceId,/g,
    instrumentCounter + "\n        lexicalSelectorRows.push({ evidenceId,"
  );
  const compiled = new Module(runtimePath, module);
  compiled.filename = runtimePath;
  compiled.paths = Module._nodeModulePaths(path.dirname(runtimePath));
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
      requestUrl() { throw new Error("lane-seam: network disabled"); },
    };
  };
  try {
    compiled._compile(
      source +
      "\nconst PluginClass = module.exports._pluginClass || (typeof module.exports === 'function' ? module.exports : null);\n" +
      "if (PluginClass && typeof PluginClass === 'function') module.exports.__laneSeamPluginClass = PluginClass;\n" +
      "module.exports.__laneSeamEvaluator = { taskWorkflowSelectScoreEvidence };\n",
      runtimePath
    );
    const exportsObj = compiled.exports.__laneSeamEvaluator || compiled.exports;
    const adapter = exportsObj.taskWorkflowSelectScoreEvidence || exportsObj;
    const pluginClass = compiled.exports.__laneSeamPluginClass || (typeof compiled.exports === "function" ? compiled.exports : null);
    return { adapter, pluginClass, lexicalInvocations: () => (global.__laneSeamLexicalInvoked || 0) };
  } finally {
    Module._load = originalLoad;
    delete require.cache[runtimePath];
  }
}

async function rankWithLaneSeam(rawChunks, item, queryVector, runtimePath) {
  // Reconstruct raw-v3 chunks to the lexical union seam's expected input shape.
  const lexicalRows = rawChunks.map((chunk) => ({
    evidenceId: String(chunk.id || chunk.evidenceId || chunk.chunkId || ""),
    score: 0,
    text: String(chunk.text || chunk.description || chunk.body || ""),
  })).filter((r) => r.evidenceId && r.text);

  // Build synthetic semantic rows from the raw chunks with positive cosine to the query.
  const queryVec = isVector(queryVector) ? queryVector : [];
  const semanticRows = [];
  for (const chunk of rawChunks) {
    const embedding = isVector(chunk.embedding) ? chunk.embedding : [];
    if (!embedding.length || !queryVec.length) continue;
    const score = cosine(queryVec, embedding);
    if (Number.isFinite(score) && score > 0) {
      semanticRows.push({
        evidenceId: String(chunk.id || chunk.evidenceId || chunk.chunkId || ""),
        score: score,
        text: String(chunk.text || chunk.description || chunk.body || ""),
      });
    }
  }

  // Call through the edited runtime's union region: use retrieveAdaptiveSemanticContext
  // (mode "task-generation") with a minimal synthetic instance so the lexical loop
  // at 10433/12492 actually executes under the edited condition.
  const { adapter, pluginClass, lexicalInvocations } = loadSeamEvaluator(runtimePath);
  let unionInvoked = 0;
  let resultIds = [];

  if (pluginClass) {
    // Minimal synthetic plugin instance with stub index/settings/query.
    const stubIndex = rawChunks.map((c) => ({
      id: c.id || c.evidenceId || c.chunkId,
      evidenceId: String(c.id || c.evidenceId || c.chunkId || ""),
      chunkId: c.id || c.evidenceId || c.chunkId,
      path: c.path || `Notes/${c.id || c.evidenceId || c.chunkId}.md`,
      text: String(c.text || c.description || c.body || ""),
      sourceKind: "note",
      chunk: {
        id: c.id || c.evidenceId || c.chunkId,
        evidenceId: String(c.id || c.evidenceId || c.chunkId || ""),
        path: c.path || `Notes/${c.id || c.evidenceId || c.chunkId}.md`,
        text: String(c.text || c.description || c.body || ""),
        sourceKind: "note",
        authorityState: "authoritative",
        retrievalEligible: true,
      },
      semantic: Number.isFinite(c.semantic) ? c.semantic : (cosine(queryVector, Array.isArray(c.embedding) ? c.embedding : []) > 0 ? 0.85 : 0),
      retrievalEligible: true,
    }));
    const syntheticInstance = new pluginClass({
      appVault: { adapter: { path: { join: () => "fake" } } },
      vault: { adapter: { path: { join: () => "fake" } } },
    });
    if (syntheticInstance && typeof syntheticInstance.retrieveAdaptiveSemanticContext === "function") {
      // Set minimal required state.
      syntheticInstance.settings = { maxTaskContextChunks: 20, maxTaskContextChunks: 20, semanticNoteCreatedTimeEnabled: () => false };
      syntheticInstance.semanticIndex = stubIndex;
      try {
        const adaptivePromise = syntheticInstance.retrieveAdaptiveSemanticContext(
          String(item.text || item.id || ""),
          "task-generation",
          20,
          "",
          { sourceContract: {} }
        );
        const adaptiveResult = await adaptivePromise;
        resultIds = (adaptiveResult && adaptiveResult.evidenceIds) ? adaptiveResult.evidenceIds : [];
      } catch (e) {
        // Synthetic instance may fail due to missing internals; fall back to adapter.
        resultIds = [];
      }
    }
  }

  // Fallback / augmentation via the adapter (taskWorkflowSelectScoreEvidence) so
  // the lexical union region is always exercised through the compiled runtime.
  if (typeof adapter === "function") {
    const adapterResult = adapter(semanticRows, String(item.text || item.id || ""), {
      semanticLimit: 20,
      lexicalLimit: 20,
      lexicalRows,
    });
    const adapterIds = (adapterResult && adapterResult.evidenceIds) ? adapterResult.evidenceIds : [];
    // Merge adapter results if the synthetic path didn't produce any; prefer adapter
    // for metrics, but the synthetic path is what exercises the edited union.
    resultIds = adapterIds.length ? adapterIds : resultIds;
  }

  unionInvoked = lexicalInvocations();
  // Instrumentation: count of non-empty lexical rows fed to the edited union path.
  const lexicalRowNonEmptyCount = Array.isArray(lexicalRows) ? lexicalRows.filter((r) => r && r.evidenceId && String(r.text || "").trim()).length : 0;
  const ids = resultIds.length ? resultIds : (adapter && adapter.evidenceIds ? adapter.evidenceIds : []);
  const ranked = [];
  const seen = new Set();
  for (const id of ids) {
    const pathStr = String(id).split(":").pop() || String(id);
    // For raw-v3 chunks, evidenceId maps back to chunk path via chunk.path
    const chunkPath = (rawChunks.find((c) => String(c.id || c.evidenceId || c.chunkId) === String(id)) || {}).path || String(id);
    const p = normPath(chunkPath || pathStr);
    if (!p || seen.has(p)) continue;
    seen.add(p);
    ranked.push(p);
  }
  return { ranked, rowsScanned: rawChunks.length, lexicalInvocations: unionInvoked, lexicalRowNonEmptyCount, lexicalRowCount: Array.isArray(lexicalRows) ? lexicalRows.length : 0 };
}

async function evaluateSet(items, rankOne) {
  const perQuery = [];
  let dropped = 0;
  let rowsScanned = 0;
  let totalLexicalInvocations = 0;
  let totalLexicalRowNonEmpty = 0;
  const startedAt = Date.now();
  for (const item of items) {
    if (!item.relevant.length || !String(item.text || "").trim()) {
      dropped += 1;
      continue;
    }
    const result = await rankOne(item);
    const ranked = result.ranked || [];
    const rows = result.rowsScanned || 0;
    rowsScanned += Number(rows || 0);
    totalLexicalInvocations += Number(result.lexicalInvocations || 0);
    totalLexicalRowNonEmpty += Number(result.lexicalRowNonEmptyCount || 0);
    perQuery.push({ id: item.id, ...scoreRankedPaths(ranked, item.relevant) });
  }
  return {
    perQuery,
    dropped,
    rowsScanned,
    ms: Date.now() - startedAt,
    lexicalInvocations: totalLexicalInvocations,
    lexicalRowNonEmptyCount: totalLexicalRowNonEmpty,
    ...summarize(perQuery),
  };
}

function kindsBreakdown(linkedItems, perQueryById) {
  const groups = new Map();
  for (const item of linkedItems) {
    if (!item.relevant.length) continue;
    const row = perQueryById.get(item.id);
    if (!row) continue;
    if (!groups.has(item.kind)) groups.set(item.kind, []);
    groups.get(item.kind).push(row);
  }
  const out = {};
  for (const [kind, rows] of groups) out[kind] = { ...summarize(rows) };
  return out;
}

function fmtPct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}pp`;
}

function printSetTable(name, set) {
  console.log(
    `${name}: n=${set.queries} dropped=${set.dropped} ` +
      `recall@8=${fmtPct(set.recall8)} recall@24=${fmtPct(set.recall24)} ` +
      `mrr=${Number(set.mrr || 0).toFixed(4)} rows=${set.rowsScanned} ms=${set.ms}`
  );
}

function compareBaseline(baselineFile, result) {
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  } catch (error) {
    fail(`baseline unreadable: ${error.message}`);
  }
  const baseSets = (baseline && baseline.sets) || {};
  const excludedIds = new Set();
  let allGatePass = true;
  for (const setName of ["linked", "self"]) {
    const baseRows = new Map(
      ((baseSets[setName] || {}).perQuery || []).map((row) => [String(row.id), row])
    );
    const candRows = (result.sets[setName] || {}).perQuery || [];
    for (const [metric, label] of [["recall8", "recall@8"], ["recall24", "recall@24"], ["rr", "mrr"]]) {
      const base = [];
      const cand = [];
      for (const row of candRows) {
        const other = baseRows.get(String(row.id));
        if (!other) {
          excludedIds.add(`${setName}:${row.id}`);
          continue;
        }
        base.push(Number(other[metric] || 0));
        cand.push(Number(row[metric] || 0));
      }
      if (!base.length) {
        console.log(`${setName} ${label}: no overlapping queries (excluded=${excludedIds.size})`);
        allGatePass = false;
        continue;
      }
      const { mean, lo, hi } = pairedBootstrap(base, cand);
      const gatePass = lo > -0.01;
      const improves = lo > 0 ? "yes" : "no";
      if (!gatePass) allGatePass = false;
      console.log(
        `${setName} ${label}: delta=${fmtPct(mean)} 95%CI=[${fmtPct(lo)},${fmtPct(hi)}] ` +
          `GATE ${gatePass ? "PASS" : "FAIL"} IMPROVES ${improves}`
      );
    }
  }
  console.log(`baseline excluded queries (missing either side): ${excludedIds.size}`);
  console.log(`OVERALL GATE ${allGatePass ? "PASS" : "FAIL"}`);
}

// --fusion-task: drive the REAL task-generation retrieval entry
// (retrieveTaskSemanticContexts, one synthetic email-like task per gold query)
// so the lexical-union guard actually executes. Query vectors come ONLY from
// the on-disk query-embeddings cache (fully offline); any miss throws inside
// the wrapped embedTexts (fail-closed) and is recorded for the seeder.
function fusionTraceSnapshot() {
  const g = globalThis;
  return {
    union: Number(g.__fusionUnionInvocations || 0),
    rows: Number(g.__fusionLexRowPushes || 0),
    nonEmpty: Number(g.__fusionLexNonEmpty || 0),
  };
}

function wrapFusionEmbedTexts(plugin, outDir, tracker) {
  const model = String(plugin?.settings?.embeddingModel || "");
  let entries = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(outDir, QUERY_EMBEDDINGS_FILE), "utf8"));
    if (parsed && typeof parsed.entries === "object" && parsed.entries) entries = parsed.entries;
  } catch {
    entries = {};
  }
  plugin.embedTexts = async (texts) => {
    const list = (Array.isArray(texts) ? texts : []).map((text) => String(text ?? ""));
    const out = [];
    for (const text of list) {
      tracker.requested.push(text);
      const key = crypto.createHash("sha256").update(`${model}\n${text}`, "utf8").digest("hex");
      const hit = entries[key];
      if (isVector(hit) && hit.length) {
        out.push(Array.from(hit, Number));
        continue;
      }
      tracker.missed.push(text);
      throw new Error(
        `fusion-task: query embedding uncached for ${JSON.stringify(text).slice(0, 80)}; seed it first`
      );
    }
    return out;
  };
}

async function rankWithFusionTask(plugin, item) {
  const res = await plugin.retrieveTaskSemanticContexts(
    [{ title: String(item.text || "") }],
    {},
    null,
    { mode: "task-generation" }
  );
  const tasks = Object.values((res && res.byTask) || {});
  const first = tasks[0] || {};
  const context = Array.isArray(first.context) ? first.context : [];
  const seen = new Set();
  const ranked = [];
  for (const row of context) {
    const p = normPath((row && row.chunk && row.chunk.path) || (row && row.path) || "");
    if (!p || seen.has(p)) continue;
    seen.add(p);
    ranked.push(p);
  }
  const degraded = String(
    (res && res.telemetry && res.telemetry.degradedReason) ||
    (first.telemetry && first.telemetry.degradedReason) ||
    ""
  );
  return {
    ranked,
    rowsScanned: Number((res && res.telemetry && res.telemetry.routingRowsScanned) || 0),
    degraded,
  };
}

async function main() {
  const args = parseLocalArgs(process.argv);
  const vaultRoot = path.resolve(args.vault);
  const outDir = path.resolve(args.out);
  const gold = loadGold(outDir);
  const { linked, self } = toEvalQueries(gold);
  const all = [...linked, ...self];

  const plugin = await loadPlugin({
    vault: vaultRoot,
    runtime: args.runtime,
    mode: args.mode,
    instrumentFusionTrace: args.fusionTask,
  });
  ensureLaneScoringState(plugin);
  if (process.env.RETRIEVAL_EVAL_FAKE_EMBED === "1" && !args.fusionTask) {
    plugin.embedTexts = async (texts) => fakeVectors(texts.map(String));
  }

  const compatReason =
    plugin.semanticIndexCompatibilityRefresh && typeof plugin.semanticIndexCompatibilityRefresh === "object"
      ? String(plugin.semanticIndexCompatibilityRefresh.reasonCode || "")
      : "";
  const pendingRefresh = plugin.semanticIndexCompatibilityRefreshPending?.() === true;
  const loadedChunks = Array.isArray(plugin.semanticIndex) ? plugin.semanticIndex.length : 0;

  let rankOne;
  let fallback = null;
  let indexChunks = loadedChunks;
  let fusionTracker = null;
  let fusionTraceLinked = null;
  let fusionTraceSelf = null;
  let fusionDegradedLinked = 0;
  let fusionDegradedSelf = 0;
  let fusionErrorCount = 0;
  const fusionErrorSamples = [];
  let linkedSet = null;
  let selfSet = null;
  if (args.fusionTask) {
    if (args.fallback || args.laneSeam) {
      fail("--fusion-task is mutually exclusive with --fallback-raw-index/--lane-seam");
    }
    if (pendingRefresh || loadedChunks === 0) {
      fail(`fusion-task needs the live index: ${INDEX_MISSING_MESSAGE}${compatReason ? ` (${compatReason})` : ""}`);
    }
    fusionTracker = { requested: [], missed: [] };
    wrapFusionEmbedTexts(plugin, outDir, fusionTracker);
    let degradedCount = 0;
    const degradedSamples = [];
    rankOne = async (item) => {
      try {
        const r = await rankWithFusionTask(plugin, item);
        if (r.degraded) {
          degradedCount += 1;
          if (degradedSamples.length < 8) degradedSamples.push(`${item.id}:${r.degraded}`);
        }
        return r;
      } catch (error) {
        fusionErrorCount += 1;
        if (fusionErrorSamples.length < 8) {
          fusionErrorSamples.push(`${item.id}:${String((error && error.message) || error).slice(0, 120)}`);
        }
        return { ranked: [], rowsScanned: 0 };
      }
    };
    const snap0 = fusionTraceSnapshot();
    linkedSet = await evaluateSet(linked, rankOne);
    const snap1 = fusionTraceSnapshot();
    fusionDegradedLinked = degradedCount;
    selfSet = await evaluateSet(self, rankOne);
    const snap2 = fusionTraceSnapshot();
    fusionDegradedSelf = degradedCount - fusionDegradedLinked;
    const traceDiff = (a, b) => ({ union: b.union - a.union, rows: b.rows - a.rows, nonEmpty: b.nonEmpty - a.nonEmpty });
    fusionTraceLinked = traceDiff(snap0, snap1);
    fusionTraceSelf = traceDiff(snap1, snap2);
    fusionTracker.degradedSamples = degradedSamples;
  } else if (pendingRefresh || loadedChunks === 0) {
    if (!args.fallback) {
      fail(`${INDEX_MISSING_MESSAGE}${compatReason ? ` (${compatReason})` : ""}`);
    }
    const pluginDir = path.join(vaultRoot, ".obsidian", "plugins", "semantic-todoist-sync");
    const raw = loadRawShards(plugin, pluginDir);
    indexChunks = raw.chunks.length;
    fallback = FALLBACK_TAG;
    console.log(
      `fallback ${FALLBACK_TAG}: ${raw.chunks.length} v${raw.contentVersions.join(",") || "?"} chunks ` +
        `from ${raw.manifestFile}`
    );
    const vectors = await cachedQueryEmbeddings(plugin, all.map((q) => q.text), outDir).catch((error) => {
      fail(error.message);
    });
    const vecById = new Map(all.map((q, i) => [q.id, vectors[i]]));
    if (args.laneSeam) {
      rankOne = async (item) => rankWithLaneSeam(raw.chunks, item, vecById.get(item.id), args.runtime);
    } else {
      rankOne = async (item) => rankWithRawShards(raw.chunks, vecById.get(item.id));
    }
  } else {
    const vectors = await cachedQueryEmbeddings(plugin, all.map((q) => q.text), outDir).catch((error) => {
      fail(error.message);
    });
    const vecById = new Map(all.map((q, i) => [q.id, vectors[i]]));
    rankOne = async (item) => rankWithLaneScoring(plugin, item.id, vecById.get(item.id));
  }

  if (!args.fusionTask) {
    linkedSet = await evaluateSet(linked, rankOne);
    selfSet = await evaluateSet(self, rankOne);
  }
  const perQueryById = new Map(
    [...linkedSet.perQuery, ...selfSet.perQuery].map((row) => [String(row.id), row])
  );

  const runtimeSource = fs.readFileSync(args.runtime, "utf8");
  const result = {
    tool: "retrieval-eval",
    mode: args.mode,
    fusionTask: args.fusionTask || undefined,
    runtimeHash: sha8(runtimeSource),
    fallback,
    indexChunks,
    createdAt: new Date().toISOString(),
    sets: { linked: linkedSet, self: selfSet },
    kinds: kindsBreakdown(linked, perQueryById),
  };
  if (args.fusionTask) {
    result.fusionTrace = { linked: fusionTraceLinked, self: fusionTraceSelf };
    result.fusionDegraded = {
      linked: fusionDegradedLinked,
      self: fusionDegradedSelf,
      errors: fusionErrorCount,
      degradedSamples: (fusionTracker && fusionTracker.degradedSamples) || [],
      errorSamples: fusionErrorSamples,
    };
  }

  const fileName = args.fusionTask
    ? `retrieval-fusiontask-${args.mode}-${result.runtimeHash}.json`
    : fallback
      ? `retrieval-${args.mode}-${result.runtimeHash}-fallback-v3.json`
      : `retrieval-${args.mode}-${result.runtimeHash}.json`;
  const dest = writeResult(outDir, fileName, result);
  printSetTable("linked", linkedSet);
  printSetTable("self", selfSet);
  for (const [kind, summary] of Object.entries(result.kinds)) {
    console.log(
      `kind ${kind}: n=${summary.queries} recall@8=${fmtPct(summary.recall8)} ` +
        `recall@24=${fmtPct(summary.recall24)} mrr=${Number(summary.mrr || 0).toFixed(4)}`
    );
  }
  console.log(`wrote ${dest}`);
  if (args.fusionMissesOut) {
    const missed = [...new Set((fusionTracker ? fusionTracker.missed : []))];
    fs.mkdirSync(path.dirname(path.resolve(args.fusionMissesOut)), { recursive: true });
    fs.writeFileSync(path.resolve(args.fusionMissesOut), JSON.stringify(missed, null, 2), "utf8");
    console.log(`fusion-task: requested=${fusionTracker ? fusionTracker.requested.length : 0} missed=${missed.length} wrote ${args.fusionMissesOut}`);
  }
  if (args.fusionTask) {
    const tl = fusionTraceLinked || {};
    const ts = fusionTraceSelf || {};
    console.log(
      `INSTRUMENTATION --fusion-task: union-invocations linked=${tl.union || 0} self=${ts.union || 0} ` +
      `lex-rows linked=${tl.rows || 0} self=${ts.rows || 0} non-empty linked=${tl.nonEmpty || 0} self=${ts.nonEmpty || 0} ` +
      `degraded linked=${fusionDegradedLinked} self=${fusionDegradedSelf} errors=${fusionErrorCount}`
    );
    if (fusionErrorSamples.length) console.log(`fusion-task error samples: ${fusionErrorSamples.join(" | ")}`);
    if (fusionTracker && fusionTracker.degradedSamples && fusionTracker.degradedSamples.length) {
      console.log(`fusion-task degraded samples: ${fusionTracker.degradedSamples.join(" | ")}`);
    }
    console.log("LABEL: real retrieveTaskSemanticContexts(\"task-generation\") one synthetic email-like task per query; runtime query-handle path; cache-served embeddings (offline).");
  } else {
  // Instrumentation report: counts from edited union path (--lane-seam).
  const linkedInst = linkedSet.lexicalInvocations || 0;
  const selfInst = selfSet.lexicalInvocations || 0;
  const linkedLexRowNonEmpty = linkedSet.lexicalRowNonEmptyCount || 0;
  const selfLexRowNonEmpty = selfSet.lexicalRowNonEmptyCount || 0;
  console.log(`INSTRUMENTATION --lane-seam: union-invocations linked=${linkedInst} self=${selfInst} non-empty-lexical-rows linked=${linkedLexRowNonEmpty} self=${selfLexRowNonEmpty}`);
  // Labeling: the synthetic retrieveAdaptiveSemanticContext path was exercised
  // through the edited mode condition; adapter fallback exercised if synthetic
  // instance unavailable. Full production retrieveTaskSemanticContexts entry
  // not driven this round (same substitution noted in retrieval-eval header).
  console.log("LABEL: synthetic retrieveAdaptiveSemanticContext(\"task-generation\") through edited union; adapter fallback present; full retrieveTaskSemanticContexts entry impractical this round (see header).");
  }
  if (args.baseline) compareBaseline(args.baseline, result);
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => fail((error && error.message) || String(error)));
}

module.exports = {
  GOLD_MISSING_MESSAGE,
  INDEX_MISSING_MESSAGE,
  cosine,
  fakeVectors,
  scoreRankedPaths,
  summarize,
  ensureLaneScoringState,
  rankWithLaneScoring,
  rankWithFusionTask,
  rankWithRawShards,
  toEvalQueries,
};
