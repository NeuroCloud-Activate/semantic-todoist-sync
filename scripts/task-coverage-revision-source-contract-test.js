"use strict";
// Task generation must pin the coverage proof to the index revision its own retrieval ran on,
// not the live this.semanticIndexRevision: a note edit mid-run bumps the live revision, the
// proof no longer matches, and the whole plan used to fail with corpus-coverage errors.
// Live repro: bump semanticIndexRevision after the first retrieval -> HEAD returned 0 tasks.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "src/main.js"), "utf8");
const sites = source.match(/coverageIndexRevision:[^\n]*/g) || [];
assert.equal(sites.length, 3, "expected 3 coverageIndexRevision call sites");
const [pre, post1, post2] = sites;
assert.match(pre, /preStructureScopes\.telemetry\?\.indexRevision \|\| this\.semanticIndexRevision/);
assert.match(post1, /taskSemanticRetrieval\.telemetry\?\.indexRevision \|\| this\.semanticIndexRevision/);
assert.match(post2, /taskSemanticRetrieval\.telemetry\?\.indexRevision \|\| this\.semanticIndexRevision/);
console.log("PASS: coverage proof revision follows the retrieval's own index revision");
