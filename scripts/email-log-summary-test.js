"use strict";
// scripts/email-log-summary-test.js — offline guard for the email log-note
// summary and for the email-log indexing change (0.9.27 ->).
//
// A processed email must leave a CONCISE summary in its log note (the full
// email text is never stored), and the log note must become part of the
// semantic index so Ask/chat and later task generation can find past emails
// and the tasks created from them.
//
// Covered here:
//   1. appendEmailLog writes "## Email summary" between the metadata lines and
//      "## Synced Todoist Tasks", and leaves the task lines untouched.
//   2. appendEmailLog without a summary keeps the 0.9.27 note byte-identical.
//   3. A summary that starts with a checkbox, a list marker or a configured
//      sync/action tag is sanitized so it can never be read back as a task.
//   4. A summary generation failure is caught: no hold, no throw, and the log
//      note is written without a summary.
//   5. isIndexablePath returns true for an email log note and false for other
//      plugin-data notes and for the writing context folder.
//   6. EVERY unit of an email log note (metadata lines, email summary, synced
//      task lines) is metadata-only: it stays searchable for Ask/chat and
//      never reaches the task-generation lane, so a past email's summary can
//      never become a phantom task. A note that is not a log note is
//      unaffected.
//
// Read-only and offline: the plugin runs over a fake in-memory vault; the
// provider call is stubbed. Nothing touches the disk or the network.
//
// Usage: node scripts/email-log-summary-test.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = process.env.EMAIL_LOG_SUMMARY_MAIN || path.join(__dirname, "..", "src/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");

class FakeTFile {
  constructor(filePath, content = "") {
    this.path = filePath;
    this.name = filePath.split("/").pop();
    this.basename = filePath.split("/").pop().replace(/\.md$/i, "");
    this.extension = "md";
    this.stat = { mtime: Date.now(), ctime: Date.now(), size: content.length };
    this.content = content;
  }
}

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
    TFile: FakeTFile,
    setIcon() {},
    requestUrl() { throw new Error("email-log-summary-test: network disabled"); }
  };
};

let runtime;
try {
  ensureNodeGlobals();
  const testModule = new Module(mainPath, module);
  testModule.filename = mainPath;
  testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
  testModule._compile(
    `${mainSource}\nmodule.exports.__emailLogSummary = {\n` +
      "  DEFAULT_SETTINGS, sanitizeEmailLogSummary, parseTaskLine, formatEmailWorkflowTimestamp,\n" +
      "  capEmailLogSummary, normalizeLegacySyncTags, hasSubtaskSyncMarker,\n" +
      "  semanticExecutionEvidencePartition, semanticRetrievalChunkEligible\n" +
      "};\n",
    mainPath
  );
  runtime = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const { DEFAULT_SETTINGS, sanitizeEmailLogSummary, parseTaskLine, formatEmailWorkflowTimestamp, capEmailLogSummary, normalizeLegacySyncTags, hasSubtaskSyncMarker, semanticExecutionEvidencePartition, semanticRetrievalChunkEligible } = runtime.__emailLogSummary;

const LOG_FOLDER = DEFAULT_SETTINGS.emailLogFolder;
const SUBJECT = "Quarterly intake form";
const FROM = "Alex Example <alex@example.com>";
const RECEIVED_AT = "2026-10-12T09:30:00.000Z";
const CLOUDFLARE_RECEIVED_AT = "2026-10-12T09:31:00.000Z";
const SECTION = "2026-10-12 Quarterly intake form";
const SUMMARY = "Alex asked Dana to submit the Atlas intake form by October 13. The request arrived on October 12 and Dana confirmed the same deadline when she replied.";

function makeTasks() {
  return [{
    id: "123456",
    oid: "OID12345",
    content: "Submit the Atlas intake form",
    section: SECTION,
    labels: [],
    priority: 1,
    subtasks: []
  }];
}

// ---------------------------------------------------------------------------
// Fake vault + plugin harness
// ---------------------------------------------------------------------------
function makeFakeApp() {
  const files = new Map();
  const folders = new Set();
  const vault = {
    adapter: {
      getBasePath: () => "",
      getName: () => "vault",
      exists: async () => false,
      list: async () => ({ files: [], folders: [] })
    },
    getName: () => "vault",
    getMarkdownFiles: () => Array.from(files.values()),
    getFiles: () => Array.from(files.values()),
    getAbstractFileByPath: (filePath) => {
      if (files.has(filePath)) return files.get(filePath);
      if (folders.has(filePath)) return { path: filePath, children: [] };
      return null;
    },
    createFolder: async (folderPath) => { folders.add(folderPath); },
    create: async (filePath, content) => {
      const file = new FakeTFile(filePath, String(content || ""));
      files.set(filePath, file);
      return file;
    },
    read: async (file) => String(file?.content || ""),
    cachedRead: async (file) => String(file?.content || ""),
    modify: async (file, content) => { file.content = String(content || ""); },
    append: async (file, content) => { file.content = `${file.content || ""}${content}`; },
    delete: async (file) => { files.delete(file.path); },
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
  return { app: { vault, metadataCache, workspace }, files };
}

function makePlugin(options = {}) {
  const { app, files } = makeFakeApp();
  const plugin = new runtime(app, { id: "semantic-todoist-sync", dir: ".obsidian/plugins/semantic-todoist-sync" });
  plugin.settings = Object.assign({}, DEFAULT_SETTINGS, {
    taskCache: {},
    pendingTaskReferences: {},
    pendingTaskDescriptions: {},
    localLog: [],
    emailFailureHolds: {},
    semanticIndexMeta: {},
    semanticIndex: [],
    semanticIndexPathMeta: new Map()
  });
  plugin.semanticIndex = [];
  plugin.semanticIndexPathMeta = new Map();
  // Offline stubs for the persistence, index and Todoist side effects.
  plugin.markActivityLogDirty = () => {};
  plugin.markTaskReferenceStateDirty = () => {};
  plugin.queueTaskReferenceIndexUpdate = () => {};
  plugin.saveSettings = async () => {};
  plugin.setSidebarStatus = () => {};
  plugin.refreshSidebarStatus = () => {};
  plugin.syncFileNotes = async (notePath) => {
    plugin.__synced.push(notePath);
    return { scanned: 1, created: 0, updated: 0, normalized: 0, relinked: 0, removed: 0, failed: 0 };
  };
  plugin.__synced = [];
  plugin.__indexed = [];
  plugin.queueSemanticIndexUpdate = (notePath, reason) => {
    plugin.__indexed.push({ path: notePath, reason });
    return { ok: true, queued: 1, reasonCode: "queued" };
  };
  if (typeof options.configure === "function") options.configure(plugin);
  return { plugin, app, files };
}

function noteContent(files) {
  const notes = Array.from(files.values());
  assert.equal(notes.length, 1, "expected exactly one log note");
  return notes[0].content;
}

function noteLines(files) {
  return noteContent(files).replace(/\n$/, "").split("\n");
}

// ---------------------------------------------------------------------------
// 1 + 2. appendEmailLog: summary section placement and the 0.9.27 shape
// ---------------------------------------------------------------------------
async function testAppendEmailLogFormat() {
  const withSummary = makePlugin();
  await withSummary.plugin.appendEmailLog({
    subject: SUBJECT,
    from: FROM,
    receivedAt: RECEIVED_AT,
    cloudflareReceivedAt: CLOUDFLARE_RECEIVED_AT,
    sectionName: SECTION,
    tasks: makeTasks(),
    summary: SUMMARY
  });
  const withLines = noteLines(withSummary.files);
  const summaryIndex = withLines.indexOf("## Email summary");
  const tasksIndex = withLines.indexOf("## Synced Todoist Tasks");
  assert.ok(summaryIndex > 0, "expected an ## Email summary section");
  assert.ok(tasksIndex > summaryIndex, "expected ## Synced Todoist Tasks after the summary section");
  assert.equal(withLines[summaryIndex - 1], "", "expected a blank line before the summary section");
  assert.equal(withLines[summaryIndex + 1], "", "expected a blank line after the summary heading");
  assert.equal(withLines[summaryIndex + 2], SUMMARY, "expected the summary text under the heading");
  assert.equal(withLines[tasksIndex - 1], "", "expected a blank line before ## Synced Todoist Tasks");
  // The metadata block keeps its 0.9.27 order and content.
  assert.equal(withLines[0].startsWith("Date processed: "), true);
  assert.equal(withLines[1], `Original email received: ${formatEmailWorkflowTimestamp(RECEIVED_AT)}`);
  assert.equal(withLines[2], `Forward received by Cloudflare: ${formatEmailWorkflowTimestamp(CLOUDFLARE_RECEIVED_AT)}`);
  assert.equal(withLines[3], `From: ${FROM}`);
  assert.equal(withLines[4], `Email subject: ${SUBJECT}`);
  assert.equal(withLines[5], `Todoist section: ${SECTION}`);
  assert.equal(withLines.filter((line) => line === "## Email summary").length, 1);

  const withoutSummary = makePlugin();
  await withoutSummary.plugin.appendEmailLog({
    subject: SUBJECT,
    from: FROM,
    receivedAt: RECEIVED_AT,
    cloudflareReceivedAt: CLOUDFLARE_RECEIVED_AT,
    sectionName: SECTION,
    tasks: makeTasks()
  });
  const plainLines = noteLines(withoutSummary.files);
  // Byte-identical to the 0.9.27 note: metadata block, then the heading, then
  // the task lines, with no blank line and no summary section.
  assert.equal(plainLines.length, 8, "expected the 0.9.27 line count");
  assert.equal(plainLines[0].startsWith("Date processed: "), true);
  assert.equal(plainLines[1], `Original email received: ${formatEmailWorkflowTimestamp(RECEIVED_AT)}`);
  assert.equal(plainLines[2], `Forward received by Cloudflare: ${formatEmailWorkflowTimestamp(CLOUDFLARE_RECEIVED_AT)}`);
  assert.equal(plainLines[3], `From: ${FROM}`);
  assert.equal(plainLines[4], `Email subject: ${SUBJECT}`);
  assert.equal(plainLines[5], `Todoist section: ${SECTION}`);
  assert.equal(plainLines[6], "## Synced Todoist Tasks");
  assert.ok(plainLines[7].startsWith("- [ ] Submit the Atlas intake form #STsync"), "unexpected task line");
  assert.equal(plainLines.some((line) => line.includes("Email summary")), false);
  assert.equal(plainLines.some((line) => line === ""), false);

  // The task lines are identical with and without a summary.
  const withTaskLine = withLines[withLines.indexOf("## Synced Todoist Tasks") + 1];
  assert.equal(withTaskLine, plainLines[7], "the task line must not change when a summary is added");
  // The summary is written before the task section and the note sync still runs.
  assert.deepEqual(withSummary.plugin.__synced.length, 1);
  // The log note is queued for indexing so it becomes retrievable evidence.
  assert.equal(withSummary.plugin.__indexed.length, 1);
  assert.equal(withSummary.plugin.__indexed[0].reason, "email-log");
  assert.ok(withSummary.plugin.__indexed[0].path.startsWith(`${LOG_FOLDER}/`));
  if (process.env.EMAIL_LOG_SUMMARY_PRINT) console.log(`--- sample note ---\n${noteContent(withSummary.files)}--- end ---`);
  console.log("PASS appendEmailLog writes the summary section and keeps the 0.9.27 shape");
}

// ---------------------------------------------------------------------------
// 3. Summary sanitization: never readable back as a task line
// ---------------------------------------------------------------------------
async function testSummarySanitization() {
  const settings = Object.assign({}, DEFAULT_SETTINGS, { syncTag: "#STsync", subtaskSyncTag: "#STSubSync", noteActionMarkerTags: "#todo" });
  const raw = [
    "- [ ] Submit the Atlas intake form #STsync",
    "* [x] Call the vendor about the addendum #todo",
    "- 1. Review the draft and reply",
    "Alex asked Dana to send the signed form by October 13. #STSubSync",
    "The second sentence has no marker."
  ].join("\n");
  const sanitized = sanitizeEmailLogSummary(raw, settings);
  assert.equal(sanitized.includes("- [ ]"), false, "a leading checkbox must be stripped");
  assert.equal(sanitized.includes("#STsync"), false, "the configured sync tag must be stripped");
  assert.equal(sanitized.includes("#STSubSync"), false, "the configured subtask tag must be stripped");
  assert.equal(sanitized.toLowerCase().includes("#todo"), false, "the configured action tag must be stripped");
  assert.equal(sanitized.includes("Submit the Atlas intake form"), true, "the summary text must survive");
  const sanitizedLines = sanitized.split("\n");
  for (const [index, line] of sanitizedLines.entries()) {
    const parsed = parseTaskLine(line, index, `${LOG_FOLDER}/note.md`, sanitizedLines, settings);
    assert.equal(parsed, null, `summary line ${index} must not parse as a task line: ${line}`);
  }
  // A note written with a hostile summary still yields only the real task line.
  const harness = makePlugin();
  await harness.plugin.appendEmailLog({
    subject: SUBJECT,
    from: FROM,
    receivedAt: RECEIVED_AT,
    cloudflareReceivedAt: CLOUDFLARE_RECEIVED_AT,
    sectionName: SECTION,
    tasks: makeTasks(),
    summary: raw
  });
  const lines = noteLines(harness.files);
  const taskLines = lines.filter((line) => parseTaskLine(line, lines.indexOf(line), `${LOG_FOLDER}/note.md`, lines, harness.plugin.settings));
  assert.equal(taskLines.length, 1, "only the real task line may parse as a task");
  assert.ok(taskLines[0].startsWith("- [ ] Submit the Atlas intake form #STsync"));
  console.log("PASS summary text cannot be parsed as a task line");
}

// ---------------------------------------------------------------------------
// 3b. A runaway summary is cut: the note never holds the email text
// ---------------------------------------------------------------------------
async function testSummaryIsBounded() {
  const long = `${"Alex asked Dana to send the signed Atlas intake form by October 13. ".repeat(60)}`;
  const capped = capEmailLogSummary(long);
  assert.ok(capped.length <= 1203, `expected a bounded summary, got ${capped.length} chars`);
  assert.ok(capped.endsWith("..."), "a cut summary is marked as truncated");
  assert.ok(capped.startsWith("Alex asked Dana"));
  const harness = makePlugin();
  await harness.plugin.appendEmailLog({
    subject: SUBJECT,
    from: FROM,
    receivedAt: RECEIVED_AT,
    cloudflareReceivedAt: CLOUDFLARE_RECEIVED_AT,
    sectionName: SECTION,
    tasks: makeTasks(),
    summary: long
  });
  const lines = noteLines(harness.files);
  const summaryText = lines.slice(lines.indexOf("## Email summary") + 2, lines.indexOf("## Synced Todoist Tasks") - 1).join("\n");
  assert.ok(summaryText.length < long.length, "the note must not hold the full summary");
  assert.ok(summaryText.length <= 1203);
  console.log("PASS a runaway summary is cut to a bounded length");
}

// ---------------------------------------------------------------------------
// 4. A summary failure never blocks or holds the email
// ---------------------------------------------------------------------------
async function testSummaryFailureIsContained() {
  const harness = makePlugin();
  const plugin = harness.plugin;
  const holds = [];
  const completed = [];
  const rawEmail = [
    "From: Alex Example <alex@example.com>",
    "To: dana@example.com",
    "Subject: Quarterly intake form",
    "Date: Mon, 12 Oct 2026 09:30:00 +0000",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hi Dana,",
    "",
    "Please submit the Atlas intake form by October 13.",
    "",
    "Thanks,",
    "Alex"
  ].join("\r\n");
  plugin.workerJson = async (workerPath, method, body) => {
    if (method === "GET" && workerPath.startsWith("/email")) {
      return { raw: rawEmail, subject: SUBJECT, from: FROM, to: "dana@example.com", receivedAt: CLOUDFLARE_RECEIVED_AT };
    }
    if (method === "POST" && workerPath === "/complete") {
      completed.push(body);
      return { ok: true };
    }
    throw new Error(`unexpected worker call ${method} ${workerPath}`);
  };
  plugin.createTaskPlanWithLocalActivity = async () => ({
    sectionName: SECTION,
    tasks: [{ id: "scope-1", content: "Submit the Atlas intake form", subtasks: [] }],
    sourceSummary: "Current/latest email message (primary status and next-action evidence):\nPlease submit the Atlas intake form by October 13.",
    contextNotes: [],
    semanticContext: []
  });
  plugin.prepareGeneratedTasksForTodoistWorkflow = async () => ({ sectionName: SECTION, sectionId: "sec-1" });
  plugin.createTodoistTaskBatch = async () => makeTasks();
  plugin.recordEmailFailureHoldSafely = async (...args) => { holds.push(args); };
  plugin.clearEmailFailureHold = async () => {};
  plugin.semanticTaskContextDispatchGate = async () => null;
  plugin.openaiResponse = async () => {
    const error = new Error("summary provider offline");
    error.code = "provider-offline";
    throw error;
  };

  const result = await plugin.processPendingEmailItem({ id: "email-1" });
  assert.equal(result.tasks, 1, "the email must still be processed");
  assert.equal(holds.length, 0, "a summary failure must not record a failure hold");
  assert.equal(completed.length, 1, "the email must still be acked");
  const lines = noteLines(harness.files);
  assert.equal(lines.some((line) => line.includes("Email summary")), false, "the note must be written without a summary");
  assert.equal(lines[6], "## Synced Todoist Tasks");
  assert.ok(lines[7].startsWith("- [ ] Submit the Atlas intake form #STsync"));
  const failureLog = (plugin.settings.localLog || []).find((entry) => String(entry.message || "").includes("summary failed"));
  assert.ok(failureLog, "expected a summary failure log entry");
  assert.equal(failureLog.data.code, "provider-offline");
  assert.equal(JSON.stringify(failureLog).includes("October 13"), false, "the log entry must not carry email text");
  console.log("PASS a summary failure gives no hold, no throw and a note without a summary");
}

// ---------------------------------------------------------------------------
// 4b. A degraded semantic index skips the summary instead of spending a call
// ---------------------------------------------------------------------------
async function testDegradedIndexSkipsSummary() {
  const harness = makePlugin();
  harness.plugin.semanticTaskContextDispatchGate = async () => ({ code: "semantic-index-degraded", mode: "email-summary" });
  harness.plugin.openaiResponse = async () => {
    throw new Error("the summary must not be requested while the index is degraded");
  };
  const summary = await harness.plugin.generateEmailLogSummary({
    subject: SUBJECT,
    sourceSummary: "Please submit the Atlas intake form by October 13.",
    taskTitles: ["Submit the Atlas intake form"]
  });
  assert.equal(summary, "");
  console.log("PASS a degraded semantic index skips the summary");
}

// ---------------------------------------------------------------------------
// 5. Email log notes are indexable vault evidence
// ---------------------------------------------------------------------------
async function testIndexablePath() {
  const harness = makePlugin();
  const plugin = harness.plugin;
  const logNote = `${LOG_FOLDER}/2026-10-12 - Quarterly intake form.md`;
  assert.equal(plugin.isIndexablePath(logNote), true, "an email log note must be indexable");
  assert.equal(plugin.isIndexablePath(`${LOG_FOLDER}/Cloudflare Email Setup.md`), true);
  assert.equal(plugin.isIndexablePath("Semantic Todoist Sync/Research/notes.md"), false, "other plugin-data notes stay excluded");
  assert.equal(plugin.isIndexablePath("Semantic Todoist Sync/Context/draft.md"), false, "the writing context folder stays excluded");
  assert.equal(plugin.isIndexablePath("Notes/Regular.md"), true);
  assert.equal(plugin.isIndexablePath("Semantic Todoist Sync/Prompts/prompt.md"), false);

  // The log folder is plugin-managed, so an include list never hides it.
  plugin.settings.indexedFolders = "Notes";
  assert.equal(plugin.isIndexablePath(logNote), true, "an include list does not hide the log notes");
  assert.equal(plugin.isIndexablePath("Notes/Regular.md"), true);
  plugin.settings.indexedFolders = "";
  assert.equal(plugin.isIndexablePath(logNote), true);
  console.log("PASS isIndexablePath accepts email log notes only");
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 6. EVERY unit of an email log note is metadata-only
//
// A log note is the vault record of a processed email. Its metadata lines,
// its AI summary and its synced task lines describe a PAST email, so none of
// them may become task-generation evidence: a later email that retrieved an
// earlier email's summary would turn that summary's request into a second,
// phantom task. The log note stays fully searchable for Ask/chat.
// ---------------------------------------------------------------------------
async function testLogNoteUnitsAreMetadataOnly() {
  const harness = makePlugin();
  await harness.plugin.appendEmailLog({
    subject: SUBJECT,
    from: FROM,
    receivedAt: RECEIVED_AT,
    cloudflareReceivedAt: CLOUDFLARE_RECEIVED_AT,
    sectionName: SECTION,
    tasks: makeTasks(),
    summary: SUMMARY
  });
  const notePath = Array.from(harness.files.keys())[0];
  const noteFile = harness.files.get(notePath);
  const chunks = harness.plugin.semanticFileChunks(notePath, noteFile, noteFile.content, { createdAt: 0, createdAtSource: "" });
  assert.ok(chunks.length >= 3, `expected the metadata, summary and task units, got ${chunks.length}`);
  assert.ok(chunks.some((chunk) => chunk.text.includes("Alex asked Dana")), "expected a summary unit");
  assert.ok(chunks.some((chunk) => chunk.text.includes("Submit the Atlas intake form")), "expected a synced task unit");
  assert.ok(chunks.some((chunk) => chunk.text.includes("Email subject:")), "expected a metadata unit");
  for (const chunk of chunks) {
    // Every unit of a log note is metadata-only: metadata lines, the email
    // summary and the synced task lines alike.
    assert.equal(chunk.evidenceEligibility, "metadata-only", `every log-note unit must be metadata-only: ${chunk.text}`);
    // Ask/chat keeps every unit of the log note.
    assert.equal(semanticRetrievalChunkEligible(chunk, { isIndexablePath: () => true }), true, `the unit must stay Ask-searchable: ${chunk.text}`);
    const chatLane = semanticExecutionEvidencePartition([chunk], "chat");
    assert.equal(chatLane.selected.length, 1, `Ask/chat must keep the unit: ${chunk.text}`);
    // The task lane drops every unit of the log note.
    const taskLane = semanticExecutionEvidencePartition([chunk], "task-generation");
    assert.equal(taskLane.selected.length, 0, `a log-note unit must not reach the task lane: ${chunk.text}`);
    assert.equal(taskLane.rejected.length, 1);
    assert.equal(taskLane.telemetry.reasonCodes[0], "metadata-only-unit");
  }
  console.log("PASS every unit of an email log note is metadata-only and stays Ask-searchable");
}

// ---------------------------------------------------------------------------
// 6b. A note that is not an email log note stays task-eligible
// ---------------------------------------------------------------------------
async function testNonLogNoteUnitsStayEvidence() {
  const harness = makePlugin();
  const notePath = "Notes/Regular.md";
  const noteFile = { basename: "Regular", stat: { mtime: 0 } };
  const text = "The Acme Atlas intake form is due October 13.\n\nAlex confirmed the deadline.";
  const chunks = harness.plugin.semanticFileChunks(notePath, noteFile, text, { createdAt: 0, createdAtSource: "" });
  assert.ok(chunks.length > 0, "expected the plain note units");
  for (const chunk of chunks) {
    assert.equal(chunk.evidenceEligibility, "evidence", `a plain note unit must stay task-eligible: ${chunk.text}`);
    const taskLane = semanticExecutionEvidencePartition([chunk], "task-generation");
    assert.equal(taskLane.selected.length, 1, `a plain note unit must reach the task lane: ${chunk.text}`);
  }
  console.log("PASS a note that is not an email log note stays task-eligible");
}

// ---------------------------------------------------------------------------
// 7. Only the log folder itself can exclude the email log notes
// ---------------------------------------------------------------------------
async function testLogFolderExclusionRule() {
  const harness = makePlugin();
  const plugin = harness.plugin;
  const logNote = `${LOG_FOLDER}/2026-10-12 - Quarterly intake form.md`;
  // The default excluded folder is the plugin data folder, which CONTAINS the
  // log folder: it must not hide the log notes.
  assert.equal(plugin.settings.excludedFolders, "Semantic Todoist Sync");
  assert.equal(plugin.isIndexablePath(logNote), true, "the plugin data folder must not hide the log notes");
  plugin.settings.excludedFolders = "Semantic Todoist Sync, Notes";
  assert.equal(plugin.isIndexablePath(logNote), true, "a parent folder must not hide the log notes");
  // Listing the log folder itself hides the log notes.
  plugin.settings.excludedFolders = LOG_FOLDER;
  assert.equal(plugin.isIndexablePath(logNote), false, "an excluded log folder hides the log notes");
  // A folder inside the log folder hides them too.
  plugin.settings.excludedFolders = `${LOG_FOLDER}/Archive`;
  assert.equal(plugin.isIndexablePath(logNote), false, "an excluded folder inside the log folder hides the log notes");
  plugin.settings.excludedFolders = "Notes";
  assert.equal(plugin.isIndexablePath(logNote), true);
  plugin.settings.excludedFolders = "";
  assert.equal(plugin.isIndexablePath(logNote), true);
  console.log("PASS only the log folder itself can exclude the email log notes");
}

// ---------------------------------------------------------------------------
// 8. The sanitizer strips every marker the sync parser accepts
// ---------------------------------------------------------------------------
async function testSummaryMarkerSanitization() {
  const settings = Object.assign({}, DEFAULT_SETTINGS, { syncTag: "#STsync", subtaskSyncTag: "#STSubSync", noteActionMarkerTags: "#todo" });
  const raw = [
    "- - [ ] Submit the Atlas intake form #STsync",
    "1.5 million forms were filed last year",
    "- [x] Reply to Alex about the legacy tag #tdsync",
    "Call the vendor about the addendum #tdsyncsub",
    "Alex asked Dana to send the signed form by October 13."
  ].join("\n");
  const sanitized = sanitizeEmailLogSummary(raw, settings);
  const lines = sanitized.split("\n");
  for (const [index, line] of lines.entries()) {
    assert.equal(/^[-*+]\s/.test(line), false, `summary line ${index} must not keep a list marker: ${line}`);
    assert.equal(/^\[[ xX]\]/.test(line), false, `summary line ${index} must not keep a checkbox: ${line}`);
    const normalized = normalizeLegacySyncTags(line, settings);
    assert.equal(normalized.includes(settings.syncTag), false, `summary line ${index} must not keep a sync tag: ${line}`);
    assert.equal(hasSubtaskSyncMarker(normalized, settings), false, `summary line ${index} must not keep a subtask tag: ${line}`);
    assert.equal(parseTaskLine(line, index, `${LOG_FOLDER}/note.md`, lines, settings), null, `summary line ${index} must not parse as a task line: ${line}`);
  }
  assert.ok(sanitized.includes("1.5 million"), "a decimal number must survive");
  assert.ok(sanitized.includes("Submit the Atlas intake form"), "the summary text must survive");
  assert.ok(sanitized.includes("Alex asked Dana"), "the summary text must survive");
  console.log("PASS the sanitizer strips every marker the sync parser accepts");
}

// ---------------------------------------------------------------------------
// 9. The summary carries no contact details
// ---------------------------------------------------------------------------
async function testSummaryRedaction() {
  const raw = "Alex asked Dana to reply, reachable at alex@example.com or +1 555 123 4567; the form is at https://example.com/intake?x=1.";
  const sanitized = sanitizeEmailLogSummary(raw, DEFAULT_SETTINGS);
  assert.equal(sanitized.includes("alex@example.com"), false, "the email address must be removed");
  assert.equal(sanitized.includes("555 123 4567"), false, "the phone number must be removed");
  assert.equal(sanitized.includes("example.com/intake"), false, "the URL must be removed");
  assert.ok(sanitized.includes("Alex"), "the name must stay");
  assert.ok(sanitized.includes("Dana"), "the name must stay");
  console.log("PASS the summary carries no contact details");
}

// ---------------------------------------------------------------------------
// 9b. A phone number is redacted only when it looks like one
// ---------------------------------------------------------------------------
async function testSummaryRedactionOnlyForPhoneShapes() {
  const redacted = [
    { raw: "+1 613-555-0110", expected: "" },
    { raw: "(613) 555-0110", expected: "" },
    { raw: "613-555-0110", expected: "" },
    { raw: "613.555.0110", expected: "" },
    { raw: "1-800-555-0199", expected: "" },
    { raw: "+44 20 7946 0958", expected: "" },
    { raw: "Phone: 613 555 0110", expected: "Phone:" }
  ];
  for (const { raw, expected } of redacted) {
    const sanitized = sanitizeEmailLogSummary(raw, DEFAULT_SETTINGS);
    assert.equal(sanitized, expected, `the phone number must be removed: ${raw} -> ${sanitized}`);
  }
  // Numbers that only look like a phone number stay: the summary must not lose
  // identifiers, amounts, dates and reference numbers.
  const kept = [
    "Grant ID NIH-R01-2026-0012345",
    "NIH-R01-2026-001-2345",
    "x613-555-0110",
    "Order 1234 5678 9012",
    "Invoice 1234567890",
    "$1,250,000",
    "$125000",
    "2026-2027",
    "2026-07-14",
    "12/25/2026",
    "1.5 million"
  ];
  for (const raw of kept) {
    const sanitized = sanitizeEmailLogSummary(raw, DEFAULT_SETTINGS);
    assert.equal(sanitized, raw, `the number must survive: ${raw} -> ${sanitized}`);
  }
  console.log("PASS a phone number is redacted only when it looks like one");
}

// ---------------------------------------------------------------------------
// 9c. A four digit prefix is a year, not a list marker
// ---------------------------------------------------------------------------
async function testSummaryNumberedMarkerKeepsFourDigitPrefix() {
  const kept = sanitizeEmailLogSummary("2026. The budget was approved.", DEFAULT_SETTINGS);
  assert.equal(kept, "2026. The budget was approved.", "a year prefix must survive");
  const stripped = sanitizeEmailLogSummary("1. Send it", DEFAULT_SETTINGS);
  assert.equal(stripped, "Send it", "a list marker must be stripped");
  const decimal = sanitizeEmailLogSummary("1.5 million", DEFAULT_SETTINGS);
  assert.equal(decimal, "1.5 million", "a decimal number must survive");
  // A kept prefix must still never read back as a task line.
  const lines = kept.split("\n");
  for (const [index, line] of lines.entries()) {
    assert.equal(parseTaskLine(line, index, `${LOG_FOLDER}/note.md`, lines, DEFAULT_SETTINGS), null, `summary line ${index} must not parse as a task line: ${line}`);
  }
  console.log("PASS a four digit prefix is a year, not a list marker");
}

// ---------------------------------------------------------------------------
// 10. The log note stays small: the startup embed cost is bounded
// ---------------------------------------------------------------------------
async function testLogNoteSizeIsBounded() {
  const harness = makePlugin();
  await harness.plugin.appendEmailLog({
    subject: SUBJECT,
    from: FROM,
    receivedAt: RECEIVED_AT,
    cloudflareReceivedAt: CLOUDFLARE_RECEIVED_AT,
    sectionName: SECTION,
    tasks: makeTasks(),
    summary: SUMMARY
  });
  const notePath = Array.from(harness.files.keys())[0];
  const noteFile = harness.files.get(notePath);
  assert.ok(noteFile.content.length < 4000, `expected a small log note, got ${noteFile.content.length} chars`);
  const chunks = harness.plugin.semanticFileChunks(notePath, noteFile, noteFile.content, { createdAt: 0, createdAtSource: "" });
  assert.ok(chunks.length <= 4, `expected a few chunks to embed, got ${chunks.length}`);
  console.log("PASS the log note stays small enough for the existing embedding batches");
}

async function main() {
  await testAppendEmailLogFormat();
  await testSummarySanitization();
  await testSummaryIsBounded();
  await testSummaryFailureIsContained();
  await testDegradedIndexSkipsSummary();
  await testIndexablePath();
  await testLogNoteUnitsAreMetadataOnly();
  await testNonLogNoteUnitsStayEvidence();
  await testLogFolderExclusionRule();
  await testSummaryMarkerSanitization();
  await testSummaryRedaction();
  await testSummaryRedactionOnlyForPhoneShapes();
  await testSummaryNumberedMarkerKeepsFourDigitPrefix();
  await testLogNoteSizeIsBounded();
  console.log("email-log-summary-test: all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
