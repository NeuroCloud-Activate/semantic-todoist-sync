"use strict";

const assert = require("assert");

const {
  metaFromFrontmatter,
  sourceKey,
  formatReference,
  formatInText,
  planReferences,
} = require("../src/writing/styles");
const { rewriteCitations } = require("../src/writing/citations");

const JOURNAL_TITLE = "Secretory vesicle transport velocity in living cells depends on myosin V lever arm length";
const journalMeta = {
  authors: ["Schott, Dale H.", "Collins, Ruth N.", "Bretscher, Anthony"],
  year: 2002,
  title: JOURNAL_TITLE,
  journal: "J. Cell Biol.",
  volume: 156,
  pages: "35-39",
};
const WEB_URL = "http://blogs.scientificamerican.com/psi-vid/2014/04/09/sloth-squeak";
const webMeta = { title: "Sloth squeak", url: WEB_URL, site: "blogs.scientificamerican.com" };

// 1: exact entries from the plan
{
  const journal = { kind: "vault", path: "papers/schott.md", meta: journalMeta };
  assert.strictEqual(
    formatReference("nature", journal),
    "Schott, D. H., Collins, R. N. & Bretscher, A. " + JOURNAL_TITLE + ". *J. Cell Biol.* **156**, 35-39 (2002).",
    "nature journal entry"
  );
  console.log("PASS nature journal entry");
}
{
  const journal = { kind: "vault", path: "papers/schott.md", meta: journalMeta };
  assert.strictEqual(
    formatReference("apa", journal),
    "Schott, D. H., Collins, R. N., & Bretscher, A. (2002). " + JOURNAL_TITLE + ". *J. Cell Biol.*, *156*, 35-39.",
    "apa journal entry"
  );
  console.log("PASS apa journal entry");
}
{
  const web = { kind: "web", meta: webMeta };
  assert.strictEqual(
    formatReference("nature", web),
    "Sloth squeak. *blogs.scientificamerican.com* " + WEB_URL,
    "nature web"
  );
  console.log("PASS nature web");
}
{
  const web = { kind: "web", meta: webMeta };
  assert.strictEqual(
    formatReference("apa", web),
    "*Sloth squeak*. (n.d.). blogs.scientificamerican.com. " + WEB_URL,
    "apa web"
  );
  console.log("PASS apa web");
}
{
  const note = { kind: "vault", path: "Grants/Budget 2026.md", meta: { title: "Budget 2026" } };
  assert.strictEqual(formatReference("nature", note), "Budget 2026. [[Grants/Budget 2026]]", "nature bare note");
  console.log("PASS nature bare note");
}
{
  const note = { kind: "vault", path: "Grants/Budget 2026.md", meta: { title: "Budget 2026" } };
  assert.strictEqual(formatReference("apa", note), "*Budget 2026*. (n.d.). [[Grants/Budget 2026]]", "apa bare note");
  console.log("PASS apa bare note");
}

// 2: six authors -> first author + et al.
{
  const meta = {
    authors: ["First, A.", "Second, B.", "Third, C.", "Fourth, D.", "Fifth, E.", "Sixth, F."],
    title: "Six author study.",
  };
  const entry = formatReference("nature", { kind: "vault", path: "a.md", meta });
  assert.ok(entry.startsWith("First, A. et al. "), "six authors collapse to first + et al.: " + entry);
  console.log("PASS nature six authors");
}

// 3: apa in-text forms
{
  const one = { meta: { authors: ["Smith, John"], year: 2020 } };
  const two = { meta: { authors: ["Smith, John", "Lee, Karen"], year: 2020 } };
  const three = { meta: journalMeta };
  const none = { meta: { title: "Budget 2026" } };
  assert.strictEqual(formatInText("apa", [{ source: one }]), "(Smith, 2020)", "one author");
  assert.strictEqual(formatInText("apa", [{ source: two }]), "(Smith & Lee, 2020)", "two authors");
  assert.strictEqual(formatInText("apa", [{ source: three }]), "(Schott et al., 2002)", "three authors");
  assert.strictEqual(formatInText("apa", [{ source: none }]), "(*Budget 2026*, n.d.)", "no author");
  const s1 = { meta: { authors: ["Smith, John"], year: 2020 } };
  const s2 = { meta: { authors: ["Lee, Karen"], year: 2021 } };
  assert.strictEqual(formatInText("apa", [{ source: s1 }, { source: s2 }]), "(Smith, 2020; Lee, 2021)", "two items share one bracket, joined with ; ");
  console.log("PASS apa in-text");
}

// 4: nature in-text numbers
{
  const a = { meta: { title: "A" } };
  const b = { meta: { title: "B" } };
  assert.strictEqual(formatInText("nature", [{ source: a, number: 1 }]), "[1]", "single number");
  assert.strictEqual(formatInText("nature", [{ source: a, number: 1 }, { source: b, number: 3 }]), "[1,3]", "comma-joined");
  assert.strictEqual(formatInText("nature", [{ source: b, number: 3 }, { source: a, number: 1 }]), "[1,3]", "numbers read ascending whatever the marker order");
  assert.strictEqual(formatInText("nature", [{ source: a, number: 1 }, { source: b, number: 1 }]), "[1]", "a repeated number is not listed twice");
  console.log("PASS nature in-text");
}

// 5: metaFromFrontmatter
{
  const m1 = metaFromFrontmatter({ author: "Jane A. Smith" });
  assert.deepStrictEqual(m1.authors, ["Smith, Jane A."], "Given Last -> Surname, Given");
  const apaEntry = formatReference("apa", { kind: "vault", path: "a.md", meta: { ...m1, year: 2020, title: "T" } });
  assert.ok(apaEntry.includes("Smith, J. A."), "given names become initials: " + apaEntry);
  const m2 = metaFromFrontmatter({ date: "2021-05-04" });
  assert.strictEqual(m2.year, 2021, "first 4-digit year from date");
  const m3 = metaFromFrontmatter({ authors: ["Dale H. Schott", "Ruth N. Collins"] });
  assert.deepStrictEqual(m3.authors, ["Schott, Dale H.", "Collins, Ruth N."], "authors list kept in order");
  console.log("PASS metaFromFrontmatter");
}

// 6: planReferences with no References section
{
  const noteText = "Just a note.\nWith text.";
  const r = planReferences(noteText, "apa", [{ meta: { title: "Alpha", url: "http://a" } }]);
  assert.ok(r.edit, "edit present");
  assert.strictEqual(r.edit.from, noteText.length, "from at end of note");
  assert.strictEqual(r.edit.to, noteText.length, "to at end of note");
  assert.ok(r.edit.text.startsWith("\n\n## References\n\n"), "appends References section: " + JSON.stringify(r.edit.text));
  console.log("PASS planReferences no section");
}

// 7: nature reuses existing numbers, new source takes next number
{
  const noteText = "## References\n1. Smith, A. http://x\n2. Jones, B. http://y\n";
  const xSource = { meta: { url: "x" } };
  const newSource = { meta: { title: "new" } };
  const r = planReferences(noteText, "nature", [xSource, newSource]);
  assert.strictEqual(r.numbers["x"], 1, "existing source reuses number 1");
  assert.strictEqual(r.numbers["new"], 3, "new source takes number 3");
  assert.strictEqual(r.added.length, 1, "one entry added");
  assert.ok(r.added[0].startsWith("3. "), "added entry starts with '3. ': " + r.added[0]);
  console.log("PASS planReferences nature reuse");
}

// 8: apa re-sorts entries and does not duplicate a listed source
{
  const noteText = "## References\n- Zed, Z. (2020). Zed entry. http://z\n";
  const alpha = { meta: { title: "Alpha", url: "http://a" } };
  const zed = { meta: { url: "http://z" } };
  const r = planReferences(noteText, "apa", [alpha, zed]);
  assert.strictEqual(r.added.length, 1, "already-listed source not duplicated");
  assert.ok(r.edit.text.indexOf("Alpha") < r.edit.text.indexOf("Zed"), "section ordered Alpha, Zed: " + r.edit.text);
  assert.strictEqual(r.edit.text.split("http://z").length - 1, 1, "zed url appears exactly once");
  console.log("PASS planReferences apa sort + dedupe");
}

// 9: section ends at the next heading of same or higher level
{
  const noteText = "Intro.\n\n## References\n\n## Appendix\n\nApp body.\n";
  const r = planReferences(noteText, "apa", [{ meta: { title: "New" } }]);
  assert.strictEqual(r.edit.to, noteText.indexOf("## Appendix"), "edit stops at ## Appendix");
  assert.ok(!r.edit.text.includes("Appendix"), "appendix untouched");
  assert.strictEqual(r.edit.from, noteText.indexOf("## References") + "## References\n".length, "edit starts after heading line");
  console.log("PASS planReferences stops at next heading");
}

// 10: rewriteCitations apa/nature end to end
{
  const evidence = [
    { eid: "E1", source: { kind: "vault", path: "papers/schott.md", meta: journalMeta } },
    { eid: "E2", source: { kind: "web", meta: webMeta } },
  ];
  const input = "Claim [E1]. More [E2, E1]. Tail [E9].";

  const apa = rewriteCitations(input, evidence, "", "apa");
  assert.strictEqual(apa.markdown, "Claim (Schott et al., 2002). More (*Sloth squeak*, n.d.; Schott et al., 2002). Tail.", "apa markers: " + apa.markdown);
  assert.strictEqual(apa.footnotes, "", "apa footnotes empty");
  assert.strictEqual(apa.cited.length, 2, "apa cited length");
  assert.strictEqual(apa.dropped, 1, "apa unknown dropped");
  assert.deepStrictEqual(apa.used, ["E1", "E2"], "apa used order");
  assert.ok(!apa.markdown.includes("[E9]"), "unknown marker removed");

  const nature = rewriteCitations(input, evidence, "", "nature");
  assert.strictEqual(nature.markdown, "Claim [1]. More [1,2]. Tail.", "nature markers: " + nature.markdown);
  assert.strictEqual(nature.footnotes, "", "nature footnotes empty");
  assert.strictEqual(nature.cited.length, 2, "nature cited length");
  assert.strictEqual(nature.dropped, 1, "nature unknown dropped");
  assert.deepStrictEqual(nature.used, ["E1", "E2"], "nature used order");
  assert.strictEqual(nature.numbers["[[papers/schott]]"], 1, "nature number for E1 source");
  assert.strictEqual(nature.numbers[WEB_URL], 2, "nature number for E2 source");

  // footnotes style unchanged: same output as before, plus cited/numbers
  const fn = rewriteCitations(input, evidence, "");
  assert.ok(fn.markdown.includes("[^1]") && fn.markdown.includes("[^2]"), "footnotes markers");
  assert.ok(fn.footnotes.startsWith("[^1]:"), "footnotes definitions");
  assert.strictEqual(fn.dropped, 1, "footnotes dropped");
  assert.deepStrictEqual(fn.used, ["E1", "E2"], "footnotes used order");
  assert.strictEqual(fn.cited.length, 2, "footnotes cited added");
  assert.deepStrictEqual(fn.numbers, {}, "footnotes numbers empty");
  console.log("PASS rewriteCitations apa/nature");
}

{
  const meta = { title: "Draft ethics amendment", url: "https://todoist.com/app/task/1", site: "Todoist", year: 2026 };
  for (const style of ["apa", "nature"]) {
    assert.strictEqual(formatReference(style, { kind: "todoist", meta }), formatReference(style, { kind: "web", meta }), "todoist formats as web (" + style + ")");
  }
  console.log("PASS todoist as web");
}
process.stdout.write(JSON.stringify({ passed: 16, failed: 0 }, null, 2) + "\n");
