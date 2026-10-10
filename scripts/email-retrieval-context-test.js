"use strict";
// scripts/email-retrieval-context-test.js — 0.9.18 regression guard (offline).
//
// Bug (see .superpowers/sdd/reoptimization/email-evidence-diagnosis.md): an email
// source is built as {type:"email", title, text} with NO vault path
// (main.js:18361-18366, path:"" at main.js:18392), so buildTaskSourceContract
// yields path "" + a synthetic src-<hash> sourceId. Every task-workflow query
// vector is BORROWED from an indexed chunk of the source note
// (main.js:12142 `lane.embedding = lane.queryHandles[0]?.vector`), and an email
// matches no indexed chunk, so both retrieval entry points produced ZERO handles
// -> routeProductionSemanticCandidateBatches early-returns degraded
// "query-vector-unavailable" (main.js:11169-11171) -> no vault note was ever
// retrieved and an email description had nothing to cite.
//
// Fix under test: the shared runtimeSemanticQueryHandles helper (the chat-mode
// runtime-embedding fallback, main.js:10328-10367, hoisted) is used by
// retrieveTaskSemanticContexts (main.js:11810, after the lane loop, before the
// routing call) and by retrieveSemanticContext's non-chat branch
// (main.js:10369-10386), so a source with no indexed path still gets a query
// vector. When embedding fails the helper returns [] and the existing
// fail-closed branch still fires.
//
// Read-only and offline: the plugin is constructed over a fake read-only app,
// plugin.embedTexts is stubbed with a deterministic bag-of-words embedding in the
// same dimension as a 12-chunk / 4-note in-memory index, and the "Acme" note is
// built to be nearest the stubbed email-task vector. Nothing touches the vault.
//
// Usage:
//   node scripts/email-retrieval-context-test.js [--record-note-arm-baseline]

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = process.env.EMAIL_RETRIEVAL_MAIN || path.join(__dirname, "..", "main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const baselinePath = path.join(__dirname, "fixtures", "email-retrieval-note-arm-baseline.json");

const argv = process.argv.slice(2);
const recordBaseline = argv.includes("--record-note-arm-baseline");

const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

function ensureNodeGlobals() {
  const g = globalThis;
  const timers = {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    setInterval: (...args) => setInterval(...args),
    clearInterval: (...args) => clearInterval(...args)
  };
  if (typeof g.window === "undefined" || !g.window) {
    g.window = Object.assign({}, timers);
    return;
  }
  for (const key of Object.keys(timers)) {
    if (typeof g.window[key] !== "function") g.window[key] = timers[key];
  }
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  class Plugin {
    constructor(app, manifest) {
      this.app = app;
      this.manifest = manifest;
    }
    async loadData() { return {}; }
    async saveData() {}
    registerEvent() {}
    addCommand() {}
    registerView() {}
    addSettingTab() {}
    addRibbonIcon() { return {}; }
  }
  return {
    ItemView: Empty,
    MarkdownRenderer: {},
    MarkdownView: Empty,
    Modal: Empty,
    Notice: Empty,
    Plugin,
    PluginSettingTab: Empty,
    Setting: Empty,
    TFile: Empty,
    setIcon() {},
    requestUrl() { throw new Error("email-retrieval-context-test: network disabled"); }
  };
};

let runtime;
try {
  ensureNodeGlobals();
  testModule._compile(
    `${mainSource}\nmodule.exports.__emailRetrievalContext = {\n` +
      "  DEFAULT_SETTINGS, SEMANTIC_EMBEDDING_CONTENT_VERSION, semanticEmbeddingIdentity,\n" +
      "  buildTaskSourceContract, buildTaskEvidenceCatalog, taskWorkflowEvidenceSourceList,\n" +
      "  contextNotesForTaskPlan\n" +
      "};\n",
    mainPath
  );
  runtime = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const {
  DEFAULT_SETTINGS,
  SEMANTIC_EMBEDDING_CONTENT_VERSION,
  semanticEmbeddingIdentity,
  buildTaskSourceContract,
  buildTaskEvidenceCatalog,
  taskWorkflowEvidenceSourceList,
  contextNotesForTaskPlan
} = runtime.__emailRetrievalContext;

// ---------------------------------------------------------------------------
// Offline fixture: 4 notes / 12 chunks, one of which ("Acme Debrief") is the
// nearest note for the email task wording.
// ---------------------------------------------------------------------------
const DIM = 16;
const FINGERPRINT = "email-context-test";
const REVISION = 1;

const EMAIL_TITLE = "Acme meeting highlights";
const EMAIL_SUMMARY =
  "Meeting highlights about the Acme Atlas program: the intake form is due October 13, " +
  "proposal Part 1 editing continues, the vendor addendum goes to Alex, the trainee estimate " +
  "for the unit breakdown is pending, and Alex's eligibility confirmation must " +
  "be saved as a PDF.";
const TASK_CONTENT = "Complete and submit the Atlas intake form";

const NOTE_PATHS = [
  "Projects/Acme/Acme Debrief.md",
  "Projects/Acme/Atlas Program.md",
  "Meeting Notes/Weekly Standup.md",
  "Notes/Personal Reading.md"
];
const ACME_PATH = NOTE_PATHS[0];
const NOTE_CHUNK_TEXTS = {
  [ACME_PATH]: [
    "Acme atlas debrief: the intake form is due October 13 and Alex confirmed the program timeline for the atlas proposal.",
    "Acme atlas proposal Part 1 editing continues; the vendor addendum and the trainee estimate for the unit breakdown are still outstanding.",
    "Acme atlas program recap: eligibility confirmation, Alex's addendum, and the intake form submission are the open items."
  ],
  "Projects/Acme/Atlas Program.md": [
    "Atlas intake paperwork checklist for the Acme program cycle.",
    "Atlas proposal reviewers and their comment windows.",
    "Atlas program reporting dates and partner letters."
  ],
  "Meeting Notes/Weekly Standup.md": [
    "Weekly standup agenda: front desk hiring interview scheduling and phone tree rotation.",
    "Break room supplies ordering and the payroll cutoff reminder.",
    "Onboarding checklist for the new front desk rotation."
  ],
  "Notes/Personal Reading.md": [
    "Grocery list and garden planting schedule for the weekend.",
    "Gym membership renewal and library returns.",
    "Travel booking receipts for the summer trip."
  ]
};

// Lane preambles emitted by buildTaskSemanticQuerySet (main.js:33358-33393) plus
// ordinary English stopwords, so the stub ranks on content words only.
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "your", "you", "are", "was", "were",
  "have", "has", "will", "would", "about", "over", "under", "must", "should", "each", "they", "them",
  "their", "when", "what", "which", "while", "also", "than", "then", "some", "more", "most", "only",
  "just", "very", "been", "being", "does", "done", "not", "but", "all", "any", "can", "could", "out",
  "current", "task", "action", "exact", "source", "wording", "same", "scope", "authoritative",
  "statement", "terminology", "naming", "direction", "preserve", "quoted", "terms", "optional",
  "primary", "context", "relationship", "handoff", "semantics", "local", "execution", "prior",
  "reviewer", "history", "identity", "artifact", "people", "feedback", "edits", "decisions",
  "conflicts", "unresolved", "state", "continuity", "existing", "open", "references"
]);

const tokensOf = (text) => String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
const slotOf = (token) => {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % DIM;
};
// Deterministic offline stand-in for the embedding model: a normalized
// bag-of-words projection, so texts sharing content words land near each other.
function fakeEmbed(text) {
  const vector = new Array(DIM).fill(0);
  for (const token of tokensOf(text)) vector[slotOf(token)] += 1;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map((value) => value / norm) : vector.map(() => 0);
}

function buildIndexChunks() {
  const chunks = [];
  let ordinal = 0;
  for (const notePath of NOTE_PATHS) {
    NOTE_CHUNK_TEXTS[notePath].forEach((text, index) => {
      ordinal += 1;
      const evidenceId = `evidence-${notePath.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${index + 1}`;
      chunks.push({
        id: evidenceId,
        evidenceId,
        chunkId: evidenceId,
        path: notePath,
        title: notePath.split("/").pop().replace(/\.md$/i, ""),
        text,
        embedding: fakeEmbed(text),
        sourceKind: "note",
        embeddingProvider: "customopenai",
        embeddingModel: "",
        embeddingDimension: DIM,
        embeddingContentVersion: SEMANTIC_EMBEDDING_CONTENT_VERSION,
        indexMetadata: {
          provider: "customopenai",
          model: "",
          dimension: DIM,
          contentVersion: SEMANTIC_EMBEDDING_CONTENT_VERSION,
          indexRevision: REVISION,
          schemaVersion: 2
        },
        provenance: { path: notePath, sourceId: `src-${notePath}`, authority: "authoritative" },
        retrievalEligible: true,
        nonEvidence: false,
        authorityState: "authoritative",
        current: true,
        lineStart: index * 4 + 1,
        lineEnd: index * 4 + 3
      });
    });
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Plugin under test over a fake, strictly read-only app.
// ---------------------------------------------------------------------------
function makeFakeApp() {
  const refuse = async () => {
    throw new Error("email-retrieval-context-test: read-only adapter");
  };
  const adapter = {
    getBasePath: () => "",
    getName: () => "",
    read: refuse,
    readBinary: refuse,
    exists: async () => false,
    stat: async () => {
      throw new Error("email-retrieval-context-test: no files");
    },
    list: async () => ({ files: [], folders: [] }),
    write: refuse,
    writeBinary: refuse,
    append: refuse,
    remove: refuse,
    rename: refuse,
    mkdir: refuse,
    rmdir: refuse,
    copy: refuse,
    process: refuse
  };
  const vault = {
    adapter,
    getName: () => "",
    getMarkdownFiles: () => [],
    getFiles: () => [],
    getAbstractFileByPath: () => null,
    cachedRead: refuse,
    read: refuse,
    create: refuse,
    modify: refuse,
    append: refuse,
    delete: refuse,
    on: () => () => {},
    off: () => {}
  };
  const metadataCache = { getFileCache: () => null, getFirstLinkpathDest: () => null };
  const workspace = {
    getLeavesOfType: () => [],
    getActiveViewOfType: () => null,
    detachLeavesOfType: () => {},
    on: () => () => {},
    off: () => {}
  };
  return { vault, metadataCache, workspace };
}

async function makePlugin(embedTextsImpl) {
  const chunks = buildIndexChunks();
  const identity = semanticEmbeddingIdentity(DEFAULT_SETTINGS, {});
  const provider = identity.provider;
  const model = identity.model;
  const plugin = new runtime(makeFakeApp(), { id: "semantic-todoist-sync", dir: ".obsidian/plugins/semantic-todoist-sync" });
  plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
  plugin.settings.embeddingProvider = provider;
  plugin.settings.embeddingModel = model;
  plugin.settings.semanticSearchMode = "exact";
  plugin.settings.semanticIndexMeta = Object.assign({}, plugin.settings.semanticIndexMeta || {}, {
    provider,
    model,
    dimension: DIM,
    chunks: chunks.length,
    embeddingContentVersion: SEMANTIC_EMBEDDING_CONTENT_VERSION,
    shardCount: 0,
    generation: "email-context-test",
    schemaVersion: 2
  });
  // Caches onload creates (main.js:4374-4379); loadPlugin never runs onload.
  plugin.queryEmbeddingCache = new Map();
  plugin.semanticRetrievalCache = new Map();
  plugin.semanticRoutingRouteCache = new Map();
  plugin.semanticExactScoreCache = new Map();
  plugin._semanticExactScoreCacheTimestamps = new Map();
  // logLocal() would schedule a 60s activity-log flush through the read-only
  // adapter; keep the in-memory log only so the run stays fast and offline.
  plugin.markActivityLogDirty = () => {};
  plugin.semanticIndex = chunks;
  plugin.semanticIndexRevision = REVISION;
  plugin.semanticIndexStorageFingerprint = FINGERPRINT;
  plugin.semanticIndexCompatibilityRefreshPending = () => false;
  const calls = [];
  plugin.embedTexts = async (texts, role, captureContext) => {
    const list = (Array.isArray(texts) ? texts : []).map((text) => String(text || ""));
    calls.push({ texts: list, role: String(role || ""), captureContext: Boolean(captureContext) });
    return list.map((text) => fakeEmbed(text));
  };
  if (typeof embedTextsImpl === "function") {
    plugin.embedTexts = async (texts, role, captureContext) => {
      const list = (Array.isArray(texts) ? texts : []).map((text) => String(text || ""));
      calls.push({ texts: list, role: String(role || ""), captureContext: Boolean(captureContext) });
      return embedTextsImpl(list, role, captureContext);
    };
  }
  for (const chunk of chunks) {
    chunk.embeddingModel = model;
    chunk.indexMetadata.model = model;
  }
  const routing = await plugin.ensureProductionSemanticRoutingState({
    chunks,
    settings: plugin.settings,
    revision: REVISION,
    storageFingerprint: FINGERPRINT,
    allowLoad: false,
    allowBuild: true,
    persist: false,
    forceBuild: true,
    shardCount: 0
  });
  return { plugin, chunks, routing, calls };
}

function makeSource(sourceType, notePath) {
  if (sourceType === "email") return { type: "email", title: EMAIL_TITLE, text: EMAIL_SUMMARY, sectionName: "2026-10-09 Acme" };
  return { type: "note", title: EMAIL_TITLE, path: notePath, text: EMAIL_SUMMARY };
}

function makeTask(contract, sourceType) {
  const fact = (contract.facts || [])[0] || {};
  const scopeId = (contract.scopes || [])[0] || {};
  return [{
    id: `scope:${scopeId.scopeId}`,
    taskId: `scope:${scopeId.scopeId}`,
    content: TASK_CONTENT,
    description: TASK_CONTENT,
    semanticQuery: [sourceType === "email" ? EMAIL_TITLE : TASK_CONTENT, TASK_CONTENT].filter(Boolean).join("\n"),
    expandTaskReferences: false,
    scope_id: scopeId.scopeId,
    evidence_ids: [contract.primaryEvidenceId, fact.evidenceId].filter(Boolean),
    fact_refs: [fact.factId].filter(Boolean),
    subtasks: []
  }];
}

async function runRetrieval({ sourceType, embedTextsImpl = null }) {
  const harness = await makePlugin(embedTextsImpl);
  const source = makeSource(sourceType, ACME_PATH);
  const contract = buildTaskSourceContract(source, EMAIL_SUMMARY, harness.plugin.settings);
  const tasks = makeTask(contract, sourceType);
  const result = await harness.plugin.retrieveTaskSemanticContexts(tasks, source, contract, {
    limit: Number(harness.plugin.settings.maxTaskContextChunks || 48),
    mode: "task-generation-prestructure",
    sourceSummary: EMAIL_SUMMARY
  });
  return { harness, source, contract, tasks, result };
}

// Arm C: the embedding endpoint is unreachable, so the runtime fallback must
// return [] and the existing fail-closed branch must still fire.
async function runRetrievalOffline() {
  const harness = await makePlugin(async () => {
    throw new Error("email-retrieval-context-test: embedding endpoint offline");
  });
  const source = makeSource("email", ACME_PATH);
  const contract = buildTaskSourceContract(source, EMAIL_SUMMARY, harness.plugin.settings);
  const result = await harness.plugin.retrieveTaskSemanticContexts(makeTask(contract, "email"), source, contract, {
    limit: Number(harness.plugin.settings.maxTaskContextChunks || 48),
    mode: "task-generation-prestructure",
    sourceSummary: EMAIL_SUMMARY
  });
  return { harness, source, contract, result };
}

// Wall-clock timings are the only fields allowed to differ between runs; every
// substantive field of the note arm must stay byte-identical.
const VOLATILE_KEYS = new Set([
  "elapsedMs", "contextBundleElapsedMs", "routingElapsedMs", "resolveElapsedMs", "assemblyElapsedMs",
  "createdAt", "updatedAt", "startedAt", "completedAt", "rebuiltAt", "at"
]);
const isVolatileKey = (name) => VOLATILE_KEYS.has(name) || /elapsedMs$/i.test(name) || /Timestamp$/.test(name);
function stripVolatile(value) {
  if (Array.isArray(value)) return value.map((entry) => stripVolatile(entry));
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [name, entry] of Object.entries(value)) {
    if (isVolatileKey(name)) continue;
    output[name] = stripVolatile(entry);
  }
  return output;
}

const failures = [];
const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push(`PASS: ${name}`);
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${(error && error.message) || error}`);
    console.error(`FAIL: ${name}: ${(error && error.message) || error}`);
  }
}

async function main() {
  // ---- Arm A: email source with no path (the bug) --------------------------
  const emailArm = await runRetrieval({ sourceType: "email" });
  const emailKey = emailArm.result.taskKeyByIndex?.["0"] || Object.keys(emailArm.result.byTask || {})[0] || "";
  const emailEntry = (emailArm.result.byTask || {})[emailKey] || {};
  const emailContext = emailEntry.context || [];
  const notePaths = [...new Set(emailContext.map((row) => String(row?.provenance?.path || row?.path || "")).filter(Boolean))];
  console.log(
    `email arm: degraded=${JSON.stringify(String(emailArm.result.telemetry?.degradedReason || ""))} ` +
    `lanes=${Number(emailArm.result.telemetry?.laneCount || 0)} indexedHandles=${Number(emailArm.result.telemetry?.indexedHandleCount || 0)} ` +
    `contextRows=${emailContext.length} notePaths=${notePaths.length} embedCalls=${emailArm.harness.calls.length}`
  );

  check("email arm is not degraded with query-vector-unavailable", () => {
    assert.notEqual(String(emailArm.result.telemetry?.degradedReason || ""), "query-vector-unavailable");
    assert.equal(emailArm.result.telemetry?.degraded, false);
  });
  check("email arm retrieves vault note context rows", () => {
    assert.ok(emailContext.length > 0, `context rows must be > 0, got ${emailContext.length}`);
    const vaultRows = emailContext.filter((row) => String(row?.provenance?.path || row?.path || "") && String(row?.provenance?.path || row?.path || "") !== String(emailArm.contract.path || ""));
    assert.ok(vaultRows.length > 0, "at least one retrieved row must be a vault note, not the email's current-source row");
    assert.ok(notePaths.includes(ACME_PATH), `the nearest Acme note must be retrieved, got ${notePaths.join(" | ") || "(none)"}`);
  });
  check("email arm yields >= 2 catalog evidence rows and a numbered Context Notes list", () => {
    const catalog = buildTaskEvidenceCatalog(emailArm.contract, emailContext, emailArm.harness.plugin.settings, {
      source: emailArm.source,
      sourceSummary: EMAIL_SUMMARY
    });
    assert.ok((catalog.items || []).length >= 2, `catalog needs >= 2 evidence rows, got ${(catalog.items || []).length}`);
    const planNotes = contextNotesForTaskPlan(emailContext, String(emailArm.source.path || ""), 7, `${EMAIL_TITLE}\n${EMAIL_SUMMARY}`, emailArm.harness.plugin.settings);
    assert.ok(planNotes.length > 0, "contextNotesForTaskPlan must derive context notes from the retrieved rows");
    const supporting = (catalog.items || []).filter((item) => item.sourceKind !== "current-source" && String(item.provenance?.path || ""));
    assert.ok(supporting.length > 0, "the catalog must carry non-current-source (vault note) rows");
    // Real citation numbering assigns one number per cited source identity, so
    // collapse the retrieved rows to one numbered entry per distinct note path.
    const numberByPath = new Map();
    const ledger = [];
    for (const item of supporting) {
      const itemPath = String(item.provenance?.path || "");
      if (!numberByPath.has(itemPath)) {
        numberByPath.set(itemPath, numberByPath.size + 1);
        ledger.push({
          number: numberByPath.get(itemPath),
          evidenceId: item.evidenceId,
          sourceId: item.provenance?.sourceId || "",
          title: item.provenance?.title || "",
          path: itemPath,
          sourceKind: item.sourceKind || "semantic-index-chunk"
        });
      }
    }
    const task = Object.assign({}, emailArm.tasks[0], {
      descriptionEvidenceBundle: { acceptedEvidenceIds: ledger.map((entry) => entry.evidenceId), evidenceIds: ledger.map((entry) => entry.evidenceId), items: catalog.items },
      descriptionCitedEvidenceIds: ledger.map((entry) => entry.evidenceId),
      descriptionCitationLedger: ledger
    });
    const list = taskWorkflowEvidenceSourceList(task, {}, "", true, "email");
    assert.ok(/^Context Notes:/.test(list), `email source list must start with "Context Notes:", got ${JSON.stringify(list.slice(0, 80))}`);
    assert.match(list, /^1\. /m, "the first context note must be numbered (1)");
    assert.match(list, /obsidian:\/\/open\?file=/, "context notes must render as vault links");
  });
  check("email arm embeds a bounded number of query texts", () => {
    const laneCount = Number(emailArm.result.telemetry?.laneCount || 0);
    assert.ok(emailArm.harness.calls.length > 0, "the email arm must embed at least one runtime query text");
    assert.ok(emailArm.harness.calls.length <= laneCount, `embedTexts calls (${emailArm.harness.calls.length}) must not exceed the lane count (${laneCount})`);
    const seen = new Set();
    for (const call of emailArm.harness.calls) {
      assert.equal(call.texts.length, 1, "each runtime embedding request carries exactly one query text");
      assert.equal(call.role, "query", "runtime query embeddings use the query role");
      assert.ok(!seen.has(call.texts[0]), `duplicate runtime embedding request for ${JSON.stringify(call.texts[0].slice(0, 60))}`);
      seen.add(call.texts[0]);
    }
  });

  // ---- Arm B: note source with an indexed path (unchanged behavior) --------
  const noteArm = await runRetrieval({ sourceType: "note" });
  const noteKey = noteArm.result.taskKeyByIndex?.["0"] || Object.keys(noteArm.result.byTask || {})[0] || "";
  const noteEntry = (noteArm.result.byTask || {})[noteKey] || {};
  const noteContext = noteEntry.context || [];
  const notePathsArmB = [...new Set(noteContext.map((row) => String(row?.provenance?.path || row?.path || "")).filter(Boolean))];
  console.log(
    `note arm:  degraded=${JSON.stringify(String(noteArm.result.telemetry?.degradedReason || ""))} ` +
    `lanes=${Number(noteArm.result.telemetry?.laneCount || 0)} indexedHandles=${Number(noteArm.result.telemetry?.indexedHandleCount || 0)} ` +
    `contextRows=${noteContext.length} notePaths=${notePathsArmB.length} embedCalls=${noteArm.harness.calls.length}`
  );
  check("note arm still resolves indexed handles and embeds nothing at runtime", () => {
    assert.equal(String(noteArm.result.telemetry?.degradedReason || ""), "");
    assert.ok(Number(noteArm.result.telemetry?.indexedHandleCount || 0) > 0, "the note arm must keep resolving indexed handles");
    assert.equal(noteArm.harness.calls.length, 0, "an indexed note source must not trigger a runtime embedding request");
    assert.ok(noteContext.length > 0, "the note arm must keep returning context rows");
  });
  check("note arm result is byte-identical to the pre-change baseline", () => {
    const snapshot = JSON.stringify(stripVolatile(noteArm.result));
    if (recordBaseline || !fs.existsSync(baselinePath)) {
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, `${snapshot}\n`, "utf8");
      console.log(`note-arm baseline ${recordBaseline ? "recorded" : "created"}: ${baselinePath}`);
      return;
    }
    const expected = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    assert.deepStrictEqual(JSON.parse(snapshot), expected);
  });

  // ---- Arm C: embedding unavailable -> fail closed -------------------------
  const offlineArm = await runRetrievalOffline();
  const offlineKey = offlineArm.result.taskKeyByIndex?.["0"] || Object.keys(offlineArm.result.byTask || {})[0] || "";
  const offlineContext = ((offlineArm.result.byTask || {})[offlineKey] || {}).context || [];
  console.log(
    `offline email arm: degraded=${JSON.stringify(String(offlineArm.result.telemetry?.degradedReason || ""))} ` +
    `contextRows=${offlineContext.length} embedCalls=${offlineArm.harness.calls.length}`
  );
  check("offline email arm degrades to query-vector-unavailable with zero context rows", () => {
    assert.equal(String(offlineArm.result.telemetry?.degradedReason || ""), "query-vector-unavailable");
    assert.equal(offlineArm.result.telemetry?.degraded, true);
    assert.equal(offlineContext.length, 0, `fail-closed retrieval must return zero context rows, got ${offlineContext.length}`);
    assert.ok(offlineArm.harness.calls.length > 0, "the fail-closed path must still attempt the runtime embedding");
  });

  // ---- Arm D: adaptive (non-chat retrieveSemanticContext) ------------------
  const adaptive = await runRetrievalAdaptive();
  async function runRetrievalAdaptive() {
    const harness = await makePlugin(null);
    const source = makeSource("email", ACME_PATH);
    const contract = buildTaskSourceContract(source, EMAIL_SUMMARY, harness.plugin.settings);
    const rows = await harness.plugin.retrieveAdaptiveSemanticContext(
      `${EMAIL_TITLE}\n${EMAIL_SUMMARY}`,
      "task-generation",
      Number(harness.plugin.settings.maxTaskContextChunks || 48),
      "",
      { sourceContract: contract }
    );
    return { harness, source, contract, rows, telemetry: rows?.semanticRetrieval?.telemetry || {} };
  }
  console.log(
    `adaptive email arm: indexState=${JSON.stringify(String(adaptive.telemetry.indexState || ""))} ` +
    `degraded=${JSON.stringify(String(adaptive.telemetry.degradedReason || ""))} rows=${(adaptive.rows || []).length} ` +
    `paths=${new Set((adaptive.rows || []).map((row) => String(row?.path || row?.provenance?.path || ""))).size} ` +
    `embedCalls=${adaptive.harness.calls.length}`
  );
  check("adaptive email retrieval returns vault rows instead of degrading", () => {
    assert.notEqual(String(adaptive.telemetry.degradedReason || ""), "query-vector-unavailable");
    assert.ok((adaptive.rows || []).length > 0, `adaptive retrieval must return rows, got ${(adaptive.rows || []).length}`);
    const paths = new Set((adaptive.rows || []).map((row) => String(row?.path || row?.provenance?.path || "")).filter(Boolean));
    assert.ok(paths.has(ACME_PATH), `the nearest Acme note must be retrieved adaptively, got ${[...paths].join(" | ") || "(none)"}`);
  });

  console.log(`email-retrieval-context-test: ${checks.length} checks passed, ${failures.length} failed`);
  if (failures.length) throw new Error(`email-retrieval-context-test failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  console.log("email-retrieval-context-test: pass");
}

main().catch((error) => {
  console.error(`email-retrieval-context-test: ${(error && error.message) || error}`);
  process.exit(1);
});
