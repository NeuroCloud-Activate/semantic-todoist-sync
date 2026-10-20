"use strict";
// scripts/email-task-plan-selection-test.js — email task plan, end to end.
//
// Exercises the REAL production email path offline: createTaskPlanWithLocalActivity
// over a fake read-only app, a stubbed embedding endpoint and a stubbed AI
// provider. It proves that an email source now runs the same scored evidence
// selection as a note source:
//   - the workflow is not blocked (dispatchAllowed true, no
//     protected-workflow-evidence-closure-unresolved failure),
//   - the evidence delivered to the provider is the CAPPED selection (one
//     semantic chunk per note, lexical window 30), not the legacy 1100 cut,
//   - none of the note-only bundle gates (catalog-selected-missing,
//     catalog-selected-empty-excerpt/-missing-provenance/-body-conflict,
//     builder-selection-extra/-unbound) fires for a legitimate email row,
//   - an email with a punctuation-only subject or task content still gets a
//     usable lexical query (the action-text fallback chain).
//
// The note arm is the control: the note selection, the note poststructure
// selection and the note bundle are compared against recorded baselines, so
// this file also proves the note path is byte-identical to the pre-change
// behaviour.
//
// Read-only and offline: nothing touches the vault, the network or Todoist.
//
// Usage:
//   node scripts/email-task-plan-selection-test.js
//   node scripts/email-task-plan-selection-test.js --record-note-baseline
//   node scripts/email-task-plan-selection-test.js --record-delivered-baseline
//   node scripts/email-task-plan-selection-test.js --main-source=<path to src/main.js>
//
// The note baselines are recorded from the PRE-CHANGE commit (a6866b4 = 0.9.27)
// with the same harness, so the note control is a real comparison:
//   git show a6866b4:src/main.js > %TEMP%/main-a6866b4.js
//   node scripts/email-task-plan-selection-test.js --record-note-baseline --main-source=%TEMP%/main-a6866b4.js
// The recorded fixtures are then compared against the current src/main.js on
// every ordinary run.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const argv = process.argv.slice(2);
const recordNoteBaseline = argv.includes("--record-note-baseline");
const recordDeliveredBaseline = argv.includes("--record-delivered-baseline");
const mainSourceArg = argv.find((value) => value.startsWith("--main-source="));
const mainPath = mainSourceArg
  ? path.resolve(mainSourceArg.slice("--main-source=".length))
  : path.join(__dirname, "..", "src/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const fixturesDir = path.join(__dirname, "fixtures");
const noteBaselinePath = path.join(fixturesDir, "email-task-plan-note-baseline.json");
const notePoststructureBaselinePath = path.join(fixturesDir, "email-task-plan-note-poststructure-baseline.json");
const deliveredBaselinePath = path.join(fixturesDir, "email-task-plan-delivered-evidence.json");

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
    requestUrl() { throw new Error("email-task-plan-selection-test: network disabled"); }
  };
};

let runtime;
try {
  ensureNodeGlobals();
  testModule._compile(
    `${mainSource}\nmodule.exports.__emailTaskPlan = {\n` +
      "  DEFAULT_SETTINGS, SEMANTIC_EMBEDDING_CONTENT_VERSION, semanticEmbeddingIdentity,\n" +
      "  buildTaskSourceContract, taskWorkflowSelectTaskRelevantEvidence,\n" +
      "  semanticChunkEvidenceId, semanticChunkContentFingerprint,\n" +
      "  taskReferenceSyntheticPath, semanticTaskReferenceSourceId,\n" +
      "  semanticTaskReferenceEmbeddingProjection\n" +
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
  taskWorkflowSelectTaskRelevantEvidence,
  semanticChunkEvidenceId,
  semanticChunkContentFingerprint,
  taskReferenceSyntheticPath,
  semanticTaskReferenceSourceId,
  semanticTaskReferenceEmbeddingProjection
} = runtime.__emailTaskPlan;

// ---------------------------------------------------------------------------
// Offline fixture: several notes, several chunks per note.
// ---------------------------------------------------------------------------
const DIM = 16;
const REVISION = 1;
const FINGERPRINT = "email-task-plan-selection-test";

const EMAIL_TITLE = "Acme Atlas intake form";
const EMAIL_SUMMARY = "The Acme Atlas intake form must be submitted before the deadline.";
const TASK_CONTENT = "Complete and submit the Acme Atlas intake form";

const NOTE_PATHS = [
  "Projects/Acme/Acme Debrief.md",
  "Projects/Acme/Atlas Program.md",
  "Meeting Notes/Weekly Standup.md",
  "Notes/Personal Reading.md",
  "Notes/Task Note.md"
];
const NOTE_CHUNK_TEXTS = {
  "Projects/Acme/Acme Debrief.md": [
    "Acme atlas debrief: the intake form is due October 13 and Alex confirmed the program timeline for the atlas proposal.",
    "Acme atlas proposal Part 1 editing continues; the vendor addendum and the trainee estimate for the unit breakdown are still outstanding.",
    "Acme atlas program recap: eligibility confirmation, Alex's addendum, and the intake form submission are the open items."
  ],
  "Projects/Acme/Atlas Program.md": [
    "Acme atlas intake paperwork checklist for the program cycle.",
    "Acme atlas proposal reviewers and their comment windows.",
    "Acme atlas program reporting dates and partner letters."
  ],
  "Meeting Notes/Weekly Standup.md": [
    "Acme standup agenda: front desk hiring interview scheduling and phone tree rotation.",
    "Acme break room supplies ordering and the payroll cutoff reminder.",
    "Acme onboarding checklist for the new front desk rotation."
  ],
  "Notes/Personal Reading.md": [
    "Acme grocery list and garden planting schedule for the weekend.",
    "Acme gym membership renewal and library returns.",
    "Acme travel booking receipts for the summer trip."
  ],
  "Notes/Task Note.md": [
    "- [ ] Submit the Acme atlas intake form\nAcme atlas task note context for the checked action."
  ]
};
// Filler notes: enough distinct notes that the per-note semantic cap and the
// 30-slot lexical window are both visible (the corpus is much larger than the
// two windows). Every chunk carries the query's topic words, so the corpus is
// positively scored and admitted, but a Todoist snapshot reference row (a
// reference row with no note of its own) still outranks the fillers and
// reaches the selection.
const FILLER_NOTE_COUNT = 36;
const FILLER_CHUNKS_PER_NOTE = 3;
for (let note = 0; note < FILLER_NOTE_COUNT; note += 1) {
  const notePath = `Projects/Filler/Filler ${note}.md`;
  NOTE_PATHS.push(notePath);
  NOTE_CHUNK_TEXTS[notePath] = Array.from({ length: FILLER_CHUNKS_PER_NOTE }, (unused, chunk) =>
    `Acme atlas filler note ${note} chunk ${chunk}: budget report follow up notes.`
  );
}

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

// A Todoist snapshot reference row in the vault index: a real (non-vault)
// reference row an email corpus can legitimately carry. Its shape is copied
// from the production builder (scripts/email-todoist-reference-evidence-test.js
// and semanticTaskReferenceRecords in src/main.js).
const SNAPSHOT_TODOIST_ID = "1234567890";
const SNAPSHOT_OID = "ABCDEF1234567890";
const SNAPSHOT_SOURCE_KIND = "todoist-snapshot-reference-row";
const SNAPSHOT_TITLE = "File the Acme Atlas intake form";
function snapshotReferenceChunk() {
  const task = {
    id: SNAPSHOT_TODOIST_ID,
    todoistId: SNAPSHOT_TODOIST_ID,
    oid: SNAPSHOT_OID,
    content: SNAPSHOT_TITLE,
    canonicalTaskId: SNAPSHOT_TODOIST_ID,
    nonVaultSource: true,
    sourceSurface: "todoist-snapshot",
    retrievalEligible: true,
    isCompleted: false
  };
  const sourceId = semanticTaskReferenceSourceId(SNAPSHOT_TODOIST_ID, task, SNAPSHOT_SOURCE_KIND);
  const path = taskReferenceSyntheticPath(sourceId, SNAPSHOT_SOURCE_KIND);
  const text = [
    `Source kind: ${SNAPSHOT_SOURCE_KIND}`,
    `Source ID: ${sourceId}`,
    `Todoist task ID: ${SNAPSHOT_TODOIST_ID}`,
    `oid: ${SNAPSHOT_OID}`,
    `Title: ${SNAPSHOT_TITLE}`,
    "State: open",
    "Current state: open in Todoist snapshot",
    "Subtask: false"
  ].join("\n");
  const evidenceId = semanticChunkEvidenceId(path, semanticChunkContentFingerprint(text), 0);
  const chunk = {
    id: `${path}#${SNAPSHOT_SOURCE_KIND}-${SNAPSHOT_TODOIST_ID}`,
    chunkId: `${path}#${SNAPSHOT_SOURCE_KIND}-${SNAPSHOT_TODOIST_ID}`,
    evidenceId,
    path,
    title: "Todoist task snapshot",
    text,
    kind: "todoist-task-reference",
    source: "local-reference-table",
    sourceKind: SNAPSHOT_SOURCE_KIND,
    sourceId,
    canonicalTaskId: SNAPSHOT_TODOIST_ID,
    taskId: SNAPSHOT_TODOIST_ID,
    todoistId: SNAPSHOT_TODOIST_ID,
    oid: SNAPSHOT_OID,
    nonVaultSource: true,
    sourceSurface: "todoist-snapshot",
    retrievalEligible: true,
    authority: "authoritative",
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
    provenance: { path, sourceId, authority: "authoritative" },
    nonEvidence: false,
    authorityState: "authoritative",
    current: true,
    taskReference: Object.assign({}, task, {
      taskId: SNAPSHOT_TODOIST_ID,
      todoistId: SNAPSHOT_TODOIST_ID,
      sourceKind: SNAPSHOT_SOURCE_KIND,
      path
    })
  };
  // The production index embeds a task-reference row from its embedding
  // projection, not from the raw snapshot text.
  chunk.embedding = fakeEmbed(semanticTaskReferenceEmbeddingProjection(chunk));
  return chunk;
}

function buildIndexChunks() {
  const chunks = [];
  for (const notePath of NOTE_PATHS) {
    NOTE_CHUNK_TEXTS[notePath].forEach((text, index) => {
      // The production index assigns every chunk the same evidence id shape
      // (ev:<path hash>:<content hash>:<ordinal>), so the harness rows carry
      // the same identity the routing state derives.
      const evidenceId = semanticChunkEvidenceId(notePath, semanticChunkContentFingerprint(text), index);
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
  chunks.push(snapshotReferenceChunk());
  return chunks;
}

// The production chunking of an email log note. The eligibility comes from
// the real semanticFileChunks, so this arm exercises the shipped rule and not
// a hand-written flag. The evidence id uses the production identity
// (semanticIndexChunkDecorationIterator): the ordinal counts the DUPLICATE
// rows of one content fingerprint, not the position in the note.
function logNoteIndexChunks(plugin, logNotePath, logNoteText) {
  const file = { basename: logNotePath.split("/").pop().replace(/\.md$/i, ""), stat: { mtime: 0 } };
  const duplicateOrdinals = new Map();
  return plugin.semanticFileChunks(logNotePath, file, logNoteText, { createdAt: 0, createdAtSource: "" })
    .map((chunk) => {
      const fingerprint = semanticChunkContentFingerprint(chunk.text);
      const duplicateKey = `${logNotePath}\u0000${fingerprint}`;
      const ordinal = duplicateOrdinals.get(duplicateKey) || 0;
      duplicateOrdinals.set(duplicateKey, ordinal + 1);
      const evidenceId = semanticChunkEvidenceId(logNotePath, fingerprint, ordinal);
      return Object.assign({}, chunk, {
        id: evidenceId,
        evidenceId,
        chunkId: evidenceId,
        embedding: fakeEmbed(chunk.text),
        sourceKind: "note",
        embeddingProvider: "customopenai",
        embeddingModel: "",
        embeddingDimension: DIM,
        indexMetadata: {
          provider: "customopenai",
          model: "",
          dimension: DIM,
          contentVersion: SEMANTIC_EMBEDDING_CONTENT_VERSION,
          indexRevision: REVISION,
          schemaVersion: 2
        },
        provenance: { path: logNotePath, sourceId: `src-${logNotePath}`, authority: "authoritative" },
        retrievalEligible: true,
        nonEvidence: false,
        authorityState: "authoritative",
        current: true
      });
    });
}

function makeFakeApp() {
  const refuse = async () => { throw new Error("email-task-plan-selection-test: read-only adapter"); };
  const adapter = {
    getBasePath: () => "", getName: () => "",
    read: refuse, readBinary: refuse, exists: async () => false,
    stat: async () => { throw new Error("email-task-plan-selection-test: no files"); },
    list: async () => ({ files: [], folders: [] }),
    write: refuse, writeBinary: refuse, append: refuse, remove: refuse,
    rename: refuse, mkdir: refuse, rmdir: refuse, copy: refuse, process: refuse
  };
  const vault = {
    adapter,
    getName: () => "",
    getMarkdownFiles: () => [],
    getFiles: () => [],
    getAbstractFileByPath: () => null,
    cachedRead: refuse, read: refuse, create: refuse, modify: refuse, append: refuse, delete: refuse,
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
  const chunks = options.chunks || buildIndexChunks();
  const identity = semanticEmbeddingIdentity(DEFAULT_SETTINGS, {});
  const provider = identity.provider;
  const model = identity.model;
  const plugin = new runtime(makeFakeApp(), { id: "semantic-todoist-sync", dir: ".obsidian/plugins/semantic-todoist-sync" });
  plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
  plugin.settings.embeddingProvider = provider;
  plugin.settings.embeddingModel = model;
  plugin.settings.semanticSearchMode = "exact";
  // A generous context ceiling so the provider projection is not the binding
  // limit: the delivered evidence must be the SELECTION, not a ceiling cut.
  plugin.settings.maxTaskContextChunks = 200;
  plugin.settings.semanticIndexMeta = Object.assign({}, plugin.settings.semanticIndexMeta || {}, {
    provider, model, dimension: DIM, chunks: chunks.length,
    embeddingContentVersion: SEMANTIC_EMBEDDING_CONTENT_VERSION,
    shardCount: 0, generation: "email-task-plan-selection-test", schemaVersion: 2
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
  await plugin.ensureProductionSemanticRoutingState({
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
  return { plugin, chunks };
}

// The stubbed provider: it returns one task that cites the first evidence
// handles the workflow actually put in front of the model.
function installAiStub(plugin, calls, options = {}) {
  const scopeId = options.scopeId || "scope-unused";
  const content = options.content || TASK_CONTENT;
  plugin.openaiResponse = async (request = {}) => {
    const prefix = String(request.promptCachePrefix || "");
    const handles = [...new Set((prefix.match(/^(E\d+) /gm) || []).map((line) => line.trim()))];
    calls.push({ operation: String(request.operation || ""), handles });
    return JSON.stringify({
      tasks: [{
        content,
        due_date: null,
        deadline_date: null,
        priority: 1,
        labels: [],
        scope_id: scopeId,
        refs: handles.slice(0, 2),
        subtasks: []
      }],
      section_name: "",
      descriptions: []
    });
  };
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

function recordBaselineFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  console.log(`baseline recorded: ${filePath}`);
}

function bundleOf(plan) {
  return plan?.taskWorkflowContextBundle || plan?.contextBundle || null;
}

function validationCodes(bundle) {
  return ((bundle?.contextBundleValidation?.protectedReferenceErrors || [])
    .concat(bundle?.contextBundleValidation?.foreignReferenceErrors || [])
    .map((code) => String(code).split(":")[0]));
}

async function main() {
  const { plugin } = await makePlugin();
  const calls = [];
  installAiStub(plugin, calls);

  const source = { type: "email", title: EMAIL_TITLE, text: EMAIL_SUMMARY, sectionName: "2026-10-09 Acme" };
  const plan = await plugin.createTaskPlanWithLocalActivity(source, {});

  const failure = plan?.workflowContextFailure || null;
  const bundle = bundleOf(plan);
  const validation = bundle?.contextBundleValidation || null;
  const projection = bundle?.providerEvidenceProjection || null;
  const deliveredIds = (projection?.selectedEvidenceIds || []).map(String);
  const deliveredPaths = new Set();
  for (const item of bundle?.evidenceCatalog?.items || []) {
    if (deliveredIds.includes(String(item.evidenceId || item.id || ""))) {
      deliveredPaths.add(String(item.provenance?.path || ""));
    }
  }

  console.log(
    `email plan: failure=${JSON.stringify(failure ? failure.code : "")} ` +
    `tasks=${Array.isArray(plan?.tasks) ? plan.tasks.length : 0} ` +
    `dispatchAllowed=${JSON.stringify(validation?.dispatchAllowed ?? null)} ` +
    `delivered=${deliveredIds.length} distinctNotes=${deliveredPaths.size} ` +
    `corpus=${buildIndexChunks().length} ` +
    `providerErrors=${JSON.stringify((validation?.protectedReferenceErrors || []).slice(0, 6))}`
  );

  check("the email plan is not blocked by a pre-AI workflow-context gate", () => {
    assert.equal(failure, null, `the email plan must not fail, got ${JSON.stringify(failure)}`);
    assert.ok(Array.isArray(plan?.tasks) && plan.tasks.length > 0, "the email plan must produce tasks");
  });

  check("the email workflow context dispatches", () => {
    assert.ok(validation, "the plan must carry the context bundle validation");
    assert.equal(validation.dispatchAllowed, true, `the email context must dispatch, errors: ${JSON.stringify(validation.protectedReferenceErrors)}`);
  });

  check("the delivered evidence is the capped selection, not the legacy 1100 cut", () => {
    const corpusSize = buildIndexChunks().length;
    assert.ok(deliveredIds.length > 0, "the email must deliver evidence");
    // The scored selection is the union of the 30-slot semantic window (one
    // chunk per note) and the 30-slot lexical window, so the delivery can never
    // exceed 60 records, while the legacy path delivered the whole 1100 cut.
    assert.ok(deliveredIds.length <= 60, `the delivered evidence (${deliveredIds.length}) must stay inside the two windows`);
    assert.ok(deliveredIds.length < corpusSize, `the delivered evidence (${deliveredIds.length}) must be smaller than the corpus (${corpusSize})`);
    assert.ok(deliveredPaths.size > 0, "the delivered evidence must carry vault note paths");
    // The per-note semantic cap spreads the semantic window over many notes.
    assert.ok(deliveredPaths.size >= 30, `the per-note cap must spread the semantic window over many notes, got ${deliveredPaths.size}`);
  });

  check("the provider was called with the evidence handles", () => {
    assert.ok(calls.length > 0, "the stubbed provider must have been called");
    assert.ok((calls[0].handles || []).length > 0, "the workflow must put evidence handles in front of the model");
  });

  // ---- Finding 3: the note-only bundle gates must not fire for email -----
  check("no note-only bundle gate fires for the email plan", () => {
    const forbidden = [
      "catalog-selected-missing",
      "catalog-selected-empty-excerpt",
      "catalog-selected-missing-provenance",
      "catalog-selected-body-conflict",
      "builder-selection-extra",
      "builder-selection-unbound",
      "builder-selection-malformed",
      "selected-catalog-supplement-conflict",
      "selected-catalog-supplement-missing",
      "protected-workflow-evidence-closure-unresolved"
    ];
    const codes = validationCodes(bundle);
    for (const code of codes) {
      assert.ok(!forbidden.includes(code), `the email plan must not report ${code}, got ${JSON.stringify(codes)}`);
    }
  });

  check("the Todoist snapshot reference row survives the email plan", () => {
    const snapshotId = snapshotReferenceChunk().evidenceId;
    assert.ok(
      deliveredIds.includes(snapshotId),
      `the snapshot reference row must reach the provider, got ${JSON.stringify(deliveredIds)}`
    );
  });

  // ---- Finding 5(b): the exact delivered evidence ids --------------------
  if (recordDeliveredBaseline) {
    recordBaselineFile(deliveredBaselinePath, { deliveredEvidenceIds: deliveredIds });
  } else if (!fs.existsSync(deliveredBaselinePath)) {
    failures.push("delivered-evidence baseline fixture is missing");
    console.error(`FAIL: the delivered-evidence baseline fixture is missing: ${deliveredBaselinePath} (record it with --record-delivered-baseline)`);
  } else {
    check("the delivered evidence ids are exactly the recorded baseline", () => {
      const expected = JSON.parse(fs.readFileSync(deliveredBaselinePath, "utf8"));
      assert.deepStrictEqual(deliveredIds, expected.deliveredEvidenceIds.map(String));
    });
  }

  // ---- Finding 4: the action-text fallback chain --------------------------
  // A punctuation-only task content falls back to the email subject; a
  // punctuation-only subject falls back to the first sentence of the
  // contract's source-summary fact (the cleaned retrieval text). Neither may
  // fail the email closed with email-action-text-missing. A non-Latin task
  // and subject (Cyrillic, CJK) are usable text too: the usable-text check
  // must accept a letter or a number in any script, not only ASCII.
  for (const [label, title, content, text, expectsEvidence] of [
    ["a punctuation-only task content falls back to the email subject", EMAIL_TITLE, "...", "Please submit the Acme Atlas intake form before Friday.", true],
    ["a punctuation-only subject falls back to the source-summary sentence", "...", "...", "Please submit the Acme Atlas intake form before Friday.", true],
    ["a Cyrillic task and subject do not fail the email closed", "Отправить анкету до пятницы", "Отправить анкету до пятницы", "Отправить анкету до пятницы", false],
    ["a CJK task and subject do not fail the email closed", "完成表格并提交", "完成表格并提交", "完成表格并提交", false]
  ]) {
    const fallbackPlugin = (await makePlugin()).plugin;
    const fallbackCalls = [];
    installAiStub(fallbackPlugin, fallbackCalls, { content });
    const fallbackSource = {
      type: "email",
      title,
      text,
      sectionName: "2026-10-09 Acme"
    };
    const fallbackPlan = await fallbackPlugin.createTaskPlanWithLocalActivity(fallbackSource, {});
    const fallbackBundle = bundleOf(fallbackPlan);
    const fallbackCodes = validationCodes(fallbackBundle);
    check(label, () => {
      assert.ok(
        !fallbackCodes.includes("email-action-text-missing"),
        `the email must not fail closed with email-action-text-missing, got ${JSON.stringify(fallbackCodes)}`
      );
      assert.ok(
        !String(fallbackPlan?.workflowContextFailure?.code || "").includes("email-action-text-missing"),
        `the email plan must not fail with email-action-text-missing, got ${JSON.stringify(fallbackPlan?.workflowContextFailure || null)}`
      );
      assert.equal(
        fallbackBundle?.contextBundleValidation?.dispatchAllowed,
        true,
        `the email must dispatch, errors: ${JSON.stringify(fallbackBundle?.contextBundleValidation?.protectedReferenceErrors || [])}`
      );
    });
    if (expectsEvidence) {
      check(`${label} (delivers evidence)`, () => {
        assert.ok(
          (fallbackBundle?.providerEvidenceProjection?.selectedEvidenceIds || []).length > 0,
          "the fallback email must still deliver evidence"
        );
      });
    }
  }

  // ---- Note arm: the note path must stay byte-identical -------------------
  // The note source runs the same scored selection, so the note arm is the
  // control: the production prestructure retrieval plus the selector must
  // produce exactly the same selection as before this change.
  const noteHarness = await makePlugin();
  const noteSource = {
    type: "note",
    title: "Task Note",
    path: "Notes/Task Note.md",
    text: "- [ ] Submit the Acme atlas intake form\nAcme atlas task note context for the checked action."
  };
  const noteContract = buildTaskSourceContract(noteSource, noteSource.text, noteHarness.plugin.settings);
  const noteScopes = await noteHarness.plugin.retrievePreStructureTaskScopeContexts(
    noteSource,
    noteContract,
    noteSource.text,
    { limit: Number(noteHarness.plugin.settings.maxTaskContextChunks || 48) }
  );
  const noteSelection = taskWorkflowSelectTaskRelevantEvidence(noteScopes.taskRelevanceRankings || {}, {
    sourceContract: noteContract,
    settings: noteHarness.plugin.settings
  });
  const noteSnapshot = JSON.stringify({
    perTaskTopN: noteSelection.perTaskTopN,
    dispatchAllowed: noteSelection.dispatchAllowed,
    protectedReferenceErrors: noteSelection.protectedReferenceErrors,
    selected: noteSelection.selectedEvidenceIds.map(String).slice().sort(),
    perTask: Object.fromEntries(Object.entries(noteSelection.perTask || {}).map(([key, entry]) => [key, {
      selectedCount: entry.selectedCount,
      finalCount: entry.finalCount,
      selectedEvidenceIds: entry.selectedEvidenceIds.map(String)
    }]))
  });
  console.log(`note selection: ${noteSnapshot.slice(0, 240)}`);

  // The note poststructure + bundle: the full note plan through the real
  // builder, so the poststructure selection and the bundle gates are covered
  // by the same byte-identity control as the prestructure selection.
  const noteMarkedScopeId = String((noteContract.scopes || []).find((scope) => scope.family === "marked-action")?.scopeId || "");
  installAiStub(noteHarness.plugin, [], { scopeId: noteMarkedScopeId });
  const notePlan = await noteHarness.plugin.createTaskPlanWithLocalActivity(noteSource, {});
  const noteBundle = bundleOf(notePlan);
  const notePoststructureSnapshot = {
    failure: notePlan?.workflowContextFailure?.code || "",
    tasks: (notePlan?.tasks || []).map((task) => ({
      content: String(task?.content || ""),
      scope_id: String(task?.scope_id || ""),
      evidence_ids: (task?.evidence_ids || []).map(String)
    })),
    dispatchAllowed: noteBundle?.contextBundleValidation?.dispatchAllowed ?? null,
    protectedReferenceErrors: noteBundle?.contextBundleValidation?.protectedReferenceErrors || [],
    foreignReferenceErrors: noteBundle?.contextBundleValidation?.foreignReferenceErrors || [],
    deliveredEvidenceIds: (noteBundle?.providerEvidenceProjection?.selectedEvidenceIds || []).map(String),
    catalogEvidenceIds: (noteBundle?.evidenceCatalog?.items || []).map((item) => String(item.evidenceId || item.id || "")),
    catalogHash: String(noteBundle?.evidenceCatalog?.hash || "")
  };
  console.log(`note poststructure: ${JSON.stringify(notePoststructureSnapshot).slice(0, 240)}`);

  if (recordNoteBaseline) {
    recordBaselineFile(noteBaselinePath, JSON.parse(noteSnapshot));
    recordBaselineFile(notePoststructureBaselinePath, notePoststructureSnapshot);
  } else if (!fs.existsSync(noteBaselinePath) || !fs.existsSync(notePoststructureBaselinePath)) {
    const missing = [
      fs.existsSync(noteBaselinePath) ? "" : noteBaselinePath,
      fs.existsSync(notePoststructureBaselinePath) ? "" : notePoststructureBaselinePath
    ].filter(Boolean);
    failures.push("note baseline fixture is missing");
    console.error(`FAIL: the note baseline fixture(s) are missing: ${missing.join(", ")} (record them with --record-note-baseline)`);
  } else {
    check("the note selection is byte-identical to the recorded baseline", () => {
      assert.deepStrictEqual(JSON.parse(noteSnapshot), JSON.parse(fs.readFileSync(noteBaselinePath, "utf8")));
    });
    check("the note poststructure and bundle are byte-identical to the recorded baseline", () => {
      assert.deepStrictEqual(notePoststructureSnapshot, JSON.parse(fs.readFileSync(notePoststructureBaselinePath, "utf8")));
    });
  }

  // ---- Email log notes are never task evidence ----------------------------
  // A processed email's log note holds an AI summary of THAT email. If a
  // later email's plan retrieved the summary as task evidence, the request in
  // the summary would become a second, phantom task. The log note stays
  // Ask/chat searchable and must never reach the task lane.
  const LOG_NOTE_PATH = `${DEFAULT_SETTINGS.emailLogFolder}/2026-10-09 - Acme Atlas intake form.md`;
  const LOG_NOTE_TEXT = [
    "Date processed: 2026-10-09 10:00",
    "Original email received: 2026-10-09 09:30",
    "Forward received by Cloudflare: 2026-10-09 09:31",
    "From: Alex Example <alex@example.com>",
    "Email subject: Acme Atlas intake form",
    "Todoist section: 2026-10-09 Acme",
    "",
    "## Email summary",
    "",
    "Alex asked Dana to submit the Acme Atlas intake form by October 13.",
    "",
    "## Synced Todoist Tasks",
    "",
    "- [ ] Submit the Acme Atlas intake form #STsync"
  ].join("\n");
  const logNoteSource = {
    type: "email",
    title: "Acme Atlas intake form",
    text: "Please submit the Acme Atlas intake form by October 13.",
    sectionName: "2026-10-12 Acme"
  };
  const logNoteHarness = await makePlugin();
  const logNoteChunks = logNoteIndexChunks(logNoteHarness.plugin, LOG_NOTE_PATH, LOG_NOTE_TEXT);
  const logNoteEvidenceIds = logNoteChunks.map((chunk) => String(chunk.evidenceId || ""));
  const logNoteSummaryId = String(
    (logNoteChunks.find((chunk) => chunk.text.includes("Alex asked Dana")) || {}).evidenceId || ""
  );

  // Control: the same corpus with the log note forced back to task-eligible
  // must deliver the log note. Without this arm the metadata-only rule could
  // pass simply because the log note never matched the query.
  const controlPlugin = (await makePlugin({
    chunks: buildIndexChunks().concat(logNoteChunks.map((chunk) => Object.assign({}, chunk, { evidenceEligibility: "evidence" })))
  })).plugin;
  installAiStub(controlPlugin, []);
  const controlPlan = await controlPlugin.createTaskPlanWithLocalActivity(logNoteSource, {});
  const controlDeliveredIds = (bundleOf(controlPlan)?.providerEvidenceProjection?.selectedEvidenceIds || []).map(String);

  // The real run: the log note keeps its production metadata-only eligibility.
  const logPlugin = (await makePlugin({ chunks: buildIndexChunks().concat(logNoteChunks) })).plugin;
  installAiStub(logPlugin, []);
  const logPlan = await logPlugin.createTaskPlanWithLocalActivity(logNoteSource, {});
  const logBundle = bundleOf(logPlan);
  const logDeliveredIds = (logBundle?.providerEvidenceProjection?.selectedEvidenceIds || []).map(String);

  check("every unit of an email log note is metadata-only", () => {
    assert.ok(logNoteChunks.length >= 3, `expected the metadata, summary and task units, got ${logNoteChunks.length}`);
    for (const chunk of logNoteChunks) {
      assert.equal(chunk.evidenceEligibility, "metadata-only", `a log-note unit must be metadata-only: ${chunk.text}`);
    }
  });

  check("the log note is a real candidate for the email query", () => {
    assert.ok(logNoteSummaryId, "expected a log-note summary unit");
    assert.ok(
      controlDeliveredIds.includes(logNoteSummaryId),
      `the control run must deliver the log-note summary, got ${JSON.stringify(controlDeliveredIds)}`
    );
  });

  check("a log note in the corpus never reaches the email plan's delivered evidence", () => {
    assert.ok(logDeliveredIds.length > 0, "the email plan must still deliver evidence");
    for (const evidenceId of logNoteEvidenceIds) {
      assert.ok(!logDeliveredIds.includes(evidenceId), `a log-note unit must not be delivered: ${evidenceId}`);
    }
  });

  if (failures.length) {
    console.error(`${failures.length} email-task-plan-selection check(s) failed`);
    process.exit(1);
  }
  console.log("PASS: email task plan selection");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
