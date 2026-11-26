"use strict";
// scripts/chat-note-companion-test.js — regression guard for the chat-mode
// "note companion" retrieval fix.
//
// Ask: "who were the mitacs reps we met recently?" cited the Mitacs note but
// the model never saw its attendee lines. The chat D5 union admits only the
// top-24 semantic + top-24 lexical windows, so the attendee chunk (zero lexical
// overlap, weak title-diluted semantic) fell outside both and was never pulled
// in with the note's selected siblings.
//
// Fix: after the union is assembled, each selected note's attendee/people
// section chunk and its first evidence chunk are added as companions (<= 2 per
// note, <= 6 total), ranked right after the note's highest-scored chunk, and
// the trim limit is raised by the companions added (<= +6). Other modes and the
// 24 default are untouched.
//
// Offline and read-only: compiles src/main.js with an empty obsidian mock,
// chunks the real Mitacs fixture with the production chunker, drives
// retrieveAdaptiveSemanticContext(query, "chat", 24, ...) with a deterministic
// bag-of-words embedding, and asserts the companion behavior.
//
// Usage: node scripts/chat-note-companion-test.js   (set CHAT_COMPANION_MAIN to
// point at a build without the fix to observe the red run)

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = process.env.CHAT_COMPANION_MAIN || path.join(__dirname, "..", "src/main.js");
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
Module._load = function (request, parent, isMain) {
  if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  class Plugin {
    constructor(app, manifest) { this.app = app; this.manifest = manifest; }
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
    requestUrl() { throw new Error("chat-note-companion-test: network disabled"); }
  };
};

let runtime;
try {
  ensureNodeGlobals();
  testModule._compile(
    `${mainSource}\nmodule.exports.__chatNoteCompanion = {\n` +
      "  chunkMarkdown,\n" +
      "  semanticIndexSourceText,\n" +
      "  DEFAULT_SETTINGS,\n" +
      "  SEMANTIC_EMBEDDING_CONTENT_VERSION,\n" +
      "  semanticEmbeddingIdentity,\n" +
      "  buildChatNoteCompanionCandidates: typeof buildChatNoteCompanionCandidates === 'function' ? buildChatNoteCompanionCandidates : null,\n" +
      "  semanticRetrievalChunkEligible\n" +
      "};\n",
    mainPath
  );
  runtime = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const {
  chunkMarkdown,
  semanticIndexSourceText,
  DEFAULT_SETTINGS,
  SEMANTIC_EMBEDDING_CONTENT_VERSION,
  semanticEmbeddingIdentity,
  buildChatNoteCompanionCandidates,
  semanticRetrievalChunkEligible
} = runtime.__chatNoteCompanion;

// ---------------------------------------------------------------------------
// Deterministic offline embedding with a controlled vocabulary.
// ---------------------------------------------------------------------------
const DIM = 64;
const MODEL = "test-model";
const REVISION = 1;
const MAX_CHARS = Number(DEFAULT_SETTINGS.semanticIndexMaxChunkChars) || 1100;
const MAX_CHUNKS = Number(DEFAULT_SETTINGS.semanticIndexMaxChunksPerNote) || 20;

// Query content words land in dims 0-3; attendee names/titles in dims 4-12, so
// the attendee chunk has ZERO lexical and semantic overlap with the query.
const VOCAB_DIMS = {
  mitacs: 0, reps: 1, recently: 2, were: 3,
  joanne: 4, tejeda: 5, strategic: 6, partnership: 7, advisor: 8,
  chris: 9, lannon: 10, director: 11, partnerships: 12
};
const STOP_WORDS = new Set([
  "the","and","for","with","that","this","from","into","your","you","are","was","were",
  "have","has","will","would","about","over","under","must","should","each","they","them",
  "their","when","what","which","while","also","than","then","some","more","most","only",
  "just","very","been","being","does","done","not","but","all","any","can","could","out",
  "current","task","action","exact","source","wording","same","scope","authoritative",
  "statement","terminology","naming","direction","preserve","quoted","terms","optional",
  "primary","context","relationship","handoff","semantics","local","execution","prior",
  "reviewer","history","identity","artifact","people","feedback","edits","decisions",
  "conflicts","unresolved","state","continuity","existing","open","references"
]);
const tokensOf = (text) => String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
const slotOf = (token) => {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) { hash ^= token.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % (DIM - 16);
};
function fakeEmbed(text) {
  const vector = new Array(DIM).fill(0);
  let count = 0;
  for (const token of tokensOf(text)) {
    const d = VOCAB_DIMS[token];
    if (d !== undefined) { vector[d] += 1; count += 1; }
    else { vector[16 + slotOf(token)] += 1; count += 1; }
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return norm ? vector.map((v) => v / norm) : vector.map(() => 0);
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < DIM; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ---------------------------------------------------------------------------
// Fixture: the REAL Mitacs note chunked with the production chunker, plus
// three supporting notes so the pool is realistic.
// ---------------------------------------------------------------------------
const MITACS_PATH = "Meeting Notes/Mitacs Meeting with Joanne - October 1, 2026.md";
const MITACS_FIXTURE = "C:/Users/MattS/AppData/Local/Temp/opencode/mitacs-fixture/Mitacs Meeting with Joanne - October 1, 2026.md";
const KATIE_PATH = "Meeting Notes/April 2025 - Katie Facecchia.md";
const UPDATE_PATH = "Projects/Mitacs/October 2026 Update.md";
const META_PATH = "Projects/Meta/Metadata Note.md";
const UNRELATED_PATH = "Notes/Unrelated.md";

function makeChunk(path, text, lineStart, lineEnd, section, metadataOnly, evidenceEligibility, provider, model) {
  const safe = String(path).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const evidenceId = `ev-${safe}-${lineStart}`;
  return {
    id: evidenceId, evidenceId, chunkId: evidenceId,
    path, title: path.split("/").pop().replace(/\.md$/i, ""),
    text, embedding: fakeEmbed(text),
    sourceKind: "note", embeddingProvider: provider, embeddingModel: model, embeddingDimension: DIM,
    embeddingContentVersion: SEMANTIC_EMBEDDING_CONTENT_VERSION,
    indexMetadata: {
      provider, model, dimension: DIM,
      contentVersion: SEMANTIC_EMBEDDING_CONTENT_VERSION, indexRevision: REVISION, schemaVersion: 2
    },
    provenance: { path, sourceId: `src-${safe}`, authority: "authoritative" },
    retrievalEligible: true, nonEvidence: false, authorityState: "authoritative", current: true,
    lineStart, lineEnd, section: section || "",
    metadataOnly: metadataOnly === true,
    evidenceEligibility: evidenceEligibility || "evidence"
  };
}

function buildIndexChunks(provider, model) {
  const chunks = [];
  // Mitacs: REAL chunks from the production chunker on the real fixture.
  const fixtureText = fs.readFileSync(MITACS_FIXTURE, "utf8");
  const sourced = semanticIndexSourceText(fixtureText);
  const realChunks = chunkMarkdown(sourced, MAX_CHARS, MAX_CHUNKS, { maxListItems: 2 });
  for (let i = 0; i < realChunks.length; i += 1) {
    const r = (realChunks.sourceLineRanges && realChunks.sourceLineRanges[i]) || { lineStart: 0, lineEnd: 0 };
    chunks.push(makeChunk(
      MITACS_PATH, String(realChunks[i]), r.lineStart, r.lineEnd,
      (realChunks.sourceSections && realChunks.sourceSections[i]) || "",
      (realChunks.semanticMetadataOnlyFlags && realChunks.semanticMetadataOnlyFlags[i]) === true,
      (realChunks.semanticEvidenceEligibilities && realChunks.semanticEvidenceEligibilities[i]) || "evidence",
      provider, model
    ));
  }
  // Supporting notes (hand-written chunks, deterministic embedding).
  let line = 1;
  const supporting = {
    [UPDATE_PATH]: [
      "Status update and next steps.",                                  // line 1: first evidence chunk, score 0 -> not selected
      "The mitacs umbrella program intake is due next month."           // line 3: mitacs -> selected, note represented
    ],
    [KATIE_PATH]: [
      "# Attendees",                                                    // Katie has an attendees section but is NOT retrieved
      "Katie Facecchia - Product Lead",
      "Dana Reed - Engineering Manager"
    ],
    [UNRELATED_PATH]: [
      "Grocery list and garden planting schedule for the weekend.",
      "Gym membership renewal and library returns.",
      "Travel booking receipts for the summer trip."
    ],
    [META_PATH]: [
      "---\ncreated: 2026-01-01\ntype: meeting\n---",            // metadata-only, no query words -> not selected, never a companion
      "This note discusses mitacs funding options."             // mitacs -> selected, note represented
    ]
  };
  for (const notePath of Object.keys(supporting)) {
    let metaIndex = 0;
    for (const text of supporting[notePath]) {
      const section = /^#?\s*attendees?\b/i.test(text) ? "Attendees" : "";
      const isMeta = notePath === META_PATH && metaIndex === 0;
      chunks.push(makeChunk(notePath, text, line, line, section, isMeta, isMeta ? "metadata-only" : "evidence", provider, model));
      metaIndex += 1;
      line += 2;
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Plugin under test over a fake, strictly read-only app.
// ---------------------------------------------------------------------------
function makeFakeApp() {
  const refuse = async () => { throw new Error("chat-note-companion-test: read-only adapter"); };
  const adapter = {
    getBasePath: () => "", getName: () => "", read: refuse, readBinary: refuse,
    exists: async () => false, stat: async () => { throw new Error("chat-note-companion-test: no files"); },
    list: async () => ({ files: [], folders: [] }), write: refuse, writeBinary: refuse,
    append: refuse, remove: refuse, rename: refuse, mkdir: refuse, rmdir: refuse,
    copy: refuse, process: refuse
  };
  const vault = {
    adapter, getName: () => "", getMarkdownFiles: () => [], getFiles: () => [],
    getAbstractFileByPath: () => null, cachedRead: refuse, read: refuse,
    create: refuse, modify: refuse, append: refuse, delete: refuse,
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
  const identity = semanticEmbeddingIdentity(DEFAULT_SETTINGS, {});
  const provider = identity.provider;
  const model = identity.model || MODEL;
  const chunks = buildIndexChunks(provider, model);
  const plugin = new runtime(makeFakeApp(), { id: "semantic-todoist-sync", dir: ".obsidian/plugins/semantic-todoist-sync" });
  plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
  plugin.settings.embeddingProvider = provider;
  plugin.settings.embeddingModel = model;
  plugin.settings.semanticSearchMode = "exact";
  plugin.settings.maxChatContextChunks = 24;
  plugin.settings.semanticIndexMeta = Object.assign({}, plugin.settings.semanticIndexMeta || {}, {
    provider, model, dimension: DIM, chunks: chunks.length,
    embeddingContentVersion: SEMANTIC_EMBEDDING_CONTENT_VERSION, shardCount: 0,
    generation: "chat-note-companion-test", schemaVersion: 2
  });
  plugin.queryEmbeddingCache = new Map();
  plugin.semanticRetrievalCache = new Map();
  plugin.semanticRoutingRouteCache = new Map();
  plugin.semanticExactScoreCache = new Map();
  plugin._semanticExactScoreCacheTimestamps = new Map();
  plugin.markActivityLogDirty = () => {};
  plugin.semanticIndex = chunks;
  plugin.semanticIndexRevision = REVISION;
  plugin.semanticIndexStorageFingerprint = "chat-note-companion-test";
  plugin.semanticIndexCompatibilityRefreshPending = () => false;
  plugin.embedTexts = async (texts) => (Array.isArray(texts) ? texts : []).map((t) => fakeEmbed(String(t || "")));
  await plugin.ensureProductionSemanticRoutingState({
    chunks, settings: plugin.settings, revision: REVISION, storageFingerprint: "chat-note-companion-test",
    allowLoad: false, allowBuild: true, persist: false, forceBuild: true, shardCount: 0
  });
  return { plugin, chunks, routing: null };
}

async function runChatRetrieval(query, mode = "chat") {
  const harness = await makePlugin();
  const rows = await harness.plugin.retrieveAdaptiveSemanticContext(query, mode, 24, "", { sourceContract: {} });
  return { harness, rows };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------
const failures = [];
const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push(`PASS: ${name}`);
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : error}`);
    console.error(`FAIL: ${name}: ${error && error.message ? error.message : error}`);
  }
}

async function main() {
  const query = "who were the mitacs reps we met recently?";
  const queryEmbedding = fakeEmbed(query);

  const harness0 = await makePlugin();
  const mitacsChunks = harness0.chunks.filter((c) => c.path === MITACS_PATH);
  const attendeeChunk = mitacsChunks.find((c) => /Joanne Tejeda/.test(c.text));
  assert.ok(attendeeChunk, "fixture must contain the attendee chunk (Joanne Tejeda)");
  const mitacsBullets = mitacsChunks.filter((c) => c.text.toLowerCase().includes("mitacs") && !c.metadataOnly);
  assert.ok(mitacsBullets.length > 0, "fixture must contain mitacs bullets");
  const bestBullet = mitacsBullets.reduce((b, c) =>
    cosine(queryEmbedding, c.embedding) > cosine(queryEmbedding, b.embedding) ? c : b, mitacsBullets[0]);

  console.log(`premise: cosine(query, attendee)=${cosine(queryEmbedding, attendeeChunk.embedding).toFixed(4)} ` +
    `cosine(query, best mitacs bullet)=${cosine(queryEmbedding, bestBullet.embedding).toFixed(4)}`);

  check("premise: attendee chunk has zero query similarity", () => {
    assert.equal(cosine(queryEmbedding, attendeeChunk.embedding), 0, "attendee chunk must share no query dimension");
  });
  check("premise: a mitacs bullet outranks the attendee chunk", () => {
    assert.ok(cosine(queryEmbedding, bestBullet.embedding) > 0, "a mitacs bullet must outrank the attendee chunk");
  });

  const { rows: chatRows, harness } = await runChatRetrieval(query, "chat");
  const rowTexts = chatRows.map((r) => String(r.text || ""));
  const rowPaths = chatRows.map((r) => String(r.path || r.provenance && r.provenance.path || ""));
  const distinctPaths = [...new Set(rowPaths)];
  console.log(`chat rows: ${chatRows.length} distinctPaths=${distinctPaths.length} paths=${distinctPaths.join(" | ")}`);
  console.log(`attendee in rows: ${rowTexts.some((t) => t.includes("Joanne Tejeda"))}`);

  // Case 1: the final rows include the Mitacs note's attendee chunk.
  check("chat rows include the Mitacs attendee chunk (Joanne Tejeda + Chris Lannon)", () => {
    assert.ok(rowTexts.some((t) => t.includes("Joanne Tejeda - Strategic Partnership Advisor")),
      `attendee chunk text missing from ${chatRows.length} rows`);
    assert.ok(rowTexts.some((t) => t.includes("Chris Lannon - Director Strategic Partnerships")),
      "Chris Lannon missing from rows");
  });

  // Case 2: total rows <= 24 + 6; companions <= 2 per note (enforced by the
  // helper, covered precisely in case 7); here we bound the total.
  check("total rows stay within 24 + 6 (no more than 30)", () => {
    assert.ok(chatRows.length <= 24 + 6, `rows ${chatRows.length} exceed 24 + 6`);
  });

  // Case 3: a retrieved note WITHOUT an attendee section gets only its first
  // evidence chunk, and only if absent. UPDATE_PATH's first evidence chunk
  // ("Status update and next steps.") scores 0 so it is not selected; the note
  // is represented by its mitacs chunk, so the first evidence chunk is added as
  // a companion. No metadata-only / extra chunk is added for it.
  const updateRows = chatRows.filter((r) => String(r.path || "") === UPDATE_PATH);
  check("retrieved note without attendees gets only its first evidence chunk", () => {
    assert.ok(updateRows.length >= 1, `${UPDATE_PATH} must be represented`);
    assert.ok(updateRows.some((r) => String(r.text || "").includes("Status update and next steps")),
      `first evidence chunk of ${UPDATE_PATH} must be added as a companion`);
    assert.ok(!updateRows.some((r) => /metadata-only|frontmatter/i.test(String(r.text || ""))),
      `no metadata-only companion for ${UPDATE_PATH}`);
  });

  // Case 4: a note that is NOT retrieved gets no companion. Katie has an
  // attendees section but none of her chunks are selected.
  const katieRows = chatRows.filter((r) => String(r.path || "") === KATIE_PATH);
  check("a non-retrieved note's attendee chunk is absent", () => {
    assert.equal(katieRows.length, 0, `${KATIE_PATH} must not be retrieved, got ${katieRows.length} rows`);
  });

  // Case 5: a metadata-only / frontmatter chunk is never added as a companion,
  // even when its note is otherwise retrieved.
  check("metadata-only frontmatter chunk is never added as a companion", () => {
    const metaRows = chatRows.filter((r) => String(r.path || "") === META_PATH);
    assert.ok(metaRows.length >= 1, `${META_PATH} must be represented by its mitacs chunk`);
    assert.ok(metaRows.some((r) => String(r.text || "").includes("mitacs funding options")), `${META_PATH} mitacs chunk must be present`);
    assert.ok(!metaRows.some((r) => String(r.text || "").includes("created: 2026-01-01")), `metadata-only chunk of ${META_PATH} must not be added as a companion`);
  });

  // Case 6: non-chat mode is unchanged (companion logic is chat-only).
  const { rows: taskRows } = await runChatRetrieval(query, "task-generation");
  const taskTexts = taskRows.map((r) => String(r.text || ""));
  check("task-generation mode is unchanged (no attendee companion, no bump)", () => {
    assert.ok(!taskTexts.some((t) => t.includes("Joanne Tejeda")), "task-generation must not add the attendee companion");
    assert.ok(!taskTexts.some((t) => t.includes("Status update and next steps")),
      "task-generation must not add the first-evidence companion");
    assert.ok(taskRows.length <= 24, `task-generation rows ${taskRows.length} must not exceed the default`);
  });

  // Case 7: pure helper unit cases (bounds 2 per note, 6 total, dedupe, order).
  // Skipped when the fix is not applied (helper does not exist), so the red run
  // keeps demonstrating case 1 failing cleanly instead of crashing on the seam.
  if (typeof buildChatNoteCompanionCandidates === "function") {
  const u = (path, text, lineStart, section, metadataOnly, evidenceId) => ({
    id: evidenceId, evidenceId, chunkId: evidenceId, path, text,
    lineStart, lineEnd: lineStart, section: section || "", metadataOnly: metadataOnly === true,
    evidenceEligibility: metadataOnly ? "metadata-only" : "evidence", retrievalEligible: true,
    nonEvidence: false, stale: false, tombstoned: false, orphan: false, sourceKind: "note"
  });
  const sel1 = { chunk: u("N1.md", "selected one", 1, "", false, "e1"), semantic: 0.9 };
  const sel2 = { chunk: u("N2.md", "selected two", 1, "", false, "e2"), semantic: 0.8 };
  const idx = [
    u("N1.md", "frontmatter", 1, "", true, "eF"),                 // metadata-only -> never a companion
    u("N1.md", "Attendees: Alice, Bob", 5, "Attendees: ", false, "eA"),
    u("N1.md", "First evidence line here", 10, "", false, "eB"),
    u("N2.md", "First evidence note two", 1, "", false, "eC")    // no attendees section -> only (b)
  ];
  const companions = buildChatNoteCompanionCandidates([sel1, sel2], idx, (chunk) => ({ chunk }));
  const byPath = {};
  for (const c of companions) { byPath[c.chunk.path] = (byPath[c.chunk.path] || 0) + 1; }
  check("helper: 2 per note, 6 total, attendee before first evidence, no metadata-only", () => {
    assert.equal(byPath["N1.md"], 2, `N1 should have 2 companions, got ${byPath["N1.md"]}`);
    assert.equal(byPath["N2.md"], 1, `N2 should have 1 companion, got ${byPath["N2.md"]}`);
    assert.equal(companions.length, 3, `total companions must be 3, got ${companions.length}`);
    assert.ok(companions.length <= 6, "total companions must not exceed 6");
    const n1 = companions.filter((c) => c.chunk.path === "N1.md").map((c) => c.chunk.text);
    assert.deepEqual(n1, ["Attendees: Alice, Bob", "First evidence line here"], "attendee must precede first evidence");
    assert.ok(!companions.some((c) => c.chunk.metadataOnly), "metadata-only chunk must not be a companion");
  });

  // Dedupe: an attendee chunk already selected is not re-added.
  const selWithAttendee = { chunk: u("N1.md", "Attendees: Alice, Bob", 5, "Attendees: ", false, "eA"), semantic: 0.9 };
  const companions2 = buildChatNoteCompanionCandidates([selWithAttendee], idx, (chunk) => ({ chunk }));
  const n1b = companions2.filter((c) => c.chunk.path === "N1.md").map((c) => c.chunk.text);
  check("helper: already-selected attendee is not re-added", () => {
    assert.equal(n1b.length, 1, `N1 should have exactly 1 companion when attendee selected, got ${n1b.length}`);
    assert.deepEqual(n1b, ["First evidence line here"], "only first evidence added when attendee already selected");
  });

  // 6-total cap across many selected notes.
  const manySelected = [];
  const manyIdx = [];
  for (let i = 0; i < 8; i += 1) {
    const p = `M${i}.md`;
    manySelected.push({ chunk: u(p, `selected ${i}`, 1, "", false, `s${i}`), semantic: 0.9 - i * 0.01 });
    manyIdx.push(u(p, `attendees ${i}`, 5, `Attendees ${i}`, false, `a${i}`));
    manyIdx.push(u(p, `first evidence ${i}`, 10, "", false, `f${i}`));
  }
  const companions3 = buildChatNoteCompanionCandidates(manySelected, manyIdx, (chunk) => ({ chunk }));
  const byPath3 = {};
  for (const c of companions3) { byPath3[c.chunk.path] = (byPath3[c.chunk.path] || 0) + 1; }
  check("helper: 6 total cap, <= 2 per note, prefers highest-scored notes", () => {
    assert.equal(companions3.length, 6, `total must be capped at 6, got ${companions3.length}`);
    for (const p of Object.keys(byPath3)) assert.ok(byPath3[p] <= 2, `${p} has ${byPath3[p]} companions > 2`);
    // highest-scored notes (M0, M1, M2) get their companions within the 6-total cap.
    const pathsInOrder = companions3.map((c) => c.chunk.path);
    assert.ok(pathsInOrder.includes("M0.md"), "highest-scored note M0 gets companions");
    assert.ok(!pathsInOrder.includes("M7.md"), "lowest-scored note M7 is beyond the 6-total cap");
  });
  } else {
    console.log("case 7: skipped (helper not present; fix not applied)");
  }

  console.log(`chat-note-companion-test: ${checks.length} checks passed, ${failures.length} failed`);
  if (failures.length) throw new Error(`chat-note-companion-test failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  console.log("chat-note-companion-test: pass");
}

main().catch((error) => {
  console.error(`chat-note-companion-test: ${error && error.message ? error.message : error}`);
  process.exit(1);
});
