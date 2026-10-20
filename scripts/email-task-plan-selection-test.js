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
//     semantic chunk per note, lexical window 30), not the legacy 1100 cut.
//
// Read-only and offline: nothing touches the vault, the network or Todoist.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = path.join(__dirname, "..", "src/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const noteBaselinePath = path.join(__dirname, "fixtures", "email-task-plan-note-baseline.json");
const recordBaseline = process.argv.slice(2).includes("--record-note-baseline");

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
      "  buildTaskSourceContract, taskWorkflowSelectTaskRelevantEvidence\n" +
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
  taskWorkflowSelectTaskRelevantEvidence
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
// two windows). Every chunk shares the query's content words so the whole
// corpus is positively scored and admitted.
const FILLER_NOTE_COUNT = 36;
const FILLER_CHUNKS_PER_NOTE = 3;
for (let note = 0; note < FILLER_NOTE_COUNT; note += 1) {
  const notePath = `Projects/Filler/Filler ${note}.md`;
  NOTE_PATHS.push(notePath);
  NOTE_CHUNK_TEXTS[notePath] = Array.from({ length: FILLER_CHUNKS_PER_NOTE }, (unused, chunk) =>
    `Acme atlas filler note ${note} chunk ${chunk}: intake form budget report follow up notes.`
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

function buildIndexChunks() {
  const chunks = [];
  for (const notePath of NOTE_PATHS) {
    NOTE_CHUNK_TEXTS[notePath].forEach((text, index) => {
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

async function makePlugin() {
  const chunks = buildIndexChunks();
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
function installAiStub(plugin, calls) {
  plugin.openaiResponse = async (request = {}) => {
    const prefix = String(request.promptCachePrefix || "");
    const handles = [...new Set((prefix.match(/^(E\d+) /gm) || []).map((line) => line.trim()))];
    calls.push({ operation: String(request.operation || ""), handles });
    return JSON.stringify({
      tasks: [{
        content: TASK_CONTENT,
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
  const { plugin } = await makePlugin();
  const calls = [];
  installAiStub(plugin, calls);

  const source = { type: "email", title: EMAIL_TITLE, text: EMAIL_SUMMARY, sectionName: "2026-10-09 Acme" };
  const plan = await plugin.createTaskPlanWithLocalActivity(source, {});

  const failure = plan?.workflowContextFailure || null;
  const bundle = plan?.taskWorkflowContextBundle || plan?.contextBundle || null;
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
  if (recordBaseline || !fs.existsSync(noteBaselinePath)) {
    fs.mkdirSync(path.dirname(noteBaselinePath), { recursive: true });
    fs.writeFileSync(noteBaselinePath, `${noteSnapshot}\n`, "utf8");
    console.log(`note-arm baseline ${recordBaseline ? "recorded" : "created"}: ${noteBaselinePath}`);
  } else {
    check("the note selection is byte-identical to the recorded baseline", () => {
      assert.deepStrictEqual(JSON.parse(noteSnapshot), JSON.parse(fs.readFileSync(noteBaselinePath, "utf8")));
    });
  }

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
