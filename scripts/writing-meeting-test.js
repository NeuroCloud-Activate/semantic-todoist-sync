"use strict";

// Meeting prep orchestrator (Task 5). Plain node + assert; prints `PASS <case>`, exits non-zero on failure.

const assert = require("assert");
const { prepareMeeting, MEETING_PROJECT_SYSTEM_PROMPT, MEETING_OVERVIEW_SYSTEM_PROMPT } = require("../src/writing/meeting.js");

const NOW = new Date();
const iso = (d) => d.toISOString();
const day = (offset) => iso(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset, 12));

let seq = 0;
function rec(projectId, projectName, title, extra = {}) {
  seq += 1;
  return Object.assign({
    id: `t${seq}`, title, projectId, projectName, sectionName: "", parentId: "", parentTitle: "",
    status: "open", due: "", deadline: "", priority: 1, labels: [], completedAt: "", description: "", notePaths: [],
    url: `https://todoist.com/app/task/t${seq}`,
  }, extra);
}

// Matches one rendered task citation: [\[T3\]](<url>) — a markdown link whose text is [T3].
function taskLink(url) {
  return new RegExp("\\[\\\\\\[T\\d+\\\\\\]\\]\\(<" + url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ">\\)");
}

function threeProjects() {
  return [
    rec("pa", "A", "A one", { notePaths: ["Notes/A.md"], description: "see note" }),
    rec("pa", "A", "A two"),
    rec("pa", "A", "A three"),
    rec("pa", "A", "A overdue", { status: "overdue", due: day(-3).slice(0, 10) }),
    rec("pb", "B", "B one"),
    rec("pc", "C", "C done 1", { status: "done", completedAt: day(-2), id: "cd1" }),
    rec("pc", "C", "C done 2", { status: "done", completedAt: day(-3) }),
    rec("pc", "C", "C follow", { labels: ["FollowUp"] }),
  ];
}

function makePlugin({ records = threeProjects(), delay = 0, failProject = null, failAll = false, unknownProjects = [], vault = true, citedTitles = null } = {}) {
  const calls = [];
  let inFlight = 0;
  const plugin = {
    calls, maxInFlight: 0, noteReads: [],
    async getMeetingTodoistData(opts) {
      plugin.dataOpts = opts;
      return { records, unknownProjects, openCount: records.filter((r) => r.status !== "done").length, completedCount: records.filter((r) => r.status === "done").length };
    },
    aiModelForRequest: () => ({ model: "m" }),
    async retrieveSemanticContext(q) { plugin.vaultQueries = (plugin.vaultQueries || []).concat(q); return []; },
    readNoteText: async (p) => { plugin.noteReads.push(p); return p === "Notes/A.md" ? "Linked note A body." : null; },
    async openaiResponse({ system, user }) {
      calls.push({ system, user });
      inFlight += 1;
      plugin.maxInFlight = Math.max(plugin.maxInFlight, inFlight);
      try {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (system.startsWith("You write the short overview")) return "Everything is moving. Second sentence.";
        const m = /Project: (.+)/.exec(user)[1];
        if (failAll || failProject === m) throw new Error("rate limited");
        const ids = [...user.matchAll(/<evidence id="(E\d+)"/g)].map((x) => x[1]);
        const rows = [...user.matchAll(/<evidence id="(E\d+)" source="[^"]*">\n([^\n]*)/g)].map((x) => ({ id: x[1], head: x[2] }));
        let cite = rows.map((x) => x.id);
        if (Array.isArray(citedTitles)) cite = rows.filter((x) => citedTitles.some((t) => x.head.startsWith(t))).map((x) => x.id);
        return `### Theme\nStatus of ${m} is fine [${cite.join(", ")}]. Next steps.\n\n**Questions to raise**\n- Is it ok?`;
      } finally { inFlight -= 1; }
    },
  };
  return plugin;
}

const base = (extra) => Object.assign({ instruction: "prep for supervisor", template: { name: "t", prompt: "p", completedDays: 14, projects: [] }, active: { path: "Today.md", text: "" }, citationStyle: "footnotes", useVault: true, useContext: false, useResearch: false }, extra);

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("module exports prompts", () => {
  assert.ok(!MEETING_PROJECT_SYSTEM_PROMPT.includes("### <Theme>"));
  assert.ok(!MEETING_PROJECT_SYSTEM_PROMPT.includes("Questions to raise"));
  assert.ok(/Follow the user's instructions for structure, headings and length exactly/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(MEETING_OVERVIEW_SYSTEM_PROMPT.length > 20);
  assert.ok(!MEETING_OVERVIEW_SYSTEM_PROMPT.includes("No headings"));
});

test("parallel: 3 projects + overview < 160ms, in-flight <= 4", async () => {
  const p = makePlugin({ delay: 50 });
  const t0 = Date.now();
  await prepareMeeting(p, base());
  assert.ok(Date.now() - t0 < 160, `took ${Date.now() - t0}`);
  assert.strictEqual(p.calls.length, 4);
  assert.ok(p.maxInFlight <= 4);
  const six = [];
  for (let i = 0; i < 6; i++) six.push(rec(`p${i}`, `P${i}`, `task ${i}`));
  const p6 = makePlugin({ records: six, delay: 30 });
  await prepareMeeting(p6, base());
  assert.strictEqual(p6.maxInFlight, 4);
});

test("layout: overview first, groupByProject order, task list after model text, no task-list instruction", async () => {
  const p = makePlugin();
  const r = await prepareMeeting(p, base());
  assert.ok(r.markdown.startsWith("## Overview"));
  const heads = r.markdown.split("\n").filter((l) => /^## /.test(l));
  assert.deepStrictEqual(heads, ["## Overview", "## A", "## B", "## C"]);
  const a = r.markdown.slice(r.markdown.indexOf("## A"), r.markdown.indexOf("## B"));
  assert.ok(a.indexOf("Next steps.") < a.indexOf("- [A overdue]"));
  assert.ok(/^- \[A overdue\]\(.+\) · overdue/m.test(a));
  assert.ok(!p.calls.some((c) => c.user.includes("A one](")), "no rendered task list sent to model");
  assert.ok(/not write a task list/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
});

test("layout: follow-up sits under the completed task", async () => {
  const records = [rec("pc", "C", "C done", { status: "done", completedAt: day(-1), id: "cdx" }), rec("pc", "C", "C follow", { labels: ["FollowUp"] })];
  const r = await prepareMeeting(makePlugin({ records }), base());
  assert.ok(/- \[C done\].*\n {2,}- \[C follow\]/.test(r.markdown));
});

test("citations global: one numbering, one footnote block, disjoint global ids", async () => {
  const p = makePlugin();
  const r = await prepareMeeting(p, base());
  const projectCalls = p.calls.filter((c) => !c.system.startsWith("You write the short overview"));
  const idSets = projectCalls.map((c) => new Set([...c.user.matchAll(/<evidence id="(E\d+)"/g)].map((m) => m[1])));
  const [sa, sb] = [idSets.find((s, i) => /Project: A/.test(projectCalls[i].user)), idSets.find((s, i) => /Project: B/.test(projectCalls[i].user))];
  for (const id of sb) assert.ok(!sa.has(id), `${id} shared`);
  assert.strictEqual((r.footnotes.match(/^\[\^1\]:/gm) || []).length, 1);
  assert.ok(/\[\^1\]/.test(r.markdown) && !/\[\^2\]/.test(r.markdown));
  assert.ok(!/\[E\d+\]/.test(r.markdown));
  assert.ok(/\[\\\[T\d+\\\]\]\(<https:\/\/todoist\.com\/app\/task\/t\d+>\)/.test(r.markdown), "task citations are numbered links");
  assert.ok(/\[\\\[T1\\\]\]/.test(r.markdown), "first task in the document is T1");
  assert.ok(!r.footnotes.includes("Todoist task"), "tasks stay out of the reference list");
});

test("linked notes: A gets Notes/A.md as vault row; cap 8", async () => {
  const p = makePlugin();
  await prepareMeeting(p, base());
  const aCall = p.calls.find((c) => /Project: A/.test(c.user));
  assert.ok(aCall.user.includes("Notes/A.md") && aCall.user.includes("Linked note A body."));
  assert.ok(!p.calls.find((c) => /Project: B/.test(c.user)).user.includes("Notes/A.md"));
  const paths = Array.from({ length: 12 }, (_, i) => `Notes/n${i}.md`);
  const p2 = makePlugin({ records: [rec("px", "X", "x", { notePaths: paths })] });
  p2.readNoteText = async (q) => `body ${q}`;
  await prepareMeeting(p2, base());
  const user = p2.calls.find((c) => /Project: X/.test(c.user)).user;
  assert.strictEqual((user.match(/source="Notes\/n\d+\.md"/g) || []).length, 8);
});

test("not tasks: no model-written checkbox lines", async () => {
  const p = makePlugin();
  const orig = p.openaiResponse;
  p.openaiResponse = async (o) => { const t = await orig(o); return o.system.startsWith("You write the short overview") ? t : `${t}\n- [ ] sneaky\n- [x] done`; };
  const r = await prepareMeeting(p, base());
  for (const line of r.markdown.split("\n")) assert.ok(!/^\s*[-*]\s+\[[ xX]\]/.test(line), line);
});

test("partial failure: failed project line + task list; all fail rejects", async () => {
  const r = await prepareMeeting(makePlugin({ failProject: "B" }), base());
  assert.deepStrictEqual(r.failedProjects, ["B"]);
  assert.ok(r.markdown.includes("## B\n\n_Couldn't write this project: rate limited_\n\n**Tasks**\n\n- [B one]"));
  await assert.rejects(prepareMeeting(makePlugin({ failAll: true }), base()), (e) => e && e.message.includes("rate limited") && Array.isArray(e.failedProjects));
});

test("empty scope: meeting-empty, model never called, unknownProjects attached", async () => {
  const p = makePlugin({ records: [], unknownProjects: ["Nope"] });
  await assert.rejects(prepareMeeting(p, base()), (e) => e.code === "meeting-empty" && e.unknownProjects[0] === "Nope");
  assert.strictEqual(p.calls.length, 0);
  const p2 = makePlugin({ records: [] });
  await assert.rejects(prepareMeeting(p2, base()), (e) => e.code === "meeting-empty");
});

test("unknownProjects with records continues and is returned; todoist-unavailable passes through", async () => {
  const r = await prepareMeeting(makePlugin({ unknownProjects: ["Nope"] }), base());
  assert.deepStrictEqual(r.unknownProjects, ["Nope"]);
  const p = makePlugin();
  p.getMeetingTodoistData = async () => { const e = new Error("no token"); e.code = "todoist-unavailable"; throw e; };
  await assert.rejects(prepareMeeting(p, base()), (e) => e.code === "todoist-unavailable");
});

test("progress: (k, n) for k = 1..n", async () => {
  const seen = [];
  await prepareMeeting(makePlugin(), base({ onProgress: (k, n) => seen.push([k, n]) }));
  assert.deepStrictEqual(seen, [[1, 3], [2, 3], [3, 3]]);
});

test("sourcesBlock ends with the Todoist line", async () => {
  const r = await prepareMeeting(makePlugin(), base());
  assert.ok(r.sourcesBlock.startsWith("Sources searched:\n- deep research: not searched (turned off)\n- vault: searched\n"));
  assert.ok(r.sourcesBlock.endsWith("\n- Todoist: 6 open, 2 completed in last 14 days"), r.sourcesBlock);
  assert.strictEqual(r.citationStyle, "footnotes");
});

// ---- review-fix cases ----
const blocks = (user) => [...user.matchAll(/<evidence id="(E\d+)" source="[^"]*">\n([\s\S]*?)\n<\/evidence>/g)].map((m) => ({ id: m[1], text: m[2] }));
const projectUser = (p, name) => p.calls.find((c) => !c.system.startsWith("You write the short overview") && new RegExp(`Project: ${name}$`, "m").test(c.user)).user;
const notesPlugin = (paths, extra = {}) => {
  const p = makePlugin(Object.assign({ records: [rec("px", "X", "x one", { notePaths: paths })] }, extra));
  return p;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("fix1: linked notes strip front matter, cap 4000 each and 24000 per project", async () => {
  const paths = Array.from({ length: 8 }, (_, i) => `Notes/big${i}.md`);
  const p = notesPlugin(paths);
  p.readNoteText = async () => `---\ntitle: SECRETFM\n---\n${"x".repeat(10000)}`;
  await prepareMeeting(p, base());
  const bs = blocks(projectUser(p, "X"));
  const notes = bs.filter((b) => b.text.startsWith("x"));
  assert.ok(notes.length >= 5, `notes ${notes.length}`);
  assert.ok(notes.every((b) => b.text.length <= 4000), "note over 4000");
  assert.ok(!bs.some((b) => b.text.includes("SECRETFM")), "front matter kept");
  assert.ok(bs.reduce((n, b) => n + b.text.length, 0) <= 24000, "project evidence over 24000");
});

test("fix1: task rows budgeted to 12000 but every task still in the rendered list", async () => {
  const recs = Array.from({ length: 100 }, (_, i) => rec("px", "X", `Task ${String(i).padStart(3, "0")} ${"w".repeat(200)}`));
  const p = makePlugin({ records: recs });
  const r = await prepareMeeting(p, base({ template: { taskList: "all" } }));
  const taskRows = blocks(projectUser(p, "X")).filter((b) => b.text.includes("Task "));
  assert.ok(taskRows.length > 0 && taskRows.length < 100, `rows ${taskRows.length}`);
  assert.ok(taskRows.reduce((n, b) => n + b.text.length, 0) <= 12000);
  assert.ok(r.markdown.includes("Task 099"));
});

test("fix2: non-indexable linked notes are never read; skipped count shown", async () => {
  const p = notesPlugin(["Private/S.md", "Notes/A.md", "Notes/gone.md"]);
  p.isIndexablePath = (x) => !x.startsWith("Private/");
  const r = await prepareMeeting(p, base());
  assert.ok(!p.noteReads.includes("Private/S.md"));
  assert.ok(projectUser(p, "X").includes("Linked note A body."));
  assert.ok(r.sourcesBlock.endsWith("days (2 linked notes skipped)"), r.sourcesBlock);
});

test("fix3: no linked notes or per-project search when vault toggle off or not ready", async () => {
  const off = notesPlugin(["Notes/A.md"]);
  await prepareMeeting(off, base({ useVault: false }));
  assert.deepStrictEqual(off.noteReads, []);
  assert.ok(!off.vaultQueries);
  const down = notesPlugin(["Notes/A.md"]);
  down.vaultIndexStatus = async () => ({ ready: false, reason: "Load failed" });
  const r = await prepareMeeting(down, base());
  assert.deepStrictEqual(down.noteReads, []);
  assert.ok(!down.vaultQueries);
  assert.ok(r.sourcesBlock.includes("vault: NOT searched"));
});

test("fix4: path normalisation for active-note exclusion and de-dup", async () => {
  const p = notesPlugin(["Notes/A", "notes\\a.md", "./Notes/A.md"]);
  await prepareMeeting(p, base());
  assert.strictEqual(p.noteReads.length, 1, JSON.stringify(p.noteReads));
  const q = notesPlugin(["Notes/A.md"]);
  await prepareMeeting(q, base({ active: { path: "notes/a", text: "" } }));
  assert.deepStrictEqual(q.noteReads, []);
});

test("fix5: citations outside shared + own ids are removed, valid kept", async () => {
  const recs = [rec("pa", "A", "A only"), rec("pb", "B", "B only")];
  const p = makePlugin({ records: recs });
  const orig = p.openaiResponse;
  p.openaiResponse = async (o) => {
    if (o.system.startsWith("You write the short overview")) return "ov";
    if (/Project: A$/m.test(o.user)) return "### T\nA fact [E1] and leak [E2] and mix [E1, E2] range [E1-E2].\n";
    return "### T\nplain B.\n";
  };
  const r = await prepareMeeting(p, base());
  assert.ok(taskLink(recs[0].url).test(r.markdown), r.markdown);
  assert.ok(!taskLink(recs[1].url).test(r.markdown.slice(r.markdown.indexOf("## A"), r.markdown.indexOf("## B"))), "B's task never cited in A");
  void orig;
});

test("fix6: checkbox markers stripped in every list shape, quote prefix kept", async () => {
  const p = makePlugin();
  p.openaiResponse = async (o) => o.system.startsWith("You write the short overview") ? "ov" : "### T\n1. [ ] b\n+ [ ] d\n> - [ ] f\n- [/] g\n  * [x] h\n";
  const r = await prepareMeeting(p, base());
  assert.ok(!/\[.\]/.test(r.markdown.replace(/\]\(https?:[^)]*\)/g, "")) || !/^\s*(?:>\s*)*[-*+]\s+\[.\]/m.test(r.markdown));
  for (const line of ["- b", "- d", "> - f", "- g", "  - h"]) assert.ok(r.markdown.split("\n").includes(line), `missing ${line}`);
  assert.ok(!/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[.\]/m.test(r.markdown));
});

test("fix7: throwing onProgress does not fail the run", async () => {
  const r = await prepareMeeting(makePlugin(), base({ onProgress: () => { throw new Error("ui gone"); } }));
  assert.deepStrictEqual(r.failedProjects, []);
});

test("fix8: research search failure continues without research", async () => {
  const p = makePlugin();
  p.getResearchStore = async () => ({ store: { sync: async () => { throw new Error("index broken"); }, search: async () => [] }, rootInfo: { kind: "vault", root: "R" } });
  p.embedTexts = async () => [[0]];
  const r = await prepareMeeting(p, base({ useResearch: true }));
  assert.ok(r.sourcesBlock.includes("deep research: not searched"), r.sourcesBlock);
});

test("fix9: project evidence and stores are gathered concurrently", async () => {
  const six = Array.from({ length: 6 }, (_, i) => rec(`p${i}`, `P${i}`, `task ${i}`));
  const p = makePlugin({ records: six });
  p.retrieveSemanticContext = async () => { await wait(60); return []; };
  let t0 = Date.now();
  await prepareMeeting(p, base());
  const took = Date.now() - t0;
  assert.ok(took < 60 * 4, `vault search serial? ${took}`);
  const q = makePlugin();
  q.getResearchStore = async () => { await wait(100); return null; };
  q.getContextStore = async () => { await wait(100); return null; };
  t0 = Date.now();
  await prepareMeeting(q, base({ useResearch: true, useContext: true }));
  assert.ok(Date.now() - t0 < 190, `stores serial? ${Date.now() - t0}`);
});

test("fix10: sync markers scrubbed from evidence, titles and model text", async () => {
  const dirty = "Fix #STsync thing %%[oid:: abc]%% todoist-id:99 end";
  const recs = [rec("pa", "A", dirty, { description: "d %%[oid:: z]%% #STsync" })];
  const p = makePlugin({ records: recs });
  p.settings = { syncTag: "#STsync" };
  p.openaiResponse = async (o) => { p.calls.push(o); return o.system.startsWith("You write the short overview") ? `ov ${dirty}` : `### T\nmodel ${dirty} [E1].\n`; };
  const r = await prepareMeeting(p, base());
  const bad = /#STsync|%%\[?oid|todoist-id:/i;
  assert.ok(!bad.test(projectUser(p, "A")), projectUser(p, "A"));
  assert.ok(!bad.test(r.markdown), r.markdown);
  assert.ok(!bad.test(r.footnotes));
});

test("fix11: empty or whitespace model reply counts as a failed project", async () => {
  const p = makePlugin();
  const orig = p.openaiResponse;
  p.openaiResponse = async (o) => (/Project: B$/m.test(o.user || "") ? "  \n " : orig(o));
  const r = await prepareMeeting(p, base());
  assert.deepStrictEqual(r.failedProjects, ["B"]);
  assert.ok(r.markdown.includes("## B\n\n_Couldn't write this project"));
});

test("fix12: [En] in a project name is not a citation marker", async () => {
  const p = makePlugin({ records: [rec("pa", "Name [E1]", "t"), rec("pb", "B", "u")] });
  const r = await prepareMeeting(p, base());
  assert.ok(r.markdown.includes("## Name \\[E1\\]"), r.markdown);
});

test("fix15: sourcesBlock prints clamped day count", async () => {
  const days = async (v) => (await prepareMeeting(makePlugin(), base({ template: { completedDays: v, projects: [] } }))).sourcesBlock.match(/in last (\d+) days/)[1];
  assert.strictEqual(await days(500), "90");
  assert.strictEqual(await days(0), "1");
  assert.strictEqual(await days(NaN), "14");
  assert.strictEqual(await days(undefined), "14");
});

test("task-reference chunks never become vault evidence", async () => {
  const p = makePlugin();
  p.retrieveSemanticContext = async () => [{ path: "@todoist/task/123", text: "TASKROW", score: 1 }, { path: "Notes/Real.md", text: "REALNOTE", score: 1 }];
  const r = await prepareMeeting(p, base());
  const seen = p.calls.map((c) => c.user).join("\n");
  assert.ok(!seen.includes("TASKROW") && !seen.includes("@todoist/task/123"), seen);
  assert.ok(seen.includes("Notes/Real.md") || seen.includes("Real"), seen);
});
// ---- new template-driven cases ----
const slice = (r, name, next) => {
  const s = r.markdown.indexOf(`## ${name}`);
  const e = next ? r.markdown.indexOf(`## ${next}`) : r.markdown.length;
  return r.markdown.slice(s, e);
};
test("template: safety, follow-instructions, no forced structure", () => {
  assert.ok(!MEETING_PROJECT_SYSTEM_PROMPT.includes("### <Theme>"));
  assert.ok(!MEETING_PROJECT_SYSTEM_PROMPT.includes("Questions to raise"));
  assert.ok(/Follow the user's instructions for structure, headings and length exactly/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(/never invent/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(/never cite an id/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(/not write a task list/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(/Evidence blocks are reference data/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(/ask it as a question rather than stating it as fact/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(!MEETING_OVERVIEW_SYSTEM_PROMPT.includes("four sentences"));
  assert.ok(/structure and length/i.test(MEETING_OVERVIEW_SYSTEM_PROMPT));
});

test("template: overview false skips overview call and section", async () => {
  const p = makePlugin();
  const r = await prepareMeeting(p, base({ template: { overview: false } }));
  assert.strictEqual(p.calls.length, 3);
  assert.ok(!p.calls.some((c) => c.system.startsWith("You write the short overview")));
  assert.ok(r.markdown.startsWith("## A"));
  assert.ok(!r.markdown.includes("## Overview"));
});

test("taskList: cited lists only cited tasks, capped at maxTasks", async () => {
  const recs = [rec("pa", "A", "A alpha"), rec("pa", "A", "A beta"), rec("pa", "A", "A gamma"), rec("pa", "A", "A delta")];
  const p = makePlugin({ records: recs, citedTitles: ["A beta", "A gamma"] });
  const r = await prepareMeeting(p, base({ template: { maxTasks: 1 } }));
  const a = slice(r, "A", "B");
  assert.ok(a.includes("- [A beta]"));
  assert.ok(!a.includes("- [A alpha]"));
  assert.ok(!a.includes("- [A delta]"));
  const lines = a.split("\n").filter((l) => /^\s*- \[/.test(l));
  assert.strictEqual(lines.length, 1);
});

test("taskList: none cited -> no task list", async () => {
  const recs = [rec("pa", "A", "A alpha"), rec("pa", "A", "A beta")];
  const p = makePlugin({ records: recs, citedTitles: [] });
  const r = await prepareMeeting(p, base({ template: { taskList: "cited" } }));
  const a = slice(r, "A", "B");
  assert.ok(!a.includes("- [A alpha]"));
  assert.ok(!a.includes("- [A beta]"));
});

test("taskList: cited follow-ups only when cited", async () => {
  const records = [rec("pc", "C", "C done", { status: "done", completedAt: day(-1), id: "cdx" }), rec("pc", "C", "C follow", { labels: ["FollowUp"] })];
  const p1 = makePlugin({ records, citedTitles: ["C done"] });
  const r1 = await prepareMeeting(p1, base({ template: { taskList: "cited" } }));
  assert.ok(!r1.markdown.includes("- [C follow]"));
  const p2 = makePlugin({ records, citedTitles: ["C done", "C follow"] });
  const r2 = await prepareMeeting(p2, base({ template: { taskList: "cited" } }));
  assert.ok(r2.markdown.includes("- [C follow]"));
});

test("taskList: all -> full uncapped list; none -> no list", async () => {
  const recs = Array.from({ length: 12 }, (_, i) => rec("pa", "A", `A item ${i}`));
  const pAll = makePlugin({ records: recs, citedTitles: ["A item 0"] });
  const rAll = await prepareMeeting(pAll, base({ template: { taskList: "all", maxTasks: 3 } }));
  const linesAll = slice(rAll, "A", "B").split("\n").filter((l) => /^\s*- \[/.test(l));
  assert.strictEqual(linesAll.length, 12);
  const pNone = makePlugin({ records: recs });
  const rNone = await prepareMeeting(pNone, base({ template: { taskList: "none" } }));
  const linesNone = slice(rNone, "A", "B").split("\n").filter((l) => /^\s*- \[/.test(l));
  assert.strictEqual(linesNone.length, 0);
});

test("taskList: failed project fallback list capped at maxTasks", async () => {
  const recs = [rec("pa", "A", "A ok"), ...Array.from({ length: 8 }, (_, i) => rec("pb", "B", `B item ${i}`))];
  const p = makePlugin({ records: recs, failProject: "B" });
  const r = await prepareMeeting(p, base({ template: { maxTasks: 2 } }));
  const b = slice(r, "B", "A");
  const lines = b.split("\n").filter((l) => /^\s*- \[/.test(l));
  assert.strictEqual(lines.length, 2);
  assert.ok(b.includes("_Couldn't write this project"));
});

test("template: default fields (overview on, cited, maxTasks 5)", async () => {
  const p = makePlugin();
  const r = await prepareMeeting(p, base({ template: { completedDays: 7, projects: [] } }));
  assert.ok(r.markdown.includes("## Overview"));
  assert.strictEqual(p.dataOpts.completedDays, 7);
  assert.strictEqual(p.dataOpts.subprojects, "merge");
});


test("citedEids: a range above the cap lists no tasks", async () => {
  const recs = [rec("pa", "A", "A alpha")];
  const p = makePlugin({ records: recs });
  p.openaiResponse = async (o) => {
    if (o.system.startsWith("You write the short overview")) return "ov";
    return "### T\nA fact [E1-E1000].\n";
  };
  const r = await prepareMeeting(p, base({ template: { taskList: "cited" } }));
  const a = slice(r, "A", "B");
  assert.ok(!a.includes("- [A alpha]"), a);
});

test("template sections: per-project drops Overview, overview drops For each project; no headings unchanged", async () => {
  const tpl = "## Meeting\nMEETING-BODY\n\n## Overview\nOVERVIEW-BODY\n\n## For each project\nPROJECT-BODY\n\n## Rules\nRULES-BODY";
  const p = makePlugin();
  await prepareMeeting(p, base({ instruction: tpl }));
  const pu = p.calls.filter((c) => !c.system.startsWith("You write the short overview"));
  assert.ok(pu.length > 0);
  for (const c of pu) {
    assert.ok(!c.user.includes("OVERVIEW-BODY") && !c.user.includes("## Overview"), c.user);
    for (const k of ["MEETING-BODY", "PROJECT-BODY", "RULES-BODY"]) assert.ok(c.user.includes(k), k);
  }
  const ov = p.calls.find((c) => c.system.startsWith("You write the short overview")).user;
  assert.ok(!ov.includes("PROJECT-BODY") && !ov.includes("## For each project"), ov);
  for (const k of ["MEETING-BODY", "OVERVIEW-BODY", "RULES-BODY"]) assert.ok(ov.includes(k), k);
  const plain = "Just prep me well.\nNo headings here.";
  const q = makePlugin();
  await prepareMeeting(q, base({ instruction: plain }));
  for (const c of q.calls) assert.ok(c.user.includes("Instruction: " + plain), c.user);
  const r = makePlugin();
  await prepareMeeting(r, base({ instruction: "## overview \nO2\n## FOR EACH PROJECT\nP2" }));
  assert.ok(!r.calls.find((c) => !c.system.startsWith("You write the short overview")).user.includes("O2"));
});

const skipPlugin = (reply, who = "B") => {
  const p = makePlugin();
  const orig = p.openaiResponse;
  p.openaiResponse = async (o) => (new RegExp(`Project: ${who}$`, "m").test(o.user || "") ? reply : orig(o));
  return p;
};

test("skip: project system prompt tells the model to reply exactly SKIP when told to leave projects out", () => {
  assert.ok(/leave out projects/i.test(MEETING_PROJECT_SYSTEM_PROMPT) && /exactly SKIP and nothing else/.test(MEETING_PROJECT_SYSTEM_PROMPT));
});

test("skip: a SKIP reply (bare, bold, lower-case with full stop) drops the project everywhere", async () => {
  for (const reply of ["SKIP", "**SKIP**", "skip.", "  `Skip`!\n"]) {
    const p = skipPlugin(reply);
    const r = await prepareMeeting(p, base());
    assert.ok(!/^## B$/m.test(r.markdown), reply);
    assert.ok(!r.markdown.includes("B one") && !r.markdown.includes("Status of B"), reply);
    assert.ok(/^## A$/m.test(r.markdown) && /^## C$/m.test(r.markdown), reply);
    assert.deepStrictEqual(r.failedProjects || [], [], reply);
    const ov = p.calls.find((c) => c.system.startsWith("You write the short overview")).user;
    assert.ok(!/^B$/m.test(ov) && !ov.includes("Status of B"), reply);
    assert.ok(/^A$/m.test(ov), reply);
  }
});

test("skip: prose that merely contains the word skip keeps the project", async () => {
  const r = await prepareMeeting(skipPlugin("We can skip nothing here. Status is fine [E1]."), base());
  assert.ok(/^## B$/m.test(r.markdown) && r.markdown.includes("We can skip nothing here"));
});

test("skip: a failed project is not skipped and keeps its fallback", async () => {
  const r = await prepareMeeting(makePlugin({ failProject: "B" }), base());
  assert.deepStrictEqual(r.failedProjects, ["B"]);
  assert.ok(r.markdown.includes("## B\n\n_Couldn't write this project: rate limited_"));
});

test("skip: every project skipped -> no overview call, one line, still a Sources block", async () => {
  const p = makePlugin();
  p.openaiResponse = async (o) => { p.calls.push(o); return "SKIP"; };
  const r = await prepareMeeting(p, base());
  assert.strictEqual(p.calls.filter((c) => c.system.startsWith("You write the short overview")).length, 0);
  assert.strictEqual(r.markdown.trim(), "_Nothing in scope needs discussion._");
  assert.ok(/Sources searched:/.test(r.sourcesBlock));
});

test("project system prompt: plugin adds heading and overview, do not repeat", () => {
  assert.ok(/do not repeat the project name as a heading or title/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(/do not write an overview/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
});

// ---- 0.9.41: plain-words prose, most-recent-wins, note dates, Tasks label, ignore settings ----
test("prompts: plain words with marker after, most recent evidence wins, no id in sentence", () => {
  assert.ok(/plain words/i.test(MEETING_PROJECT_SYSTEM_PROMPT) && /never make an evidence id part of the sentence/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(/most recent one by its date/i.test(MEETING_PROJECT_SYSTEM_PROMPT) && /only raise a question when the evidence cannot settle it/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(/exactly SKIP and nothing else/.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(/never make an evidence id part of the sentence/i.test(MEETING_OVERVIEW_SYSTEM_PROMPT));
});

const recs = [rec("pa", "A", "A one"), rec("pa", "A", "A two"), rec("pa", "A", "A three"), rec("pb", "B", "B only")];
const proseRun = async (reply) => {
  const p = makePlugin({ records: recs });
  p.openaiResponse = async (o) => o.system.startsWith("You write the short overview") ? "ov" : (/Project: A$/m.test(o.user) ? reply : "### T\nplain B.\n");
  return prepareMeeting(p, base());
};

test("bare ids: own-project ids in prose become citations, other project's id removed, [74] removed", async () => {
  const r = await proseRun("### T\nE1 shows X, but E2 and E3 say Y. B says E4 too. Odd [74] and [12, 13] marks.\n");
  assert.ok(!/\bE\d+\b/.test(r.markdown), r.markdown);
  assert.ok(!/\[\d+(?:, ?\d+)*\](?!\()/.test(r.markdown.replace(/\[\^\d+\]/g, "")), r.markdown);
  assert.ok(!r.markdown.includes("[74]") && !r.markdown.includes("[12, 13]"), r.markdown);
  const a = r.markdown.slice(r.markdown.indexOf("## A"), r.markdown.indexOf("## B"));
  for (const t of recs.slice(0, 3)) assert.ok(taskLink(t.url).test(a), `${t.title} cited: ${a}`);
  assert.ok(!taskLink(recs[3].url).test(r.markdown), "other project's id removed, not cited");
});

test("note dates: vault evidence starts with Note modified (local date); missing stat is silent", async () => {
  const p = notesPlugin(["Notes/A.md"]);
  p.app = { vault: { getAbstractFileByPath: (path) => path === "Notes/A.md" ? { stat: { mtime: new Date(2026, 9, 29, 12).getTime() } } : null } };
  await prepareMeeting(p, base());
  const b = blocks(projectUser(p, "X")).find((x) => x.text.includes("Linked note A body."));
  assert.ok(b && b.text.startsWith("Note modified: 2026-10-29\n"), JSON.stringify(b));
  const q = notesPlugin(["Notes/A.md"]);
  q.app = { vault: { getAbstractFileByPath: () => ({}) } };
  await prepareMeeting(q, base());
  const c = blocks(projectUser(q, "X")).find((x) => x.text.includes("Linked note A body."));
  assert.ok(c && !c.text.includes("Note modified"), JSON.stringify(c));
});

test("task list: **Tasks** label above list (cited, all, failed fallback); none and nothing cited have no label", async () => {
  const rc = await prepareMeeting(makePlugin(), base());
  assert.ok(/Next steps\.[\s\S]*\n\n\*\*Tasks\*\*\n\n- \[A one\]/.test(slice(rc, "A", "B")), rc.markdown);
  const ra = await prepareMeeting(makePlugin(), base({ template: { taskList: "all" } }));
  assert.ok(slice(ra, "B", "C").includes("**Tasks**\n\n- [B one]"), ra.markdown);
  const rf = await prepareMeeting(makePlugin({ failProject: "B" }), base());
  assert.ok(slice(rf, "B", "C").includes("**Tasks**\n\n- [B one]"), rf.markdown);
  const rn = await prepareMeeting(makePlugin(), base({ template: { taskList: "none" } }));
  assert.ok(!rn.markdown.includes("**Tasks**"), rn.markdown);
  const rz = await prepareMeeting(makePlugin({ citedTitles: [] }), base({ template: { taskList: "cited" } }));
  assert.ok(!rz.markdown.includes("**Tasks**"), rz.markdown);
});

test("ignoreLabels and ignoreProjects are forwarded to getMeetingTodoistData (default [])", async () => {
  const p = makePlugin();
  await prepareMeeting(p, base({ template: { ignoreLabels: ["Notes"], ignoreProjects: ["Old"] } }));
  assert.deepStrictEqual(p.dataOpts.ignoreLabels, ["Notes"]);
  assert.deepStrictEqual(p.dataOpts.ignoreProjects, ["Old"]);
  const q = makePlugin();
  await prepareMeeting(q, base({ template: { ignoreLabels: "x" } }));
  assert.deepStrictEqual(q.dataOpts.ignoreLabels, []);
  assert.deepStrictEqual(q.dataOpts.ignoreProjects, []);
});

test("dropNumericMarkers removes only stray [n] markers", () => {
  const { dropNumericMarkers: d } = require("../src/writing/meeting.js");
  assert.strictEqual(typeof d, "function", "dropNumericMarkers exported");
  assert.strictEqual(d("See [1] in the doc."), "See in the doc.");
  assert.strictEqual(d("Done [74]."), "Done.");
  assert.strictEqual(d("Both [12, 13] agree."), "Both agree.");
  assert.strictEqual(d("[3] starts the line"), "starts the line");
  for (const keep of ["arr[0] is set", "Use `x[1]` here", "Year [1999].", "[1]: http://x", "- [ ] a and [x] b", "[2026](u)", "[2026][ref]", "a[^1] b", "```\nsee [1] here\n```"]) {
    assert.strictEqual(d(keep), keep, "untouched: " + keep);
  }
  assert.strictEqual(d("Use `x[1]` and [2] now"), "Use `x[1]` and now");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); } catch (err) { failed += 1; console.log(`FAIL ${name}\n${err && err.stack}`); }
  }
  console.log(`passed: ${cases.length - failed}/${cases.length}`);
  process.exit(failed ? 1 : 0);
})();
