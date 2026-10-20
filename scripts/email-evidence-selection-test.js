"use strict";
// scripts/email-evidence-selection-test.js — email evidence selection parity.
//
// An email source must use the SAME scored evidence selection as a note
// source: RRF of the semantic ranking and the TF-IDF lexical ranking, with
// the per-note semantic cap (TASK_EVIDENCE_SEMANTIC_NOTE_CAP = 1) and the
// lexical window (TASK_EVIDENCE_LEXICAL_WINDOW = 30). The note-only
// action/self/marker assertions are skipped for email (an email has no
// indexed source chunk to be the "self" handle and no marked-action scope).
//
// The note arm is compared against a recorded baseline
// (scripts/fixtures/email-evidence-selection-note-baseline.json), so this
// file also proves the note selection is byte-identical to the pre-change
// behaviour.
//
// Read-only and offline: nothing touches the vault or the network.
//
// Usage:
//   node scripts/email-evidence-selection-test.js [--record-note-baseline]

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const rootDir = path.join(__dirname, "..");
const mainPath = path.join(rootDir, "src/main.js");
const baselinePath = path.join(__dirname, "fixtures", "email-evidence-selection-note-baseline.json");
const recordBaseline = process.argv.slice(2).includes("--record-note-baseline");

const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(rootDir);

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
    requestUrl() { throw new Error("email-evidence-selection-test: network disabled"); }
  };
};

let runtime;
try {
  const mainSource = fs.readFileSync(mainPath, "utf8");
  testModule._compile(
    `${mainSource}\nmodule.exports.__emailEvidenceSelection = {\n` +
      "  DEFAULT_SETTINGS, buildTaskSourceContract, taskReferenceSyntheticPath,\n" +
      "  taskWorkflowSelectTaskRelevantEvidence, taskWorkflowSelectScoreEvidence\n" +
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
  buildTaskSourceContract,
  taskReferenceSyntheticPath,
  taskWorkflowSelectTaskRelevantEvidence,
  taskWorkflowSelectScoreEvidence
} = runtime.__emailEvidenceSelection;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const NOTE_SEMANTIC_NOTE_CAP = 1;
const NOTE_LEXICAL_WINDOW = 30;

const EMAIL_TITLE = "Acme Atlas intake form";
const EMAIL_SUMMARY = "The Acme Atlas intake form must be submitted before the deadline.";
const EMAIL_ACTION_TEXT = EMAIL_TITLE;

function noteFixture() {
  const contract = {
    id: "src-note-fixture",
    sourceId: "src-note-fixture",
    source_type: "note",
    sourceType: "note",
    path: "Notes/Fixture.md",
    primaryEvidenceId: "evidence-primary",
    scopes: [{
      scopeId: "scope-fixture",
      id: "scope-fixture",
      action: "Submit the budget report",
      lines: [1, 2, 3],
      mandatoryFactIds: [],
      mandatoryTaskFactIds: []
    }],
    facts: [],
    explicitMarkers: [{ scopeId: "scope-fixture", line: 1, action: "Submit the budget report" }]
  };
  const rows = [
    { evidenceId: "ev-self", path: "Notes/Fixture.md", text: "Submit the budget report by Friday", lineStart: 1, lineEnd: 3, adjustedSemantic: 0.91, rawSemanticScore: 0.91, sourceKind: "note", provenance: { sourceId: "src-fixture", path: "Notes/Fixture.md" } },
    { evidenceId: "ev-n1", path: "Notes/One.md", text: "budget report review notes", lineStart: 1, lineEnd: 2, adjustedSemantic: 0.8, rawSemanticScore: 0.8, sourceKind: "note", provenance: { sourceId: "src-one", path: "Notes/One.md" } },
    { evidenceId: "ev-n2", path: "Notes/One.md", text: "budget report figures", lineStart: 4, lineEnd: 5, adjustedSemantic: 0.79, rawSemanticScore: 0.79, sourceKind: "note", provenance: { sourceId: "src-one", path: "Notes/One.md" } },
    { evidenceId: "ev-n3", path: "Notes/Two.md", text: "budget report draft", lineStart: 1, lineEnd: 2, adjustedSemantic: 0.78, rawSemanticScore: 0.78, sourceKind: "note", provenance: { sourceId: "src-two", path: "Notes/Two.md" } },
    { evidenceId: "ev-n4", path: "Notes/Three.md", text: "unrelated reading list", lineStart: 1, lineEnd: 2, adjustedSemantic: 0.4, rawSemanticScore: 0.4, sourceKind: "note", provenance: { sourceId: "src-three", path: "Notes/Three.md" } }
  ];
  return {
    contract,
    rankings: {
      "scope:scope-fixture": {
        taskKey: "scope:scope-fixture",
        scopeId: "scope-fixture",
        queryHandleEvidenceId: "ev-self",
        actionText: "Submit the budget report",
        rows
      }
    }
  };
}

function emailFixture() {
  const contract = buildTaskSourceContract(
    { type: "email", title: EMAIL_TITLE, text: EMAIL_SUMMARY },
    EMAIL_SUMMARY,
    DEFAULT_SETTINGS
  );
  assert.equal(contract.sourceType, "email", "the email contract must carry the email source type");
  const scopeId = String(contract.scopes?.[0]?.scopeId || "");
  const rows = [];
  for (let note = 0; note < 40; note += 1) {
    const notePath = `Notes/Bulk ${note}.md`;
    for (let chunk = 0; chunk < 4; chunk += 1) {
      rows.push({
        evidenceId: `ev-bulk-${note}-${chunk}`,
        path: notePath,
        text: `budget report chunk ${chunk} of note ${note}`,
        lineStart: chunk * 3 + 1,
        lineEnd: chunk * 3 + 3,
        adjustedSemantic: 0.9 - note * 0.01 - chunk * 0.001,
        rawSemanticScore: 0.9 - note * 0.01 - chunk * 0.001,
        sourceKind: "note",
        provenance: { sourceId: `src-bulk-${note}`, path: notePath }
      });
    }
  }
  // A Todoist snapshot reference row: a real email corpus row that carries no
  // note line range. It must survive the email selection exactly as it does
  // for notes (it is never dropped for a missing note line range).
  const snapshotPath = taskReferenceSyntheticPath("record-email-1", "todoist-snapshot-reference-row");
  rows.push({
    evidenceId: "ev-snapshot",
    path: snapshotPath,
    text: "Title: File the Acme Atlas intake form",
    adjustedSemantic: 0.88,
    rawSemanticScore: 0.88,
    sourceKind: "todoist-snapshot-reference-row",
    provenance: { sourceId: "src-todoist-snapshot", path: snapshotPath },
    taskReference: {
      todoistId: "1234567890",
      taskId: "1234567890",
      id: "1234567890",
      oid: "ABCDEF1234567890",
      sourceKind: "todoist-snapshot-reference-row",
      nonVaultSource: true,
      sourceSurface: "todoist-snapshot",
      retrievalEligible: true,
      path: snapshotPath,
      content: "File the Acme Atlas intake form"
    }
  });
  return {
    contract,
    scopeId,
    rows,
    rankings: {
      [`scope:${scopeId}`]: {
        taskKey: `scope:${scopeId}`,
        scopeId,
        queryHandleEvidenceId: "",
        actionText: EMAIL_ACTION_TEXT,
        rows
      }
    }
  };
}

// The selector's internal ranked shape (score resolved from the exact
// adjusted/raw semantic fields) — the same rows the score module ranks.
function rankedShape(rows) {
  return rows.map((row) => ({
    evidenceId: String(row.evidenceId || ""),
    score: Number(row.adjustedSemantic !== undefined && row.adjustedSemantic !== null ? row.adjustedSemantic : row.rawSemanticScore),
    text: String(row.text || ""),
    path: String(row.path || ""),
    lineStart: Number(row.lineStart),
    lineEnd: Number(row.lineEnd)
  }));
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

// ---------------------------------------------------------------------------
// Note arm: the selection must stay byte-identical to the recorded baseline.
// ---------------------------------------------------------------------------
const note = noteFixture();
const noteSelection = taskWorkflowSelectTaskRelevantEvidence(note.rankings, {
  sourceContract: note.contract,
  settings: DEFAULT_SETTINGS
});
const noteSnapshot = JSON.stringify(noteSelection);

if (recordBaseline || !fs.existsSync(baselinePath)) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${noteSnapshot}\n`, "utf8");
  console.log(`note-arm baseline ${recordBaseline ? "recorded" : "created"}: ${baselinePath}`);
} else {
  const expected = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  check("note arm selection is byte-identical to the recorded baseline", () => {
    assert.deepStrictEqual(JSON.parse(noteSnapshot), expected);
  });
  check("note arm keeps its scored selection (perTaskTopN null)", () => {
    assert.equal(noteSelection.perTaskTopN, null);
    assert.equal(noteSelection.dispatchAllowed, true);
  });
}

// ---------------------------------------------------------------------------
// Email arm: the same scored selection as notes.
// ---------------------------------------------------------------------------
const email = emailFixture();
const emailSelection = taskWorkflowSelectTaskRelevantEvidence(email.rankings, {
  sourceContract: email.contract,
  settings: DEFAULT_SETTINGS
});
const emailTaskKey = Object.keys(email.rankings)[0];
const emailPerTask = emailSelection.perTask[emailTaskKey] || {};
const emailScoredIds = emailPerTask.moduleResults?.scores?.evidenceIds || [];
const emailErrorCodes = (emailSelection.protectedReferenceErrors || []).map((code) => String(code).split(":")[0]);

check("email selection uses the scored selection, not the 1100 cut", () => {
  assert.equal(emailSelection.perTaskTopN, null, "the email selection must not use the legacy 1100 per-task cut");
  assert.ok(emailScoredIds.length > 0, "the email selection must score evidence");
  assert.ok(
    emailSelection.selectedEvidenceIds.length < email.rows.length,
    `the email selection (${emailSelection.selectedEvidenceIds.length}) must be smaller than the corpus (${email.rows.length})`
  );
});

check("email selection applies the per-note semantic cap and the lexical window", () => {
  const expected = taskWorkflowSelectScoreEvidence(rankedShape(email.rows), EMAIL_ACTION_TEXT, {
    semanticNoteCap: NOTE_SEMANTIC_NOTE_CAP,
    lexicalLimit: NOTE_LEXICAL_WINDOW
  });
  assert.deepStrictEqual(emailScoredIds, expected.evidenceIds, "the email selection must use the note scoring (cap + lexical window)");
  const semanticIds = expected.evidenceIds.filter((id) => expected.reasonsById[id] === "admitted-semantic-window");
  const pathById = new Map(email.rows.map((row) => [row.evidenceId, row.path]));
  const perNote = new Map();
  for (const id of semanticIds) {
    const notePath = pathById.get(id);
    perNote.set(notePath, (perNote.get(notePath) || 0) + 1);
  }
  for (const [notePath, count] of perNote) {
    assert.equal(count, 1, `note ${notePath} must keep one semantic chunk, got ${count}`);
  }
  assert.ok(semanticIds.length >= 30, `the semantic window must stay full, got ${semanticIds.length}`);
  assert.ok(expected.evidenceIds.length <= 60, `the selection must stay inside the two windows, got ${expected.evidenceIds.length}`);
});

check("email selection dispatches with no note-only error code", () => {
  assert.equal(emailSelection.dispatchAllowed, true, `the email selection must dispatch, errors: ${JSON.stringify(emailSelection.protectedReferenceErrors)}`);
  for (const code of emailErrorCodes) {
    assert.ok(
      !["action-or-self-missing", "action-source-mismatch", "body-or-position-missing", "corpus-coverage"].includes(code),
      `the email selection must not report the note-only error code ${code}`
    );
  }
});

check("a Todoist snapshot reference row survives the email selection", () => {
  assert.ok(
    emailSelection.selectedEvidenceIds.includes("ev-snapshot"),
    `the snapshot reference row must survive, got ${JSON.stringify(emailSelection.selectedEvidenceIds)}`
  );
});

check("an email ranking without a usable action text fails closed with a clear code", () => {
  const noAction = emailFixture();
  noAction.rankings[Object.keys(noAction.rankings)[0]].actionText = "   ";
  const selection = taskWorkflowSelectTaskRelevantEvidence(noAction.rankings, {
    sourceContract: noAction.contract,
    settings: DEFAULT_SETTINGS
  });
  assert.equal(selection.dispatchAllowed, false, "an email without an action text must not dispatch");
  assert.ok(
    (selection.protectedReferenceErrors || []).some((code) => String(code).startsWith("email-action-text-missing:")),
    `the email must report email-action-text-missing, got ${JSON.stringify(selection.protectedReferenceErrors)}`
  );
});

if (failures.length) {
  console.error(`${failures.length} email-evidence-selection check(s) failed`);
  process.exit(1);
}
console.log("PASS: email evidence selection parity");
