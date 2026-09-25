"use strict";

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
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
    requestUrl() {}
  };
};

const Plugin = require("../main.js");
Module._load = originalLoad;

const buildTaskSourceContract = Plugin.buildTaskSourceContract;
const settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { noteActionMarkerTags: ["#todo"] });
assert.strictEqual(typeof buildTaskSourceContract, "function", "the real source-contract builder must be exported");

function contractFor(text, name) {
  const source = { type: "note", title: name, path: `${name}.md` };
  return buildTaskSourceContract(source, text, settings);
}

function markedScopes(contract) {
  return contract.scopes.filter((scope) => scope.family === "marked-action");
}

function markerFact(contract, marker) {
  return contract.facts.find((fact) => fact.kind === "marked-action" && fact.factId === marker.factId);
}

const checkboxContract = contractFor("- [ ] Prepare the committee briefing", "Checkbox action");
assert.strictEqual(checkboxContract.explicitMarkers.length, 1, "an unchecked checkbox must create one explicit marker");
const checkboxMarker = checkboxContract.explicitMarkers[0];
assert.strictEqual(checkboxMarker.line, 1, "the checkbox marker must retain its one-based source line");
assert.strictEqual(checkboxMarker.action, "Prepare the committee briefing", "the action must be the exact checkbox body");
assert.strictEqual(markedScopes(checkboxContract).length, 1, "the unchecked checkbox must have one marked-action scope");
const checkboxScope = markedScopes(checkboxContract)[0];
assert.strictEqual(checkboxMarker.scopeId, checkboxScope.scopeId, "the marker must point to its action scope");
assert.deepStrictEqual(checkboxScope.lines, [1], "the action scope must keep the exact checkbox source line");
const checkboxFact = markerFact(checkboxContract, checkboxMarker);
assert.ok(checkboxFact, "the checkbox action must have a canonical marked-action fact");
assert.deepStrictEqual(checkboxFact.mandatoryFor, ["task", "description", "identity"], "the action fact must remain mandatory for its task, description, and identity");
assert.ok(checkboxScope.mandatoryTaskFactIds.includes(checkboxFact.factId), "the action fact must be mandatory for task validation in its scope");
assert.ok(checkboxScope.mandatoryIdentityFactIds.includes(checkboxFact.factId), "the action fact must be mandatory for identity validation in its scope");
console.log("PASS: unchecked checkbox becomes an exact mandatory action scope");

const dedupedContract = contractFor("- [ ] #todo Prepare the committee briefing", "Checkbox with configured tag");
assert.strictEqual(dedupedContract.explicitMarkers.length, 1, "a checkbox line with #todo must yield one marker");
assert.strictEqual(markedScopes(dedupedContract).length, 1, "a checkbox line with #todo must yield one action scope");
assert.strictEqual(dedupedContract.explicitMarkers[0].action, "Prepare the committee briefing", "the combined marker must preserve the configured-tag action text");
assert.deepStrictEqual(markedScopes(dedupedContract)[0].markerTags, ["#todo"], "the existing configured tag identity must be preserved");
console.log("PASS: checkbox and configured #todo on one line are deduplicated");

const trailingTagContract = contractFor("- [ ] Prepare the briefing #todo", "Checkbox with trailing configured tag");
const embeddedTagContract = contractFor("- [ ] Prepare the briefing #todo by Friday", "Checkbox with embedded configured tag");
const checkboxTagFailures = [];
for (const [name, contract, expectedAction] of [
  ["trailing #todo", trailingTagContract, "Prepare the briefing"],
  ["embedded #todo", embeddedTagContract, "Prepare the briefing by Friday"]
]) {
  try {
    assert.strictEqual(contract.explicitMarkers.length, 1, `${name}: checkbox action must yield one marker`);
    assert.strictEqual(markedScopes(contract).length, 1, `${name}: checkbox action must yield one scope`);
    assert.strictEqual(contract.explicitMarkers[0].action, expectedAction, `${name}: complete action text must survive tag position`);
    assert.deepStrictEqual(markedScopes(contract)[0].markerTags, ["#todo"], `${name}: configured tag identity must survive`);
  } catch (error) {
    checkboxTagFailures.push(`${name}: ${error.message}`);
  }
}
if (checkboxTagFailures.length) {
  for (const failure of checkboxTagFailures) console.error(`FAIL: ${failure}`);
  throw new Error(`${checkboxTagFailures.length} checkbox/tag edge cases failed`);
}
console.log("PASS: trailing and embedded #todo preserve one complete checkbox action scope");

const standaloneMultiTagContract = contractFor("#todo Prepare the summary #todo Review the appendix", "Standalone multiple action tags");
assert.deepStrictEqual(standaloneMultiTagContract.explicitMarkers.map((marker) => marker.action), ["Prepare the summary", "Review the appendix"], "standalone multiple #todo markers must remain separate actions");

const continuationContract = contractFor("- [ ] #todo\nPrepare the committee briefing", "Checkbox tag with continuation action");
const malformedCheckboxContract = contractFor("- [] Prepare the committee briefing", "Malformed checkbox marker");
const continuationFailures = [];
for (const [name, contract, expectedCount] of [
  ["tag-only checkbox fallback", continuationContract, 1],
  ["empty-bracket list item", malformedCheckboxContract, 0]
]) {
  try {
    assert.strictEqual(contract.explicitMarkers.length, expectedCount, `${name}: marker count`);
    if (expectedCount) {
      assert.strictEqual(contract.explicitMarkers[0].tag, "#todo", `${name}: configured tag identity`);
      assert.strictEqual(contract.explicitMarkers[0].action, "Prepare the committee briefing", `${name}: complete action text`);
      assert.strictEqual(contract.explicitMarkers[0].line, 1, `${name}: marker line stays on the checkbox`);
      assert.deepStrictEqual(markedScopes(contract)[0].markerTags, ["#todo"], `${name}: scope keeps configured tag identity`);
    }
  } catch (error) {
    continuationFailures.push(`${name}: ${error.message}`);
  }
}
if (continuationFailures.length) {
  for (const failure of continuationFailures) console.error(`FAIL: ${failure}`);
  throw new Error(`${continuationFailures.length} checkbox fallback/syntax cases failed`);
}
console.log("PASS: tag-only checkbox fallback and strict checkbox syntax");

const headingStopContract = contractFor("- [ ] #todo\n# Next topic\nPrepare the committee briefing", "Checkbox tag stops at heading");
assert.strictEqual(headingStopContract.explicitMarkers.length, 0, "checkbox fallback must not cross a heading");
const markerStopContract = contractFor("- [ ] #todo\n#todo Review the appendix", "Checkbox tag stops at another marker");
assert.deepStrictEqual(markerStopContract.explicitMarkers.map((marker) => [marker.line, marker.action]), [[2, "Review the appendix"]], "checkbox fallback must stop at another configured marker");

const checkboxBeforeCheckboxContract = contractFor("- [ ] #todo\n- [ ] Second task", "Checkbox tag stops at next checkbox");
const tagBeforeCheckboxContract = contractFor("#todo\n- [ ] Second task", "Tag stops at next checkbox");
const checkboxBeforeCheckedContract = contractFor("- [ ] #todo\n- [x] Completed task", "Checkbox tag stops at checked item");
const tagBeforeCheckedContract = contractFor("#todo\n- [x] Completed task", "Tag stops at checked item");
const checkboxBoundaryFailures = [];
for (const [name, contract, expected] of [
  ["checkbox fallback before unchecked checkbox", checkboxBeforeCheckboxContract, [[2, "Second task"]]],
  ["tag fallback before unchecked checkbox", tagBeforeCheckboxContract, [[2, "Second task"]]],
  ["checkbox fallback before checked checkbox", checkboxBeforeCheckedContract, []],
  ["tag fallback before checked checkbox", tagBeforeCheckedContract, []]
]) {
  try {
    assert.deepStrictEqual(contract.explicitMarkers.map((marker) => [marker.line, marker.action]), expected, `${name}: markers must not absorb an adjacent checkbox`);
    assert.strictEqual(markedScopes(contract).length, expected.length, `${name}: each active checkbox must have exactly one scope`);
  } catch (error) {
    checkboxBoundaryFailures.push(`${name}: ${error.message}`);
  }
}
if (checkboxBoundaryFailures.length) {
  for (const failure of checkboxBoundaryFailures) console.error(`FAIL: ${failure}`);
  throw new Error(`${checkboxBoundaryFailures.length} adjacent-checkbox boundaries failed`);
}
console.log("PASS: tag fallback stops before adjacent checked or unchecked checkboxes");

const tagSemanticsContract = contractFor("#todoist this line is not a configured action\n- [ ] #todoist Review the response", "Checkbox tag semantics");
assert.deepStrictEqual(tagSemanticsContract.explicitMarkers.map((marker) => marker.line), [2], "#todoist alone must not act as #todo, while its unchecked checkbox remains active");
assert.strictEqual(tagSemanticsContract.explicitMarkers[0].action, "#todoist Review the response", "an unconfigured tag spelling must remain part of checkbox action text");
const checkedContract = contractFor("- [x] Archive the committee briefing", "Checked checkbox");
assert.strictEqual(checkedContract.explicitMarkers.length, 0, "a checked checkbox alone must not create an active action marker");
console.log("PASS: configured tag matching stays exact and checked boxes are inactive");

const datedContract = contractFor([
  "- [ ] Submit the report 📅 2026-10-15 {{2026-10-20}}",
  "- [ ] Review the response 📅 2026-10-22 {{2026-10-29}}"
].join("\n"), "Checkbox date ownership");
assert.strictEqual(markedScopes(datedContract).length, 2, "each unchecked sibling checkbox must have its own action scope");
const [submitMarker, reviewMarker] = datedContract.explicitMarkers;
const submitDue = datedContract.facts.find((fact) => fact.kind === "due-date" && fact.value === "2026-10-15");
const reviewDue = datedContract.facts.find((fact) => fact.kind === "due-date" && fact.value === "2026-10-22");
const submitDeadline = datedContract.facts.find((fact) => fact.kind === "deadline" && fact.value === "2026-10-20");
const reviewDeadline = datedContract.facts.find((fact) => fact.kind === "deadline" && fact.value === "2026-10-29");
assert.ok(submitDue && reviewDue && submitDeadline && reviewDeadline, "each inline due date and deadline must remain represented as a fact");
assert.strictEqual(submitDue.scopeId, submitMarker.scopeId, "the first inline due date must belong to the first checkbox action");
assert.strictEqual(submitDeadline.scopeId, submitMarker.scopeId, "the first inline deadline must belong to the first checkbox action");
assert.strictEqual(reviewDue.scopeId, reviewMarker.scopeId, "the second inline due date must belong to the second checkbox action");
assert.strictEqual(reviewDeadline.scopeId, reviewMarker.scopeId, "the second inline deadline must belong to the second checkbox action");
assert.ok(![submitDue, reviewDue, submitDeadline, reviewDeadline].some((fact) => fact.scopeId === datedContract.sourceScopeId), "inline dates must not fall back to the generic source scope");
console.log("PASS: inline dates stay bound to their owning sibling action scopes");

process.stdout.write(JSON.stringify({ passed: 7, failed: 0 }, null, 2) + "\n");
