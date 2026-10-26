"use strict";
// G3: a merge send must reach Todoist exactly as mergeDuplicateIntoExisting built it (note and email source blocks kept).
// DUPBOX_MAIN lets a proposal copy of src/main.js be tested before it is merged.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const mainPath = process.env.DUPBOX_MAIN ? path.resolve(process.env.DUPBOX_MAIN) : path.join(__dirname, "..", "src/main.js");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.join(__dirname, "..", "src"));
const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  class Empty { open() {} }
  return { ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty, TFile: Empty, setIcon() {}, requestUrl: async () => { throw new Error("network disabled in test"); } };
};
let Plugin;
try {
  global.window = { setTimeout, clearTimeout, requestIdleCallback: null };
  testModule._compile(`${fs.readFileSync(mainPath, "utf8")}\nmodule.exports.__t = { descriptionSourceList, todoistUpdatePayload, formatTodoistDescription };`, mainPath);
  Plugin = testModule.exports;
} finally {
  Module._load = originalLoad;
}
const { descriptionSourceList: S, todoistUpdatePayload, formatTodoistDescription } = Plugin.__t;
const dedupe = require("../src/todoist/dedupe.js");

const cases = [];
const test = (name, fn) => cases.push([name, fn]);
const clean = (t) => String(t).replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const note = (p) => "Send the form to Chantal.\n\n" + S({ path: p }, [{ path: "Notes/ctx.md" }], "", "note");
const email = (s, n) => "Draft reply to Chantal.\n\n" + S({ from: "Chantal <c@x.com>", subject: s, receivedAt: "2026-10-2" + n }, [{ path: "Notes/ctx" + n + ".md" }], "", "email");
const combos = { "note+note": [note("Notes/a.md"), note("Notes/b.md")], "note+email": [note("Notes/a.md"), email("Forms", "3")], "email+email": [email("Forms", "3"), email("Forms 2", "4")], "email+note": [email("Forms", "3"), note("Notes/b.md")] };
const merge = (existing, incoming, due = null) => dedupe.mergeDuplicateIntoExisting({ content: "Send form", labels: [], priority: 1, description: existing }, { description: incoming, due_date: due }, { today: "2026-10-25", sourceName: "the email from Chantal" });
const settings = (over = {}) => Object.assign({}, Plugin.DEFAULT_SETTINGS, over);
const remoteOf = (description) => ({ id: "e1", content: "Send form", description, labels: [], priority: 1 });

// Run the real mergeHeldDuplicate; capture the parsed task it hands to the Todoist updater, then build the real payload.
async function sendMerge(existing, incoming, over = {}) {
  const p = Object.create(Plugin.prototype);
  p.settings = settings(over);
  p.logLocal = () => {};
  p.duplicateSourceName = () => "the email from Chantal";
  p.saveDuplicateStore = async () => {};
  let parsed;
  p.updateTodoistFromParsedTask = async (task) => { parsed = task; return false; };
  const record = { candidate: { id: "e1" }, task: { description: incoming, labels: [], priority: 1, subtasks: [], due_date: over.due || null }, source: { type: "email" } };
  const snapshot = { tasks: [remoteOf(existing)] };
  await p.mergeHeldDuplicate(record, snapshot).catch(() => {});
  assert.ok(parsed, "updater was called");
  return { payload: todoistUpdatePayload(parsed, remoteOf(existing), p.settings), record };
}

for (const [name, [existing, incoming]] of Object.entries(combos)) {
  test(`merge ${name}: Todoist gets the merged description as built, nothing lost, re-merge idempotent`, async () => {
    const merged = merge(existing, incoming);
    const { payload } = await sendMerge(existing, incoming);
    assert.equal(payload.description, clean(merged.description));
    for (const line of existing.split("\n").filter((l) => l.trim())) assert.ok(payload.description.includes(line.trim()), `lost: ${line}`);
    if (/email/.test(name.split("+")[0]) || /email/.test(name.split("+")[1])) {
      assert.ok(/Email Source/.test(payload.description), payload.description);
      assert.ok(/From:/.test(payload.description) && /Subject:/.test(payload.description), payload.description);
    }
    assert.equal(clean(merge(payload.description, incoming).description), payload.description, "second merge changes nothing");
  });
}

test("non-merge task description still goes through source-list normalisation", () => {
  const raw = note("Notes/a.md").replace("\nSources:\n", "\n\nSources:\n");
  const viaNormal = formatTodoistDescription(raw, settings());
  assert.equal(viaNormal, formatTodoistDescription(raw, settings(), "", false));
  const payload = todoistUpdatePayload({ content: "x", description: raw, descriptionShouldSync: true, descriptionForceSync: true, labels: [], priority: 1 }, null, settings());
  assert.equal(payload.description, viaNormal);
});

test("too long for the full merge but existing + sentence fits: sentence is appended", async () => {
  const existing = "Short existing note";
  const inc = "A much longer incoming description that cannot fit in the limit.";
  const merged = merge(existing, inc, "2026-11-10");
  assert.ok(merged.sentence);
  const max = (existing + "\n\n" + merged.sentence).length + 5;
  assert.ok(clean(merged.description).length > max, "full merge must not fit");
  const { payload, record } = await sendMerge(existing, inc, { todoistDescriptionMaxChars: max, due: "2026-11-10" });
  // The plugin stamps its own local date, so compare with the date normalised.
  const day = (t) => t.replace(/On \d{4}-\d{2}-\d{2}/, "On DAY");
  assert.equal(day(payload.description), day(existing + "\n\n" + merged.sentence));
  assert.ok(!record.outcomeNote, "no too-long note when the sentence was recorded");
});

test("too long even with the sentence: description unchanged and outcomeNote set", async () => {
  const existing = "Short existing note";
  const { payload, record } = await sendMerge(existing, "A much longer incoming description that cannot fit in the limit.", { todoistDescriptionMaxChars: 25, due: "2026-11-10" });
  assert.ok(!("description" in payload), JSON.stringify(payload));
  assert.equal(record.outcomeNote, "The description was too long to add to.");
});

const quoted = (summary) => merge("Send form", summary, "2026-11-10").sentence.match(/: "(.*)"\.$/)[1];
test("merge sentence quote drops markdown emphasis and citation markers", () => {
  const q = quoted("You need to pull the **October vendor invoice totals** for finance **by Nov 12**, because finance asked again after the audit call (1).");
  assert.equal(q, "You need to pull the October vendor invoice totals for finance by Nov 12, because finance asked…");
  assert.ok(!/\*|\(1\)/.test(merge("Send form", "Pull **x** now (1).", "2026-11-10").sentence));
  assert.equal(quoted("Use `code`, __bold__ and *it* [2] here[^3]."), "Use code, bold and it here");
});
test("merge sentence quote keeps ordinary parentheses and brackets", () => {
  assert.equal(quoted("Call the network (CBS) about [link-free] text by Nov 12."), "Call the network (CBS) about [link-free] text by Nov 12");
});
test("merge sentence quote of a plain reason is unchanged", () => {
  assert.equal(quoted("Finance asked again after the audit call."), "Finance asked again after the audit call");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${(error && error.stack || error).toString().split("\n").slice(0, 6).join("\n  ")}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exitCode = 1;
})();
