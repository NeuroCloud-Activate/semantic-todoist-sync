"use strict";
// scripts/email-cleanup-test.js — email chain cleaning for the shared
// note-based retrieval pipeline (offline).
//
// Only ONE step of the email pipeline is email-specific: cleaning the chain.
// The whole chain (newest message plus the earlier quoted replies) must still
// reach both the AI and the semantic retrieval lanes, so the cleaner removes
// per-message noise only:
//   - header blocks (the top block and every per-message header block)
//   - signatures (the RFC 3676 "-- " separator, sign-off blocks, the mobile
//     "Sent from my iPhone" trailer)
//   - legal / confidentiality disclaimers (the blank-line-delimited paragraph)
//
// The AI-facing summary keeps each earlier message's From/Sent/Date/Subject
// lines (who asked what, when) and every request line — the old action-word
// filter is gone. The retrieval text drops the headers so they never become
// search queries.
//
// Read-only and offline: src/main.js is compiled through Module with a fake
// obsidian; nothing touches the vault.
//
// Usage:
//   node scripts/email-cleanup-test.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = process.env.EMAIL_CLEANUP_MAIN || path.join(__dirname, "..", "src/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
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
    requestUrl() { throw new Error("email-cleanup-test: network disabled"); }
  };
};

let runtime;
try {
  testModule._compile(
    `${mainSource}\nmodule.exports.__emailCleanup = {\n` +
      "  DEFAULT_SETTINGS, cleanEmailChainText, compressSourceForTaskPrompt,\n" +
      "  sourceContractSourceText, emailSourceTextForModel,\n" +
      "  buildTaskSourceContract, buildTaskSemanticQuerySet,\n" +
      "  emailCurrentMessageText, emailCurrentSignalText\n" +
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
  cleanEmailChainText,
  compressSourceForTaskPrompt,
  sourceContractSourceText,
  emailSourceTextForModel,
  buildTaskSourceContract,
  buildTaskSemanticQuerySet,
  emailCurrentMessageText,
  emailCurrentSignalText
} = runtime.__emailCleanup;

const FORWARDER = "matthew.seegobin@blood.ca";
const ORIGINAL_SENDER = "Joanne Tejeda <joanne@mitacs.ca>";
const SUBJECT = "Umbrella Intake Form Draft - For Review";

const DISCLAIMER = [
  "This email and any attachments are confidential and may be legally privileged.",
  "If you are not the intended recipient, please notify the sender and delete this email."
].join(" ");

// Outlook-style forward: the newest message on top, the earlier message in an
// "-----Original Message-----" block with its own header block, a sign-off
// block, a mobile trailer and a legal disclaimer.
const OUTLOOK_BODY = [
  "Hi Matt,",
  "",
  "The intake form draft is ready.",
  "",
  "Thanks,",
  "Matt SeeGobin",
  "Director, Programs",
  "",
  "-----Original Message-----",
  `From: ${ORIGINAL_SENDER}`,
  "Sent: October 19, 2026 1:30 PM",
  `To: ${FORWARDER}`,
  `Subject: ${SUBJECT}`,
  "",
  "Can you confirm the budget line before Friday?",
  "",
  "Sent from my iPhone",
  "",
  DISCLAIMER
].join("\n");

// Gmail-style forward: a "Forwarded message" rule plus its own header block.
const GMAIL_BODY = [
  "Hi Matt,",
  "",
  "The variance numbers changed after the audit.",
  "",
  "---------- Forwarded message ---------",
  "From: Alex Rivera <alex@example.com>",
  "Date: Mon, Oct 19, 2026 at 1:30 PM EDT",
  "Subject: Q3 variance review",
  `To: ${FORWARDER}`,
  "",
  "Please review the Q3 variance numbers.",
  "",
  "Best,",
  "Alex Rivera",
  "alex@example.com",
  "416-555-0134"
].join("\n");

// Gmail-style reply: the earlier message is quoted behind an "On ... wrote:"
// marker instead of a header block.
const GMAIL_REPLY_BODY = [
  "Hi Matt,",
  "",
  "Can you send the revised deck?",
  "",
  "On Mon, Oct 19, 2026 at 1:30 PM Alex Rivera <alex@example.com> wrote:",
  "> The variance numbers changed after the audit.",
  "> Please review the Q3 variance numbers."
].join("\n");

function buildEmailSource(body, subject = SUBJECT) {
  const text = emailSourceTextForModel(
    { text: body, from: FORWARDER },
    { from: FORWARDER, to: "team@blood.ca" },
    { subject, receivedAt: "Oct 19, 2026, 1:37 PM EDT" }
  );
  return { type: "email", title: subject, text };
}

const NOTE_TEXT = [
  "# Project Atlas",
  "",
  "## Logged Actions",
  "",
  "- [ ] Review the intake form",
  "- [ ] Send the vendor addendum",
  "",
  "Context: the intake form is due October 13."
].join("\n");
const NOTE_SOURCE = { type: "note", title: "Project Atlas", path: "Projects/Atlas.md", text: NOTE_TEXT };
const NOTE_EXPECTED = "# Project Atlas\n\n## Logged Actions\n\n- [ ] Review the intake form\n- [ ] Send the vendor addendum\n\nContext: the intake form is due October 13.";

const failures = [];
const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push(name);
    console.log(`PASS: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${(error && error.message) || error}`);
    console.error(`FAIL: ${name}: ${(error && error.message) || error}`);
  }
}

function assertMissing(text, needle, what) {
  assert.ok(!text.includes(needle), `${what} must not survive in the cleaned text, got ${JSON.stringify(text)}`);
}

// The cleaned text must not hold the line at all: a name that also appears in
// a header or a greeting must not fail the check.
function assertMissingLine(text, needle, what) {
  const lines = String(text || "").split("\n").map((line) => line.trim());
  assert.ok(!lines.includes(needle), `${what} must not survive as a line, got ${JSON.stringify(lines)}`);
}

function main() {
  check("src/main.js exposes the email chain cleaner", () => {
    assert.equal(typeof cleanEmailChainText, "function", "src/main.js must export cleanEmailChainText");
  });

  // ---- retrieval text: no headers, no signature, no disclaimer -------------
  const outlookSource = buildEmailSource(OUTLOOK_BODY);
  const outlookRetrieval = sourceContractSourceText(outlookSource, DEFAULT_SETTINGS);

  check("the email retrieval text drops every header line", () => {
    assertMissing(outlookRetrieval, "From:", "the From header");
    assertMissing(outlookRetrieval, "Forwarded by:", "the Forwarded by header");
    assertMissing(outlookRetrieval, "To:", "the To header");
    assertMissing(outlookRetrieval, "Sent:", "the Sent header");
    assertMissing(outlookRetrieval, "Subject:", "the Subject header");
    assertMissing(outlookRetrieval, "Original email received:", "the received-at header");
    assertMissing(outlookRetrieval, "-----Original Message-----", "the forwarded-block marker");
    assert.ok(!/^from\s*:/im.test(outlookRetrieval), `no line may start with a header keyword, got ${JSON.stringify(outlookRetrieval)}`);
  });

  check("the email retrieval text drops the signature and the disclaimer", () => {
    assertMissing(outlookRetrieval, "Matt SeeGobin", "the signature name");
    assertMissing(outlookRetrieval, "Director, Programs", "the signature title");
    assertMissing(outlookRetrieval, "Thanks,", "the sign-off line");
    assertMissing(outlookRetrieval, "Sent from my iPhone", "the mobile trailer");
    assertMissing(outlookRetrieval, "confidential", "the disclaimer body");
    assertMissing(outlookRetrieval, "please notify the sender", "the disclaimer request");
  });

  check("the email retrieval text keeps the request sentences of the whole chain", () => {
    assert.ok(outlookRetrieval.includes("The intake form draft is ready."), `the newest request must survive, got ${JSON.stringify(outlookRetrieval)}`);
    assert.ok(outlookRetrieval.includes("Can you confirm the budget line before Friday?"), `the earlier request must survive, got ${JSON.stringify(outlookRetrieval)}`);
    assert.ok(outlookRetrieval.includes("Hi Matt,"), `the greeting must survive, got ${JSON.stringify(outlookRetrieval)}`);
  });

  check("a Gmail forward loses its headers, signature and disclaimers but keeps both requests", () => {
    const retrieval = sourceContractSourceText(buildEmailSource(GMAIL_BODY, "Q3 variance review"), DEFAULT_SETTINGS);
    assertMissing(retrieval, "Forwarded message", "the forwarded-block marker");
    assertMissing(retrieval, "Date:", "the Date header");
    assertMissing(retrieval, "Subject:", "the Subject header");
    assertMissing(retrieval, "Alex Rivera", "the signature name");
    assertMissing(retrieval, "alex@example.com", "the signature address");
    assertMissing(retrieval, "416-555-0134", "the signature phone number");
    assertMissing(retrieval, "Best,", "the sign-off line");
    assert.ok(retrieval.includes("The variance numbers changed after the audit."), `the newest request must survive, got ${JSON.stringify(retrieval)}`);
    assert.ok(retrieval.includes("Please review the Q3 variance numbers."), `the earlier request must survive, got ${JSON.stringify(retrieval)}`);
  });

  check("a Gmail reply drops the 'On ... wrote:' marker but keeps the quoted request", () => {
    const retrieval = sourceContractSourceText(buildEmailSource(GMAIL_REPLY_BODY, "Q3 variance review"), DEFAULT_SETTINGS);
    assertMissing(retrieval, "wrote:", "the quoted-reply marker");
    assert.ok(retrieval.includes("Can you send the revised deck?"), `the newest request must survive, got ${JSON.stringify(retrieval)}`);
    assert.ok(retrieval.includes("Please review the Q3 variance numbers."), `the quoted request must survive, got ${JSON.stringify(retrieval)}`);
  });

  // ---- AI-facing summary: full chain, headers kept ------------------------
  const outlookSummary = compressSourceForTaskPrompt(outlookSource, DEFAULT_SETTINGS);

  check("the AI summary keeps the two section labels", () => {
    assert.ok(outlookSummary.includes("Current/latest email message (primary status and next-action evidence):"), `the current label must survive, got ${JSON.stringify(outlookSummary)}`);
    assert.ok(outlookSummary.includes("Earlier quoted email thread (background and unresolved context only):"), `the history label must survive, got ${JSON.stringify(outlookSummary)}`);
  });

  check("the AI summary keeps the earlier message's From and Date lines", () => {
    assert.ok(outlookSummary.includes(`From: ${ORIGINAL_SENDER}`), `the earlier From line must survive, got ${JSON.stringify(outlookSummary)}`);
    assert.ok(outlookSummary.includes("Sent: October 19, 2026 1:30 PM"), `the earlier Sent line must survive, got ${JSON.stringify(outlookSummary)}`);
    assert.ok(outlookSummary.includes(`Subject: ${SUBJECT}`), `the earlier Subject line must survive, got ${JSON.stringify(outlookSummary)}`);
  });

  check("the AI summary keeps every request line, including lines with no action word", () => {
    assert.ok(outlookSummary.includes("Hi Matt,"), `the greeting must survive, got ${JSON.stringify(outlookSummary)}`);
    assert.ok(outlookSummary.includes("The intake form draft is ready."), `the newest request must survive, got ${JSON.stringify(outlookSummary)}`);
    assert.ok(outlookSummary.includes("Can you confirm the budget line before Friday?"), `the earlier request must survive, got ${JSON.stringify(outlookSummary)}`);
    assert.ok(outlookSummary.includes("The variance numbers changed after the audit.") === false, "an unrelated message must not leak into this chain");
  });

  check("the AI summary drops the signature and the disclaimer but keeps the chain structure", () => {
    assertMissing(outlookSummary, "Matt SeeGobin", "the signature name");
    assertMissing(outlookSummary, "Director, Programs", "the signature title");
    assertMissing(outlookSummary, "Sent from my iPhone", "the mobile trailer");
    assertMissing(outlookSummary, "confidential", "the disclaimer body");
    assert.ok(outlookSummary.includes("-----Original Message-----"), `the chain marker must survive for the AI, got ${JSON.stringify(outlookSummary)}`);
  });

  check("the AI summary keeps a request line that carries no action word", () => {
    const body = [
      "Hi Matt,",
      "",
      "The budget line sits at 4,200 dollars.",
      "",
      "-----Original Message-----",
      `From: ${ORIGINAL_SENDER}`,
      "Sent: October 19, 2026 1:30 PM",
      `To: ${FORWARDER}`,
      `Subject: ${SUBJECT}`,
      "",
      "The variance numbers changed after the audit."
    ].join("\n");
    const summary = compressSourceForTaskPrompt(buildEmailSource(body), DEFAULT_SETTINGS);
    assert.ok(summary.includes("The budget line sits at 4,200 dollars."), `a request line without an action word must survive, got ${JSON.stringify(summary)}`);
    assert.ok(summary.includes("The variance numbers changed after the audit."), `the earlier request must survive, got ${JSON.stringify(summary)}`);
  });

  // ---- cleaner unit behaviour ---------------------------------------------
  check("cleanEmailChainText keeps the headers for the AI and drops them for retrieval", () => {
    const withHeaders = cleanEmailChainText(OUTLOOK_BODY, { keepHeaders: true });
    assert.ok(withHeaders.includes(`From: ${ORIGINAL_SENDER}`), `the header must survive with keepHeaders, got ${JSON.stringify(withHeaders)}`);
    assert.ok(!withHeaders.includes("Matt SeeGobin"), `the signature must be removed with keepHeaders, got ${JSON.stringify(withHeaders)}`);
    const withoutHeaders = cleanEmailChainText(OUTLOOK_BODY, { keepHeaders: false });
    assert.ok(!withoutHeaders.includes("From:"), `the header must be dropped without keepHeaders, got ${JSON.stringify(withoutHeaders)}`);
    assert.ok(withoutHeaders.includes("Can you confirm the budget line before Friday?"), `the request must survive, got ${JSON.stringify(withoutHeaders)}`);
  });

  check("a sign-off block is removed but a following request survives", () => {
    const body = [
      "Hi Matt,",
      "",
      "Thanks,",
      "Matt SeeGobin",
      "Director, Programs",
      "",
      "Could you confirm the budget line?"
    ].join("\n");
    const cleaned = cleanEmailChainText(body, { keepHeaders: true });
    assertMissing(cleaned, "Matt SeeGobin", "the signature name");
    assertMissing(cleaned, "Director, Programs", "the signature title");
    assert.ok(cleaned.includes("Could you confirm the budget line?"), `the request must survive, got ${JSON.stringify(cleaned)}`);
  });

  check("a disclaimer paragraph is removed without touching the neighbouring request", () => {
    const body = [
      "Hi Matt,",
      "",
      "Please review the draft.",
      "",
      DISCLAIMER,
      "",
      "The board meets on Tuesday."
    ].join("\n");
    const cleaned = cleanEmailChainText(body, { keepHeaders: true });
    assertMissing(cleaned, "confidential", "the disclaimer body");
    assertMissing(cleaned, "please notify the sender", "the disclaimer request");
    assert.ok(cleaned.includes("Please review the draft."), `the request must survive, got ${JSON.stringify(cleaned)}`);
    assert.ok(cleaned.includes("The board meets on Tuesday."), `the following line must survive, got ${JSON.stringify(cleaned)}`);
  });

  check("the cleaner never returns empty text", () => {
    const body = "Thanks,\nMatt SeeGobin";
    const cleaned = cleanEmailChainText(body, { keepHeaders: true });
    assert.ok(cleaned.length > 0, "the cleaner must fall back to the uncleaned text");
  });

  // ---- the retrieval lanes carry no email noise ---------------------------
  check("the semantic query lanes carry no header, signature or disclaimer text", () => {
    const contract = buildTaskSourceContract(outlookSource, sourceContractSourceText(outlookSource, DEFAULT_SETTINGS), DEFAULT_SETTINGS);
    const scopeId = String((contract.scopes || [])[0]?.scopeId || "");
    const factId = String((contract.facts || [])[0]?.factId || "");
    const lanes = buildTaskSemanticQuerySet({
      id: `scope:${scopeId}`,
      content: "Complete and submit the intake form",
      semanticQuery: "Complete and submit the intake form",
      scope_id: scopeId,
      evidence_ids: [contract.primaryEvidenceId].filter(Boolean),
      fact_refs: [factId].filter(Boolean),
      subtasks: []
    }, outlookSource, contract, {});
    const laneText = lanes.map((lane) => String(lane?.text || "")).join("\n");
    assert.ok(lanes.length > 0, "the email source must still produce retrieval lanes");
    assertMissing(laneText, "confidential", "the disclaimer body");
    assertMissing(laneText, "Matt SeeGobin", "the signature name");
    assertMissing(laneText, "Director, Programs", "the signature title");
    assert.ok(!/^from\s*:/im.test(laneText), `no lane may start with a header keyword, got ${JSON.stringify(laneText)}`);
    assert.ok(laneText.includes("The intake form draft is ready."), `the newest request must reach a lane, got ${JSON.stringify(laneText)}`);
    assert.ok(laneText.includes("Can you confirm the budget line before Friday?"), `the earlier request must reach a lane, got ${JSON.stringify(laneText)}`);
  });

  check("the email current-message signal still reads the new summary", () => {
    const current = emailCurrentMessageText(outlookSummary);
    assert.ok(current.includes("The intake form draft is ready."), `the current message must be parsed from the summary, got ${JSON.stringify(current)}`);
    assert.ok(!current.includes("Can you confirm the budget line before Friday?"), `the current message must not include the earlier thread, got ${JSON.stringify(current)}`);
    const signal = emailCurrentSignalText(outlookSummary);
    assert.ok(signal.includes("The intake form draft is ready."), `the signal text must keep the current message, got ${JSON.stringify(signal)}`);
  });

  // ---- a request is never lost (regression: eaeb72b deleted requests) -----
  check("a request that mentions 'confidential' survives the cleaner", () => {
    const body = [
      "Hi Matt,",
      "",
      "Please keep the budget confidential and send it Friday.",
      "",
      "Thanks,",
      "Matt SeeGobin"
    ].join("\n");
    const cleaned = cleanEmailChainText(body, { keepHeaders: true });
    assert.ok(cleaned.includes("Please keep the budget confidential and send it Friday."), `the request must survive, got ${JSON.stringify(cleaned)}`);
    assertMissing(cleaned, "Matt SeeGobin", "the signature name");
    const retrieval = sourceContractSourceText(buildEmailSource(body), DEFAULT_SETTINGS);
    assert.ok(retrieval.includes("Please keep the budget confidential and send it Friday."), `the request must reach the retrieval text, got ${JSON.stringify(retrieval)}`);
  });

  check("a request that mentions a virus scan survives the cleaner", () => {
    const body = [
      "Hi Matt,",
      "",
      "Please delete the virus scan report and confirm receipt.",
      "",
      "Thanks,",
      "Matt SeeGobin"
    ].join("\n");
    const cleaned = cleanEmailChainText(body, { keepHeaders: true });
    assert.ok(cleaned.includes("Please delete the virus scan report and confirm receipt."), `the request must survive, got ${JSON.stringify(cleaned)}`);
    const retrieval = sourceContractSourceText(buildEmailSource(body), DEFAULT_SETTINGS);
    assert.ok(retrieval.includes("Please delete the virus scan report and confirm receipt."), `the request must reach the retrieval text, got ${JSON.stringify(retrieval)}`);
  });

  check("a disclaimer sentence inside a body paragraph is dropped but the request stays", () => {
    const body = "Hi Matt, Please review the intake form. This email and any attachments are confidential and may be legally privileged. If you are not the intended recipient, please notify the sender and delete this email.";
    const cleaned = cleanEmailChainText(body, { keepHeaders: true });
    assert.ok(cleaned.includes("Hi Matt, Please review the intake form."), `the request must survive, got ${JSON.stringify(cleaned)}`);
    assertMissing(cleaned, "confidential", "the disclaimer sentence");
    assertMissing(cleaned, "please notify the sender", "the disclaimer notice");
  });

  check("a legal footer under a rule loses both the rule and the footer", () => {
    const body = [
      "Hi Matt,",
      "",
      "Please review the draft.",
      "",
      "---",
      "This email and any attachments are confidential."
    ].join("\n");
    const cleaned = cleanEmailChainText(body, { keepHeaders: false });
    assertMissing(cleaned, "---", "the rule");
    assertMissing(cleaned, "confidential", "the legal footer");
    assert.ok(cleaned.includes("Please review the draft."), `the request must survive, got ${JSON.stringify(cleaned)}`);
  });

  check("an external-sender banner is removed", () => {
    const body = [
      "CAUTION: EXTERNAL EMAIL. Do not click links or open attachments.",
      "",
      "Hi Matt,",
      "",
      "Please review the draft."
    ].join("\n");
    const cleaned = cleanEmailChainText(body, { keepHeaders: false });
    assertMissing(cleaned, "CAUTION", "the banner lead-in");
    assertMissing(cleaned, "Do not click links", "the banner advice");
    assert.ok(cleaned.includes("Please review the draft."), `the request must survive, got ${JSON.stringify(cleaned)}`);
  });

  check("an [EXTERNAL] prefix is stripped but the request survives", () => {
    const cleaned = cleanEmailChainText("[EXTERNAL] Please review the draft.", { keepHeaders: false });
    assertMissing(cleaned, "[EXTERNAL]", "the banner prefix");
    assert.ok(cleaned.includes("Please review the draft."), `the request must survive, got ${JSON.stringify(cleaned)}`);
  });

  check("a two-line Gmail quote marker is a boundary and is dropped for retrieval", () => {
    const body = [
      "Hi Matt,",
      "",
      "Can you send the revised deck?",
      "",
      "On Mon, Oct 6, 2026 at 9:14 AM Alex Rivera",
      "<alex@example.com> wrote:",
      "> Please review the Q3 variance numbers."
    ].join("\n");
    const retrieval = sourceContractSourceText(buildEmailSource(body, "Q3 variance review"), DEFAULT_SETTINGS);
    assertMissing(retrieval, "wrote:", "the quote marker");
    assertMissing(retrieval, "alex@example.com", "the quote marker address");
    assert.ok(retrieval.includes("Can you send the revised deck?"), `the newest request must survive, got ${JSON.stringify(retrieval)}`);
    assert.ok(retrieval.includes("Please review the Q3 variance numbers."), `the quoted request must survive, got ${JSON.stringify(retrieval)}`);
  });

  check("a Gmail quote marker with the address on its own line is dropped for retrieval", () => {
    const body = [
      "Hi Matt,",
      "",
      "Can you send the revised deck?",
      "",
      "On Mon, Oct 6, 2026 at 9:14 AM Alex Rivera",
      "<alex@example.com>",
      "wrote:",
      "> Please review the Q3 variance numbers."
    ].join("\n");
    const retrieval = sourceContractSourceText(buildEmailSource(body, "Q3 variance review"), DEFAULT_SETTINGS);
    assertMissing(retrieval, "wrote:", "the quote marker");
    assertMissing(retrieval, "alex@example.com", "the quote marker address");
    assert.ok(retrieval.includes("Can you send the revised deck?"), `the newest request must survive, got ${JSON.stringify(retrieval)}`);
    assert.ok(retrieval.includes("Please review the Q3 variance numbers."), `the quoted request must survive, got ${JSON.stringify(retrieval)}`);
  });

  check("a company and address footer is dropped from the retrieval text", () => {
    const body = [
      "Hi Matt,",
      "",
      "Please review the draft.",
      "",
      "Canadian Blood Services | 1800 Diefenbaker Boulevard, Ottawa, ON K1A 0G1"
    ].join("\n");
    const retrieval = sourceContractSourceText(buildEmailSource(body), DEFAULT_SETTINGS);
    assertMissing(retrieval, "Canadian Blood Services", "the organization footer");
    assertMissing(retrieval, "Diefenbaker", "the address footer");
    assert.ok(retrieval.includes("Please review the draft."), `the request must survive, got ${JSON.stringify(retrieval)}`);
  });

  check("separator and contact footer lines are dropped from the retrieval text", () => {
    const body = [
      "Hi Matt,",
      "",
      "Please review the draft.",
      "",
      "________________________________",
      "Hi Alex,",
      "",
      "Please confirm the numbers.",
      "",
      "Tel: 613-232-5555",
      "info@blood.ca"
    ].join("\n");
    const retrieval = sourceContractSourceText(buildEmailSource(body), DEFAULT_SETTINGS);
    assertMissing(retrieval, "____", "the separator line");
    assertMissing(retrieval, "Tel: 613-232-5555", "the phone footer");
    assertMissing(retrieval, "info@blood.ca", "the e-mail footer");
    assert.ok(retrieval.includes("Please confirm the numbers."), `the request must survive, got ${JSON.stringify(retrieval)}`);
  });

  check("a French, Spanish and German sign-off is removed", () => {
    const french = ["Bonjour,", "", "Cordialement,", "Alex Rivera"].join("\n");
    const frenchCleaned = cleanEmailChainText(french, { keepHeaders: true });
    assertMissing(frenchCleaned, "Cordialement", "the French sign-off");
    assertMissing(frenchCleaned, "Alex Rivera", "the signature name");
    const spanish = ["Hola,", "", "Atentamente,", "Alex Rivera"].join("\n");
    const spanishCleaned = cleanEmailChainText(spanish, { keepHeaders: true });
    assertMissing(spanishCleaned, "Atentamente", "the Spanish sign-off");
    const german = ["Hallo,", "", "Mit freundlichen Grüßen", "Alex Rivera"].join("\n");
    const germanCleaned = cleanEmailChainText(german, { keepHeaders: true });
    assertMissing(germanCleaned, "Mit freundlichen Grüßen", "the German sign-off");
    assertMissing(germanCleaned, "Alex Rivera", "the signature name");
  });

  check("a reply line, a phone request and a list item survive the cleaner", () => {
    const body = [
      "Thanks, approved.",
      "",
      "Call me at 555-1234 to confirm.",
      "",
      "- Review the intake form",
      "- Send the vendor addendum"
    ].join("\n");
    const cleaned = cleanEmailChainText(body, { keepHeaders: false });
    assert.ok(cleaned.includes("Thanks, approved."), `the reply must survive, got ${JSON.stringify(cleaned)}`);
    assert.ok(cleaned.includes("Call me at 555-1234 to confirm."), `the phone request must survive, got ${JSON.stringify(cleaned)}`);
    assert.ok(cleaned.includes("- Review the intake form"), `the list item must survive, got ${JSON.stringify(cleaned)}`);
    assert.ok(cleaned.includes("- Send the vendor addendum"), `the list item must survive, got ${JSON.stringify(cleaned)}`);
  });

  // ---- the line rules must never eat real content -------------------------
  // Every line of real content must survive BOTH lanes: the AI summary
  // (keepHeaders: true) and the retrieval text (keepHeaders: false).
  const assertSurvivesBothLanes = (body, needle, what) => {
    for (const keepHeaders of [true, false]) {
      const cleaned = cleanEmailChainText(body, { keepHeaders });
      assert.ok(cleaned.includes(needle), `${what} must survive with keepHeaders=${keepHeaders}, got ${JSON.stringify(cleaned)}`);
    }
  };

  // ---- the RFC 3676 "--" separator opens a signature block ----------------
  // The "--" line marks the start of a signature, not the end of the message:
  // a request that follows it must never be lost.
  check("a '--' separator does not end the message: a quoted request survives", () => {
    const body = [
      "Please approve the venue booking.",
      "--",
      "Matt SeeGobin",
      "> Can you also send the invoice to accounting?"
    ].join("\n");
    assertSurvivesBothLanes(body, "Please approve the venue booking.", "the request before the signature");
    assertSurvivesBothLanes(body, "> Can you also send the invoice to accounting?", "the quoted request after the signature");
    const retrieval = sourceContractSourceText(buildEmailSource(body), DEFAULT_SETTINGS);
    assert.ok(retrieval.includes("Can you also send the invoice to accounting?"), `the quoted request must reach the retrieval text, got ${JSON.stringify(retrieval)}`);
    const summary = compressSourceForTaskPrompt(buildEmailSource(body), DEFAULT_SETTINGS);
    assert.ok(summary.includes("Can you also send the invoice to accounting?"), `the quoted request must reach the AI summary, got ${JSON.stringify(summary)}`);
  });

  check("a '--' separator and its signature block are removed", () => {
    const body = [
      "Please approve the venue booking.",
      "--",
      "Matt SeeGobin",
      "Director, Programs",
      "Tel: 613-555-0110"
    ].join("\n");
    for (const keepHeaders of [true, false]) {
      const cleaned = cleanEmailChainText(body, { keepHeaders });
      assertMissing(cleaned, "--", "the signature separator");
      assertMissing(cleaned, "Matt SeeGobin", "the signature name");
      assertMissing(cleaned, "Director, Programs", "the signature title");
      assertMissing(cleaned, "613-555-0110", "the signature phone");
      assert.ok(cleaned.includes("Please approve the venue booking."), `the request must survive, got ${JSON.stringify(cleaned)}`);
    }
  });

  check("a request right after a '--' signature block survives", () => {
    const body = [
      "The venue is booked.",
      "--",
      "Matt SeeGobin",
      "Please confirm by Friday."
    ].join("\n");
    assertSurvivesBothLanes(body, "The venue is booked.", "the line before the signature");
    assertSurvivesBothLanes(body, "Please confirm by Friday.", "the request after the signature");
  });

  check("a markdown table row is never a contact footer", () => {
    const body = [
      "Hi Matt,",
      "",
      "| Book the venue for Friday | Alex |",
      "| Renegotiate the rate | Alex |",
      "| Sign the addendum | Alex |",
      "| Item | Qty |",
      "Total | 500"
    ].join("\n");
    assertSurvivesBothLanes(body, "| Book the venue for Friday | Alex |", "the table row with the venue request");
    assertSurvivesBothLanes(body, "| Renegotiate the rate | Alex |", "the table row with the rate request");
    assertSurvivesBothLanes(body, "| Sign the addendum | Alex |", "the table row with the addendum request");
    assertSurvivesBothLanes(body, "| Item | Qty |", "the table header row");
    assertSurvivesBothLanes(body, "Total | 500", "the total row");
  });

  check("a markdown table header row above a table rule is never a contact footer", () => {
    const body = [
      "Hi Matt,",
      "",
      "Booking Contact | 613-555-0110",
      "|---|---|"
    ].join("\n");
    assertSurvivesBothLanes(body, "Booking Contact | 613-555-0110", "the table header row");
  });

  check("a pipe footer with an organisation and a contact detail is still dropped", () => {
    const body = [
      "Hi Matt,",
      "",
      "Please review the draft.",
      "",
      "Canadian Blood Services | 613-232-5555"
    ].join("\n");
    const retrieval = sourceContractSourceText(buildEmailSource(body), DEFAULT_SETTINGS);
    assertMissing(retrieval, "Canadian Blood Services", "the organisation footer");
    assertMissing(retrieval, "613-232-5555", "the phone footer");
    assert.ok(retrieval.includes("Please review the draft."), `the request must survive, got ${JSON.stringify(retrieval)}`);
  });

  check("a plain lead-in line is not an external-sender banner", () => {
    const body = [
      "Hi Matt,",
      "",
      "Important: the venue changed to 5 PM on Friday.",
      "Notice: parking is on the third floor.",
      "Attention: the contract expires on Monday.",
      "Warning: the file is corrupted.",
      "Caution: the invoice total differs from the quote."
    ].join("\n");
    assertSurvivesBothLanes(body, "Important: the venue changed to 5 PM on Friday.", "the Important lead-in");
    assertSurvivesBothLanes(body, "Notice: parking is on the third floor.", "the Notice lead-in");
    assertSurvivesBothLanes(body, "Attention: the contract expires on Monday.", "the Attention lead-in");
    assertSurvivesBothLanes(body, "Warning: the file is corrupted.", "the Warning lead-in");
    assertSurvivesBothLanes(body, "Caution: the invoice total differs from the quote.", "the Caution lead-in");
  });

  check("a banner advice line that stands alone is not a banner", () => {
    const body = [
      "Hi Matt,",
      "",
      "Do not open the attachment until Friday.",
      "This message originated from the shared inbox.",
      "Be wary of the attachment."
    ].join("\n");
    assertSurvivesBothLanes(body, "Do not open the attachment until Friday.", "the attachment instruction");
    assertSurvivesBothLanes(body, "This message originated from the shared inbox.", "the shared-inbox sentence");
    assertSurvivesBothLanes(body, "Be wary of the attachment.", "the wary sentence");
  });

  check("a disclaimer-only body leaves the search text without the headers", () => {
    const source = buildEmailSource("This email and any attachments are confidential and may be legally privileged.");
    const retrieval = sourceContractSourceText(source, DEFAULT_SETTINGS);
    assertMissing(retrieval, "confidential", "the disclaimer body");
    assertMissing(retrieval, "From:", "the From header");
    assertMissing(retrieval, "Subject:", "the Subject header");
    assert.equal(retrieval, SUBJECT, "the search text falls back to the subject");
    const summary = compressSourceForTaskPrompt(source, DEFAULT_SETTINGS);
    assert.ok(summary.length > 0, "the AI lane must never be empty");
  });

  check("a signature-only body leaves the search text without the headers", () => {
    const source = buildEmailSource("Thanks,\nMatt SeeGobin");
    const retrieval = sourceContractSourceText(source, DEFAULT_SETTINGS);
    assertMissing(retrieval, "Matt SeeGobin", "the signature name");
    assertMissing(retrieval, "From:", "the From header");
    assertMissing(retrieval, "Subject:", "the Subject header");
    assert.equal(retrieval, SUBJECT, "the search text falls back to the subject");
  });

  check("a line that starts with 'On' is not a Gmail quote marker", () => {
    const body = [
      "On Monday we agreed to send the draft.",
      "",
      "The deadline is Friday."
    ].join("\n");
    assertSurvivesBothLanes(body, "On Monday we agreed to send the draft.", "the On line");
  });

  check("a request with a postal address survives the cleaner", () => {
    const line = "Please courier the forms to 1800 Diefenbaker Blvd, Ottawa ON K1A 0G1 by Friday.";
    assertSurvivesBothLanes(line, line, "the courier request");
    const retrieval = sourceContractSourceText(buildEmailSource(line), DEFAULT_SETTINGS);
    assert.ok(retrieval.includes(line), `the courier request must reach the retrieval text, got ${JSON.stringify(retrieval)}`);
  });

  check("a phone request survives the cleaner", () => {
    const line = "Call 613-555-0110 to book the room.";
    assertSurvivesBothLanes(line, line, "the phone request");
  });

  check("a French request survives the cleaner", () => {
    const line = "Merci de confirmer avant vendredi.";
    assertSurvivesBothLanes(line, line, "the French request");
  });

  check("a four megabyte body cleans in under a second", () => {
    const unit = "Hi Matt,\n\nPlease review the intake form.\n\nThis email and any attachments are confidential and may be legally privileged.\n\n";
    let body = "";
    while (body.length < 4 * 1024 * 1024) body += unit;
    const started = Date.now();
    const cleaned = cleanEmailChainText(body, { keepHeaders: false });
    const elapsed = Date.now() - started;
    assert.ok(cleaned.length > 0, "the cleaner must not empty a large body");
    assert.ok(elapsed < 1000, `a 4 MB body must clean in under 1 s, took ${elapsed} ms`);
  });

  // ---- the sign-off is removed however it is written ----------------------
  // The request line is the same in every case: it must always survive.
  const REQUEST = "Please send the stipend schedule by Friday.";

  check("a lowercase sign-off and a lowercase name are removed", () => {
    const body = ["Hi Matt,", "", REQUEST, "", "kind regards", "janaka"].join("\n");
    for (const keepHeaders of [true, false]) {
      const cleaned = cleanEmailChainText(body, { keepHeaders });
      assertMissing(cleaned, "kind regards", "the lowercase sign-off");
      assertMissing(cleaned, "janaka", "the lowercase name");
      assert.ok(cleaned.includes(REQUEST), `the request must survive, got ${JSON.stringify(cleaned)}`);
    }
  });

  check("a sign-off and the name on one line are removed", () => {
    const signoffs = ["Thanks, Alex", "Cheers - Alex", "Thanks again, Sophie T.", "Best, J."];
    for (const signoff of signoffs) {
      const body = ["Hi Matt,", "", REQUEST, "", signoff].join("\n");
      for (const keepHeaders of [true, false]) {
        const cleaned = cleanEmailChainText(body, { keepHeaders });
        assertMissing(cleaned, signoff, `the inline sign-off ${JSON.stringify(signoff)}`);
        assert.ok(cleaned.includes(REQUEST), `the request must survive, got ${JSON.stringify(cleaned)}`);
      }
    }
  });

  check("an inline sign-off with a sentence after the name is kept", () => {
    const body = ["Hi Matt,", "", REQUEST, "", "Thanks, Alex will send it tomorrow."].join("\n");
    assertSurvivesBothLanes(body, "Thanks, Alex will send it tomorrow.", "the inline sign-off with a verb");
    const reply = ["Hi Matt,", "", REQUEST, "", "Thanks, approved."].join("\n");
    assertSurvivesBothLanes(reply, "Thanks, approved.", "the inline sign-off with a lower-case word");
  });

  check("a contact block without a sign-off is removed at the end of a message", () => {
    const body = [
      "Hi Matt,",
      "",
      REQUEST,
      "",
      "Janaka Perera",
      "Research Coordinator",
      "Canadian Blood Services",
      "613-555-0110"
    ].join("\n");
    for (const keepHeaders of [true, false]) {
      const cleaned = cleanEmailChainText(body, { keepHeaders });
      assertMissing(cleaned, "Janaka Perera", "the contact name");
      assertMissing(cleaned, "Research Coordinator", "the contact title");
      assertMissing(cleaned, "Canadian Blood Services", "the organisation");
      assert.ok(cleaned.includes(REQUEST), `the request must survive, got ${JSON.stringify(cleaned)}`);
    }
  });

  // ---- a content line after a sign-off is real content ---------------------
  check("a short content line after an inline sign-off survives", () => {
    const body = ["Hi Matt,", "", REQUEST, "", "Thanks, Alex", "Meeting is Thursday"].join("\n");
    assertSurvivesBothLanes(body, REQUEST, "the request");
    assertSurvivesBothLanes(body, "Meeting is Thursday", "the content line after the inline sign-off");
  });

  check("a short content line after a sign-off block survives", () => {
    const body = ["Hi Matt,", "", REQUEST, "", "Thanks,", "Alex Rivera", "Meeting is Thursday"].join("\n");
    assertSurvivesBothLanes(body, REQUEST, "the request");
    assertSurvivesBothLanes(body, "Meeting is Thursday", "the content line after the sign-off block");
  });

  check("a title-case deadline line after a contact block survives", () => {
    const body = ["Hi Matt,", "", REQUEST, "", "Janaka Perera", "613-555-0110", "Stipend Schedule Due Friday"].join("\n");
    assertSurvivesBothLanes(body, REQUEST, "the request");
    assertSurvivesBothLanes(body, "Stipend Schedule Due Friday", "the deadline line after the contact block");
  });

  check("an organisation and a title still count as a trailing contact block", () => {
    const body = ["Hi Matt,", "", REQUEST, "", "Janaka Perera", "Research Program Manager", "Canadian Blood Services", "613-555-0110"].join("\n");
    for (const keepHeaders of [true, false]) {
      const cleaned = cleanEmailChainText(body, { keepHeaders });
      assertMissing(cleaned, "Janaka Perera", "the contact name");
      assertMissing(cleaned, "Research Program Manager", "the contact title");
      assertMissing(cleaned, "Canadian Blood Services", "the organisation");
      assert.ok(cleaned.includes(REQUEST), `the request must survive, got ${JSON.stringify(cleaned)}`);
    }
    const director = ["Hi Matt,", "", REQUEST, "", "Janaka Perera", "Director, Programs", "613-555-0110"].join("\n");
    for (const keepHeaders of [true, false]) {
      const cleaned = cleanEmailChainText(director, { keepHeaders });
      assertMissing(cleaned, "Director, Programs", "the contact title");
      assert.ok(cleaned.includes(REQUEST), `the request must survive, got ${JSON.stringify(cleaned)}`);
    }
  });

  // ---- a street address belongs to the signature block --------------------
  check("a street address after a signature block is removed in both lanes", () => {
    const request = "Once the adjunct program review is settled I will prepare the invitation list for the 2027 renewals.";
    const body = [
      "Hi Matt,",
      "",
      request,
      "",
      "Thanks,",
      "Jim Whitfield",
      "Director, Research Partnerships",
      "Canadian Blood Services",
      "Phone: 613-555-0188",
      "1800 Diefenbaker Boulevard, Ottawa, ON"
    ].join("\n");
    for (const keepHeaders of [true, false]) {
      const cleaned = cleanEmailChainText(body, { keepHeaders });
      assertMissing(cleaned, "Thanks,", "the sign-off");
      assertMissing(cleaned, "Jim Whitfield", "the signature name");
      assertMissing(cleaned, "Director, Research Partnerships", "the signature title");
      assertMissing(cleaned, "Canadian Blood Services", "the organisation");
      assertMissing(cleaned, "Phone: 613-555-0188", "the phone line");
      assertMissing(cleaned, "1800 Diefenbaker Boulevard, Ottawa, ON", "the street address");
      assert.ok(cleaned.includes(request), `the request must survive, got ${JSON.stringify(cleaned)}`);
    }
  });

  // ---- a content line after a sign-off is never a request or an address ---
  // The sign-off block stops at a request line, and a line that only mentions
  // a street word is not an address: both must survive in both lanes.
  check("a content line after a sign-off survives in both lanes", () => {
    const contentLines = [
      "Send Report Today",
      "Action Required",
      "100 Main Street is where we meet",
      "5 items, see Main Street",
      "1 Place your order by Friday"
    ];
    for (const line of contentLines) {
      const body = ["Hi Matt,", "", REQUEST, "", "Thanks,", "Alex", line].join("\n");
      assertSurvivesBothLanes(body, line, `the content line ${JSON.stringify(line)}`);
    }
  });

  check("a street address without a city is removed in both lanes", () => {
    const body = ["Hi Matt,", "", REQUEST, "", "Thanks,", "Alex", "45 Rideau Street"].join("\n");
    for (const keepHeaders of [true, false]) {
      const cleaned = cleanEmailChainText(body, { keepHeaders });
      assertMissing(cleaned, "45 Rideau Street", "the street address");
      assert.ok(cleaned.includes(REQUEST), `the request must survive, got ${JSON.stringify(cleaned)}`);
    }
  });

  check("prose that names a person survives the cleaner", () => {
    assertSurvivesBothLanes("Janaka Perera will review the file.", "Janaka Perera will review the file.", "the prose sentence");
    const attendees = ["Alex Rivera", "Sophie Tremblay", "Janaka Perera"].join("\n");
    assertSurvivesBothLanes(attendees, "Sophie Tremblay", "the attendee list");
    assertSurvivesBothLanes(attendees, "Janaka Perera", "the last attendee");
  });

  check("a forwarded chain loses every signature and keeps every request", () => {
    const chain = [
      "Hi Matt,",
      "",
      REQUEST,
      "",
      "Thanks,",
      "Matt",
      "",
      "-----Original Message-----",
      "From: Janaka Perera <janaka.perera@example.org>",
      "Sent: Thursday, September 18, 2025 4:12 PM",
      "To: Matt <matt@example.org>",
      "Subject: Stipend schedule",
      "",
      "Hi Matt,",
      "",
      "Can you also send the invoice to accounting?",
      "",
      "Cheers - Alex",
      "",
      "-----Original Message-----",
      "From: Sophie Tremblay <sophie@example.org>",
      "Sent: Wednesday, September 17, 2025 9:02 AM",
      "To: Matt <matt@example.org>",
      "Subject: Re: Stipend schedule",
      "",
      "Hi Matt,",
      "",
      "We still owe the payment request reviews for two trainees.",
      "",
      "Please confirm by Friday.",
      "",
      "Janaka Perera",
      "Research Coordinator",
      "Canadian Blood Services",
      "613-555-0110",
      "janaka.perera@example.org"
    ].join("\n");
    const retrieval = sourceContractSourceText(buildEmailSource(chain, "Stipend schedule"), DEFAULT_SETTINGS);
    for (const line of ["Thanks,", "Matt", "Cheers - Alex", "Janaka Perera", "Research Coordinator", "Canadian Blood Services", "613-555-0110", "janaka.perera@example.org"]) {
      assertMissingLine(retrieval, line, `the signature line ${JSON.stringify(line)}`);
    }
    assert.ok(retrieval.includes(REQUEST), `the first request must survive, got ${JSON.stringify(retrieval)}`);
    assert.ok(retrieval.includes("Can you also send the invoice to accounting?"), `the second request must survive, got ${JSON.stringify(retrieval)}`);
    assert.ok(retrieval.includes("Please confirm by Friday."), `the third request must survive, got ${JSON.stringify(retrieval)}`);
    const summary = compressSourceForTaskPrompt(buildEmailSource(chain, "Stipend schedule"), DEFAULT_SETTINGS);
    assert.ok(summary.includes("From: Janaka Perera <janaka.perera@example.org>"), `the From header must survive for the AI, got ${JSON.stringify(summary)}`);
    assert.ok(summary.includes("Sent: Thursday, September 18, 2025 4:12 PM"), `the Sent header must survive for the AI, got ${JSON.stringify(summary)}`);
    assert.ok(summary.includes("Subject: Stipend schedule"), `the Subject header must survive for the AI, got ${JSON.stringify(summary)}`);
    for (const line of ["Thanks,", "Matt", "Cheers - Alex", "Janaka Perera", "Research Coordinator", "Canadian Blood Services", "613-555-0110", "janaka.perera@example.org"]) {
      assertMissingLine(summary, line, `the signature line ${JSON.stringify(line)}`);
    }
    assert.ok(summary.includes(REQUEST), `the first request must reach the AI summary, got ${JSON.stringify(summary)}`);
    assert.ok(summary.includes("Can you also send the invoice to accounting?"), `the second request must reach the AI summary, got ${JSON.stringify(summary)}`);
    assert.ok(summary.includes("Please confirm by Friday."), `the third request must reach the AI summary, got ${JSON.stringify(summary)}`);
  });

  // ---- note sources are byte-identical ------------------------------------
  check("a note source is unchanged by the email cleaner", () => {
    assert.equal(compressSourceForTaskPrompt(NOTE_SOURCE, DEFAULT_SETTINGS), NOTE_EXPECTED, "the note summary must stay byte-identical");
    assert.equal(sourceContractSourceText(NOTE_SOURCE, DEFAULT_SETTINGS), NOTE_EXPECTED, "the note contract text must stay byte-identical");
  });

  if (failures.length) {
    console.error(`${failures.length} email-cleanup check(s) failed`);
    process.exit(1);
  }
  console.log(`PASS: email chain cleaning (${checks.length} checks)`);
}

main();
