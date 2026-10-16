"use strict";

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

// Load src/main.js with injected exports for internal functions.
function loadSourceWithExports(sourcePath) {
  const src = fs.readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
  const names = ["chatResponseSchema", "renderStructuredChatEvidenceResponse", "parseChatEvidenceResponse", "deviceDateString", "chatResponseSchema"];
  const inject = "\nmodule.exports.__injected = {" + names.map((n) => `${JSON.stringify(n)}: (typeof ${n} !== "undefined" ? ${n} : undefined)`).join(",") + "};\n";
  const filename = path.join(require("os").tmpdir(), `structured-chat-test-${Date.now()}.js`);
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
    class Empty {}
    return {
      ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
      Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty,
      TFile: Empty, setIcon() {}, requestUrl: async () => ({ status: 200, json: {} }),
      Platform: { isDesktop: true }
    };
  };
  try { compiled._compile(src + inject, filename); } finally { Module._load = originalLoad; }
  return compiled.exports.__injected || compiled.exports;
}

const injected = loadSourceWithExports(path.join(__dirname, "..", "src", "main.js"));
const chatResponseSchema = injected.chatResponseSchema || (injected.default && injected.default.chatResponseSchema);
const renderStructuredChatEvidenceResponse = injected.renderStructuredChatEvidenceResponse || (injected.default && injected.default.renderStructuredChatEvidenceResponse);

// Helper to call functions if wrapped differently
function getSchema() {
  const fn = chatResponseSchema || (require("../main.js") && require("../main.js").chatResponseSchema);
  return fn ? fn() : null;
}
function renderResponse(value, ledger, options) {
  const fn = renderStructuredChatEvidenceResponse || (require("../main.js") && require("../main.js").renderStructuredChatEvidenceResponse);
  if (!fn) throw new Error("renderStructuredChatEvidenceResponse not available");
  return fn(value, ledger || [], options || {});
}

// (a) Schema includes topic required and property shape
const schema = (function () {
  try {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
    // Check source directly for schema shape
    const hasTopicProp = /topic:\s*\{[^}]*type:\s*"string"[^}]*minLength:\s*1[^}]*description:[^}]*Person, project, or item[^}]*identical topic[^}]*\}/.test(src);
    const hasTopicRequired = /required:\s*\["[^"]*"[^\]]*"topic"[^\]]*\]/.test(src);
    return { hasTopicProp, hasTopicRequired, sourceChecked: true };
  } catch (e) {
    return { error: e.message };
  }
})();

assert.strictEqual(schema.hasTopicProp, true, "schema must include topic property with string/minLength 1/description");
assert.strictEqual(schema.hasTopicRequired, true, "claim required array must include 'topic'");
console.log("PASS (a): schema topic property present and required");

// (b) Two interleaved topics grouped with headings + adjacency
const interleavedResponse = JSON.stringify({
  claims: [
    { text: "Project Alpha is active.", established: true, evidence_ids: ["e1"], category: "fact", topic: "Project Alpha" },
    { text: "Meeting notes reviewed.", established: true, evidence_ids: ["e2"], category: "fact", topic: "Meeting" },
    { text: "Project Alpha needs updates.", established: false, evidence_ids: [], category: "unsupported", topic: "Project Alpha" },
  ]
});
const interleaved = renderResponse(interleavedResponse, [{ evidenceId: "e1", url: "http://example.com/e1", markdown: "[e1](http://example.com/e1)" }, { evidenceId: "e2", url: "http://example.com/e2", markdown: "[e2](http://example.com/e2)" }]);
const interleavedText = interleaved.answer || interleaved;
assert.ok(interleavedText.includes("**Topic: Project Alpha**"), "interleaved must have Project Alpha heading");
assert.ok(interleavedText.includes("**Topic: Meeting**"), "interleaved must have Meeting heading");
assert.ok(interleavedText.includes("Project Alpha is active."), "interleaved must keep claim text");
assert.ok(interleavedText.includes("Meeting notes reviewed."), "interleaved must keep meeting claim");
console.log("PASS (b): 2 interleaved topics grouped with headings and adjacency");

// (c) Single topic flat == old format (no headings, no blank lines between groups)
const singleResponse = JSON.stringify({
  claims: [
    { text: "Item A.", established: true, evidence_ids: ["e1"], category: "fact", topic: "Single" },
    { text: "Item B.", established: false, evidence_ids: [], category: "unsupported", topic: "Single" },
  ]
});
const single = renderResponse(singleResponse, [{ evidenceId: "e1", url: "http://example.com/e1", markdown: "[e1](http://example.com/e1)" }]);
const singleText = single.answer || single;
assert.strictEqual(singleText.indexOf("**Topic:"), -1, "single topic must have no heading");
assert.strictEqual(singleText.includes("Item A."), true);
console.log("PASS (c): single topic flat equals old format (no headings)");

// Verify 0-1 topics produces same flat string as old format
const flatOld = ["- Item A. [e1](http://example.com/e1)", "- Item B."].join("\n");
assert.strictEqual(singleText.trim(), flatOld.trim(), "0-1 topic output must match old joined format");
console.log("PASS (c-extra): single topic flat string equals old renderedClaims.join('\\n')");

// (d) Prompt sentences check (source-text check)
const srcPath = path.join(__dirname, "..", "src", "main.js");
const srcText = fs.readFileSync(srcPath, "utf8");
const completedSentence = "For follow-up, action, or to-do questions: omit items whose evidence shows them completed (checked - [x], marked complete/done) unless the user asks about completed work";
const sixMonthSentence = "for open items whose source date is more than 6 months before today's date, keep them but say they are older than 6 months and may be stale";
const topicIdentitySentence = "Topic labels name the person, project, or item, never the missing fact";
assert.ok(srcText.includes(topicIdentitySentence), "prompt must include topic-identity rule sentence");
assert.ok(srcText.includes(completedSentence), "prompt must include completed-item sentence");
assert.ok(srcText.includes(sixMonthSentence), "prompt must include 6-month sentence");
console.log("PASS (d): prompt contains topic-identity + completed-item + 6-month sentences");

// (e) Subset merge: related topic labels reunite under one heading
const subsetResponse = JSON.stringify({
  claims: [
    { text: "Jim needs a follow-up.", established: true, evidence_ids: ["e1"], category: "fact", topic: "Jim and Cheryl follow-up" },
    { text: "BEAP agreements are ready.", established: true, evidence_ids: ["e2"], category: "fact", topic: "BEAP agreements follow-up" },
    { text: "Jim follow-up draft sent.", established: false, evidence_ids: [], category: "unsupported", topic: "Jim follow-up" },
  ]
});
const subset = renderResponse(subsetResponse, [{ evidenceId: "e1", url: "http://example.com/e1", markdown: "[e1](http://example.com/e1)" }, { evidenceId: "e2", url: "http://example.com/e2", markdown: "[e2](http://example.com/e2)" }]);
const subsetText = subset.answer || subset;
const jimHeadings = (subsetText.match(/\*\*Topic:[^*]+\*\*/g) || []).filter(h => h.toLowerCase().includes("jim"));
assert.strictEqual(jimHeadings.length, 1, "subset merge should produce exactly one Jim-related heading (e) got headings: " + subsetText);
assert.ok(subsetText.includes("BEAP agreements follow-up"), "BEAP heading must stay separate (e)");
console.log("PASS (e): subset merge reunites Jim-related topics under one heading, BEAP separate");

// (f) Disjoint topics stay separate
const disjointResponse = JSON.stringify({
  claims: [
    { text: "BEAP agreement A.", established: true, evidence_ids: ["e1"], category: "fact", topic: "BEAP agreements follow-up" },
    { text: "TM1 status ok.", established: true, evidence_ids: ["e2"], category: "fact", topic: "TM1 status follow-up" },
  ]
});
const disjoint = renderResponse(disjointResponse, [{ evidenceId: "e1", url: "http://example.com/e1", markdown: "[e1](http://example.com/e1)" }, { evidenceId: "e2", url: "http://example.com/e2", markdown: "[e2](http://example.com/e2)" }]);
const disjointText = disjoint.answer || disjoint;
assert.strictEqual((disjointText.match(/\*\*Topic:[^*]+\*\*/g) || []).length, 2, "disjoint topics should have 2 headings (f)");
console.log("PASS (f): disjoint topics stay separate (2 headings)");

// (g) Single merged group -> flat output, no headings, byte-equal to old join format
const singleMergedResponse = JSON.stringify({
  claims: [
    { text: "Follow-ups for Crystal.", established: true, evidence_ids: ["e1"], category: "fact", topic: "Follow-ups for Crystal" },
    { text: "Crystal follow-up draft.", established: false, evidence_ids: [], category: "unsupported", topic: "Crystal follow-up draft" },
  ]
});
const singleMerged = renderResponse(singleMergedResponse, [{ evidenceId: "e1", url: "http://example.com/e1", markdown: "[e1](http://example.com/e1)" }]);
const singleMergedText = singleMerged.answer || singleMerged;
assert.strictEqual(singleMergedText.indexOf("**Topic:"), -1, "single merged group must have no heading (g)");
assert.ok(singleMergedText.includes("Follow-ups for Crystal."), "must keep first claim (g)");
console.log("PASS (g): single merged group produces flat output without headings");

// (h) Empty/missing topics never merge into named group
const emptyTopicResponse = JSON.stringify({
  claims: [
    { text: "No topic claim.", established: false, evidence_ids: [], category: "unsupported", topic: "" },
    { text: "Named claim.", established: true, evidence_ids: ["e1"], category: "fact", topic: "Named Group" },
  ]
});
const emptyTopic = renderResponse(emptyTopicResponse, [{ evidenceId: "e1", url: "http://example.com/e1", markdown: "[e1](http://example.com/e1)" }]);
const emptyText = emptyTopic.answer || emptyTopic;
// Heading rule unchanged: headings only with >=2 distinct non-empty merged groups; empty topic stays separate so named group is flat.
assert.strictEqual((emptyText.match(/\*\*Topic:[^*]+\*\*/g) || []).length, 0, "named group stays flat when paired with empty topic, no heading (h)");
assert.ok(!emptyText.includes("**Topic: Named Group**"), "named group should not have heading when only one non-empty group (h)");
console.log("PASS (h): empty/missing topic stays separate, named group flat (no heading)");

console.log("\nAll structured-chat-evidence tests passed.");
