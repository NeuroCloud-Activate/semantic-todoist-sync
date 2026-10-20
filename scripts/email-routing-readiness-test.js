"use strict";
// scripts/email-routing-readiness-test.js — the email workflow owns the
// production semantic routing state.
//
// Live symptom (disposable vault, build 82E68E5833C1): the first email
// processed right after plugin load got ZERO vault rows (adaptive context 0,
// delivered evidence = only its own current-source row, 5 s instead of
// 15-29 s). The same email minutes later was normal.
//
// Root cause: the vault retrieval path only READS the production routing
// state (ensureProductionSemanticRoutingState with allowBuild:false) and
// degrades to zero rows when it is missing. That state is built by the
// startup warm-up 5 s after load, so an email processed inside that window
// retrieved nothing. Every processed email invalidates the state again,
// because the email log note is indexed (index revision bump).
//
// This test proves the email workflow builds the routing state BEFORE it runs
// vault retrieval:
//   (a) with no routing state built yet, the email plan builds it and
//       delivers vault rows (before the fix: zero vault rows),
//   (b) two emails back to back with an index revision bump between them (the
//       email log note is indexed) both deliver vault rows,
//   (c) a routing build that throws or returns null neither throws out of the
//       email workflow nor creates a durable failure hold.
//
// The harness is the offline fake app of scripts/email-task-plan-selection-test.js
// (same module loader, same corpus shape, same stubbed AI provider). The
// vault adapter is writable in memory, because the email workflow persists
// the routing artifact it builds.
//
// Read-only and offline: nothing touches a real vault, the network or Todoist.
//
// Usage:
//   node scripts/email-routing-readiness-test.js
//   node scripts/email-routing-readiness-test.js --main-source=<path to src/main.js>

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const argv = process.argv.slice(2);
const mainSourceArg = argv.find((value) => value.startsWith("--main-source="));
const mainPath = mainSourceArg
  ? path.resolve(mainSourceArg.slice("--main-source=".length))
  : path.join(__dirname, "..", "src/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");

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
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
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
    requestUrl() { throw new Error("email-routing-readiness-test: network disabled"); }
  };
};

let runtime;
try {
  ensureNodeGlobals();
  testModule._compile(
    `${mainSource}\nmodule.exports.__emailRoutingReadiness = {\n` +
      "  DEFAULT_SETTINGS, SEMANTIC_EMBEDDING_CONTENT_VERSION, semanticEmbeddingIdentity,\n" +
      "  semanticChunkEvidenceId, semanticChunkContentFingerprint\n" +
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
  semanticChunkEvidenceId,
  semanticChunkContentFingerprint
} = runtime.__emailRoutingReadiness;

// ---------------------------------------------------------------------------
// Offline fixture: a small vault corpus the email can retrieve.
// ---------------------------------------------------------------------------
const DIM = 16;
const REVISION = 1;
const FINGERPRINT = "email-routing-readiness-test";

const EMAIL_TITLE = "Acme Atlas intake form";
const EMAIL_TEXT = "The Acme Atlas intake form must be submitted before Friday.";

const NOTE_PATHS = [
  "Projects/Acme/Acme Debrief.md",
  "Projects/Acme/Atlas Program.md",
  "Meeting Notes/Weekly Standup.md",
  "Notes/Personal Reading.md",
  "Notes/Task Note.md",
  "Projects/Acme/Atlas Timeline.md"
];
const NOTE_CHUNK_TEXTS = {
  "Projects/Acme/Acme Debrief.md": [
    "Acme atlas debrief: the intake form is due October 13 and Alex confirmed the program timeline for the atlas proposal.",
    "Acme atlas proposal editing continues; the vendor addendum and the trainee estimate for the unit breakdown are still outstanding."
  ],
  "Projects/Acme/Atlas Program.md": [
    "Acme atlas intake paperwork checklist for the program cycle.",
    "Acme atlas proposal reviewers and their comment windows."
  ],
  "Meeting Notes/Weekly Standup.md": [
    "Acme standup agenda: front desk hiring interview scheduling and phone tree rotation.",
    "Acme onboarding checklist for the new front desk rotation."
  ],
  "Notes/Personal Reading.md": [
    "Acme grocery list and garden planting schedule for the weekend.",
    "Acme travel booking receipts for the summer trip."
  ],
  "Notes/Task Note.md": [
    "- [ ] Submit the Acme atlas intake form\nAcme atlas task note context for the checked action."
  ],
  "Projects/Acme/Atlas Timeline.md": [
    "Acme atlas program reporting dates and partner letters.",
    "Acme atlas eligibility confirmation notes for the intake round."
  ]
};
const NOTE_PATH_SET = new Set(NOTE_PATHS);

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
function fakeEmbed(text) {
  const vector = new Array(DIM).fill(0);
  for (const token of tokensOf(text)) vector[slotOf(token)] += 1;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map((value) => value / norm) : vector.map(() => 0);
}

function noteChunk(notePath, text, index) {
  const evidenceId = semanticChunkEvidenceId(notePath, semanticChunkContentFingerprint(text), index);
  return {
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
  };
}

function buildIndexChunks() {
  const chunks = [];
  for (const notePath of NOTE_PATHS) {
    NOTE_CHUNK_TEXTS[notePath].forEach((text, index) => chunks.push(noteChunk(notePath, text, index)));
  }
  return chunks;
}

// The email log note the plugin writes after a processed email. It becomes
// vault evidence, so the next email in the same poll sees a changed index.
const EMAIL_LOG_PATH = "Email-To-Todoist/2026-10-09 Acme Atlas intake form.md";
function emailLogChunk() {
  return noteChunk(
    EMAIL_LOG_PATH,
    "Acme Atlas intake form email log: the intake form task was synced to Todoist.",
    0
  );
}

// A writable in-memory vault adapter: the email workflow persists the routing
// artifact it builds, so the adapter must accept writes.
function makeFakeApp() {
  const files = new Map();
  const adapter = {
    getBasePath: () => "", getName: () => "",
    read: async (filePath) => {
      if (!files.has(filePath)) throw new Error(`email-routing-readiness-test: no such file ${filePath}`);
      return files.get(filePath);
    },
    readBinary: async (filePath) => {
      if (!files.has(filePath)) throw new Error(`email-routing-readiness-test: no such file ${filePath}`);
      return files.get(filePath);
    },
    exists: async (filePath) => files.has(filePath),
    stat: async () => { throw new Error("email-routing-readiness-test: no files"); },
    list: async (dir) => ({
      files: Array.from(files.keys())
        .filter((filePath) => filePath.startsWith(`${dir}/`))
        .map((filePath) => filePath.slice(dir.length + 1)),
      folders: []
    }),
    write: async (filePath, body) => { files.set(filePath, String(body)); },
    writeBinary: async (filePath, bytes) => { files.set(filePath, bytes); },
    append: async () => {},
    remove: async (filePath) => { files.delete(filePath); },
    rename: async (from, to) => {
      if (!files.has(from)) throw new Error(`email-routing-readiness-test: no such file ${from}`);
      files.set(to, files.get(from));
      files.delete(from);
    },
    mkdir: async () => {}, rmdir: async () => {}, copy: async () => {}, process: async () => {}
  };
  const vault = {
    adapter,
    getName: () => "",
    getMarkdownFiles: () => [],
    getFiles: () => [],
    getAbstractFileByPath: () => null,
    cachedRead: async () => { throw new Error("email-routing-readiness-test: read-only vault"); },
    read: async () => { throw new Error("email-routing-readiness-test: read-only vault"); },
    create: async () => { throw new Error("email-routing-readiness-test: read-only vault"); },
    modify: async () => { throw new Error("email-routing-readiness-test: read-only vault"); },
    append: async () => { throw new Error("email-routing-readiness-test: read-only vault"); },
    delete: async () => { throw new Error("email-routing-readiness-test: read-only vault"); },
    on: () => () => {}, off: () => {}
  };
  const metadataCache = { getFileCache: () => null, getFirstLinkpathDest: () => null };
  const workspace = {
    getLeavesOfType: () => [], getActiveViewOfType: () => null, detachLeavesOfType: () => {},
    on: () => () => {}, off: () => {}
  };
  return { vault, metadataCache, workspace };
}

async function makePlugin(options = {}) {
  const chunks = buildIndexChunks();
  const identity = semanticEmbeddingIdentity(DEFAULT_SETTINGS, {});
  const provider = identity.provider;
  const model = identity.model;
  const app = makeFakeApp();
  const plugin = new runtime(app, { id: "semantic-todoist-sync", dir: ".obsidian/plugins/semantic-todoist-sync" });
  plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
  plugin.settings.embeddingProvider = provider;
  plugin.settings.embeddingModel = model;
  plugin.settings.semanticSearchMode = "exact";
  plugin.settings.maxTaskContextChunks = 200;
  plugin.settings.semanticIndexMeta = Object.assign({}, plugin.settings.semanticIndexMeta || {}, {
    provider, model, dimension: DIM, chunks: chunks.length,
    embeddingContentVersion: SEMANTIC_EMBEDDING_CONTENT_VERSION,
    shardCount: 0, generation: "email-routing-readiness-test", schemaVersion: 2
  });
  plugin.queryEmbeddingCache = new Map();
  plugin.semanticRetrievalCache = new Map();
  plugin.semanticRoutingRouteCache = new Map();
  plugin.semanticExactScoreCache = new Map();
  plugin._semanticExactScoreCacheTimestamps = new Map();
  plugin.markActivityLogDirty = () => {};
  plugin.semanticIndex = chunks;
  plugin.semanticIndexRevision = REVISION;
  plugin.semanticIndexStorageFingerprint = FINGERPRINT;
  plugin.semanticIndexCompatibilityRefreshPending = () => false;
  plugin.embedTexts = async (texts) => (Array.isArray(texts) ? texts : []).map((text) => fakeEmbed(text));
  for (const chunk of chunks) {
    chunk.embeddingModel = model;
    chunk.indexMetadata.model = model;
  }
  // No routing state is built here on purpose: the plugin has just loaded, so
  // this is the state the live email poll met.
  plugin.logLocal = (message, details) => {
    plugin.logs.push({ message, details: details || {} });
  };
  plugin.logs = [];
  installAiStub(plugin);
  return { plugin, chunks, app };
}

// The stubbed provider: it returns one task that cites the first evidence
// handles the workflow actually put in front of the model.
function installAiStub(plugin) {
  plugin.openaiResponse = async (request = {}) => {
    const prefix = String(request.promptCachePrefix || "");
    const handles = [...new Set((prefix.match(/^(E\d+) /gm) || []).map((line) => line.trim()))];
    return JSON.stringify({
      tasks: [{
        content: "Complete and submit the Acme Atlas intake form",
        due_date: null,
        deadline_date: null,
        priority: 1,
        labels: [],
        scope_id: "scope-unused",
        refs: handles.slice(0, 2),
        subtasks: []
      }],
      section_name: "",
      descriptions: []
    });
  };
}

function bundleOf(plan) {
  return plan?.taskWorkflowContextBundle || plan?.contextBundle || null;
}

// The evidence the provider actually received, with the vault path of every
// delivered row.
function deliveredRows(plan) {
  const bundle = bundleOf(plan);
  const projection = bundle?.providerEvidenceProjection || null;
  const ids = (projection?.selectedEvidenceIds || []).map(String);
  const paths = [];
  for (const item of bundle?.evidenceCatalog?.items || []) {
    if (ids.includes(String(item.evidenceId || item.id || ""))) {
      paths.push(String(item.provenance?.path || ""));
    }
  }
  return { ids, paths, vaultPaths: paths.filter((item) => NOTE_PATH_SET.has(item)) };
}

function emailSource(title = EMAIL_TITLE, text = EMAIL_TEXT) {
  return { type: "email", title, text, sectionName: "2026-10-09 Acme" };
}

// The worker/Todoist edges of the real email workflow, stubbed so the plan
// path can be driven end to end without a worker, a vault write or Todoist.
function installEmailWorkflowStubs(plugin) {
  plugin.workerJson = async (route) => {
    if (String(route).startsWith("/email?")) {
      return {
        raw: [
          "From: sender@example.com",
          "To: me@example.com",
          "Subject: Acme Atlas intake form",
          "",
          "Please submit the Acme Atlas intake form before Friday.",
          ""
        ].join("\r\n"),
        subject: "Acme Atlas intake form",
        from: "sender@example.com",
        receivedAt: "2026-10-09T10:00:00Z"
      };
    }
    return {};
  };
  plugin.prepareGeneratedTasksForTodoistWorkflow = async (tasks, plan) => ({
    sectionId: "section-1",
    sectionName: plan?.sectionName || "2026-10-09 Acme",
    tasks: tasks || []
  });
  plugin.generateEmailLogSummary = async () => "Acme Atlas intake form summary.";
  plugin.createTodoistTaskBatch = async (sectionName, tasks) => (tasks || []).map((task, index) => ({
    id: `todoist-${index + 1}`,
    content: String(task?.content || "")
  }));
  plugin.appendEmailLog = async () => {};
}

const failures = [];
function check(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${(error && error.message) || error}`);
    console.error(`FAIL: ${name}: ${(error && error.message) || error}`);
  }
}

async function main() {
  // ---- (a) no routing state yet: the email plan must build it ------------
  const first = await makePlugin();
  const firstPlan = await first.plugin.createTaskPlanWithLocalActivity(emailSource(), {});
  const firstRows = deliveredRows(firstPlan);
  console.log(
    `email 1: delivered=${firstRows.ids.length} vaultNotes=${firstRows.vaultPaths.length} ` +
    `routingState=${first.plugin.productionSemanticRoutingState?.routingIndex ? "ready" : "missing"} ` +
    `failure=${JSON.stringify(firstPlan?.workflowContextFailure?.code || "")}`
  );

  check("the email plan builds the routing state before vault retrieval", () => {
    assert.ok(
      first.plugin.productionSemanticRoutingState?.routingIndex,
      "the email plan must leave a built production routing state behind"
    );
  });

  check("the email plan delivers vault rows instead of only its own current-source row", () => {
    assert.ok(
      firstRows.vaultPaths.length > 0,
      `the email plan must deliver vault note rows, got ${JSON.stringify(firstRows.paths)}`
    );
    assert.ok(
      firstRows.ids.length >= 2,
      `the email plan must deliver more than the single current-source row, got ${firstRows.ids.length}`
    );
  });

  // ---- (b) two emails back to back with an index revision bump -----------
  // The first email writes an email log note, that note is indexed, so the
  // index revision changes and the routing state is invalidated before the
  // second email runs its retrieval.
  first.plugin.semanticIndex = [...first.plugin.semanticIndex, emailLogChunk()];
  first.plugin.semanticIndexRevision = REVISION + 1;
  first.plugin.semanticIndexStorageFingerprint = `${FINGERPRINT}-2`;
  first.plugin.invalidateProductionSemanticRoutingState("semantic-index-revision");
  const secondPlan = await first.plugin.createTaskPlanWithLocalActivity(
    emailSource("Acme Atlas invoice", "The Acme Atlas invoice for the program cycle must be filed."),
    {}
  );
  const secondRows = deliveredRows(secondPlan);
  console.log(
    `email 2: delivered=${secondRows.ids.length} vaultNotes=${secondRows.vaultPaths.length} ` +
    `routingState=${first.plugin.productionSemanticRoutingState?.routingIndex ? "ready" : "missing"} ` +
    `failure=${JSON.stringify(secondPlan?.workflowContextFailure?.code || "")}`
  );

  check("the second email still delivers vault rows after the index revision bump", () => {
    assert.ok(
      secondRows.vaultPaths.length > 0,
      `the second email plan must deliver vault note rows, got ${JSON.stringify(secondRows.paths)}`
    );
  });

  // ---- (c) a failing routing build must not break the email workflow ------
  // The real email workflow entry point, so the hold machinery is in play.
  const broken = await makePlugin();
  installEmailWorkflowStubs(broken.plugin);
  const recordedHolds = [];
  broken.plugin.recordEmailFailureHoldSafely = async (...args) => { recordedHolds.push(args); };
  let brokenCalls = 0;
  broken.plugin.ensureProductionSemanticRoutingState = async () => {
    brokenCalls += 1;
    // The workflow-owned readiness build is the FIRST call; it throws.
    if (brokenCalls === 1) throw Object.assign(new Error("routing build exploded"), { code: "routing-state-build-failed" });
    return null;
  };
  let brokenResult = null;
  let brokenError = null;
  try {
    brokenResult = await broken.plugin.processPendingEmailItem({ id: "email-1" });
  } catch (error) {
    brokenError = error;
  }
  check("a routing build that throws does not throw out of the email workflow", () => {
    assert.equal(brokenError, null, `the email workflow must not throw, got ${brokenError && brokenError.message}`);
    assert.ok(brokenResult, "the email workflow must still return a result");
  });

  check("a routing build that throws creates no durable failure hold", () => {
    assert.equal(recordedHolds.length, 0, `the email workflow must not record a failure hold, got ${JSON.stringify(recordedHolds)}`);
    assert.equal(broken.plugin.emailFailureHoldCounts().total, 0, "the email workflow must not leave a failure hold behind");
  });

  const nullBuild = await makePlugin();
  installEmailWorkflowStubs(nullBuild.plugin);
  const nullHolds = [];
  nullBuild.plugin.recordEmailFailureHoldSafely = async (...args) => { nullHolds.push(args); };
  nullBuild.plugin.ensureProductionSemanticRoutingState = async () => null;
  let nullResult = null;
  let nullError = null;
  try {
    nullResult = await nullBuild.plugin.processPendingEmailItem({ id: "email-2" });
  } catch (error) {
    nullError = error;
  }
  check("a routing build that resolves null does not throw out of the email workflow", () => {
    assert.equal(nullError, null, `the email workflow must not throw, got ${nullError && nullError.message}`);
    assert.ok(nullResult, "the email workflow must still return a result");
  });
  check("a routing build that resolves null creates no durable failure hold", () => {
    assert.equal(nullHolds.length, 0, `the email workflow must not record a failure hold, got ${JSON.stringify(nullHolds)}`);
  });

  if (failures.length) {
    console.error(`${failures.length} email-routing-readiness check(s) failed`);
    process.exit(1);
  }
  console.log("PASS: email routing readiness");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
