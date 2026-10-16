"use strict";

// Marketplace review contract: styles.css lint warnings + transitive sprintf-js
// advisory. Plain asserts only — a throw exits non-zero so
// scripts/run-tests.js reports FAIL.

const assert = require("assert");
const fs = require("fs");

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

const styles = fs.readFileSync("styles.css", "utf8");
const main = fs.readFileSync("src/main.js", "utf8");
const lockRaw = fs.readFileSync("package-lock.json", "utf8");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const lock = JSON.parse(lockRaw);

assert.strictEqual(count(styles, ":has("), 0, "styles.css must not use the :has() selector");
assert.strictEqual(count(styles, "column-gap"), 0, "styles.css must not use column-gap");
assert.ok(
  count(styles, ".semantic-todoist-toggle-setting") >= 2,
  "styles.css must target toggle rows with .semantic-todoist-toggle-setting (>= 2 selectors)"
);
assert.ok(
  count(main, "semantic-todoist-toggle-setting") >= 3,
  "src/main.js must add the toggle marker class at every toggle setting (>= 3 sites)"
);
assert.ok(
  pkg.overrides && pkg.overrides.argparse,
  "package.json must pin argparse through an overrides block"
);
assert.ok(
  !lockRaw.includes("sprintf-js"),
  "package-lock.json must no longer contain sprintf-js"
);
assert.strictEqual(
  lock.packages["node_modules/argparse"].version.slice(0, 1),
  "2",
  "package-lock.json argparse must resolve to 2.x"
);

console.log("PASS styles-lint-contract-test.js");
