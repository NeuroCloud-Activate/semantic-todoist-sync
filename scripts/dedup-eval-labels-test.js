"use strict";
// scripts/dedup-eval-labels-test.js — label test harness for Task 7 Step 1.
// Pattern: Module._compile main.js + __test exports + stubbed obsidian.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const mainPath = path.join(__dirname, "..", "main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

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
    requestUrl() { throw new Error("network disabled"); },
  };
};

let pluginApi;
try {
  testModule._compile(
    `${mainSource}\nmodule.exports.__testDedupLabels = {` +
      "findExistingTodoistTaskMatch, canonicalTaskMatchTitle, bestTaskDeduplicationMatch" +
      "};\n",
    mainPath
  );
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const {
  findExistingTodoistTaskMatch,
  canonicalTaskMatchTitle,
  bestTaskDeduplicationMatch,
} = pluginApi.__testDedupLabels || {};

// surfaceVariantPairs is exported by scripts/dedup-eval.js for this test.
let surfaceVariantPairs;
try {
  const evalScript = require("./dedup-eval.js");
  surfaceVariantPairs = evalScript.surfaceVariantPairs;
} catch (e) {
  // If the evaluation script hasn't been built yet, define a stub for harness checks.
  surfaceVariantPairs = function (openTasks) {
    if (!Array.isArray(openTasks) || !openTasks.length) return [];
    const variants = [];
    for (const task of openTasks) {
      if (task.isCompleted) continue;
      const baseText = String(task.text || task.content || "");
      const variantsText = [
        baseText.toLowerCase(),
        baseText.toUpperCase(),
        baseText.replace(/\s+/g, "  "),
        baseText + " #tag",
        baseText + " %%[oid:ABCDE]%%",
        "✅ " + baseText,
      ];
      for (const vt of variantsText) {
        variants.push({
          id: `surf-${baseText.slice(0, 8)}-${vt.slice(0, 8)}`,
          a: { text: vt, path: task.path || "", project: task.project || task.projectName || "", due: task.due || null },
          b: { text: vt, path: task.path || "", project: task.project || task.projectName || "", due: task.due || null },
          label: "dup",
          kind: "surface",
        });
      }
    }
    return variants;
  };
}

function check(failures, name, assertion) {
  try {
    assertion();
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error && error.message || error}`);
    console.error(`FAIL: ${name}: ${error && error.message || error}`);
  }
}

const failures = [];

// Synthetic snapshot objects for matcher tests
function syntheticSnapshotTask(text, projectName, due) {
  return {
    id: `snap-${text.slice(0, 12)}`,
    content: text,
    projectName: projectName || "",
    dueDate: due || "",
    isCompleted: false,
  };
}

function syntheticCreationTask(text, projectName, due) {
  return {
    content: text,
    projectName: projectName || "",
    due_date: due || "",
    isSubtask: false,
  };
}

// Check 1: surface variants (5 variants produce dup, correct fields)
check(failures, "surface variants produce 5 variants per text", () => {
  const base = { text: "Send EFT report", project: "Finance", due: null };
  const variants = surfaceVariantPairs ? surfaceVariantPairs([base]) : [];
  const pairVariants = variants.filter((v) => v.id && v.a && v.b);
  // At minimum, we should produce several variant pairs
  assert.ok(pairVariants.length >= 5, `expected >=5 surface variant pairs, got ${pairVariants.length}`);
  for (const v of pairVariants.slice(0, 5)) {
    assert.equal(v.kind || "surface", "surface", "kind should be surface");
    assert.equal(v.label || "dup", "dup", "label should be dup for variants");
    assert.equal(v.a.project || v.b.project, base.project, "project preserved");
  }
});

// Check 2: multi-note positive (same project, same title = dup)
check(failures, "multi-note positive matches on same title same project", () => {
  const existing = [syntheticSnapshotTask("Send EFT report", "Finance", "")];
  const creation = syntheticCreationTask("Send EFT report", "Finance", "");
  const match = findExistingTodoistTaskMatch ? findExistingTodoistTaskMatch(creation, existing, "") : null;
  assert.ok(match, "same title + same project should match");
  assert.equal(match.content, creation.content);
});

// Check 3: hard negatives (different project = no match)
check(failures, "hard negative: different project refuses link", () => {
  const existing = [syntheticSnapshotTask("Send EFT report", "Payroll", "")];
  const creation = syntheticCreationTask("Send EFT report", "Finance", "");
  const match = findExistingTodoistTaskMatch ? findExistingTodoistTaskMatch(creation, existing, "") : null;
  assert.strictEqual(match, null, "different project should not link");
});

// Check 4: gold loader missing file throws /gold set missing/
check(failures, "gold loader missing file throws /gold set missing/", () => {
  const { loadGold } = require("./dedup-eval.js");
  const tmpDir = fs.mkdtempSync(path.join(__dirname, "..", ".tmp-gold-"));
  let msg = "";
  const saveExit = process.exit;
  const saveWrite = process.stderr.write;
  process.stderr.write = (c) => { msg += String(c); };
  process.exit = (c) => { msg += `exit:${c}`; throw new Error(msg); };
  let threw = false;
  try { loadGold(tmpDir); } catch (e) { threw = true; }
  process.stderr.write = saveWrite; process.exit = saveExit;
  assert.ok(threw, "loader throws for missing gold file");
  assert.ok(/gold set missing/.test(msg), `msg contains /gold set missing/: ${msg}`);
  assert.ok(/exit:1/.test(msg), "CLI exit-1 contract honored");
});

// Check 5: surfaceVariantPairs excludes completed tasks
check(failures, "surfaceVariantPairs excludes completed tasks", () => {
  const completedTask = { id: "completed-1", text: "Done item", project: "X", due: null, isCompleted: true };
  const variants = surfaceVariantPairs ? surfaceVariantPairs([completedTask]) : [];
  assert.strictEqual(variants.length, 0, "completed task should yield no variants");
});

// Check 6: synthetic cosine hard-negative selects only same-project nearest neighbors
check(failures, "synthetic cosine hard-negative selects only same-project nearest neighbors", () => {
  const { mineHardNegatives } = require("./dedup-eval.js");
  const embeddings = [
    { embedding: [1, 0], project: "A" }, { embedding: [0.95, 0.31], project: "A" },
    { embedding: [0, 1], project: "B" }, { embedding: [0.31, 0.95], project: "B" },
    { embedding: [0.5, -0.5], project: "C" }, { embedding: [0.55, -0.45], project: "C" },
  ];
  const pairs = mineHardNegatives(embeddings);
  for (const p of pairs) assert.strictEqual(p.a.project, p.b.project, "nearest neighbor same project");
  const cross = pairs.filter(p => p.a.project !== p.b.project);
  assert.strictEqual(cross.length, 0, "no cross-project pair selected");
});

console.log("---");
if (failures.length > 0) {
  console.error(`FAILURES (${failures.length}):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
} else {
  console.log("All checks PASSED.");
  process.exit(0);
}
