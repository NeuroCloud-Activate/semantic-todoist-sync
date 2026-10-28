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

// 0-1 topics read as one prose paragraph: no bullets, link after the sentence that cites it
assert.strictEqual(singleText.trim(), "Item A. [e1](http://example.com/e1) Item B.", "0-1 topic output is one prose paragraph");
console.log("PASS (c-extra): single topic reads as one prose paragraph");

// (c-links) A source cited by several sentences shows its link once, after the first sentence that cites it
const repeatResponse = JSON.stringify({
  claims: [
    { text: "The project has three tasks.", established: true, evidence_ids: ["e1", "e2"], category: "fact", topic: "Project" },
    { text: "One is to buy paper.", established: true, evidence_ids: ["e1"], category: "fact", topic: "Project" },
    { text: "Another is due Nov 2.", established: true, evidence_ids: ["e2", "e3"], category: "timing", topic: "Project" },
  ]
});
const repeatLedger = ["e1", "e2", "e3"].map((id) => ({ evidenceId: id, url: `http://example.com/${id}`, markdown: `[${id}](http://example.com/${id})` }));
const repeatText = (renderResponse(repeatResponse, repeatLedger).answer || "").trim();
assert.strictEqual(repeatText, "The project has three tasks. [e1](http://example.com/e1) [e2](http://example.com/e2) One is to buy paper. Another is due Nov 2. [e3](http://example.com/e3)", repeatText);
console.log("PASS (c-links): each source link shows once");

// (c-heads) With headings, each topic is one paragraph and a link shown under one topic is not repeated under another
const twoTopicText = (renderResponse(JSON.stringify({ claims: [
  { text: "Alpha is active.", established: true, evidence_ids: ["e1"], category: "fact", topic: "Project Alpha" },
  { text: "Alpha ships Friday.", established: true, evidence_ids: ["e1"], category: "timing", topic: "Project Alpha" },
  { text: "The meeting is set.", established: true, evidence_ids: ["e1", "e2"], category: "fact", topic: "Meeting" },
] }), repeatLedger).answer || "").trim();
assert.strictEqual(twoTopicText, "**Topic: Project Alpha**\nAlpha is active. [e1](http://example.com/e1) Alpha ships Friday.\n\n**Topic: Meeting**\nThe meeting is set. [e2](http://example.com/e2)", twoTopicText);
assert.ok(!/^- /m.test(twoTopicText), "no bullets");
console.log("PASS (c-heads): one paragraph per topic, links not repeated");

// (c-inline) A task or note named directly is linked in the sentence; evidence used only for context stays a source link after it
const inlineText = (renderResponse(JSON.stringify({ claims: [
  { text: "You have [buy printer paper](e1) and [email Alex](e2) open.", established: true, evidence_ids: ["e1", "e3"], category: "fact", topic: "Project" },
  { text: "The paper task came from a team note.", established: true, evidence_ids: ["e1", "e3"], category: "history", topic: "Project" },
  { text: "Ignore [ghost](e9) and [this](https://evil.example/x).", established: true, evidence_ids: [], category: "fact", topic: "Project" },
] }), repeatLedger).answer || "").trim();
assert.strictEqual(inlineText, "You have [buy printer paper](http://example.com/e1) and [email Alex](http://example.com/e2) open. [e3](http://example.com/e3) The paper task came from a team note. Ignore ghost and this.", inlineText);
console.log("PASS (c-inline): directly named items link inline, context stays a source, unknown ids and URLs stay plain text");
// (c-inline-later) A source linked inline later is not also shown as a source link on an earlier sentence
const laterText = (renderResponse(JSON.stringify({ claims: [
  { text: "The project lists two tasks.", established: true, evidence_ids: ["e1", "e2", "e3"], category: "fact", topic: "Project" },
  { text: "[Buy paper](e1) has no due date.", established: true, evidence_ids: ["e1"], category: "timing", topic: "Project" },
  { text: "[Email Alex](e2) is due Nov 2.", established: true, evidence_ids: ["e2"], category: "timing", topic: "Project" },
] }), repeatLedger).answer || "").trim();
assert.strictEqual(laterText, "The project lists two tasks. [e3](http://example.com/e3) [Buy paper](http://example.com/e1) has no due date. [Email Alex](http://example.com/e2) is due Nov 2.", laterText);
console.log("PASS (c-inline-later): inline-linked items are never repeated as source links");
// (c-inline-inject) Model text that mimics the internal link marker cannot break the answer or borrow a link
const injectText = (renderResponse(JSON.stringify({ claims: [
  { text: "See [\u00017] and [\u00010] and [Buy paper](e1).", established: true, evidence_ids: ["e1"], category: "fact", topic: "Project" },
] }), repeatLedger).answer || "").trim();
assert.ok(injectText.includes("[Buy paper](http://example.com/e1)"), injectText);
assert.strictEqual((injectText.match(/\]\(/g) || []).length, 1, injectText);
assert.ok(!injectText.includes("\u0001"), injectText);
console.log("PASS (c-inline-inject): fake link markers are ignored");

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
// (d-tone) Helpful, natural prose instead of a robotic list; still concise and grounded
assert.ok(srcText.includes("You are a helpful Obsidian sidebar assistant."), "helpful role sentence");
assert.ok(srcText.includes("read together as one short, connected answer"), "claims read as connected prose");
assert.ok(srcText.includes("vary how sentences begin"), "no repetitive sentence openings");
assert.ok(!srcText.includes("\"You are a concise Obsidian sidebar assistant.\""), "old robotic role sentence removed");
assert.ok(srcText.includes("Each claim must be one clear, factual sentence."), "claims stay factual");
console.log("PASS (d-tone): prompt asks for helpful, natural, concise prose");
assert.ok(srcText.includes("write its name once as a Markdown link to its exact evidence_id, like [name](evidence_id)"), "prompt asks for inline links to directly named tasks/notes");
assert.ok(!srcText.includes("do not write Markdown links, numbered citations, or a source list yourself"), "old no-links rule replaced");
console.log("PASS (d-inline): prompt asks for inline links to items named directly");
assert.ok(srcText.includes("A short follow-up continues the previous question"), "prompt keeps follow-ups in the previous question's scope");
console.log("PASS (d-followup): follow-ups keep the earlier scope");

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
