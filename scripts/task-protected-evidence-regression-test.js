"use strict";

// Protected-evidence regression guards (0.9.3/0.9.7/0.9.11/0.9.12): each check
// reproduces a released bug through the real extraction/validation chain and
// must PASS on current code — this file guards, it does not fix.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

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
    requestUrl() { throw new Error("network disabled - requestUrl must not be called"); }
  };
};

let pluginApi;
try {
  testModule._compile(
    `${mainSource}\nmodule.exports.__testProtectedEvidenceRegression = {\n` +
      "  stripGeneratedActionItemsSection, buildTaskSourceContract, buildTaskEvidenceCatalog,\n" +
      "  explicitNoteActionMarkers, sourceContractSourceText, chunkMarkdown,\n" +
      "  normalizeMarkedActionText, validateChatEvidenceCitations, chatSourceLedger,\n" +
      "  taskWorkflowContextBundle, resolveTaskWorkflowReferences,\n" +
      "  deterministicMarkedActionTaskTrees, semanticMetadataOnlyUnit,\n" +
      "  taskWorkflowIsCurrentSourcePrimaryEvidence, taskWorkflowCurrentSourcePrimaryIdentity\n" +
      "};\n",
    mainPath
  );
  pluginApi = testModule.exports;
} finally {
  Module._load = originalLoad;
  delete require.cache[mainPath];
}

const {
  stripGeneratedActionItemsSection, buildTaskSourceContract, buildTaskEvidenceCatalog,
  explicitNoteActionMarkers, sourceContractSourceText, chunkMarkdown,
  normalizeMarkedActionText, validateChatEvidenceCitations, chatSourceLedger,
  taskWorkflowContextBundle, resolveTaskWorkflowReferences,
  deterministicMarkedActionTaskTrees, semanticMetadataOnlyUnit,
  taskWorkflowIsCurrentSourcePrimaryEvidence, taskWorkflowCurrentSourcePrimaryIdentity
} = pluginApi.__testProtectedEvidenceRegression;

const settings = Object.assign({}, pluginApi.DEFAULT_SETTINGS);
const failures = [];
function check(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); }
  catch (error) { failures.push(`${name}: ${error && error.message || error}`); console.error(`FAIL: ${name}: ${error && error.message || error}`); }
}

// 0.9.7: properties alias must not start a skipped section or shift actions.
check("properties alias does not shift action lines", () => {
  const raw = ["---", "aliases: [\"Project: #Name\"]", "---", "# My Note", "", "## Tasks", "- [ ] do X"].join("\n");
  const stripped = stripGeneratedActionItemsSection(raw);
  assert.deepEqual(stripped.split("\n").slice(0, 5), raw.split("\n").slice(0, 5));
  assert.deepEqual(explicitNoteActionMarkers(raw.split("\n").slice(0, 3).join("\n"), settings), []);
  const contract = buildTaskSourceContract({ type: "note", title: "t", path: "t.md" }, raw, settings);
  assert.equal(contract.explicitMarkers.length, 1);
  assert.equal(contract.explicitMarkers[0].line, 7);
  assert.equal(contract.explicitMarkers[0].action, "do X");
  const span = chunkMarkdown(raw).sourceLineRanges.find((range, i) => chunkMarkdown(raw)[i].includes("do X"));
  assert.ok(span && span.lineStart <= 7 && 7 <= span.lineEnd);
});

// 0.9.11: the email's own source text is evidence for every scope of that email.
check("email self text is evidence for every scope", () => {
  const text = "Hello team, please review the attached budget and confirm the venue.";
  const source = { type: "email", title: "Budget review", path: "Email_26_10_01_Subject.md", sourceId: "src-email-1", primaryEvidenceId: "evidence-email-primary" };
  const contract = buildTaskSourceContract(source, text, settings);
  const catalog = buildTaskEvidenceCatalog(contract, [], settings, { source, sourceSummary: text });
  const primary = catalog.items.find((item) => item.evidenceId === contract.primaryEvidenceId);
  assert.ok(taskWorkflowIsCurrentSourcePrimaryEvidence(primary, taskWorkflowCurrentSourcePrimaryIdentity(contract)));
  const mk = (id, scope) => ({ id, taskId: id, content: id, scope_id: scope, evidence_ids: [contract.primaryEvidenceId], fact_refs: [], fact_bindings: [], subtasks: [] });
  const bundle = taskWorkflowContextBundle({ source, sourceType: "email", sourceTitle: source.title, sourcePath: source.path, sourceSummary: text, sourceContract: contract, evidenceCatalog: catalog, semanticContext: [], tasks: [mk("t1", contract.scopeIds[0]), mk("t2", "scope-wrong-label")], taskEvidenceRefs: { t1: [contract.primaryEvidenceId], t2: [contract.primaryEvidenceId] }, taskEvidenceScopes: { t1: contract.scopeIds[0], t2: "scope-wrong-label" }, settings });
  assert.equal(bundle.contextBundleValidation.dispatchAllowed, true);
  assert.deepEqual(bundle.contextBundleValidation.foreignReferenceErrors, []);
  const resolved = resolveTaskWorkflowReferences([mk("t1", contract.scopeIds[0]), mk("t2", "scope-wrong-label")], contract, catalog, { allowLegacyFactBindings: false });
  for (const task of resolved.tasks) assert.ok(task.evidence_ids.includes(contract.primaryEvidenceId), `${task.id} keeps the email primary evidence`);
});

// 0.9.3: a front-matter/tags-only note yields no protected evidence, no block.
check("front-matter-only note skipped", () => {
  const fm = ["---", "title: Empty", "tags: [#MeetingNotes]", "---", "rrTags: #MeetingNotes"].join("\n");
  const source = { type: "note", title: "Empty", path: "Notes/Empty.md" };
  const units = chunkMarkdown(fm);
  assert.equal(units.semanticUnitKinds[0], "frontmatter");
  const chunks = units.map((chunkText, i) => ({ id: `fm-${i}`, evidenceId: `evidence-fm-${i}`, path: source.path, title: source.title, text: chunkText, semanticUnitKind: units.semanticUnitKinds[i], metadataOnly: units.semanticMetadataOnlyFlags[i] === true, evidenceEligibility: units.semanticEvidenceEligibilities[i], lineStart: units.sourceLineRanges[i] }));
  assert.ok(chunks.every((chunk) => semanticMetadataOnlyUnit(chunk)));
  const contract = buildTaskSourceContract(source, fm, settings);
  assert.deepEqual(contract.explicitMarkers, []);
  assert.deepEqual(deterministicMarkedActionTaskTrees([], fm, settings), []);
  const catalog = buildTaskEvidenceCatalog(contract, chunks, settings, { source, sourceSummary: fm });
  assert.deepEqual(catalog.telemetry.metadataOnlyRejectedEvidenceIds.slice().sort(), ["evidence-fm-0", "evidence-fm-1"]);
  assert.ok(!catalog.items.some((item) => item.evidenceId.startsWith("evidence-fm-")));
  const bundle = taskWorkflowContextBundle({ source, sourceType: "note", sourceTitle: source.title, sourcePath: source.path, sourceSummary: fm, sourceContract: contract, evidenceCatalog: catalog, semanticContext: [], tasks: [], taskEvidenceRefs: {}, taskEvidenceScopes: {}, settings });
  assert.equal(bundle.contextBundleValidation.dispatchAllowed, true);
  for (const id of ["evidence-fm-0", "evidence-fm-1"]) assert.ok(!bundle.providerEvidenceProjection.protectedEvidenceIds.includes(id));
});

// 0.9.12: every retrieved chunk of the active note stays citable, not just chunk 1.
check("every chunk of active note citable", () => {
  const activeChunks = [1, 2, 3].map((n) => ({ path: "Notes/Active.md", title: "Active", sourceKind: "note", sourceId: "src-active", evidenceId: `ev-active-${n}`, text: `Active paragraph ${n}` }));
  const ledger = chatSourceLedger({ path: "Notes/Active.md", title: "Active", text: "Active full" }, activeChunks, settings, null);
  assert.ok(["ev-active-1", "ev-active-2", "ev-active-3"].every((id) => ledger.some((entry) => entry.evidenceId === id && entry.url)));
  const result = validateChatEvidenceCitations(JSON.stringify({ claims: [{ text: "The third paragraph covers the budget.", evidence_ids: ["ev-active-3"] }] }), ledger, {});
  assert.equal(result.telemetry.supportedClaimCount, 1);
  assert.equal(result.telemetry.invalidEvidenceClaimCount, 0);
  assert.match(result.answer, /ev-active-3|Active\.md|budget/);
});

// Marker-detection and ledger paths agree through normalizeMarkedActionText.
check("normalizers agree on marked action", () => {
  const inputs = ["Buy milk", "TODO: call Bob", "Buy milk.", "Please buy milk", "When X arrives, do Y", "🎉 Buy milk", "Buy milk #tag", "Buy milk [[Shopping]]"];
  const pinned = { "Buy milk.": "Buy milk", "Please buy milk": "buy milk", "When X arrives, do Y": "do Y When X arrives" };
  for (const input of inputs) {
    const contract = buildTaskSourceContract({ type: "note", title: "t", path: "t.md" }, `- [ ] ${input}`, settings);
    assert.equal(contract.explicitMarkers.length, 1, `${input}: one marker`);
    const catalog = buildTaskEvidenceCatalog(contract, [], settings, { source: { type: "note", title: "t", path: "t.md" }, sourceSummary: `- [ ] ${input}` });
    const fact = catalog.items.flatMap((item) => item.structuredFacts || []).find((entry) => entry.kind === "marked-action");
    assert.ok(fact, `${input}: ledger carries the marked-action fact`);
    assert.equal(normalizeMarkedActionText(contract.explicitMarkers[0].action), normalizeMarkedActionText(fact.value), `${input}: paths agree`);
    if (pinned[input]) assert.equal(normalizeMarkedActionText(fact.value), pinned[input], `${input}: pinned normalization`);
  }
});

if (failures.length) throw new Error(`task protected-evidence regression test failed (${failures.length}):\n- ${failures.join("\n- ")}`);
console.log("task protected-evidence regression test: pass");
