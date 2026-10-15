"use strict";

const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
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
    requestUrl() {}
  };
};

const Plugin = require("../main.js");
Module._load = originalLoad;

assert.strictEqual(typeof Plugin.buildTaskSourceContract, "function", "the real source-contract builder must be exported");
const settings = Object.assign({}, Plugin.DEFAULT_SETTINGS, { noteActionMarkerTags: "#todo" });

function contractFor(text, name) {
  const source = { type: "note", title: name, path: `${name}.md` };
  return Plugin.buildTaskSourceContract(source, text, settings);
}

function markersFor(text, name) {
  return contractFor(text, name).explicitMarkers;
}

// 1. Trailing tag on a plain bullet: the action is the same line's text before the tag.
const trailing = markersFor("- Add confidentiality language to future targeted competition emails #todo", "Trailing tag");
assert.strictEqual(trailing.length, 1, "a plain bullet with a trailing #todo must yield one marker");
assert.strictEqual(trailing[0].tag, "#todo", "the trailing marker keeps its tag identity");
assert.strictEqual(trailing[0].action, "Add confidentiality language to future targeted competition emails", "the trailing marker action is the same-line text before the tag");
assert.strictEqual(trailing[0].line, 1, "the trailing marker stays on its source line");
console.log("PASS: trailing tag on a plain bullet keeps the same-line action");

// 2. Leading tag unchanged.
const leading = markersFor("- #todo Do the follow-up", "Leading tag");
assert.deepStrictEqual(leading.map((marker) => marker.action), ["Do the follow-up"], "a leading #todo still takes the text after the marker");
console.log("PASS: leading tag still takes the text after the marker");

// 3. Tag alone on its line still falls back to the next line.
const alone = markersFor("#todo\nDo the follow-up", "Tag alone");
assert.deepStrictEqual(alone.map((marker) => [marker.line, marker.action]), [[1, "Do the follow-up"]], "a lone #todo still takes the next line");
console.log("PASS: lone tag still falls back to the next line");

// 4. Two markers on one line stay separate.
const two = markersFor("#todo Prepare the summary #todo Review the appendix", "Two markers");
assert.deepStrictEqual(two.map((marker) => marker.action), ["Prepare the summary", "Review the appendix"], "two markers on one line stay separate");
console.log("PASS: two markers on one line stay separate");

// 5. Checkbox lines unchanged (the checkbox branch already strips trailing tags).
const checkbox = markersFor("- [ ] Prepare the briefing #todo", "Checkbox trailing");
assert.deepStrictEqual(checkbox.map((marker) => marker.action), ["Prepare the briefing"], "a checkbox trailing tag still yields the checkbox body");
console.log("PASS: checkbox trailing tag unchanged");

// 6. Text on both sides of a single marker combines: before-text + after-text.
const bothSides = markersFor("- Send the report to Jim #todo by Friday", "Both sides");
assert.strictEqual(bothSides.length, 1, "a single marker with text on both sides must yield one marker");
assert.strictEqual(bothSides[0].action, "Send the report to Jim by Friday", "the action combines the text before and after the marker");
console.log("PASS: single marker with text on both sides combines before and after");

// 7. Both sides with a numbered list: leading number syntax stripped from the before-text.
const numbered = markersFor("1. Do X #todo by Friday", "Numbered both sides");
assert.deepStrictEqual(numbered.map((marker) => marker.action), ["Do X by Friday"], "a numbered item with text on both sides combines without the list number");
console.log("PASS: numbered list with text on both sides combines without the list number");

// 8. Leading-only unchanged (plain line, no bullet).
const leadingPlain = markersFor("#todo Add X", "Leading plain");
assert.deepStrictEqual(leadingPlain.map((marker) => marker.action), ["Add X"], "a leading #todo still takes the text after the marker");
console.log("PASS: leading-only plain tag still takes the text after the marker");

// 9. Trailing-only still keeps the same-line before-text.
const trailingPlain = markersFor("- Finish the slides #todo", "Trailing plain");
assert.deepStrictEqual(trailingPlain.map((marker) => marker.action), ["Finish the slides"], "a trailing #todo still takes the same-line text before the marker");
console.log("PASS: trailing-only tag still takes the same-line text before the marker");

// 10. "#todo A #todo B" yields exactly two markers, A and B.
const twoAB = markersFor("#todo A #todo B", "Two markers AB");
assert.strictEqual(twoAB.length, 2, "two markers with text must yield exactly two markers");
assert.deepStrictEqual(twoAB.map((marker) => marker.action), ["A", "B"], "each marker takes only its own after-text");
console.log("PASS: two markers stay separate with their own after-text");

// 11. "#todo A #todo" must not duplicate "A" for the second marker.
const trailingEmpty = markersFor("#todo A #todo\nDo the follow-up", "Trailing empty second");
assert.strictEqual(trailingEmpty[0].action, "A", "the first marker still takes its after-text");
assert.ok(!trailingEmpty.slice(1).some((marker) => marker.action === "A"), "the second marker must not duplicate the first marker text");
console.log("PASS: empty second marker does not duplicate the first marker text");

process.stdout.write(JSON.stringify({ passed: 11, failed: 0 }, null, 2) + "\n");
