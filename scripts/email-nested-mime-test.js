"use strict";

// parseRawEmail must decode the text body of nested multipart emails
// (multipart/related > multipart/alternative > text/plain), not hand the
// undecoded inner MIME block to the planner.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const mainPath = path.join(__dirname, "..", "main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const testModule = new Module(mainPath, module);
testModule.filename = mainPath;
testModule.paths = Module._nodeModulePaths(path.dirname(mainPath));

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
  class Empty {}
  return {
    ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty,
    Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty,
    TFile: Empty, setIcon() {}, requestUrl() { throw new Error("Network disabled in local test."); }
  };
};

let parseRawEmail;
try {
  testModule._compile(`${mainSource}\nmodule.exports.__mimeTest = { parseRawEmail };`, mainPath);
  parseRawEmail = testModule.exports.__mimeTest.parseRawEmail;
} finally {
  Module._load = originalLoad;
}

const b64 = (text) => Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
const plain = "Please review the Alpha meeting highlights and the Beta program for Casey.";
const html = "<html><body><p>HTML copy of the Alpha note</p></body></html>";

const nested = [
  "From: a@example.com", "To: b@example.com", "Subject: Fw: Alpha",
  'Content-Type: multipart/related; boundary="OUTER"', "", "--OUTER",
  'Content-Type: multipart/alternative; boundary="INNER"', "", "--INNER",
  'Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: base64", "", b64(plain), "--INNER",
  'Content-Type: text/html; charset="utf-8"', "Content-Transfer-Encoding: base64", "", b64(html), "--INNER--",
  "--OUTER", "Content-Type: image/png", "Content-Transfer-Encoding: base64", "", "iVBORw0KGgo=", "--OUTER--", ""
].join("\r\n");
const nestedText = parseRawEmail(nested).text;
assert.ok(nestedText.includes("Alpha meeting highlights"), `nested text/plain was not decoded: ${nestedText.slice(0, 80)}`);
assert.ok(!/Content-Type|boundary|INNER/i.test(nestedText), "MIME headers or boundaries leaked into the body");

const htmlOnly = [
  "Subject: x", 'Content-Type: multipart/related; boundary="O"', "", "--O",
  'Content-Type: multipart/alternative; boundary="I"', "", "--I",
  'Content-Type: text/html; charset="utf-8"', "Content-Transfer-Encoding: base64", "", b64(html), "--I--", "--O--", ""
].join("\r\n");
assert.ok(parseRawEmail(htmlOnly).text.includes("HTML copy of the Alpha note"), "nested html-only body was not decoded");

const flat = [
  "Subject: x", 'Content-Type: multipart/alternative; boundary="F"', "", "--F",
  "Content-Type: text/plain", "", "flat plain body", "--F--", ""
].join("\r\n");
assert.equal(parseRawEmail(flat).text, "flat plain body");

console.log("Email nested MIME parsing: passed.");
