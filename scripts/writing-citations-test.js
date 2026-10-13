"use strict";

const assert = require("assert");

const { rewriteCitations } = require("../src/writing/citations");
const { planInsertion, insertDraft, composeDraft } = require("../src/writing/insert");

function makeEditor(text, cursor) {
  const calls = [];
  function posToOffset(pos) {
    const lines = text.split("\n");
    let off = 0;
    for (let i = 0; i < pos.line; i++) off += lines[i].length + 1;
    return off + pos.ch;
  }
  function offsetToPos(offset) {
    const lines = text.split("\n");
    let rest = offset;
    for (let i = 0; i < lines.length; i++) {
      if (rest <= lines[i].length) return { line: i, ch: rest };
      rest -= lines[i].length + 1;
    }
    const last = lines.length - 1;
    return { line: last, ch: lines[last].length };
  }
  return {
    calls,
    getValue: () => text,
    posToOffset,
    offsetToPos,
    getCursor: () => ({ line: cursor.line, ch: cursor.ch }),
    getSelection: () => "",
    replaceRange: (t, from, to) => {
      calls.push({ text: t, from, to });
    },
  };
}

function ev(eid, source) {
  return { eid, source };
}

// 1: basic rewrite, reuse, unknown dropped
{
  const evidence = [
    ev("E1", { kind: "vault", path: "Folder/Note.md", heading: "Heading" }),
    ev("E2", { kind: "vault", path: "Folder/Other.md" }),
  ];
  const r = rewriteCitations("a [E1] b [E1] c [E9]", evidence, "");
  assert.ok(r.markdown.includes("[^1]"), "first use becomes [^1]");
  assert.strictEqual(r.markdown.includes("[E1]"), false, "[E1] fully rewritten");
  assert.strictEqual(r.markdown.includes("[E9]"), false, "unknown [E9] removed");
  assert.strictEqual(r.dropped, 1, "dropped === 1");
  assert.deepStrictEqual(r.used, ["E1"], "used lists distinct eids");
  assert.ok(r.footnotes.includes("[^1]: [[Folder/Note#Heading]]"), "vault label");
  console.log("PASS basic rewrite reuse unknown-dropped");
}

// 2: bracket variants [E2, E5], [E2,E5], [E2][E5]
{
  const evidence = [
    ev("E2", { kind: "vault", path: "A.md" }),
    ev("E5", { kind: "vault", path: "B.md" }),
  ];
  for (const input of ["x [E2, E5] y", "x [E2,E5] y", "x [E2][E5] y"]) {
    const r = rewriteCitations(input, evidence, "");
    assert.ok(r.markdown.includes("[^1]") && r.markdown.includes("[^2]"), `variants map to two markers: ${input}`);
    assert.deepStrictEqual(r.used, ["E2", "E5"], `used order: ${input}`);
    assert.strictEqual(r.dropped, 0, `no drops: ${input}`);
  }
  console.log("PASS bracket variants");
}

// 3: numbering continues past existing numeric footnotes, ignores named
{
  const evidence = [ev("E2", { kind: "vault", path: "A.md" })];
  const noteText = "[^1] a\n[^2] b\n[^3] c\n[^4] d\n[^5] e\n[^6] f\n[^7] g\n[^ref] named\n";
  const r = rewriteCitations("x [E2]", evidence, noteText);
  assert.ok(r.markdown.includes("[^8]"), "first new footnote is [^8]");
  assert.ok(r.footnotes.startsWith("[^8]:"), "definition starts at [^8]");
  console.log("PASS numbering continues at 8 ignoring named");
}

// 4: definitions per kind
{
  const evidence = [
    ev("E1", { kind: "vault", path: "Folder/Note.md", heading: "Heading" }),
    ev("E2", { kind: "context-vault", path: "Writing Context/report.docx", locator: "p. 3" }),
    ev("E3", { kind: "context-external", name: "report.docx", locator: "Sheet: Q3" }),
  ];
  const r = rewriteCitations("[E1] [E2] [E3]", evidence, "");
  const lines = r.footnotes.split("\n");
  assert.strictEqual(lines.length, 3, "one definition per line");
  assert.strictEqual(lines[0], "[^1]: [[Folder/Note#Heading]]", "vault with heading");
  assert.strictEqual(lines[1], "[[Writing Context/report.docx]], p. 3".replace(/^/, "[^2]: "), "context-vault with locator");
  assert.strictEqual(lines[2], "[^3]: report.docx, Sheet: Q3", "external with locator");
  console.log("PASS definitions per kind");
}

// 4b: saved deep-research notes render as vault-style links (task 11)
{
  const evidence = [
    ev("E1", { kind: "research-vault", path: "Semantic Todoist Sync/Research/r.md", locator: "Findings" }),
    ev("E2", { kind: "research-vault", path: "Semantic Todoist Sync/Research/r.md", locator: "" }),
    ev("E3", { kind: "research-external", name: "r.pdf", locator: "p. 2" }),
  ];
  const r = rewriteCitations("[E1] [E2] [E3]", evidence, "");
  const lines = r.footnotes.split("\n");
  assert.strictEqual(lines[0], "[^1]: [[Semantic Todoist Sync/Research/r.md]], Findings", "research-vault with locator");
  assert.strictEqual(lines[1], "[^2]: [[Semantic Todoist Sync/Research/r.md]]", "research-vault omits empty locator");
  assert.strictEqual(lines[2], "[^3]: r.pdf, p. 2", "research-external with locator");
  console.log("PASS research footnote definitions");
}

// 5: vault without heading omits #heading; context-vault without locator omits it
{
  const r1 = rewriteCitations("[E1]", [ev("E1", { kind: "vault", path: "Folder/Note.md" })], "");
  assert.ok(r1.footnotes.includes("[[Folder/Note]]"), "vault omits #heading when absent");
  assert.ok(!r1.footnotes.includes("#"), "no stray #");
  const r2 = rewriteCitations("[E1]", [ev("E1", { kind: "context-vault", path: "Writing Context/a.docx", locator: "" })], "");
  assert.strictEqual(r2.footnotes, "[^1]: [[Writing Context/a.docx]]", "context-vault omits locator when empty");
  console.log("PASS omit missing heading locator");
}

// 6: unsafe names fall back to plain text, no wikilink
{
  for (const bad of ["a|b.docx", "a[b.docx", "a]b.docx", "a#b.docx"]) {
    const r = rewriteCitations("[E1]", [ev("E1", { kind: "context-vault", path: "Writing Context/" + bad, locator: "p. 1" })], "");
    assert.ok(!r.footnotes.includes("[["), `unsafe ${bad} has no wikilink`);
    assert.ok(r.footnotes.includes(bad), `unsafe ${bad} keeps plain name`);
  }
  const rv = rewriteCitations("[E1]", [ev("E1", { kind: "vault", path: "Folder/a|b.md", heading: "H" })], "");
  assert.ok(!rv.footnotes.includes("[["), "unsafe vault path has no wikilink");
  console.log("PASS unsafe names plain text");
}

// 7: planInsertion recorded
{
  const text = "0123456789".repeat(6) + "MARKER rest of note";
  const editor = makeEditor(text, { line: 0, ch: 0 });
  const from = editor.offsetToPos(text.indexOf("MARKER"));
  const off = editor.posToOffset(from);
  const prefix = text.slice(Math.max(0, off - 40), off);
  assert.strictEqual(prefix.length, 40, "prefix is 40 chars");
  const recorded = { path: "Note.md", from, to: from, prefix };
  const plan = planInsertion(editor, recorded, "Note.md");
  assert.strictEqual(plan.mode, "recorded", "unchanged prefix -> recorded");
  assert.deepStrictEqual(plan.from, from, "recorded from");
  assert.deepStrictEqual(plan.to, from, "recorded to");
  console.log("PASS planInsertion recorded");
}

// 8: planInsertion cursor + notice when prefix changed
{
  const text = "0123456789".repeat(6) + "MARKER rest of note";
  const editor = makeEditor("USER TYPED! " + text, { line: 0, ch: 5 });
  const staleFrom = { line: 0, ch: text.indexOf("MARKER") };
  // prefix captured before the user typed (from the original text)
  const stalePrefix = text.slice(Math.max(0, text.indexOf("MARKER") - 40), text.indexOf("MARKER"));
  const recorded = { path: "Note.md", from: staleFrom, to: staleFrom, prefix: stalePrefix };
  const plan = planInsertion(editor, recorded, "Note.md");
  assert.strictEqual(plan.mode, "cursor", "changed prefix -> cursor");
  assert.deepStrictEqual(plan.from, { line: 0, ch: 5 }, "cursor from");
  assert.deepStrictEqual(plan.to, { line: 0, ch: 5 }, "cursor to");
  assert.ok(typeof plan.notice === "string" && plan.notice.length > 0, "notice present");
  console.log("PASS planInsertion cursor with notice");
}

// 9: planInsertion closed
{
  const editor = makeEditor("hello", { line: 0, ch: 0 });
  const recorded = { path: "Note.md", from: { line: 0, ch: 1 }, to: { line: 0, ch: 1 }, prefix: "h" };
  const plan = planInsertion(editor, recorded, "Other.md");
  assert.strictEqual(plan.mode, "closed", "other note -> closed");
  assert.strictEqual(plan.from, undefined, "closed from undefined");
  assert.strictEqual(plan.to, undefined, "closed to undefined");
  console.log("PASS planInsertion closed");
}

// 10: insertDraft exactly one replaceRange with body + footnotes; composeDraft helper
{
  assert.strictEqual(composeDraft("body", "[^1]: x"), "body\n\n[^1]: x", "compose joins with blank line");
  assert.strictEqual(composeDraft("body", ""), "body", "empty footnotes -> body only");
  const editor = makeEditor("hello world", { line: 0, ch: 5 });
  const plan = { mode: "recorded", from: { line: 0, ch: 5 }, to: { line: 0, ch: 5 } };
  const full = composeDraft("draft body", "[^8]: [[A]]");
  insertDraft(editor, plan, full);
  assert.strictEqual(editor.calls.length, 1, "exactly one replaceRange call");
  assert.deepStrictEqual(editor.calls[0], { text: "draft body\n\n[^8]: [[A]]", from: plan.from, to: plan.to }, "call args");
  console.log("PASS insertDraft once with composed text");
}

// 11: planInsertion falls back to cursor when posToOffset throws (deleted lines)
{
  const editor = {
    getValue: () => "hello",
    posToOffset: () => { throw new Error("position no longer exists"); },
    getCursor: () => ({ line: 0, ch: 2 }),
  };
  const recorded = { path: "Note.md", from: { line: 5, ch: 0 }, to: { line: 5, ch: 0 }, prefix: "0123456789".repeat(4) };
  let plan;
  assert.doesNotThrow(() => { plan = planInsertion(editor, recorded, "Note.md"); }, "must never throw");
  assert.strictEqual(plan.mode, "cursor", "throw -> cursor");
  assert.deepStrictEqual(plan.from, { line: 0, ch: 2 }, "cursor from");
  assert.deepStrictEqual(plan.to, { line: 0, ch: 2 }, "cursor to");
  assert.ok(typeof plan.notice === "string" && plan.notice.length > 0, "notice present");
  console.log("PASS planInsertion posToOffset throw -> cursor");
}

// 12: planInsertion falls back to cursor when recorded offset exceeds document length
{
  const editor = {
    getValue: () => "hi",
    posToOffset: () => 999,
    getCursor: () => ({ line: 0, ch: 1 }),
  };
  const recorded = { path: "Note.md", from: { line: 0, ch: 999 }, to: { line: 0, ch: 999 }, prefix: "0123456789".repeat(4) };
  let plan;
  assert.doesNotThrow(() => { plan = planInsertion(editor, recorded, "Note.md"); }, "must never throw");
  assert.strictEqual(plan.mode, "cursor", "out-of-range offset -> cursor");
  assert.deepStrictEqual(plan.from, { line: 0, ch: 1 }, "cursor from");
  assert.deepStrictEqual(plan.to, { line: 0, ch: 1 }, "cursor to");
  assert.ok(typeof plan.notice === "string" && plan.notice.length > 0, "notice present");
  console.log("PASS planInsertion out-of-range offset -> cursor");
}

// 13: composeDraft empty/whitespace body returns footnotes only; empty footnotes returns body only
{
  assert.strictEqual(composeDraft("", "[^1]: x"), "[^1]: x", "empty body -> footnotes only");
  assert.strictEqual(composeDraft("   \n  ", "[^1]: x"), "[^1]: x", "whitespace body -> footnotes only");
  assert.strictEqual(composeDraft("body", "   "), "body", "whitespace footnotes -> body only");
  console.log("PASS composeDraft empty-body and empty-footnotes edges");
}

// 14: removing an unknown eid eats one adjacent space (no double space)
{
  const r = rewriteCitations("a [E9] b", [], "");
  assert.strictEqual(r.markdown, "a b", "no double space left behind");
  assert.strictEqual(r.dropped, 1, "dropped === 1");
  console.log("PASS unknown eid leaves single space");
}

// 14b: heading normalisation real values
{
  const r1 = rewriteCitations("[E1]", [ev("E1", { kind: "vault", path: "Projects/Intake Redesign.md", heading: "# Intake Redesign" })], "");
  assert.strictEqual(r1.footnotes, "[^1]: [[Projects/Intake Redesign]]", "repeated heading omitted: # Intake Redesign");

  const r2 = rewriteCitations("[E1]", [ev("E1", { kind: "vault", path: "Projects/Intake Redesign.md", heading: "## Goals" })], "");
  assert.strictEqual(r2.footnotes, "[^1]: [[Projects/Intake Redesign#Goals]]", "heading normalised: ## Goals");

  const r3 = rewriteCitations("[E1]", [ev("E1", { kind: "vault", path: "Projects/Intake Redesign.md", heading: "Plan > ## Risks #1" })], "");
  assert.strictEqual(r3.footnotes, "[^1]: [[Projects/Intake Redesign#Risks 1]]", "nested + special chars: Plan > ## Risks #1");

  const r4 = rewriteCitations("[E1]", [ev("E1", { kind: "vault", path: "Projects/Intake Redesign.md", heading: "### Q&A | misc" })], "");
  assert.strictEqual(r4.footnotes, "[^1]: [[Projects/Intake Redesign#Q&A misc]]", "pipe and whitespace: ### Q&A | misc");

  const r5 = rewriteCitations("[E1]", [ev("E1", { kind: "vault", path: "Folder/a|b.md", heading: "## H" })], "");
  assert.ok(!r5.footnotes.includes("[["), "unsafe vault path no wikilink");
  assert.strictEqual(r5.footnotes, "[^1]: a|b, H", "unsafe vault plain text with normalised heading");

  // 14c: colon and %% heading fixes
  {
    const r6 = rewriteCitations("[E1]", [ev("E1", { kind: "vault", path: "Research Team/August 17, 2026.md", heading: "Meeting Notes:" })], "");
    assert.strictEqual(r6.footnotes, "[^1]: [[Research Team/August 17, 2026#Meeting Notes]]", "colon stripped from heading");

    const r7 = rewriteCitations("[E1]", [ev("E1", { kind: "vault", path: "Note.md", heading: "## Q3: Plan | Risks" })], "");
    assert.strictEqual(r7.footnotes, "[^1]: [[Note#Q3 Plan Risks]]", "colon and pipe stripped");

    const r8 = rewriteCitations("[E1]", [ev("E1", { kind: "vault", path: "Note.md", heading: "100%% done" })], "");
    assert.strictEqual(r8.footnotes, "[^1]: [[Note#100 done]]", "double-percent stripped");

    console.log("PASS colon and percent heading fixes");
  }

  console.log("PASS heading normalisation real values");
}

// 15: evidence id ranges (live defect [E1, E3–E8]: raw range marker stayed in note)
{
  const evs = Array.from({ length: 8 }, (_, i) =>
    ev("E" + (i + 1), { kind: "vault", path: "A" + (i + 1) + ".md" }));
  // live case: comma list plus en-dash range expands every id in order
  const live = rewriteCitations("x [E1, E3–E8] y", evs, "");
  assert.ok(!live.markdown.includes("[E"), "live range fully rewritten, no raw marker");
  assert.deepStrictEqual(live.used, ["E1", "E3", "E4", "E5", "E6", "E7", "E8"], "live range expands E3-E8 after E1");
  assert.strictEqual(live.dropped, 0, "no drops when every id is listed");
  // all three dash forms plus E3-8 shorthand
  for (const input of ["[E3-E5]", "[E3–E5]", "[E3—E5]", "[E3-5]", "[E3–5]", "[E3—5]"]) {
    const r = rewriteCitations("x " + input + " y", evs, "");
    assert.deepStrictEqual(r.used, ["E3", "E4", "E5"], "dash form expands: " + input);
    assert.ok(!r.markdown.includes("[E"), "no raw marker: " + input);
    assert.strictEqual(r.dropped, 0, "no drops: " + input);
  }
  // mixed list and range in one group
  const mix = rewriteCitations("[E1, E3-E4]", evs, "");
  assert.deepStrictEqual(mix.used, ["E1", "E3", "E4"], "mixed list and range");
  // range ids not in the evidence list each count one dropped (as today)
  const gap = rewriteCitations("[E1-E4]", [ev("E1", { kind: "vault", path: "A.md" }), ev("E3", { kind: "vault", path: "B.md" })], "");
  assert.deepStrictEqual(gap.used, ["E1", "E3"], "only listed ids kept");
  assert.strictEqual(gap.dropped, 2, "E2 and E4 each drop once");
  assert.ok(!gap.markdown.includes("[E"), "no raw marker when partially unknown");
  // reversed range rejected as one unknown
  const rev = rewriteCitations("a [E5-E3] b", evs, "");
  assert.deepStrictEqual(rev.used, [], "reversed expands nothing");
  assert.strictEqual(rev.dropped, 1, "reversed counts one drop");
  assert.strictEqual(rev.markdown, "a b", "reversed eats adjacent space like unknown");
  // single range capped at 32 ids: oversized rejected as one unknown
  const big = rewriteCitations("a [E1-E40] b", evs, "");
  assert.deepStrictEqual(big.used, [], "oversized expands nothing");
  assert.strictEqual(big.dropped, 1, "oversized counts one drop");
  assert.ok(!big.markdown.includes("[E"), "oversized marker removed");
  // "to" is NOT a range: only the three dash forms expand
  const to = rewriteCitations("a [E3 to E5] b", evs, "");
  assert.ok(to.markdown.includes("[E3 to E5]"), "to-form left raw");
  assert.deepStrictEqual(to.used, [], "to-form defines nothing");
  console.log("PASS evidence id ranges");
}

process.stdout.write(JSON.stringify({ passed: 19, failed: 0 }, null, 2) + "\n");
