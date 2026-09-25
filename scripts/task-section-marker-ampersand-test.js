"use strict";
// Regression: section marker containing `&` must survive parse -> Todoist args.
// Synthetic fixture shape: `///Demo_Review_A&B`.
// Reads ../main.js at runtime via a temporary augmented copy;
// never edits main.js, vault, or Todoist. Network disabled like other local harnesses.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

global.fetch = async () => {
  throw new Error("network access is disabled in this local harness");
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
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
      requestUrl() {
        throw new Error("Obsidian network access is disabled in this local harness");
      }
    };
  }
  if (["http", "https", "node:http", "node:https"].includes(request)) {
    throw new Error("network access is disabled in this local harness");
  }
  return originalLoad.call(this, request, parent, isMain);
};

function loadActualFns() {
  const mainPath = path.join(__dirname, "..", "main.js");
  const src = fs.readFileSync(mainPath, "utf8");
  const probe = "\n;module.exports.__sectionAmpersandProbe = { parseTaskLine, extractSection, extractTaskContent, todoistArgsFromParsedTask, taskPriorityForTodoist, taskLabelsForTodoist, removeSectionMarker, setSectionMarker, taskSyntaxMarkerIndexes };";
  const tmp = path.join(os.tmpdir(), "stsync-main-probe-" + Date.now() + "-" + process.pid + ".js");
  fs.writeFileSync(tmp, src + probe, "utf8");
  try {
    const mod = require(tmp);
    return { mod, probe: mod.__sectionAmpersandProbe, settings: mod.DEFAULT_SETTINGS };
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

let fns;
let DEFAULT_SETTINGS;
try {
  const loaded = loadActualFns();
  fns = loaded.probe;
  DEFAULT_SETTINGS = loaded.settings;
} finally {
  Module._load = originalLoad;
}

assert.ok(fns && typeof fns.parseTaskLine === "function", "actual parseTaskLine must be loadable");
assert.ok(typeof fns.extractSection === "function", "actual extractSection must be loadable");
assert.ok(typeof fns.extractTaskContent === "function", "actual extractTaskContent must be loadable");
assert.ok(typeof fns.todoistArgsFromParsedTask === "function", "actual todoistArgsFromParsedTask must be loadable");

const settings = Object.assign({}, DEFAULT_SETTINGS);
const PATH = "Meeting Notes/Demo_Review_2026-03-02.md";
const LINE = "- [ ] Alex to email Blake #STsync #FollowUp !!1 ///Demo_Review_A&B %%[p:: Inbox]%% DATE 2026-04-08 %%[oid:: DEMO01]%%".replace("DATE", String.fromCodePoint(0x1F4C5));
const EXPECTED_SECTION = "Demo_Review_A&B";

const failures = [];
function check(name, run) {
  try {
    run();
    process.stdout.write("GREEN " + name + "\n");
  } catch (error) {
    failures.push(name + ": " + (error.message || String(error)));
    process.stdout.write("RED " + name + ": " + String(error.message || error).split("\n")[0] + "\n");
  }
}

const parsed = fns.parseTaskLine(LINE, 55, PATH, [LINE], settings);
assert.ok(parsed, "parseTaskLine must accept the reported line shape");
console.log("actual section : " + JSON.stringify(parsed.section));
console.log("actual content : " + JSON.stringify(parsed.content));
console.log("actual priority: " + JSON.stringify(parsed.priority));
console.log("actual due     : " + JSON.stringify(parsed.due_date));
console.log("actual deadline: " + JSON.stringify(parsed.deadline_date));
console.log("actual labels  : " + JSON.stringify(parsed.labels));

check("section preserves full marker incl &", () => {
  assert.strictEqual(parsed.section, EXPECTED_SECTION);
});

check("title has no section residue", () => {
  assert.ok(!parsed.content.includes("&B"), "content leaks section fragment: " + parsed.content);
  assert.ok(!parsed.content.includes("///"), "content leaks /// marker: " + parsed.content);
  assert.ok(parsed.content.indexOf("Alex to email Blake") === 0, "content must start with action text: " + parsed.content);
});

check("priority parses !!1 to 1", () => {
  assert.strictEqual(parsed.priority, 1);
});

check("due parses to 2026-04-08", () => {
  assert.strictEqual(parsed.due_date, "2026-04-08");
});

check("no deadline without {{date}}", () => {
  assert.strictEqual(parsed.deadline_date, null);
});

check("labels keep FollowUp, drop #STsync", () => {
  assert.deepStrictEqual(parsed.labels, ["FollowUp"]);
});

const args = fns.todoistArgsFromParsedTask(parsed, "proj-1", "", "sect-1", settings);
console.log("actual args  : " + JSON.stringify(args));

check("todoist args carry full title + section id", () => {
  assert.ok(!String(args.content).includes("&B"), "args.content leaks fragment: " + args.content);
  assert.strictEqual(args.section_id, "sect-1");
});

check("todoist args priority/due/labels/no-deadline", () => {
  assert.strictEqual(args.priority, 1);
  assert.deepStrictEqual(args.labels, ["FollowUp"]);
  assert.deepStrictEqual(args.due, { date: "2026-04-08" });
  assert.ok(!args.deadline, "deadline must be absent, got: " + JSON.stringify(args.deadline));
});

check("removeSectionMarker strips the full &-marker", () => {
  const stripped = fns.removeSectionMarker(LINE);
  assert.ok(!stripped.includes("///"), "stripped line still has ///: " + stripped);
  assert.ok(!stripped.includes("A&B"), "stripped line still has fragment: " + stripped);
});

if (failures.length) {
  process.stdout.write("\n" + failures.length + " RED assertion(s) — expected before fix.\n");
  process.exitCode = 1;
} else {
  process.stdout.write("\nAll section-marker ampersand assertions GREEN.\n");
}
