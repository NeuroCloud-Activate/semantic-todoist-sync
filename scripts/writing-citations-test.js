"use strict";

const assert = require("assert");

const { rewriteCitations, normalizeBareCitations } = require("../src/writing/citations");
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

// 13b: composeDraft appends the Sources searched block last (after footnotes), once, only with a body
{
  const block = "Sources searched:\n- deep research: not searched (turned off)\n- vault: searched\n- context folder: searched";
  assert.strictEqual(composeDraft("body", "[^1]: x", block), "body\n\n[^1]: x\n\n" + block, "block appended last after footnotes");
  assert.strictEqual(composeDraft("body", "", block), "body\n\n" + block, "block appended without footnotes");
  assert.strictEqual(composeDraft("body", "[^1]: x"), "body\n\n[^1]: x", "omitted block -> identical output");
  assert.strictEqual(composeDraft("body", "[^1]: x", "   "), "body\n\n[^1]: x", "blank block -> unchanged");
  assert.strictEqual(composeDraft("", "[^1]: x", block), "[^1]: x", "no body -> block not added");
  assert.strictEqual(composeDraft("", "", block), "", "empty draft -> unchanged");
  assert.strictEqual(composeDraft("body\n\n" + block, "", block), "body\n\n" + block, "model-echoed block not duplicated");
  console.log("PASS composeDraft appends Sources searched last, once, only with a body");
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

// 16: bare evidence ids in prose become citations (the model sometimes drops the brackets)
{
  const note = (n) => ev("E" + n, { kind: "vault", path: "N" + n + ".md" });
  const evs = [229, 230, 232, 16, 17, 18, 19].map(note);
  const one = rewriteCitations("E232 shows the guidelines.", evs, "");
  assert.strictEqual(one.markdown, "[^1] shows the guidelines.", "bare id at the start: " + one.markdown);
  assert.deepStrictEqual(one.used, ["E232"], "bare id counted as used");
  const two = rewriteCitations("but E229 and E230 still list it.", evs, "");
  assert.strictEqual(two.markdown, "but [^1][^2] still list it.", "bare list: " + two.markdown);
  assert.deepStrictEqual(two.used, ["E229", "E230"], "both ids of a bare list cited");
  const comma = rewriteCitations("see E229, E230.", evs, "");
  assert.deepStrictEqual(comma.used, ["E229", "E230"], "comma list cited");
  for (const input of ["E16–E19", "E16-E19"]) {
    const r = rewriteCitations("x " + input + " y", evs, "");
    assert.deepStrictEqual(r.used, ["E16", "E17", "E18", "E19"], "bare range: " + input);
    assert.ok(!/E\d/.test(r.markdown), "no raw id left: " + r.markdown);
  }
  const mixedUnknown = rewriteCitations("E10 and E232 agree.", evs, "");
  assert.strictEqual(mixedUnknown.markdown, "E10 and [^1] agree.", "unknown id in a bare list stays, known one cited: " + mixedUnknown.markdown);
  console.log("PASS bare evidence ids become citations");
}

// 17: normalizeBareCitations tidy-up and protected text
{
  const sets = (allowed, known) => ({ allowed: new Set(allowed), known: new Set(known) });
  assert.strictEqual(typeof normalizeBareCitations, "function", "normalizeBareCitations exported");
  const n = (text, a, k) => normalizeBareCitations(text, sets(a, k || a));
  assert.strictEqual(n("The E5 note says X.", ["E1"], ["E1", "E5"]), "The note says X.", "known-not-allowed id removed, one space left");
  assert.strictEqual(n("See E5.", ["E1"], ["E1", "E5"]), "See.", "no space before punctuation");
  assert.strictEqual(n("Two (E5) here.", ["E1"], ["E1", "E5"]), "Two here.", "empty parentheses removed");
  assert.strictEqual(n("but E5 and E6 still list", ["E1"], ["E1", "E5", "E6"]), "but still list", "removed list leaves one space");
  assert.strictEqual(n("E5 first", ["E1"], ["E1", "E5"]), "first", "removed at line start");
  assert.strictEqual(n("A form named E10 and E2E tests.", ["E1"], ["E1"]), "A form named E10 and E2E tests.", "unknown id and E2E untouched");
  assert.strictEqual(n("Model E1.5 is v2.", ["E1"], ["E1"]), "Model E1.5 is v2.", "E1.5 is not an id");
  assert.strictEqual(n("x E1 y", ["E1"]), "x [E1] y", "allowed bare id becomes a marker");
  const protectedText = "[E1] [E1](https://x.test/E1) `E1` [[Note E1]] https://x.test/E1 ```\nE1\n```";
  assert.strictEqual(n(protectedText, ["E1"]), protectedText, "markers, link text and urls, code and wikilinks untouched");
  assert.strictEqual(n("a [E1](https://x.test/E1) b E1", ["E1"]), "a [E1](https://x.test/E1) b [E1]", "text after a link is still converted");
  console.log("PASS normalizeBareCitations");
}

// 17b: removal never leaves broken punctuation or an empty bullet
{
  const s = { allowed: new Set(["E1"]), known: new Set(["E1", "E4"]) };
  const n = (t) => normalizeBareCitations(t, s);
  assert.strictEqual(n("(see E4)."), "(see).", "no space before closing bracket: " + n("(see E4)."));
  assert.strictEqual(n("(E4)."), ".", "empty parens with trailing dot");
  assert.strictEqual(n("a, E4, b"), "a, b", "no doubled comma: " + n("a, E4, b"));
  assert.strictEqual(n("- E4\n- keep"), "- keep", "empty bullet dropped: " + JSON.stringify(n("- E4\n- keep")));
  assert.strictEqual(n("1. E4\ntext"), "text", "empty numbered item dropped");
  assert.strictEqual(n("x (a, E4) y"), "x (a) y", "no comma before closing bracket: " + n("x (a, E4) y"));
  assert.strictEqual(n("x ( E4 ) y"), "x y", "empty parens removed");
  assert.strictEqual(n("- E1 ok"), "- [E1] ok", "allowed ids still converted");
  console.log("PASS bare removal tidy");
}

// 18: todoist citations are inline links, never footnotes or reference entries
{
  const task = (n, extra) => ({ kind: "todoist", title: "Task " + n, project: "Thesis", url: "https://app.todoist.com/app/task/" + n, state: "open", meta: { title: "Task " + n, site: "Todoist", url: "https://app.todoist.com/app/task/" + n, year: 2026 }, ...extra });
  const evs = [ev("E1", { kind: "vault", path: "A.md" }), ev("E2", task(2)), ev("E3", task(3)), ev("E4", { kind: "vault", path: "B.md" })];
  // each task link shows its own sequence number in brackets: [\[T1\]](<url>)
  const t = (seq, n) => "[\\[T" + seq + "\\]](<https://app.todoist.com/app/task/" + n + ">)";

  const only = rewriteCitations("a [E2] b", evs, "");
  assert.strictEqual(only.markdown, "a " + t(1, 2) + " b", "todoist marker becomes a numbered inline link: " + only.markdown);
  assert.strictEqual(only.footnotes, "", "todoist adds no footnote: " + only.footnotes);
  assert.deepStrictEqual(only.used, ["E2"], "todoist id still reported as used");
  assert.strictEqual(only.cited.length, 1, "todoist source still reported as cited");

  const first = rewriteCitations("x [E2] y [E1] z [E4]", evs, "");
  assert.strictEqual(first.markdown, "x " + t(1, 2) + " y [^1] z [^2]", "todoist consumes no footnote number: " + first.markdown);
  assert.deepStrictEqual(first.footnotes.split("\n"), ["[^1]: [[A]]", "[^2]: [[B]]"], "footnotes numbered from 1: " + first.footnotes);
  assert.deepStrictEqual(first.used, ["E2", "E1", "E4"], "used keeps first-seen order");

  const continued = rewriteCitations("x [E2] y [E1]", evs, "[^3] old");
  assert.strictEqual(continued.markdown, "x " + t(1, 2) + " y [^4]", "numbering still continues the note: " + continued.markdown);

  const mixed = rewriteCitations("a [E2, E1] b", evs, "");
  assert.strictEqual(mixed.markdown, "a [^1] " + t(1, 2) + " b", "mixed group: footnote then inline link: " + mixed.markdown);
  assert.strictEqual(mixed.footnotes, "[^1]: [[A]]", "mixed group footnotes only the note");

  const many = rewriteCitations("a [E2, E3] b", evs, "");
  assert.strictEqual(many.markdown, "a " + t(1, 2) + t(2, 3) + " b", "several tasks: adjacent numbered links: " + many.markdown);

  const bare = rewriteCitations("E2 and E3 agree.", evs, "");
  assert.strictEqual(bare.markdown, t(1, 2) + t(2, 3) + " agree.", "bare task ids become links too: " + bare.markdown);
  const mix2 = rewriteCitations("a [E1, E2, E3] b", evs, "");
  assert.strictEqual(mix2.markdown, "a [^1] " + t(1, 2) + t(2, 3) + " b", "mixed group: note then adjacent task links: " + mix2.markdown);

  // task numbers run in order of first appearance and repeat for later citations
  const own = rewriteCitations("x [E2] y [E3] z [E2]", evs, "");
  assert.strictEqual(own.markdown, "x " + t(1, 2) + " y " + t(2, 3) + " z " + t(1, 2), "own sequence by first appearance: " + own.markdown);
  assert.deepStrictEqual(own.used, ["E2", "E3"], "used reports both tasks");

  // task numbers are independent of note footnote numbers
  const indep = rewriteCitations("n [E1] t [E2]", evs, "");
  assert.strictEqual(indep.markdown, "n [^1] t " + t(1, 2), "task numbering ignores note footnotes: " + indep.markdown);

  for (const style of ["apa", "nature"]) {
    const styled = rewriteCitations("a [E2] b [E3] c [E2]", [ev("E2", task(2)), ev("E3", task(3))], "", style);
    assert.strictEqual(styled.markdown, "a " + t(1, 2) + " b " + t(2, 3) + " c " + t(1, 2), style + " keeps task numbers: " + styled.markdown);
    assert.strictEqual(styled.footnotes, "", style + ": tasks add no footnote");
  }

  for (const url of ["", "javascript:x", "not a url", "https://x.test/a b"]) {
    const bad = rewriteCitations("a [E2] b", [ev("E2", task(2, { url }))], "");
    assert.strictEqual(bad.markdown, "a b", "invalid url '" + url + "' renders nothing: " + bad.markdown);
    assert.strictEqual(bad.footnotes, "", "invalid url adds no footnote");
    const next = rewriteCitations("a [E2] b [E3]", [ev("E2", task(2, { url })), ev("E3", task(3))], "");
    assert.strictEqual(next.markdown, "a b " + t(1, 3), "invalid url consumes no T number: " + next.markdown);
  }
  const todoistScheme = rewriteCitations("a [E2] b", [ev("E2", task(2, { url: "todoist://task?id=6gjvC96xxWrjG2PH" }))], "");
  assert.strictEqual(todoistScheme.markdown, "a [\\[T1\\]](<todoist://task?id=6gjvC96xxWrjG2PH>) b", "todoist:// urls are links: " + todoistScheme.markdown);
  console.log("PASS todoist inline links");
}

// 19: task numbers continue those already cited in the note (Apply keeps numbering)
{
  const task = (n, extra) => ({ kind: "todoist", title: "Task " + n, project: "Thesis", url: "https://app.todoist.com/app/task/" + n, state: "open", meta: { title: "Task " + n, site: "Todoist", url: "https://app.todoist.com/app/task/" + n, year: 2026 }, ...extra });
  const t = (seq, n) => "[\\[T" + seq + "\\]](<https://app.todoist.com/app/task/" + n + ">)";

  // re-citing task/2 must stay T1, not become T2
  const repro = rewriteCitations("[E9] [E2]", [ev("E2", task(2)), ev("E9", task(99))], "ACCEPTED FINDING only " + t(1, 2) + ".\n");
  assert.strictEqual(repro.markdown, t(2, 99) + " " + t(1, 2), "seeded task keeps T1, new task gets T2: " + repro.markdown);

  // a task already numbered T3 keeps T3
  const t3 = rewriteCitations("[E2]", [ev("E2", task(2))], "x " + t(3, 2) + " y");
  assert.strictEqual(t3.markdown, t(3, 2), "seeded task keeps T3: " + t3.markdown);

  // new tasks number after the seeded maximum, in first-appearance order; seeded tasks reuse
  const mixed = rewriteCitations("[E9] [E3] [E9]", [ev("E9", task(9)), ev("E3", task(3))], t(1, 2) + " and " + t(2, 3));
  assert.strictEqual(mixed.markdown, t(3, 9) + " " + t(2, 3) + " " + t(3, 9), "mixed seeded and new: " + mixed.markdown);

  // no task links in the note: numbering starts at T1 as before
  const fresh = rewriteCitations("[E2] [E3]", [ev("E2", task(2)), ev("E3", task(3))], "[^1] old footnote\n");
  assert.strictEqual(fresh.markdown, t(1, 2) + " " + t(2, 3), "no seeded links: " + fresh.markdown);

  // plain text that merely looks like a number does not seed
  const literal = rewriteCitations("[E2]", [ev("E2", task(2))], "plain [T3] and [\\[T4\\]] text\n");
  assert.strictEqual(literal.markdown, t(1, 2), "non-link literals do not seed: " + literal.markdown);

  // an invalid url still drops its marker and consumes no number
  const badUrl = rewriteCitations("[E2] [E3]", [ev("E2", task(2, { url: "javascript:x" })), ev("E3", task(3))], t(4, 9));
  assert.strictEqual(badUrl.markdown, t(5, 3), "invalid url consumes no number after seeded max: " + badUrl.markdown);
  console.log("PASS task numbers seed from note");
}
process.stdout.write(JSON.stringify({ passed: 23, failed: 0 }, null, 2) + "\n");

