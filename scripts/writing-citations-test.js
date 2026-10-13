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

process.stdout.write(JSON.stringify({ passed: 14, failed: 0 }, null, 2) + "\n");
