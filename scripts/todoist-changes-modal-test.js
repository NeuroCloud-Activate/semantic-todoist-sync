"use strict";
// Fix 1: create rows render as a readable, wrapped layout with a linked description; other rows keep sentence/diff.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { buildPreview } = require("../src/todoist/preview.js");

// Minimal Obsidian DOM mock: createEl honours { text, cls, attr }, textContent is visible text only.
class El {
  constructor(tag = "div", o = {}) {
    this.tag = tag;
    this.children = [];
    this._text = o.text == null ? "" : String(o.text);
    this.className = o.cls || "";
    this.attrs = { ...(o.attr || {}) };
    this.style = { setProperty() {} };
    if (o.href !== undefined) this.attrs.href = o.href;
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v) { this._text = String(v == null ? "" : v); this.children = []; }
  createEl(tag, o = {}) { const c = new El(tag, o); this.children.push(c); return c; }
  createDiv(o = {}) { return this.createEl("div", o); }
  createSpan(o = {}) { return this.createEl("span", o); }
  setAttr(k, v) { this.attrs[k] = String(v); return this; }
  addClass(c) { this.className = `${this.className} ${c}`.trim(); return this; }
  empty() { this.children = []; this._text = ""; return this; }
  focus() {}
}
const all = (root, out = []) => { for (const c of root.children || []) { out.push(c); all(c, out); } return out; };
const byClass = (root, cls) => all(root).filter((e) => String(e.className).split(/\s+/).includes(cls));

const originalLoad = Module._load;
Module._load = function (request) {
  if (request !== "obsidian") return originalLoad.apply(this, arguments);
  return {
    ItemView: class {}, MarkdownRenderer: {}, MarkdownView: class {}, Menu: class {},
    Modal: class {
      constructor() {
        this.modalEl = new El("div");
        this.contentEl = new El("div");
        this.modalEl.children.push(this.contentEl);
      }
    },
    Notice: class {}, Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {},
    setIcon() {}, requestUrl: async () => { throw new Error("network disabled"); }
  };
};
let TodoistChangesModal;
try {
  global.window = { setTimeout, clearTimeout, requestIdleCallback: null, requestAnimationFrame: (fn) => setTimeout(fn, 0) };
  const mainPath = path.join(__dirname, "..", "src", "main.js");
  const m = new Module(mainPath, module);
  m.filename = mainPath;
  m.paths = Module._nodeModulePaths(path.dirname(mainPath));
  const source = fs.readFileSync(mainPath, "utf8").replace(/\r\n/g, "\n");
  m._compile(source + "\nmodule.exports.__TodoistChangesModal = TodoistChangesModal;\n", mainPath);
  TodoistChangesModal = m.exports.__TodoistChangesModal;
} finally {
  Module._load = originalLoad;
}

const snapshot = {
  tasks: [{ id: "t1", content: "Pay rent", projectId: "p2", labels: [] }],
  projects: [{ id: "p1", name: "Home" }, { id: "p2", name: "Work" }],
  sections: []
};
const description = "Review notes:\nSee [meeting notes](obsidian://vault/Notes/Meeting.md) and [web](https://example.com).";
const createRow = { op: "create", fields: { content: "Plan", priority: 4, dueDate: "2026-12-01", labels: ["a", "b"], description }, target: { projectId: "p1" }, newLabels: ["urgent"] };
const moveRow = { op: "move", taskId: "t1", fields: {}, target: { projectId: "p1" }, newLabels: [] };
const preview = buildPreview([createRow, moveRow], snapshot, { placementFor: () => ({ path: "Notes/2026.md", phrase: "at the end of the monthly note" }) });
const modal = new TodoistChangesModal({}, { applyTodoistChanges: async () => ({}) }, { preview }, null);
modal.onOpen();
const rows = byClass(modal.contentEl, "semantic-todoist-change-row");
const create = rows.find((r) => byClass(r, "semantic-todoist-change-detail").length);
const move = rows.find((r) => !byClass(r, "semantic-todoist-change-detail").length);
assert.ok(create && move, "one structured create row and one unchanged non-create row");

const title = byClass(create, "semantic-todoist-change-title")[0];
assert.ok(title && title.textContent === "Plan", "create row shows the title in bold");
const fields = byClass(create, "semantic-todoist-change-field").map((e) => e.textContent);
for (const want of ["Where: Home", "Due: 2026-12-01", "Priority: P1", "Labels: a, b", "Note line: at the end of the monthly note"]) {
  assert.ok(fields.some((t) => t === want), `field ${want} present; got ${JSON.stringify(fields)}`);
}
assert.ok(!fields.some((t) => /a note line will be added/.test(t)), `no redundant note prefix: ${JSON.stringify(fields)}`);
const details = byClass(create, "semantic-todoist-change-details")[0];
assert.ok(details, "description is in a collapsed details element");
assert.ok(byClass(details, "semantic-todoist-change-description-line").length === 2, "newlines become separate lines");
assert.ok(!create.textContent.includes("obsidian://"), `no raw URL in visible text: ${create.textContent}`);
const anchors = all(create).filter((e) => e.tag === "a");
assert.ok(anchors.some((a) => a.textContent === "meeting notes" && String(a.attrs.href).startsWith("obsidian://")), "obsidian link labelled with its text");
assert.ok(byClass(create, "semantic-todoist-change-diff").length === 0, "create drops the redundant diff line");
assert.ok(create.textContent.includes("New label: urgent"), "warnings still shown");
assert.ok(move.textContent.includes('Move "Pay rent" from Work to Home'), "non-create row keeps its sentence");
assert.ok(byClass(move, "semantic-todoist-change-diff").some((e) => e.textContent === "Work -> Home"), "non-create row keeps its diff line");
assert.ok(modal.ticked.has(preview.groups[0].rows[0].id), "ticked state untouched");

const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8").replace(/\r\n/g, "\n");
const rowRule = (css.match(/\.semantic-todoist-changes-modal \.semantic-todoist-change-row\s*\{[^}]*\}/) || [])[0];
assert.ok(rowRule && /min-width:\s*0/.test(rowRule) && /overflow-wrap:\s*anywhere/.test(rowRule) && /white-space:\s*normal/.test(rowRule), "rows wrap");
assert.ok(/\.semantic-todoist-changes-modal \.modal-content\s*\{[^}]*overflow-x:\s*hidden/.test(css), "no horizontal scroll in modal content");
console.log("PASS create row renders structured fields, description links and wrapped non-create rows");
