"use strict";
// Checks the semanticNoteCap option of taskWorkflowSelectScoreEvidence (main.js):
//  - cap off (default) is byte-identical to the previous selector on random corpora;
//  - cap 1 keeps at most one chunk per note in the semantic window and still fills it;
//  - lexicalLimit option is honoured.
// The "previous selector" is HEAD's main.js (git show), so this test also guards drift.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Module = require("node:module");

const rootDir = path.join(__dirname, "..");

function load(source, name) {
  const filename = path.join(os.tmpdir(), name);
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(rootDir);
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
    class Empty {}
    return { ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty, TFile: Empty, setIcon() {}, requestUrl() { throw new Error("net disabled"); } };
  };
  try {
    compiled._compile(source + "\nmodule.exports.__capTest = { taskWorkflowSelectScoreEvidence, taskWorkflowSelectTaskRelevantEvidence };\n", filename);
  } finally {
    Module._load = originalLoad;
  }
  return compiled.exports.__capTest;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["budget", "grant", "review", "panel", "jim", "aditi", "report", "deadline", "invoice", "meeting", "ubc", "irgp", "beap", "notes", "follow"];
function corpus(rand, nNotes, chunksPerNote) {
  const rows = [];
  for (let n = 0; n < nNotes; n++) {
    const count = 1 + Math.floor(rand() * chunksPerNote);
    for (let c = 0; c < count; c++) {
      const words = Array.from({ length: 6 + Math.floor(rand() * 6) }, () => WORDS[Math.floor(rand() * WORDS.length)]);
      rows.push({
        evidenceId: `e-${n}-${c}`,
        path: `Notes/n${n}.md`,
        text: words.join(" "),
        score: 0.2 + rand() * 0.7,
        lineStart: c * 3 + 1,
        lineEnd: c * 3 + 3
      });
    }
  }
  return rows;
}

function main() {
  const headSource = execFileSync("git", ["show", "HEAD:main.js"], { cwd: rootDir, maxBuffer: 1 << 28 }).toString("utf8");
  const oldSelect = load(headSource, "cap-test-head.js").taskWorkflowSelectScoreEvidence;
  const newModule = load(fs.readFileSync(path.join(rootDir, "main.js"), "utf8"), "cap-test-new.js");
  const newSelect = newModule.taskWorkflowSelectScoreEvidence;

  const rand = mulberry32(20261012);
  const pathOf = (rows) => new Map(rows.map((row) => [row.evidenceId, row.path]));

  // 1. cap off == old behaviour (and explicit cap 0 == old)
  for (let i = 0; i < 50; i++) {
    const rows = corpus(rand, 8 + Math.floor(rand() * 40), 4);
    const query = `${WORDS[Math.floor(rand() * WORDS.length)]} ${WORDS[Math.floor(rand() * WORDS.length)]} follow up`;
    const expected = oldSelect(rows, query);
    assert.deepEqual(newSelect(rows, query), expected, `cap default differs on corpus ${i}`);
    assert.deepEqual(newSelect(rows, query, { semanticNoteCap: 0 }), expected, `cap 0 differs on corpus ${i}`);
  }

  // 2. cap 1: at most one semantic-window chunk per note; window still full when enough notes exist
  let fullWindows = 0;
  for (let i = 0; i < 50; i++) {
    const rows = corpus(rand, 45, 6);
    const query = "budget review follow up";
    const result = newSelect(rows, query, { semanticNoteCap: 1, semanticLimit: 30, lexicalLimit: 20 });
    const paths = pathOf(rows);
    const semanticIds = Object.entries(result.reasonsById || {})
      .filter(([, reason]) => reason === "admitted-semantic-window")
      .map(([id]) => id);
    const perNote = new Map();
    for (const id of semanticIds) perNote.set(paths.get(id), (perNote.get(paths.get(id)) || 0) + 1);
    for (const [note, count] of perNote) assert.equal(count, 1, `note ${note} has ${count} semantic chunks with cap 1 (corpus ${i})`);
    if (semanticIds.length === 30) fullWindows++;
  }
  assert.ok(fullWindows >= 45, `cap 1 should fill the 30-slot window when 45 notes exist (full in ${fullWindows}/50)`);

  // 3. cap 1 gives more distinct notes than the old selector when one note dominates the top scores
  const dominated = [];
  for (let c = 0; c < 12; c++) dominated.push({ evidenceId: `d-${c}`, path: "Notes/hub.md", text: "alpha", score: 0.95 - c * 0.001, lineStart: 1, lineEnd: 2 });
  for (let n = 0; n < 40; n++) dominated.push({ evidenceId: `o-${n}`, path: `Notes/o${n}.md`, text: "beta", score: 0.5 - n * 0.001, lineStart: 1, lineEnd: 2 });
  const noCap = newSelect(dominated, "gamma");
  const capped = newSelect(dominated, "gamma", { semanticNoteCap: 1 });
  const distinct = (result) => new Set(result.evidenceIds.map((id) => pathOf(dominated).get(id))).size;
  assert.ok(distinct(capped) > distinct(noCap), `cap 1 should reach more notes (${distinct(capped)} vs ${distinct(noCap)})`);
  assert.equal(capped.evidenceIds.filter((id) => id.startsWith("d-")).length, 1, "hub note limited to one chunk");

  // 4. lexicalLimit honoured
  const rows = corpus(rand, 60, 3).map((row, i) => (i % 2 ? Object.assign({}, row, { text: `${row.text} zorblat` }) : row));
  const small = newSelect(rows, "zorblat", { lexicalLimit: 5, semanticLimit: 1 });
  const large = newSelect(rows, "zorblat", { lexicalLimit: 40, semanticLimit: 1 });
  assert.ok(large.evidenceIds.length > small.evidenceIds.length, "larger lexicalLimit should admit more chunks");

  // 5. wiring: the task workflow's own selector applies the cap (1 chunk/note) and the lexical window of 30
  //    (cap/window come from main.js constants at the call site, not from this test).
  const hub = [];
  for (let c = 0; c < 12; c++) hub.push({ evidenceId: `h-${c}`, adjustedSemantic: 0.95 - c * 0.001, rawSemanticScore: 0.95 - c * 0.001, text: "alpha", path: "Notes/hub.md", lineStart: c * 2 + 1, lineEnd: c * 2 + 2 });
  for (let n = 0; n < 60; n++) hub.push({ evidenceId: `w-${n}`, adjustedSemantic: 0.5 - n * 0.001, rawSemanticScore: 0.5 - n * 0.001, text: `beta note ${n}`, path: `Notes/w${n}.md`, lineStart: 1, lineEnd: 2 });
  const workflow = newModule.taskWorkflowSelectTaskRelevantEvidence({ t1: { scopeId: "s1", queryHandleEvidenceId: "", actionText: "gamma action", rows: hub } }, { sourceContract: {}, settings: {} });
  const scored = workflow.perTask.t1.moduleResults.scores.evidenceIds;
  assert.ok(scored.length > 0, "workflow selector returned no scored evidence");
  assert.equal(scored.filter((id) => id.startsWith("h-")).length, 1, "workflow selector must keep one chunk of the hub note");
  assert.ok(new Set(scored).size >= 30, "workflow selector should still fill its semantic window");

  console.log("task-evidence-note-cap-test: PASS");
}

main();
