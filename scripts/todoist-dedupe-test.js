"use strict";
// Task 10 (precision-first duplicate gate) - plain node + assert, prints `PASS <case>`.
const assert = require("assert");
const { ruleGate, dedupeCandidates, confirmPair, dedupeAllowed, STRICT_JUDGE_PROMPT, CALIBRATED_EMBEDDING_MODELS } = require("../src/todoist/dedupe.js");

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

test("uncalibrated embedding model → off with reason", () => {
  assert.deepStrictEqual(CALIBRATED_EMBEDDING_MODELS, ["embeddinggemma-2"]);
  const on = { todoistDuplicateFinding: true, todoistDuplicateFindingValidated: true };
  const r = dedupeAllowed({ ...on, embeddingModel: "qwen3-embedding-0.6b-8k:latest" });
  assert.strictEqual(r.ok, false);
  assert.ok(/embedding/i.test(r.reason));
  assert.deepStrictEqual(dedupeAllowed({ ...on, embeddingModel: "embeddinggemma-2" }), { ok: true, reason: "" });
});
test("not validated or switched off → off", () => {
  const m = { embeddingModel: "embeddinggemma-2" };
  assert.deepStrictEqual(dedupeAllowed({ ...m, todoistDuplicateFinding: true }), { ok: false, reason: "not validated" });
  assert.strictEqual(dedupeAllowed({ ...m, todoistDuplicateFindingValidated: true }).ok, false);
  assert.strictEqual(dedupeAllowed({}).ok, false);
});

if (failed) { console.log(`${failed} failed`); process.exit(1); }
