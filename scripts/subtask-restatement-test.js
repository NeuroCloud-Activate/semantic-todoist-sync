"use strict";
// limitGeneratedTasks must never keep a subtask that only restates its parent (or an earlier sibling),
// and must keep genuinely distinct steps, subtasks with their own identity/schedule, and ownership steps.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const rootDir = path.join(__dirname, "..");

function load() {
  const filename = path.join(os.tmpdir(), "subtask-restatement-main.js");
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
    compiled._compile(fs.readFileSync(path.join(rootDir, "main.js"), "utf8") + "\nmodule.exports.__restate = { limitGeneratedTasks };\n", filename);
  } finally {
    Module._load = originalLoad;
  }
  return compiled.exports.__restate.limitGeneratedTasks;
}

const limit = load();
const contents = (task) => (task.subtasks || []).map((s) => s.content);
const make = (content, subs, extra = {}) => Object.assign({ content, subtasks: subs.map((c) => (typeof c === "string" ? { content: c } : c)) }, extra);

// 1. real restatements seen in a live generation are removed
let out = limit([make("Draft ESTMTA transfer of funds agreements and final documents and review Aditi's drafted TOFs", [
  "Review the ESTMTA transfer of funds agreements Aditi drafted",
  "Draft the ESTMTA transfer of funds agreements and develop the final documents",
  "Incorporate the ESTMTA documents Crystal will forward"
])], 10, 4);
assert.deepEqual(contents(out[0]), ["Incorporate the ESTMTA documents Crystal will forward"]);

out = limit([make("Email Bill to identify the McMaster legal contact for Andrew Shih's agreement review", [
  "Ask Bill who the McMaster legal contact is for Andrew Shih's agreement",
  "Contact the McMaster legal contact to arrange Andrew Shih's agreement review"
])], 10, 4);
assert.deepEqual(contents(out[0]), ["Contact the McMaster legal contact to arrange Andrew Shih's agreement review"]);

out = limit([make("Update Travel Bursary program documents ahead of the RDPC meeting", [
  "Review and update the Travel Bursary program documents",
  "Prepare to discuss the Travel Bursary program updates at the RDPC meeting"
])], 10, 4);
assert.deepEqual(contents(out[0]), [], "both subtasks only reuse parent words");

// 2. distinct steps stay (new words that matter)
out = limit([make("Review all GFP renewal transfer of funds agreements", [
  "Verify that the acceptance of funding errors Crystal fixed are resolved",
  "Send Aditi the list of agreements that need changes"
])], 10, 4);
assert.equal(out[0].subtasks.length, 2);

// 3. sibling restatement: later sibling that only repeats an earlier one is dropped, first is kept
out = limit([make("Prepare the stipend payment package", [
  "Check the stipend requests with Aditi",
  "Aditi stipend requests check"
])], 10, 4);
assert.deepEqual(contents(out[0]), ["Check the stipend requests with Aditi"]);

// 4. identity / own schedule / ownership steps are never dropped by this rule
out = limit([make("Send the reminder email to adjuncts", [
  { content: "Send the reminder email to adjuncts", id: "t1" },
  { content: "Send the reminder email to adjuncts", due_date: "2026-03-02" }
], { due_date: "2026-03-01" })], 10, 4);
assert.equal(out[0].subtasks.length, 2, "existing Todoist subtask and separately scheduled subtask stay");

out = limit([Object.assign(make("Draft the budget", ["Draft the budget"]), { ownershipStepCount: 1 })], 10, 4);
assert.equal(out[0].subtasks.length, 1, "trailing ownership step kept past the restatement rule");

// 5. empty-term subtasks (only generic words) are kept, not silently removed; cap still applies
out = limit([make("Handle the DRG agreements", ["Follow up", "Review the Lazarus acceptance", "Check Pryzdial status", "Email Hari about CHEO", "Confirm March reply date"])], 10, 4);
assert.ok(out[0].subtasks.length <= 4, "regular subtask cap still applies");
assert.ok(out[0].subtasks.some((s) => s.content === "Follow up"), "generic-only subtask is not treated as a restatement");

// 6. real generated trees: no kept subtask restates its parent; baseline-style plans unchanged
const gen = path.join(process.env.TEMP || os.tmpdir(), "opencode", "live", "gen-new.json");
if (fs.existsSync(gen)) {
  const tasks = JSON.parse(fs.readFileSync(gen, "utf8")).tasks;
  const trees = [];
  for (const t of tasks) { if (t.depth === 0) trees.push(make(t.content, [])); else trees[trees.length - 1].subtasks.push({ content: t.content }); }
  const before = trees.reduce((a, t) => a + t.subtasks.length, 0);
  const after = limit(trees, 30, 15);
  const kept = after.reduce((a, t) => a + t.subtasks.length, 0);
  assert.ok(kept < before && kept >= before - 10, `live tree: ${before} -> ${kept}`);
  console.log(`live generated tree: ${before} subtasks -> ${kept}`);
}

// 7. cross-main restatement: a wrapper task's children that repeat OTHER main tasks are dropped
out = limit([make("Work through the January 8 prioritization list for ESTMTA briefing note, Crystal touchpoint, Don Branch DRG review, Travel Bursary", [
  "Book a touchpoint with Crystal for next week Wednesday or Thursday",
  "Complete the ESTMTA briefing note as priority 1",
  "Review the Don Branch DRG application to understand the changes",
  "Address the Travel Bursary item"
]), make("Revise the ESTMTA briefing note based on Sophie's comments", []), make("Review the Don Branch DRG application changes made for budget changes", []), make("Book a touchpoint with Crystal on a Wednesday or Thursday", [])], 10, 4);
const wrapper = out.find((t) => t.content.startsWith("Work through the January 8"));
assert.deepEqual(contents(wrapper), ["Book a touchpoint with Crystal for next week Wednesday or Thursday", "Address the Travel Bursary item"], "children repeating other main tasks are dropped, distinct children stay");
assert.equal(out.length, 4, "main tasks are never removed by the subtask rule");

// 8. the same child is kept when no other main task carries it
out = limit([make("Work through the January 8 prioritization list", ["Complete the ESTMTA briefing note as priority 1"])], 10, 4);
assert.equal(out[0].subtasks.length, 1, "no other main task to duplicate, so the child stays");

console.log("subtask-restatement-test: PASS");
