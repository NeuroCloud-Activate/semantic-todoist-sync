"use strict";

// Task 3 (presets + exact-range guard) — TDD test. Requires src/writing/rewrite.js.
const assert = require("assert");

const { REWRITE_PRESETS, typedRewriteInstruction, planReplacement } = require("../src/writing/rewrite.js");

function makeEditor(text) {
  return {
    text,
    getRange(from, to) {
      assert.ok(typeof from === "number" && typeof to === "number", "positions are offsets");
      return this.text.slice(from, to);
    },
  };
}

function preset(id) {
  const found = REWRITE_PRESETS.find((p) => p.id === id);
  assert.ok(found, `preset ${id} exists`);
  return found;
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`FAIL ${name}: ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`PASS ${name}`);
}

test("range unchanged -> ok", () => {
  const editor = makeEditor("alpha beta gamma");
  const recorded = { path: "Notes/A.md", from: 6, to: 10, original: "beta" };
  const plan = planReplacement(editor, recorded, "Notes/A.md");
  assert.strictEqual(plan.ok, true);
  assert.deepStrictEqual([plan.from, plan.to], [6, 10]);
});

test("text changed -> ok:false, notice 'Selected text changed; not applied.'", () => {
  const editor = makeEditor("alpha beta gamma");
  const recorded = { path: "Notes/A.md", from: 6, to: 10, original: "CHANGED" };
  const plan = planReplacement(editor, recorded, "Notes/A.md");
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.notice, "Selected text changed; not applied.");
});

test("different path -> ok:false, notice 'Open <file name> to apply.'", () => {
  const editor = makeEditor("alpha beta gamma");
  const recorded = { path: "Notes/A.md", from: 6, to: 10, original: "beta" };
  const plan = planReplacement(editor, recorded, "Notes/B.md");
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.notice, "Open A.md to apply.");
});

test("presets ids unique", () => {
  const ids = REWRITE_PRESETS.map((p) => p.id);
  assert.strictEqual(ids.length, new Set(ids).size);
});

test("grammar/plain/tighten/steps and every tone-* have evidence 'off'", () => {
  for (const id of ["grammar", "plain", "tighten", "steps"]) {
    assert.strictEqual(preset(id).evidence, "off", id);
  }
  for (const p of REWRITE_PRESETS.filter((p) => p.id.startsWith("tone-"))) {
    assert.strictEqual(p.evidence, "off", p.id);
  }
});

test("polish/expand/continue/funder/policy have evidence 'toggles'", () => {
  for (const id of ["polish", "expand", "continue", "funder", "policy"]) {
    assert.strictEqual(preset(id).evidence, "toggles", id);
  }
});

test("check has evidence 'vault' and apply 'chat'", () => {
  assert.strictEqual(preset("check").evidence, "vault");
  assert.strictEqual(preset("check").apply, "chat");
});

test("continue has apply 'after'", () => {
  assert.strictEqual(preset("continue").apply, "after");
});

test("funder/policy/steps have group 'Grant & policy'", () => {
  for (const id of ["funder", "policy", "steps"]) {
    assert.strictEqual(preset(id).group, "Grant & policy", id);
  }
});

test("tone rows tone-formal/-neutral/-persuasive/-casual in order with group 'Change tone'", () => {
  const tones = REWRITE_PRESETS.filter((p) => p.id.startsWith("tone-")).map((p) => p.id);
  assert.deepStrictEqual(tones, ["tone-formal", "tone-neutral", "tone-persuasive", "tone-casual"]);
  for (const id of tones) {
    assert.strictEqual(preset(id).group, "Change tone", id);
  }
});

test("no tone-friendly preset", () => {
  assert.strictEqual(REWRITE_PRESETS.some((p) => p.id === "tone-friendly"), false);
});

test('typedRewriteInstruction("be bolder") contains "be bolder"', () => {
  assert.ok(typedRewriteInstruction("be bolder").includes("be bolder"));
});

process.stdout.write(JSON.stringify({ passed, failed: 0 }) + "\n");
