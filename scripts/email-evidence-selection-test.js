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
//   node scripts/email-evidence-selection-test.js --main-source=<path to src/main.js>
//
// The note baseline is recorded from the PRE-CHANGE commit (a6866b4 = 0.9.27)
// with the same harness, so the note control is a real comparison:
//   git show a6866b4:src/main.js > %TEMP%/main-a6866b4.js
//   node scripts/email-evidence-selection-test.js --record-note-baseline --main-source=%TEMP%/main-a6866b4.js
// The recorded fixture is then compared against the current src/main.js on
// every ordinary run.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const argv = process.argv.slice(2);
const rootDir = path.join(__dirname, "..");
const mainSourceArg = argv.find((value) => value.startsWith("--main-source="));
const mainPath = mainSourceArg
  ? path.resolve(mainSourceArg.slice("--main-source=".length))
  : path.join(rootDir, "src/main.js");
const baselinePath = path.join(__dirname, "fixtures", "email-evidence-selection-note-baseline.json");
const recordBaseline = argv.includes("--record-note-baseline");

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
    requestUrl() { throw new Error("email-evidence-selection-test: network disabled"); }
  };
};

let runtime;
try {
  const mainSource = fs.readFileSync(mainPath, "utf8");
  testModule._compile(
    `${mainSource}\nmodule.exports.__emailEvidenceSelection = {\n` +
      "  DEFAULT_SETTINGS, buildTaskSourceContract, taskReferenceSyntheticPath,\n" +
      "  taskWorkflowSelectTaskRelevantEvidence, taskWorkflowSelectScoreEvidence,\n" +
      "  emailSelectionActionText: typeof emailSelectionActionText === 'function' ? emailSelectionActionText : null\n" +
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
  taskWorkflowSelectScoreEvidence,
  emailSelectionActionText
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

// Rewrite the semantic score of every corpus row. The score module reads the
// adjusted (or raw) semantic score, so this drives the score-ordered paths.
function setSemanticScores(rows, scoreFor) {
  rows.forEach((row, index) => {
    const score = scoreFor(row, index);
    row.adjustedSemantic = score;
    row.rawSemanticScore = score;
  });
  return rows;
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

// A missing baseline is a FAILURE, never an implicit recording: the fixture is
// the control that proves the note path did not move. Recording happens only
// with the explicit --record-note-baseline flag.
if (recordBaseline) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${noteSnapshot}\n`, "utf8");
  console.log(`note-arm baseline recorded: ${baselinePath}`);
} else if (!fs.existsSync(baselinePath)) {
  failures.push("note-arm baseline fixture is missing");
  console.error(`FAIL: the note-arm baseline fixture is missing: ${baselinePath} (record it with --record-note-baseline)`);
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

// ---------------------------------------------------------------------------
// Zero-evidence guard: the semantic window is independent of the lexical
// overlap. An email whose action text shares NO token with the corpus must
// still be served by the semantic window (one chunk per note, up to the cap),
// and a corpus whose rows carry no positive semantic score must not collapse
// the selection to nothing (an email must never reach the model with no
// evidence).
// ---------------------------------------------------------------------------
const NO_OVERLAP_ACTION_TEXT = "Zephyr quokka xylophone";

check("an email whose action text shares no token with the corpus still gets the semantic window", () => {
  const fixture = emailFixture();
  const taskKey = Object.keys(fixture.rankings)[0];
  fixture.rankings[taskKey].actionText = NO_OVERLAP_ACTION_TEXT;
  const selection = taskWorkflowSelectTaskRelevantEvidence(fixture.rankings, {
    sourceContract: fixture.contract,
    settings: DEFAULT_SETTINGS
  });
  const perTask = selection.perTask[taskKey] || {};
  const scoredIds = perTask.moduleResults?.scores?.evidenceIds || [];
  const pathById = new Map(fixture.rows.map((row) => [row.evidenceId, row.path]));
  const overlap = (id) => {
    const tokens = (text) => String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    const query = new Set(tokens(NO_OVERLAP_ACTION_TEXT));
    return tokens(pathById.get(id)).some((token) => query.has(token));
  };
  assert.ok(
    scoredIds.every((id) => !overlap(id)),
    `the fixture must have no lexical overlap, got ${JSON.stringify(scoredIds.filter(overlap))}`
  );
  assert.ok(scoredIds.length >= 30, `the semantic window must still deliver its rows, got ${scoredIds.length}`);
  const perNote = new Map();
  for (const id of scoredIds) {
    const notePath = pathById.get(id);
    perNote.set(notePath, (perNote.get(notePath) || 0) + 1);
  }
  for (const [notePath, count] of perNote) {
    assert.equal(count, 1, `note ${notePath} must keep one semantic chunk, got ${count}`);
  }
  assert.equal(selection.dispatchAllowed, true, `the email must dispatch, errors: ${JSON.stringify(selection.protectedReferenceErrors)}`);
});

// ---------------------------------------------------------------------------
// Semantic-window fallback (email only): the safety net for a corpus with no
// positively scored row. It serves the TOP-SCORED rows, one per note, so it
// needs an ordering signal. A corpus whose scores are all tied (a degenerate
// embedding) carries none: the fallback then selects nothing and the email
// proceeds exactly as it would without it.
// ---------------------------------------------------------------------------

function scoredIdsOf(selection, taskKey) {
  return (selection.perTask[taskKey] || {}).moduleResults?.scores?.evidenceIds || [];
}

// The fallback rows, computed independently of the implementation: the
// highest-scored rows, one per note, up to the semantic limit.
function expectedFallbackIds(fixture, limit) {
  const pathById = new Map(fixture.rows.map((row) => [row.evidenceId, row.path]));
  const byScore = fixture.rows.slice().sort((left, right) => (right.adjustedSemantic - left.adjustedSemantic)
    || (left.evidenceId < right.evidenceId ? -1 : left.evidenceId > right.evidenceId ? 1 : 0));
  const ids = [];
  const usedNotes = new Set();
  for (const row of byScore) {
    if (ids.length >= limit) break;
    const note = pathById.get(row.evidenceId) || row.evidenceId;
    if (usedNotes.has(note)) continue;
    usedNotes.add(note);
    ids.push(row.evidenceId);
  }
  return ids;
}

check("an email corpus with tied semantic scores gets no fallback rows", () => {
  const fixture = emailFixture();
  setSemanticScores(fixture.rows, () => 0);
  const taskKey = Object.keys(fixture.rankings)[0];
  const selection = taskWorkflowSelectTaskRelevantEvidence(fixture.rankings, {
    sourceContract: fixture.contract,
    settings: DEFAULT_SETTINGS
  });
  const scoredIds = scoredIdsOf(selection, taskKey);
  // The fallback must select nothing, so the selection is exactly the
  // no-fallback selection (the lexical window alone).
  const withoutFallback = taskWorkflowSelectScoreEvidence(rankedShape(fixture.rows), EMAIL_ACTION_TEXT, {
    semanticNoteCap: NOTE_SEMANTIC_NOTE_CAP,
    lexicalLimit: NOTE_LEXICAL_WINDOW
  });
  assert.deepStrictEqual(
    scoredIds,
    withoutFallback.evidenceIds,
    "a tied corpus carries no ordering signal, so the fallback must select nothing"
  );
  // The guard is not vacuous: those are exactly the rows the fallback would
  // have served, so a fallback that fired would show up here.
  const fallbackRows = expectedFallbackIds(fixture, 30);
  const selected = new Set(scoredIds);
  assert.ok(
    !fallbackRows.some((id) => selected.has(id)),
    `a tied corpus must not be served by the fallback rows, got ${JSON.stringify(fallbackRows.filter((id) => selected.has(id)))}`
  );
  assert.equal(selection.dispatchAllowed, true, `the email must dispatch, errors: ${JSON.stringify(selection.protectedReferenceErrors)}`);
});

check("an email corpus with distinct negative semantic scores gets the top-scored rows, one per note", () => {
  const fixture = emailFixture();
  setSemanticScores(fixture.rows, (row, index) => -0.001 * (index + 1));
  const taskKey = Object.keys(fixture.rankings)[0];
  const selection = taskWorkflowSelectTaskRelevantEvidence(fixture.rankings, {
    sourceContract: fixture.contract,
    settings: DEFAULT_SETTINGS
  });
  const scoredIds = scoredIdsOf(selection, taskKey);
  const expectedIds = expectedFallbackIds(fixture, 30);
  const bulkIds = new Set(fixture.rows.filter((row) => row.path.startsWith("Notes/Bulk")).map((row) => row.evidenceId));
  const selectedBulk = scoredIds.filter((id) => bulkIds.has(id)).slice().sort();
  assert.deepStrictEqual(
    selectedBulk,
    expectedIds.slice().sort(),
    "the fallback must serve exactly the top-scored rows"
  );
  assert.equal(expectedIds.length, 30, "the expectation must fill the semantic limit");
  // One row per note.
  const pathById = new Map(fixture.rows.map((row) => [row.evidenceId, row.path]));
  const perNote = new Map();
  for (const id of selectedBulk) {
    const note = pathById.get(id);
    perNote.set(note, (perNote.get(note) || 0) + 1);
  }
  for (const [note, count] of perNote) {
    assert.equal(count, 1, `note ${note} must keep one fallback row, got ${count}`);
  }
  // The lowest-scored bulk row is not served: the fallback is score-ordered.
  const lowest = fixture.rows.filter((row) => bulkIds.has(row.evidenceId)).slice(-1)[0];
  assert.ok(!scoredIds.includes(lowest.evidenceId), "the lowest-scored row must not be served");
  assert.equal(selection.dispatchAllowed, true, `the email must dispatch, errors: ${JSON.stringify(selection.protectedReferenceErrors)}`);
});

check("an email corpus without a positive semantic score still gets the semantic window", () => {
  const fixture = emailFixture();
  setSemanticScores(fixture.rows, (row, index) => -0.001 * (index + 1));
  const taskKey = Object.keys(fixture.rankings)[0];
  const selection = taskWorkflowSelectTaskRelevantEvidence(fixture.rankings, {
    sourceContract: fixture.contract,
    settings: DEFAULT_SETTINGS
  });
  const scoredIds = scoredIdsOf(selection, taskKey);
  assert.ok(scoredIds.length > 0, `the email selection must never be empty, got ${JSON.stringify(scoredIds)}`);
  assert.ok(
    scoredIds.length >= 30,
    `the fallback semantic window must keep one chunk per note up to the cap, got ${scoredIds.length}`
  );
  assert.equal(selection.dispatchAllowed, true, `the email must dispatch, errors: ${JSON.stringify(selection.protectedReferenceErrors)}`);
});

// ---------------------------------------------------------------------------
// Non-Latin action text: the usable-text check must accept a letter or a
// number in any script, not only ASCII. A Cyrillic or CJK email must not
// fail closed with email-action-text-missing.
// ---------------------------------------------------------------------------
for (const [label, actionText] of [
  ["Cyrillic", "Отправить анкету до пятницы"],
  ["CJK", "完成表格并提交"]
]) {
  // A source that predates the helper has no action-text chain to check.
  if (typeof emailSelectionActionText !== "function") {
    console.log(`SKIP: a ${label} action text is a usable lexical query (this source has no emailSelectionActionText)`);
  } else {
    check(`a ${label} action text is a usable lexical query`, () => {
      assert.equal(
        emailSelectionActionText([actionText]),
        actionText,
        `the ${label} action text must be accepted as usable`
      );
    });
  }

  check(`an email ranking with a ${label} action text does not fail closed`, () => {
    const fixture = emailFixture();
    const taskKey = Object.keys(fixture.rankings)[0];
    fixture.rankings[taskKey].actionText = actionText;
    const selection = taskWorkflowSelectTaskRelevantEvidence(fixture.rankings, {
      sourceContract: fixture.contract,
      settings: DEFAULT_SETTINGS
    });
    const codes = (selection.protectedReferenceErrors || []).map((code) => String(code).split(":")[0]);
    assert.ok(
      !codes.includes("email-action-text-missing"),
      `the ${label} email must not fail closed, got ${JSON.stringify(codes)}`
    );
    assert.equal(selection.dispatchAllowed, true, `the ${label} email must dispatch, errors: ${JSON.stringify(selection.protectedReferenceErrors)}`);
    // The TF-IDF tokenizer yields no ASCII token for non-Latin text, so the
    // email must still be served by the semantic window.
    assert.ok(scoredIdsOf(selection, taskKey).length > 0, `the ${label} email must still get evidence`);
  });
}

// ---------------------------------------------------------------------------
// The semantic-window fallback is email-only: the note selection path must
// never receive it. A note ranking with no positive semantic score gives the
// same result as the pre-change behaviour (no fallback rows).
// ---------------------------------------------------------------------------
check("the note selection path never receives the semantic-window fallback", () => {
  const fixture = noteFixture();
  const taskKey = Object.keys(fixture.rankings)[0];
  setSemanticScores(fixture.rankings[taskKey].rows, () => 0);
  const selection = taskWorkflowSelectTaskRelevantEvidence(fixture.rankings, {
    sourceContract: fixture.contract,
    settings: DEFAULT_SETTINGS
  });
  const withoutFallback = taskWorkflowSelectScoreEvidence(rankedShape(fixture.rankings[taskKey].rows), "Submit the budget report", {
    semanticNoteCap: NOTE_SEMANTIC_NOTE_CAP,
    lexicalLimit: NOTE_LEXICAL_WINDOW
  });
  assert.deepStrictEqual(
    scoredIdsOf(selection, taskKey),
    withoutFallback.evidenceIds,
    "the note path must not receive the semantic-window fallback"
  );
  // The guard is not vacuous: on a corpus with distinct negative scores the
  // fallback would serve the top-scored rows, so a note that received it
  // would differ from the no-fallback selection.
  const negative = noteFixture();
  const negativeTaskKey = Object.keys(negative.rankings)[0];
  setSemanticScores(negative.rankings[negativeTaskKey].rows, (row, index) => -0.001 * (index + 1));
  const negativeSelection = taskWorkflowSelectTaskRelevantEvidence(negative.rankings, {
    sourceContract: negative.contract,
    settings: DEFAULT_SETTINGS
  });
  const negativeWithoutFallback = taskWorkflowSelectScoreEvidence(rankedShape(negative.rankings[negativeTaskKey].rows), "Submit the budget report", {
    semanticNoteCap: NOTE_SEMANTIC_NOTE_CAP,
    lexicalLimit: NOTE_LEXICAL_WINDOW
  });
  const negativeWithFallback = taskWorkflowSelectScoreEvidence(rankedShape(negative.rankings[negativeTaskKey].rows), "Submit the budget report", {
    semanticNoteCap: NOTE_SEMANTIC_NOTE_CAP,
    lexicalLimit: NOTE_LEXICAL_WINDOW,
    semanticWindowFallback: true
  });
  assert.notDeepStrictEqual(
    negativeWithFallback.evidenceIds,
    negativeWithoutFallback.evidenceIds,
    "the fixture must be sensitive to the fallback, or this check proves nothing"
  );
  assert.deepStrictEqual(
    scoredIdsOf(negativeSelection, negativeTaskKey),
    negativeWithoutFallback.evidenceIds,
    "the note path must not receive the semantic-window fallback"
  );
});

// ---------------------------------------------------------------------------
// Query-handle closure: a note's query handle is its own chunk. An email has
// no indexed source chunk, so a foreign handle must never be closure-added:
// it cannot be supplemented, so the catalog supplement would fail closed
// (selected-catalog-supplement-missing) for a legitimate email.
// ---------------------------------------------------------------------------
check("an email ranking with a foreign query handle never closure-adds it", () => {
  const fixture = emailFixture();
  const taskKey = Object.keys(fixture.rankings)[0];
  fixture.rankings[taskKey].queryHandleEvidenceId = "ev-foreign-handle";
  const selection = taskWorkflowSelectTaskRelevantEvidence(fixture.rankings, {
    sourceContract: fixture.contract,
    settings: DEFAULT_SETTINGS
  });
  const perTask = selection.perTask[taskKey] || {};
  assert.ok(
    !selection.selectedEvidenceIds.includes("ev-foreign-handle"),
    `the foreign query handle must not be selected, got ${JSON.stringify(selection.selectedEvidenceIds)}`
  );
  assert.deepStrictEqual(perTask.closureAdded || [], [], "the foreign query handle must not be closure-added");
  assert.equal(selection.dispatchAllowed, true, `the email must dispatch, errors: ${JSON.stringify(selection.protectedReferenceErrors)}`);
});

check("an email ranking with a query handle inside the corpus keeps it", () => {
  const fixture = emailFixture();
  const taskKey = Object.keys(fixture.rankings)[0];
  fixture.rankings[taskKey].queryHandleEvidenceId = "ev-bulk-0-0";
  const selection = taskWorkflowSelectTaskRelevantEvidence(fixture.rankings, {
    sourceContract: fixture.contract,
    settings: DEFAULT_SETTINGS
  });
  const perTask = selection.perTask[taskKey] || {};
  assert.equal(perTask.queryHandleEvidenceId, "ev-bulk-0-0", "a real corpus row stays the query handle");
  assert.ok(selection.selectedEvidenceIds.includes("ev-bulk-0-0"), "the real corpus row must stay selected");
});

if (failures.length) {
  console.error(`${failures.length} email-evidence-selection check(s) failed`);
  process.exit(1);
}
console.log("PASS: email evidence selection parity");
