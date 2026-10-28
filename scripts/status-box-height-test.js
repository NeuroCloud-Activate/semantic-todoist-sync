"use strict";

// The sidebar status box keeps one fixed height of three lines, so it never
// jumps as status messages come and go; longer text scrolls inside it.

const assert = require("assert");
const fs = require("fs");

const styles = fs.readFileSync("styles.css", "utf8");
const match = /\.semantic-todoist-status\s*\{([^}]*)\}/.exec(styles);
assert.ok(match, "styles.css must style .semantic-todoist-status");
const rule = match[1];
const prop = (name) => (new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]+);`).exec(rule) || [])[1]?.trim() || "";

assert.strictEqual(prop("line-height"), "1.25", "status line height is 1.25");
assert.strictEqual(prop("height"), "calc(3em * 1.25)", "status content is exactly three lines tall");
assert.strictEqual(prop("box-sizing"), "content-box", "the three-line height excludes padding and border");
assert.strictEqual(prop("max-height"), "", "no max-height: the height is fixed, not a ceiling");
assert.strictEqual(prop("overflow"), "auto", "text longer than three lines scrolls inside the box");

console.log("PASS status-box-height-test.js");
