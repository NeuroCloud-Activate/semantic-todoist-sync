"use strict";
// Differential parity check: our merged source vs the pristine release source (default 0.9.20).
// Compiles both with injected exports of internal functions, runs IDENTICAL inputs through the task, description,
// web-research and settings logic (no network, no vault, no Todoist), and diffs the JSON outputs.
//   node scripts/parity-vs-release.js [--base <main.js of release>] [--candidate <src/main.js>]\n// Default candidate = this repo\u0027s src/main.js. NOTE: our src/ is based on 0.9.16, so pass\n//   --candidate .superpowers/validation/merge-0.9.20/src/main.js (made by docs/writing-mode/tools/remerge-onto-release.js)\n// to compare the MERGED result against the 0.9.20 release.
// Exit code 1 on any FAIL.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.resolve(__dirname, "..");
const VAL = path.join(ROOT, ".superpowers", "validation");
const args = { base: path.join(VAL, "base-0.9.20", "main.js"), candidate: path.join(ROOT, "src", "main.js") };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--base") args.base = process.argv[++i];
  else if (process.argv[i] === "--candidate") args.candidate = process.argv[++i];
}

const NAMES = [
  "limitGeneratedTasks", "normalizeStableSettings", "resolveTaskGenerationPromptProfile", "taskDescriptionUserInstruction",
  "taskDescriptionUserInstructionLines", "buildWebSearchRequest", "webSearchModeProfile", "normalizeWebSearchMode",
  "webResearchResponseSchema", "chatResponseSchema", "webEvidenceLedgerEntries", "aiOperationReasoningEffort",
  "normalizeReasoningEffort", "taskWorkflowCachePrefixInstruction", "renderWebResearchAnswer", "normalizeWebSearchProvider",
  "normalizeWebSearchModel", "stableSupportedProvider", "migrateRetrievalDefaultSettings", "DEFAULT_SETTINGS"
];

function load(file, tag) {
  const src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const inject = "\nmodule.exports.__parity = {" + NAMES.map((n) => `${JSON.stringify(n)}: (typeof ${n} !== "undefined" ? ${n} : undefined)`).join(",") + "};\n";
  const filename = path.join(os.tmpdir(), `parity-${tag}-main.js`);
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(file));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request !== "obsidian") return originalLoad.call(this, request, parent, isMain);
    class Empty {}
    return { ItemView: Empty, MarkdownRenderer: {}, MarkdownView: Empty, Modal: Empty, Notice: Empty, Plugin: Empty, PluginSettingTab: Empty, Setting: Empty, TFile: Empty, setIcon() {}, requestUrl: async () => ({ status: 200, json: {} }), Platform: { isDesktop: true } };
  };
  try { compiled._compile(src + inject, filename); } finally { Module._load = originalLoad; }
  return compiled.exports.__parity;
}

// Canonical JSON: stable key order, functions dropped, volatile timestamps/ids masked.
function canon(value) {
  return JSON.stringify(value, (key, v) => {
    if (typeof v === "function") return undefined;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = v[k];
      return out;
    }
    return v;
  }, 1);
}
function firstDiff(a, b) {
  const la = a.split("\n"); const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) return `line ${i + 1}: base=${JSON.stringify((la[i] || "").trim().slice(0, 140))} cand=${JSON.stringify((lb[i] || "").trim().slice(0, 140))}`;
  return "";
}

const base = load(args.base, "base");
const cand = load(args.candidate, "cand");
const results = [];
const ALLOWED_NEW_SETTING_KEYS = (k) => /writing/i.test(k);

function scenario(id, label, fn) {
  let status = "PASS"; let detail = "identical";
  try {
    const out = fn();
    if (out === "SKIP") { status = "SKIP"; detail = "function not present in both builds"; }
    else if (out && out.diff) { status = out.status || "FAIL"; detail = out.diff; }
  } catch (e) { status = "FAIL"; detail = "threw: " + String(e && e.message || e).slice(0, 200); }
  results.push({ id, label, status, detail });
  console.log(`[${status}] ${id} ${label} - ${detail}`);
}
function compareFn(name, inputs) {
  if (typeof base[name] !== "function" || typeof cand[name] !== "function") return "SKIP";
  for (const [i, input] of inputs.entries()) {
    const run = (impl) => { try { return { ok: canon(impl[name](...JSON.parse(JSON.stringify(input)))) }; } catch (e) { return { err: String(e && e.message || e).slice(0, 120) }; } };
    const a = run(base); const b = run(cand);
    const sa = a.ok !== undefined ? a.ok : "ERR:" + a.err; const sb = b.ok !== undefined ? b.ok : "ERR:" + b.err;
    if (sa !== sb) return { diff: `input #${i} ${firstDiff(sa, sb)}` };
  }
  return null;
}

// ---- 1. exported surface of the compiled sources
scenario("1", "internal function surface", () => {
  const missing = NAMES.filter((n) => (typeof base[n] !== "undefined") && (typeof cand[n] === "undefined"));
  if (missing.length) return { diff: "missing in candidate: " + missing.join(",") };
  const present = NAMES.filter((n) => typeof base[n] !== "undefined").length;
  return { status: "PASS", diff: `${present}/${NAMES.length} probed functions present in both` };
});

// ---- 2. settings: defaults and normalisation
scenario("2a", "DEFAULT_SETTINGS (only writing-* keys may be added)", () => {
  const b = base.DEFAULT_SETTINGS; const c = cand.DEFAULT_SETTINGS;
  if (!b || !c) return "SKIP";
  const removed = Object.keys(b).filter((k) => !(k in c));
  const added = Object.keys(c).filter((k) => !(k in b));
  const unexpected = added.filter((k) => !ALLOWED_NEW_SETTING_KEYS(k));
  const stripWrite = (k, v) => (k === "aiOperationModels" && v && typeof v === "object") ? Object.fromEntries(Object.entries(v).filter(([op]) => op !== "write")) : v;
  const changed = Object.keys(b).filter((k) => k in c && canon(stripWrite(k, b[k])) !== canon(stripWrite(k, c[k])));
  if (removed.length || unexpected.length || changed.length) return { diff: `removed=[${removed}] unexpectedAdded=[${unexpected}] changed=[${changed}]` };
  return { status: "PASS", diff: `identical except added=[${added.join(",")}]` };
});
scenario("2b", "normalizeStableSettings on fixtures", () => {
  if (typeof base.normalizeStableSettings !== "function") return "SKIP";
  const fixtures = [{}, { aiModelProvider: "openrouter", embeddingProvider: "customopenai", embeddingModel: "qwen3-embedding-0.6b-8k:latest" }, { someLegacyKey: "x", sidebarMode: "write", chatWebSearchProvider: "nope", reasoning: 5 }, { taskGenerationPromptProfileMode: "manual", taskGenerationPromptProfile: "gpt-5.6-luna", noteMainTaskInstructions: "custom" }];
  for (const [i, f] of fixtures.entries()) {
    const a = base.normalizeStableSettings(JSON.parse(JSON.stringify(f))); const b = cand.normalizeStableSettings(JSON.parse(JSON.stringify(f)));
    const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !ALLOWED_NEW_SETTING_KEYS(k)).map(([k, v]) => [k, (k === "aiOperationModels" && v && typeof v === "object") ? Object.fromEntries(Object.entries(v).filter(([op]) => op !== "write")) : v]));
    const sa = canon(strip(a)); const sb = canon(strip(b));
    if (sa !== sb) return { diff: `fixture #${i} ${firstDiff(sa, sb)}` };
  }
  return null;
});
scenario("2c", "migrateRetrievalDefaultSettings", () => compareFn("migrateRetrievalDefaultSettings", [[{}], [{ maxChatContextChunks: 8, maxTaskContextChunks: 6 }]]));

// ---- 3. chat / deep research building blocks
scenario("3a", "web search mode normalisation and profiles", () => {
  let r = compareFn("normalizeWebSearchMode", [["off"], ["concise"], ["deep"], ["bogus"], [true], [undefined]]); if (r) return r;
  return compareFn("webSearchModeProfile", [["off"], ["concise"], ["deep"]]);
});
scenario("3b", "web search request bodies per provider/mode", () => {
  const mk = (provider, mode) => [{ provider, model: "m", mode, prompt: "What changed in the review process?", active: { title: "T", path: "a.md", text: "body", selection: "" }, context: [{ path: "b.md", text: "ctx", evidenceId: "E1" }] }];
  const inputs = []; for (const p of ["gemini", "openai", "anthropic", "openrouter"]) for (const m of ["concise", "deep"]) inputs.push(mk(p, m));
  return compareFn("buildWebSearchRequest", inputs);
});
scenario("3c", "research/chat response schemas", () => {
  let r = compareFn("webResearchResponseSchema", [["concise"], ["deep"]]); if (r) return r;
  return compareFn("chatResponseSchema", [[]]);
});
scenario("3d", "web evidence ledger entries", () => compareFn("webEvidenceLedgerEntries", [[[{ evidenceId: "W1", title: "A [x]", url: "https://e.org/a", excerpt: "text" }, { evidenceId: "W2", title: "B", url: "https://e.org/b", text: "t2" }]], [[]]]));
scenario("3e", "provider/model normalisers and reasoning effort", () => {
  let r = compareFn("normalizeWebSearchProvider", [["gemini"], ["openai"], ["x"], [""]]); if (r) return r;
  r = compareFn("stableSupportedProvider", [["openrouter", "openai"], ["nope", "openai"]]); if (r) return r;
  r = compareFn("normalizeReasoningEffort", [["low"], ["HIGH"], ["zzz", "auto"]]); if (r) return r;
  return compareFn("aiOperationReasoningEffort", [["auto", "chat"], ["high", "task-generation"], ["xhigh", "description", true], ["medium", "web-search", false]]);
});

// ---- 4. task generation
const T = (content, subs, extra = {}) => Object.assign({ content, subtasks: (subs || []).map((c) => (typeof c === "string" ? { content: c } : c)) }, extra);
scenario("4a", "limitGeneratedTasks (restatement/duplicate filtering and caps)", () => compareFn("limitGeneratedTasks", [
  [[T("Draft ESTMTA transfer of funds agreements and final documents", ["Review the ESTMTA transfer of funds agreements Aditi drafted", "Draft the ESTMTA transfer of funds agreements and develop the final documents", "Incorporate the ESTMTA documents Crystal will forward"])], 10, 4],
  [[T("Email Jim the IRGP guidelines", ["Email Jim the IRGP guidelines", "Attach the full application"]), T("Email Jim the IRGP guidelines", ["Send the notices of intent"]), T("Confirm committee date with Cheryl", [])], 10, 4],
  [Array.from({ length: 14 }, (_, i) => T("Task " + i, ["s1", "s2", "s3", "s4", "s5"])), 10, 4],
  [[], 10, 4]
]));
scenario("4b", "task generation prompt profile resolution", () => compareFn("resolveTaskGenerationPromptProfile", [
  [{ mode: "auto", profile: "default", selectedModel: "gpt-5.6-luna", phase: "description" }],
  [{ mode: "auto", profile: "default", selectedModel: "gpt-5.6-terra", phase: "task" }],
  [{ mode: "manual", profile: "gpt-5.6-terra", selectedModel: "claude-haiku-5-5", phase: "description" }],
  [{}]
]));
scenario("4c", "shared workflow cache prefix", () => compareFn("taskWorkflowCachePrefixInstruction", [[]]));

// ---- 5. description generation
scenario("5a", "description user-instruction lines (initial/retry, note/email, structured evidence)", () => {
  const settings = base.DEFAULT_SETTINGS ? JSON.parse(JSON.stringify(base.DEFAULT_SETTINGS)) : {};
  const mk = (extra) => [Object.assign({ phase: "initial", settings, sourceTitle: "Notes_26_07_22_ResearchTeam", descriptionInstructions: settings.noteDescriptionInstructions || "", sourceType: "note", citeContextNotes: true, structuredEvidence: true }, extra)];
  return compareFn("taskDescriptionUserInstructionLines", [mk({}), mk({ phase: "retry" }), mk({ sourceType: "email", citeContextNotes: false }), mk({ structuredEvidence: false })]);
});
scenario("5b", "description user instruction text with task rows", () => {
  const settings = base.DEFAULT_SETTINGS ? JSON.parse(JSON.stringify(base.DEFAULT_SETTINGS)) : {};
  const rows = [{ scope_id: "t1", title: "Send guidelines to Jim", must: ["E1"], refs: ["E1", "E2"] }];
  return compareFn("taskDescriptionUserInstruction", [
    [{ phase: "initial", settings, sourceTitle: "Notes", descriptionInstructions: "d", sourceType: "note", promptMainTasks: rows, sharedTaskEvidence: { providerHandleLines: ["E1 text", "E2 text"] }, citeContextNotes: true, structuredEvidence: true }],
    [{ phase: "retry", settings, sourceTitle: "Notes", descriptionInstructions: "d", sourceType: "note", promptMainTasks: rows, sharedTaskEvidence: { providerHandleLines: ["E1 text"] }, structuredEvidence: true }]
  ]);
});

const fails = results.filter((r) => r.status === "FAIL").length;
const skips = results.filter((r) => r.status === "SKIP").length;
fs.mkdirSync(VAL, { recursive: true });
fs.writeFileSync(path.join(VAL, "parity-report.json"), JSON.stringify({ base: args.base, candidate: args.candidate, results }, null, 2));
console.log(`\nparity: ${results.length - fails - skips} pass, ${fails} fail, ${skips} skipped -> .superpowers/validation/parity-report.json`);
process.exit(fails ? 1 : 0);
