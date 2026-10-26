"use strict";
// Task 10 (precision-first duplicate gate) - plain node + assert, prints `PASS <case>`.
const assert = require("assert");
const { ruleGate, dedupeCandidates, confirmPair, STRICT_JUDGE_PROMPT, CALIBRATED_EMBEDDING_MODELS, vetoKeyTokens, bestDuplicateCandidate, boxesOnVerdict, mergeDuplicateIntoExisting, STRICT_VERDICT_SCHEMA, DUPLICATE_BOX_MIN, NEAR_IDENTICAL_MIN } = require("../src/todoist/dedupe.js");

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack}`); }
}
const T = (o) => Object.assign({ id: "1", content: "Send the quarterly budget report to finance", projectId: "p1", sectionId: "s1", parentId: null, dueDate: "2026-11-01", isRecurring: false }, o);
const gate = (a, b, extra = []) => ruleGate(a, b, new Map([a, b, ...extra].map((t) => [String(t.id), t])));

test("baseline pair passes gate", () => assert.strictEqual(gate(T({ id: "1" }), T({ id: "2", content: "Send quarterly budget report to the finance team" })), null));
test("gate: parent and subtask rejected", () => {
  assert.ok(gate(T({ id: "1" }), T({ id: "2", parentId: "1" })));
  assert.ok(gate(T({ id: "2", parentId: "1" }), T({ id: "1" })));
});
test("gate: sibling subtasks of different parents rejected", () => {
  assert.ok(gate(T({ id: "1", parentId: "9" }), T({ id: "2", parentId: "8" })));
  assert.strictEqual(gate(T({ id: "1", parentId: "9" }), T({ id: "2", parentId: "9" })), null);
});
test("gate: different projects rejected unless titles identical", () => {
  assert.ok(gate(T({ id: "1" }), T({ id: "2", projectId: "p2", content: "Send quarterly budget report to finance team" })));
  assert.strictEqual(gate(T({ id: "1" }), T({ id: "2", projectId: "p2", content: "send the Quarterly Budget Report to finance!" })), null);
});
test("gate: recurring vs one-off rejected", () => {
  assert.ok(gate(T({ id: "1", isRecurring: true }), T({ id: "2" })));
});
test("gate: short title rejected unless everything matches", () => {
  assert.ok(gate(T({ id: "1", content: "Call Bob" }), T({ id: "2", content: "Call Bob" , dueDate: "2026-11-02" })));
  assert.ok(gate(T({ id: "1", content: "Call Bob" }), T({ id: "2", content: "Call Bob now please today" })));
  assert.strictEqual(gate(T({ id: "1", content: "Call Bob" }), T({ id: "2", content: "Call Bob" })), null);
});
test("STRICT_JUDGE_PROMPT is a non-empty string", () => assert.ok(typeof STRICT_JUDGE_PROMPT === "string" && /not-duplicate/.test(STRICT_JUDGE_PROMPT)));

test("gate: top-level dueDate drives short-title; date part only", () => {
  const c = { id: "1", content: "Call Bob", dueDate: "2026-11-01", projectId: "p1", sectionId: "", parentId: "", isRecurring: false };
  assert.strictEqual(ruleGate(c, { ...c, id: "2", dueDate: "2026-12-05" }), "short-title");
  assert.strictEqual(ruleGate(c, { ...c, id: "2", dueDate: "2026-11-01T10:00:00" }), null);
});
test("gate: recurring-mismatch with isRecurring true vs false", () => {
  assert.strictEqual(gate(T({ id: "1", isRecurring: true }), T({ id: "2" })), "recurring-mismatch");
});
test("gate: unknown isRecurring rejects; due-object fallback still works", () => {
  assert.strictEqual(gate(T({ id: "1", isRecurring: undefined }), T({ id: "2" })), "recurring-unknown");
  assert.strictEqual(gate(T({ id: "1" }), T({ id: "2", isRecurring: "no" })), "recurring-unknown");
  const d = (r) => T({ isRecurring: undefined, dueDate: undefined, due: { date: "2026-11-01", isRecurring: r } });
  assert.strictEqual(gate({ ...d(false), id: "1" }, { ...d(false), id: "2" }), null);
  assert.strictEqual(gate({ ...d(true), id: "1" }, { ...d(false), id: "2" }), "recurring-mismatch");
});
test("due object without a recurring flag is unknown and rejects", () => {
  const d = (due) => T({ isRecurring: undefined, dueDate: undefined, due });
  assert.strictEqual(gate({ ...d({ date: "2026-11-01" }), id: "1" }, { ...d({ date: "2026-11-01" }), id: "2" }), "recurring-unknown");
});
test("due.is_recurring boolean is read", () => {
  const d = (r) => T({ isRecurring: undefined, dueDate: undefined, due: { date: "2026-11-01", is_recurring: r } });
  assert.strictEqual(gate({ ...d(false), id: "1" }, { ...d(false), id: "2" }), null);
  assert.strictEqual(gate({ ...d(true), id: "1" }, { ...d(false), id: "2" }), "recurring-mismatch");
});
test("prompt carries precision framing", () => {
  assert.ok(/Precision matters far more than recall: when in doubt, answer "not-duplicate"/.test(STRICT_JUDGE_PROMPT));
  assert.ok(/so that completing one would make the other pointless/.test(STRICT_JUDGE_PROMPT));
});
test("string confidence rejected", () => {
  assert.strictEqual(confirmPair([{ verdict: "duplicate", confidence: "0.9" }]), false);
});
test("length-mismatched vectors yield no pair", () => {
  const a = T({ id: "1" }), b = T({ id: "2", content: "Send the quarterly budget report to finance team" });
  assert.deepStrictEqual(dedupeCandidates([a, b], { 1: [1, 0, 5], 2: [1, 0] }, { cosineMin: 0.5 }).pairs, []);
});
test("self pair never produced", () => {
  const t = T({ id: "1" });
  const { pairs } = dedupeCandidates([t], { 1: [1, 0] }, { cosineMin: 0 });
  assert.deepStrictEqual(pairs, []);
});
test("candidates: cosine cut-off (default 0.96) and gate applied", () => {
  const a = T({ id: "1" }), b = T({ id: "2", content: "Send quarterly budget report to the finance team" }), c = T({ id: "3", content: "Send quarterly budget report to finance team", parentId: "1" });
  const v = { 1: [1, 0], 2: [1, 0.01], 3: [1, 0] };
  const { pairs, missing } = dedupeCandidates([a, b, c], v);
  assert.deepStrictEqual(missing, []);
  assert.deepStrictEqual(pairs.map((p) => [p.aId, p.bId]), [["1", "2"], ["2", "3"]]); // 1-3 is parent/subtask, so it is gated out
  assert.ok(pairs[0].cosine >= 0.96);
  assert.deepStrictEqual(dedupeCandidates([a, b], { 1: [1, 0], 2: [1, 1] }).pairs, []);
});
test("unembedded tasks embedded first, not skipped", () => {
  const a = T({ id: "1" }), b = T({ id: "2" });
  const r = dedupeCandidates([a, b], { 1: [1, 0] });
  assert.deepStrictEqual(r.missing, ["2"]);
  assert.deepStrictEqual(r.pairs, []);
});

test("judges disagree → not suggested", () => {
  assert.strictEqual(confirmPair([{ verdict: "duplicate", confidence: 0.95 }, { verdict: "not-duplicate", confidence: 0.9 }]), false);
  assert.strictEqual(confirmPair([{ verdict: "duplicate", confidence: 0.95 }, { verdict: "unsure", confidence: 0.9 }]), false);
});
test("confidence 0.79 → not suggested", () => {
  assert.strictEqual(confirmPair([{ verdict: "duplicate", confidence: 0.79 }]), false);
  assert.strictEqual(confirmPair([{ verdict: "duplicate", confidence: 0.8 }, { verdict: "duplicate", confidence: 0.95 }]), true);
  assert.strictEqual(confirmPair([]), false);
});

test("calibrated embedding models are only embeddinggemma-2; dedupeAllowed is retired", () => {
  assert.deepStrictEqual(CALIBRATED_EMBEDDING_MODELS, ["embeddinggemma-2"]);
  assert.strictEqual(require("../src/todoist/dedupe.js").dedupeAllowed, undefined);
});

test("no due date is one-off; due without flag stays unknown", () => {
  const n = (o) => T({ isRecurring: undefined, dueDate: undefined, ...o });
  assert.strictEqual(gate(n({ id: "1" }), n({ id: "2", content: "Send quarterly budget report finance team" })), null);
  assert.strictEqual(gate(n({ id: "1", isRecurring: true }), n({ id: "2" })), "recurring-mismatch");
  assert.strictEqual(gate(n({ id: "1", due_date: "2026-11-01" }), n({ id: "2" })), "recurring-unknown");
  assert.strictEqual(gate(n({ id: "1", due: null }), n({ id: "2", due: "" , content: "Send quarterly budget report finance team" })), null);
});
test("veto: person, program, number, generic words", () => {
  const v = (a, b) => vetoKeyTokens({ content: a }, { content: b });
  assert.strictEqual(v("Email Sophie draft", "Email Catherine draft"), "differs on person name");
  assert.strictEqual(v("Review ESTMTA guidelines", "Review IRGP guidelines"), "differs on program code");
  assert.strictEqual(v("Pay invoice 2500", "Pay invoice 2600"), "differs on number/code/date");
  assert.strictEqual(v("Review Legal's wording", "Send wording to Legal"), null);
  assert.strictEqual(v("Send report", "Report send"), null); // first-word capital ignored
  assert.strictEqual(v("Draft memo. Sophie reviews", "Draft memo. Sophie reviews now"), null);
  assert.strictEqual(v("Call Sophie today", "Call sophie today"), null);
});
const BX = (o) => ({ id: "1", content: "Send quarterly budget report finance team", projectId: "p1", sectionId: "s1", parentId: null, due_date: "2026-11-01", isRecurring: false, ...o });
test("bestDuplicateCandidate: self skip, gate, veto, best, near-identical", () => {
  assert.strictEqual(DUPLICATE_BOX_MIN, 0.9);
  assert.strictEqual(NEAR_IDENTICAL_MIN, 0.98);
  const t = BX({ id: "", oid: "o1" });
  assert.strictEqual(bestDuplicateCandidate(t, [1, 0], [{ task: BX({ id: "9", oid: "o1" }), vec: [1, 0] }]), null);
  assert.strictEqual(bestDuplicateCandidate(BX({ id: "1" }), [1, 0], [{ task: BX({ id: "1" }), vec: [1, 0] }]), null);
  assert.strictEqual(bestDuplicateCandidate(BX(), [1, 0], [{ task: BX({ id: "2", parentId: "1" }), vec: [1, 0] }]), null); // gate
  assert.strictEqual(bestDuplicateCandidate(BX({ content: "Pay invoice 2500 for vendor" }), [1, 0], [{ task: BX({ id: "2", content: "Pay invoice 2600 for vendor" }), vec: [1, 0] }]), null); // veto
  assert.strictEqual(bestDuplicateCandidate(BX(), [1, 0], [{ task: BX({ id: "2" }), vec: [1] }, { task: BX({ id: "3" }), vec: null }]), null);
  assert.strictEqual(bestDuplicateCandidate(BX(), [1, 0], [{ task: BX({ id: "2" }), vec: [0, 1] }]), null); // below min
  const r = bestDuplicateCandidate(BX(), [1, 0], [
    { task: BX({ id: "2" }), vec: [1, 0.3] }, { task: BX({ id: "3" }), vec: [1, 0.1] }, { task: BX({ id: "4" }), vec: [1, 0.1] }]);
  assert.strictEqual(r.candidate.id, "3");
  assert.strictEqual(r.nearIdentical, true);
  assert.ok(r.score >= 0.98);
  const s = bestDuplicateCandidate(BX(), [1, 0], [{ task: BX({ id: "2", sectionId: "s2" }), vec: [1, 0.01] }]);
  assert.strictEqual(s.nearIdentical, false);
  const w = bestDuplicateCandidate(BX(), [1, 0], [{ task: BX({ id: "2" }), vec: [1, 0.4] }]);
  assert.strictEqual(w.nearIdentical, false);
});
test("ruleGate: empty/missing ids are no id, not parent-child (plan tasks have id \"\")", () => {
  const top = { id: "t1", content: "Send the quarterly budget summary to Alex Rivera by Friday", projectId: "p", parentId: "" };
  for (const id of ["", undefined, null]) {
    const plan = { id, content: "Send the quarterly budget summary to Alex Rivera", projectId: "p", parentId: "" };
    assert.notStrictEqual(ruleGate(plan, top), "parent-child");
    assert.notStrictEqual(ruleGate(top, plan), "parent-child");
  }
  assert.strictEqual(ruleGate({ ...top, id: "1" }, { ...top, id: "2", parentId: "1" }), "parent-child");
  assert.strictEqual(ruleGate({ ...top, id: "2", parentId: "1" }, { ...top, id: "1" }), "parent-child");
  const plan = BX({ id: "", oid: "", due_date: undefined, parentId: "" });
  const r = bestDuplicateCandidate(plan, [1, 0], [{ task: BX({ id: "t1", oid: "x", parentId: "" }), vec: [1, 0] }]);
  assert.ok(r && r.candidate.id === "t1" && r.score === 1);
  assert.strictEqual(bestDuplicateCandidate({ ...plan, oid: "o1" }, [1, 0], [{ task: BX({ id: "t1", oid: "o1" }), vec: [1, 0] }]), null);
});
test("STRICT_VERDICT_SCHEMA and boxesOnVerdict", () => {
  assert.deepStrictEqual(STRICT_VERDICT_SCHEMA.required.sort(), ["confidence", "reason", "verdict"]);
  assert.deepStrictEqual(STRICT_VERDICT_SCHEMA.properties.verdict.enum, ["duplicate", "unsure", "not-duplicate"]);
  assert.strictEqual(STRICT_VERDICT_SCHEMA.additionalProperties, false);
  assert.strictEqual(boxesOnVerdict({ verdict: "not-duplicate", confidence: 0.99 }), false);
  for (const r of [null, undefined, {}, { error: "timeout" }, { verdict: "duplicate" }, { verdict: "unsure", confidence: 0.1 }]) assert.strictEqual(boxesOnVerdict(r), true);
});
const EX = { content: "Send budget report", description: "Quarterly budget summary.\n\nSources:\n- note A.md", labels: ["Work", "finance"], priority: 2, due_date: "2026-11-02", deadline_date: "" };
test("merge: due and priority changes, sentence, labels, sources", () => {
  const inc = { content: "Send the budget report", description: "Latest email says Deadline moved up. Extra.\n\nSources:\n- note A.md\n- email B", labels: ["FINANCE", "urgent"], priority: 4, due_date: "2026-11-10", deadline_date: "2026-11-12" };
  const m = mergeDuplicateIntoExisting(EX, inc, { sourceName: "Email B", today: "2026-10-25" });
  assert.strictEqual(m.content, EX.content);
  assert.deepStrictEqual(m.labels, ["Work", "finance", "urgent"]);
  assert.strictEqual(m.priority, 4);
  assert.strictEqual(m.due_date, "2026-11-10");
  assert.strictEqual(m.deadline_date, "2026-11-12");
  assert.deepStrictEqual(m.changes, [{ field: "due date", from: "2026-11-02", to: "2026-11-10" }, { field: "deadline", from: "", to: "2026-11-12" }, { field: "priority", from: "P3", to: "P1" }]);
  assert.strictEqual(m.sentence, "On 2026-10-25 the due date moved from 2026-11-02 to 2026-11-10, deadline set to 2026-11-12 and priority rose from P3 to P1, per Email B: \"Latest email says Deadline moved up\".");
  assert.ok(!/->|\n/.test(m.sentence));
  for (const l of EX.description.split("\n").filter((x) => x.trim())) assert.ok(m.description.includes(l), l);
  assert.strictEqual((m.description.match(/note A\.md/g) || []).length, 1);
  assert.ok(m.description.includes("- email B") && m.description.includes(m.sentence));
  assert.ok(m.description.indexOf(m.sentence) < m.description.indexOf("Sources:"));
});
test("merge: priority dropped, no-change gives no sentence, reason fallbacks", () => {
  const d = mergeDuplicateIntoExisting({ ...EX, priority: 4 }, { ...EX, priority: 2, due_date: "", description: "" }, { sourceName: "Email B", today: "2026-10-25" });
  assert.strictEqual(d.sentence, "On 2026-10-25 priority dropped from P1 to P3, per Email B.");
  const n = mergeDuplicateIntoExisting(EX, { ...EX, priority: 1, due_date: "2026-11-02" }, { today: "2026-10-25" });
  assert.deepStrictEqual(n.changes, []);
  assert.strictEqual(n.sentence, undefined);
  assert.strictEqual(n.priority, 2);
  assert.strictEqual(n.due_date, "2026-11-02");
  assert.strictEqual(n.description, EX.description);
  const e = mergeDuplicateIntoExisting(EX, { ...EX, priority: 4, description: "" }, { today: "2026-10-25" });
  assert.strictEqual(e.sentence, "On 2026-10-25 priority rose from P3 to P1.");
  const long = mergeDuplicateIntoExisting(EX, { ...EX, priority: 4, description: "Moved up because " + "word ".repeat(40) + "end." }, { sourceName: "S", today: "2026-10-25" });
  const q = long.sentence.match(/: "(.*)"\.$/)[1];
  assert.ok(q.startsWith("Moved up because word") && q.endsWith("…") && q.length <= 101 && !/word…$/.test("x") && /word…$/.test(q));
});
test("merge: reason keeps case, sentence split skips abbreviations", () => {
  const r = (d) => mergeDuplicateIntoExisting(EX, { ...EX, priority: 4, description: d }, { sourceName: "S", today: "2026-10-25" }).sentence;
  assert.strictEqual(r("Dr. Smith said so. More."), "On 2026-10-25 priority rose from P3 to P1, per S: \"Dr. Smith said so\".");
  assert.ok(r("PDF is due! Then.").endsWith("per S: \"PDF is due\"."));
  assert.ok(r("Use e.g. Excel. Next").endsWith("per S: \"Use e.g. Excel\"."));
});
test("merge: due/deadline with time compare by date part", () => {
  const same = mergeDuplicateIntoExisting({ ...EX, due_date: "2026-11-02T10:00:00" }, { ...EX, due_date: "2026-11-02", priority: 1 }, { today: "2026-10-25" });
  assert.strictEqual(same.due_date, "2026-11-02T10:00:00");
  assert.deepStrictEqual(same.changes, []);
  const diff = mergeDuplicateIntoExisting({ ...EX, due_date: "2026-11-02T10:00:00" }, { ...EX, due_date: "2026-11-05", priority: 1 }, { today: "2026-10-25" });
  assert.strictEqual(diff.due_date, "2026-11-05");
  assert.deepStrictEqual(diff.changes, [{ field: "due date", from: "2026-11-02", to: "2026-11-05" }]);
});
const SRC = "Notes/a.md";
const mg = (ed, id) => mergeDuplicateIntoExisting({ ...EX, priority: 1, description: ed }, { ...EX, priority: 1, description: id }, { today: "2026-10-25" }).description;
const EMAIL_EX = "Draft reply.\n\n**Email Source:**\nFrom: Chantal <c@x.com>\nSubject: Forms\n\n**Context Notes:**\n1. Notes/a.md\n2. Notes/b.md";
const EMAIL_IN = "Chantal pushed deadline.\n\n**Email Source:**\nFrom: Chantal <c@x.com>\nSubject: Forms 2\n\n**Context Notes:**\n1. Notes/a.md\n2. Notes/c.md";
test("merge sources: note + note continues numbering, no duplicate path", () => {
  assert.strictEqual(mg("Send form.\n\nSources:\n1. Notes/a.md", "Other.\n\nSources:\n1. Notes/z.md\n2. Notes/a.md"), "Send form.\n\nOther.\n\nSources:\n1. Notes/a.md\n2. Notes/z.md");
  assert.strictEqual(mg("S.\n\nSources:\n- [A](Notes/a%20b.md)", "S.\n\nSource List:\n1. Notes/a b\n2. Notes/q.md"), "S.\n\nSources:\n- [A](Notes/a%20b.md)\n- Notes/q.md");
});
test("merge sources: note + email appends email section, drops known notes", () => {
  assert.strictEqual(mg("Send form.\n\nSources:\n1. Notes/a.md", EMAIL_IN),
    "Send form.\n\nChantal pushed deadline.\n\nSources:\n1. Notes/a.md\n\n**Email Source:**\nFrom: Chantal <c@x.com>\nSubject: Forms 2\n\n**Context Notes:**\n1. Notes/c.md");
});
test("merge sources: email + email appends within sections", () => {
  assert.strictEqual(mg(EMAIL_EX, EMAIL_IN),
    "Draft reply.\n\nChantal pushed deadline.\n\n**Email Source:**\nFrom: Chantal <c@x.com>\nSubject: Forms\nFrom: Chantal <c@x.com>\nSubject: Forms 2\n\n**Context Notes:**\n1. Notes/a.md\n2. Notes/b.md\n3. Notes/c.md");
  assert.strictEqual(mg(EMAIL_EX, EMAIL_EX), "Draft reply.\n\n" + EMAIL_EX.split("\n\n").slice(1).join("\n\n"));
});
test("merge sources: email + note adds new Sources section from 1", () => {
  assert.strictEqual(mg(EMAIL_EX, "New.\n\nSources:\n1. Notes/z.md\n2. Notes/b.md"), EMAIL_EX.replace("Draft reply.", "Draft reply.\n\nNew.") + "\n\nSources:\n1. Notes/z.md");
  assert.strictEqual(mg("Hi.", "Sources:\n3. Notes/q.md"), "Hi.\n\nSources:\n1. Notes/q.md");
});
test("merge: summary prefix appends only the remainder", () => {
  assert.strictEqual(mg("Send form.", "Send form. Extra detail."), "Send form.\n\nExtra detail.");
  assert.strictEqual(mg("Send form. Extra detail.", "Send form."), "Send form. Extra detail.");
  assert.strictEqual(mg("Send form.", "Something else."), "Send form.\n\nSomething else.");
});
test("section compare: name vs id", () => {
  const vec = [1, 0], plan = { content: "Submit annual report to funder", projectId: "p1", section: "Admin" };
  const cand = (o) => ({ task: { id: "e1", content: "Submit annual report to funder", projectId: "p1", sectionId: "s9", section: "Admin", dueDate: "", isRecurring: false, ...o }, vec });
  assert.strictEqual(bestDuplicateCandidate(plan, vec, [cand()]).nearIdentical, true);
  assert.strictEqual(bestDuplicateCandidate(plan, vec, [cand({ sectionId: "" })]).nearIdentical, true);
  assert.strictEqual(bestDuplicateCandidate(plan, vec, [cand({ section: "Other" })]).nearIdentical, false);
  assert.strictEqual(bestDuplicateCandidate({ ...plan, section: "" }, vec, [cand({ sectionId: "", section: "" })]).nearIdentical, true);
  const short = { content: "Send annual form", projectId: "p1", section: "Admin", isRecurring: false };
  assert.strictEqual(ruleGate({ ...short, id: "a" }, { ...short, id: "b", sectionId: "s9" }), null);
  assert.strictEqual(ruleGate({ ...short, id: "a" }, { ...short, id: "b", section: "Home" }), "short-title");
  const nm = { content: "Submit annual report to funder", projectName: "Home", isRecurring: false };
  assert.strictEqual(ruleGate({ ...nm, id: "a" }, { ...nm, id: "b", projectId: "p1", projectName: "home" }), null);
});if (failed) { console.log(`${failed} failed`); process.exit(1); }

