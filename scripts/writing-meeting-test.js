"use strict";

// Meeting prep orchestrator (Task 5). Plain node + assert; prints `PASS <case>`, exits non-zero on failure.

const assert = require("assert");
const { prepareMeeting, MEETING_PROJECT_SYSTEM_PROMPT, MEETING_OVERVIEW_SYSTEM_PROMPT, MEETING_TRIAGE_SYSTEM_PROMPT, MEETING_QUESTIONS_SYSTEM_PROMPT, TRIAGE_SCHEMA, splitProjectQuestions, capQuestionBullets, sectionBody } = require("../src/writing/meeting.js");

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
        if (system === MEETING_OVERVIEW_SYSTEM_PROMPT) return "Everything is moving. Second sentence.";
        const m = /Project: (.+)/.exec(user)[1];
        if (failAll || failProject === m) throw new Error("rate limited");
        const ids = [...user.matchAll(/<evidence id="(E\d+)"/g)].map((x) => x[1]);
        const rows = [...user.matchAll(/<evidence id="(E\d+)" source="[^"]*">\n([^\n]*)/g)].map((x) => ({ id: x[1], head: x[2] }));
        let cite = rows.map((x) => x.id);
        if (Array.isArray(citedTitles)) cite = rows.filter((x) => citedTitles.some((t) => x.head.startsWith(t))).map((x) => x.id);
        return `### Theme\nStatus of ${m} is fine [${cite.join(", ")}]. Next steps.\n\n### Questions\n- Is it ok?`;
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

test('prompt: triage is selective and keeps its guardrails', () => {
  assert.ok(/short meeting prep, not a status report/i.test(MEETING_TRIAGE_SYSTEM_PROMPT));
  assert.ok(/needs to hear about a change, make a decision, or unblock something/i.test(MEETING_TRIAGE_SYSTEM_PROMPT));
  assert.ok(/leave out routine or recurring admin work, test projects/i.test(MEETING_TRIAGE_SYSTEM_PROMPT));
  assert.ok(/only due or overdue with nothing for the supervisor to decide/i.test(MEETING_TRIAGE_SYSTEM_PROMPT));
  assert.ok(/one row for every id/i.test(MEETING_TRIAGE_SYSTEM_PROMPT));
  assert.ok(/never invent an id/i.test(MEETING_TRIAGE_SYSTEM_PROMPT));
  assert.ok(/quiet, nothing is due/i.test(MEETING_TRIAGE_SYSTEM_PROMPT));
});

test('prompt: top questions are grouped, numbered, capped and one-line', () => {
  assert.ok(/at most 8 questions, most important first/i.test(MEETING_QUESTIONS_SYSTEM_PROMPT));
  assert.ok(/### <exact project name>/i.test(MEETING_QUESTIONS_SYSTEM_PROMPT));
  assert.ok(/numbered list/i.test(MEETING_QUESTIONS_SYSTEM_PROMPT));
  assert.ok(/don't repeat the project name inside a question/i.test(MEETING_QUESTIONS_SYSTEM_PROMPT));
  assert.ok(/number straight through the groups from 1/i.test(MEETING_QUESTIONS_SYSTEM_PROMPT));
  assert.ok(/keep each question to one line/i.test(MEETING_QUESTIONS_SYSTEM_PROMPT));
  assert.ok(/merge duplicates/i.test(MEETING_QUESTIONS_SYSTEM_PROMPT));
  assert.ok(/never invent/i.test(MEETING_QUESTIONS_SYSTEM_PROMPT));
  assert.ok(!/start each question with the project name/i.test(MEETING_QUESTIONS_SYSTEM_PROMPT));
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
  const projectCalls = p.calls.filter((c) => c.system !== MEETING_OVERVIEW_SYSTEM_PROMPT);
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
  p.openaiResponse = async (o) => { const t = await orig(o); return o.system === MEETING_OVERVIEW_SYSTEM_PROMPT ? t : `${t}\n- [ ] sneaky\n- [x] done`; };
  const r = await prepareMeeting(p, base());
  for (const line of r.markdown.split("\n")) assert.ok(!/^\s*[-*]\s+\[[ xX]\]/.test(line), line);
});

test("partial failure: failed project line + task list; all fail rejects", async () => {
  const r = await prepareMeeting(makePlugin({ failProject: "B" }), base());
  assert.deepStrictEqual(r.failedProjects, ["B"]);
  assert.ok(r.markdown.includes("## B\n\n_I couldn't write this section this time (rate limited). The related tasks are below._\n\n**Tasks**\n\n- [B one]"));
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
const projectUser = (p, name) => p.calls.find((c) => c.system !== MEETING_OVERVIEW_SYSTEM_PROMPT && new RegExp(`Project: ${name}$`, "m").test(c.user)).user;
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
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return "ov";
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
  p.openaiResponse = async (o) => o.system === MEETING_OVERVIEW_SYSTEM_PROMPT ? "ov" : "### T\n1. [ ] b\n+ [ ] d\n> - [ ] f\n- [/] g\n  * [x] h\n";
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
  p.openaiResponse = async (o) => { p.calls.push(o); return o.system === MEETING_OVERVIEW_SYSTEM_PROMPT ? `ov ${dirty}` : `### T\nmodel ${dirty} [E1].\n`; };
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
  assert.ok(r.markdown.includes("## B\n\n_I couldn't write this section this time (the model returned no text)."));
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
  assert.ok(!p.calls.some((c) => c.system === MEETING_OVERVIEW_SYSTEM_PROMPT));
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
  assert.ok(b.includes("_I couldn't write this section this time"));
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
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return "ov";
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
  const pu = p.calls.filter((c) => c.system !== MEETING_OVERVIEW_SYSTEM_PROMPT);
  assert.ok(pu.length > 0);
  for (const c of pu) {
    assert.ok(!c.user.includes("OVERVIEW-BODY") && !c.user.includes("## Overview"), c.user);
    for (const k of ["MEETING-BODY", "PROJECT-BODY", "RULES-BODY"]) assert.ok(c.user.includes(k), k);
  }
  const ov = p.calls.find((c) => c.system === MEETING_OVERVIEW_SYSTEM_PROMPT).user;
  assert.ok(!ov.includes("PROJECT-BODY") && !ov.includes("## For each project"), ov);
  for (const k of ["MEETING-BODY", "OVERVIEW-BODY", "RULES-BODY"]) assert.ok(ov.includes(k), k);
  const plain = "Just prep me well.\nNo headings here.";
  const q = makePlugin();
  await prepareMeeting(q, base({ instruction: plain }));
  for (const c of q.calls) assert.ok(c.user.includes("Instruction: " + plain), c.user);
  const r = makePlugin();
  await prepareMeeting(r, base({ instruction: "## overview \nO2\n## FOR EACH PROJECT\nP2" }));
  assert.ok(!r.calls.find((c) => c.system !== MEETING_OVERVIEW_SYSTEM_PROMPT).user.includes("O2"));
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
    const ov = p.calls.find((c) => c.system === MEETING_OVERVIEW_SYSTEM_PROMPT).user;
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
  assert.ok(r.markdown.includes("## B\n\n_I couldn't write this section this time (rate limited)."));
});

test("skip: every project skipped -> no overview call, one line, still a Sources block", async () => {
  const p = makePlugin();
  p.openaiResponse = async (o) => { p.calls.push(o); return "SKIP"; };
  const r = await prepareMeeting(p, base());
  assert.strictEqual(p.calls.filter((c) => c.system === MEETING_OVERVIEW_SYSTEM_PROMPT).length, 0);
  assert.strictEqual(r.markdown.trim(), "_Nothing here looks like it needs discussion this time._");
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
  p.openaiResponse = async (o) => o.system === MEETING_OVERVIEW_SYSTEM_PROMPT ? "ov" : (/Project: A$/m.test(o.user) ? reply : "### T\nplain B.\n");
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

// ---- Task 3: tone, recent context, enrichment, {maxTasks} ----
test("headTail: long note keeps tail, short note unchanged", async () => {
  const body = `${"H".repeat(4300)}\nAPPENDED UPDATE`;
  const p = notesPlugin(["Notes/long.md"]);
  p.readNoteText = async () => body;
  await prepareMeeting(p, base());
  const row = blocks(projectUser(p, "X")).find((b) => b.text.includes("APPENDED UPDATE"));
  assert.ok(row && row.text.includes("H".repeat(1500)) && row.text.length <= 4000, JSON.stringify(row && row.text.length));
});

test("headTail direct: unchanged under limit, head + ellipsis + tail over limit", () => {
  const { headTail } = require("../src/writing/meeting.js");
  assert.strictEqual(headTail("  short  "), "short");
  const out = headTail(`${"H".repeat(4300)}\nAPPENDED UPDATE`);
  assert.ok(out.startsWith("H".repeat(1500)));
  assert.ok(out.includes("\n…\n"));
  assert.ok(out.endsWith("APPENDED UPDATE"));
  assert.ok(out.length <= 4000, `length ${out.length}`);
});

test("recent linked notes first and query uses recent titles", async () => {
  const recs = [rec("px", "X", "newish title", { notePaths: ["Notes/old.md", "Notes/new.md"], updatedAt: "2026-10-28T10:00:00Z", activityAt: Date.parse("2026-10-28T10:00:00Z") })];
  const p = makePlugin({ records: recs });
  p.readNoteText = async (path) => `body ${path}`;
  p.app = { vault: { getAbstractFileByPath: (path) => ({ stat: { mtime: path.includes("new") ? Date.now() : 0 } }) } };
  await prepareMeeting(p, base());
  const user = projectUser(p, "X");
  assert.ok(user.indexOf("Notes/new.md") < user.indexOf("Notes/old.md"), user);
  assert.ok(p.vaultQueries.some((q) => /newish/.test(q)), p.vaultQueries);
});

test('linked notes: at most 20 stat lookups per project across enrichment and sorting', async () => {
  const paths = Array.from({ length: 60 }, (_, i) => `Notes/n${String(i).padStart(2, '0')}.md`);
  const p = makePlugin({ records: [rec('px', 'X', 'x', { notePaths: paths })] });
  let stats = 0;
  p.app = { vault: { getAbstractFileByPath: () => { stats += 1; return { stat: { mtime: 1000 } }; } } };
  p.readNoteText = async () => null; // no note evidence rows, so noteDateLine adds no lookups
  await prepareMeeting(p, base());
  assert.ok(stats > 0 && stats <= 20, `stat lookups ${stats}`);
});

test("activity order identical with triage off and single", async () => {
  const recs = [rec("quiet", "Quiet", "old", { activityAt: 0 }), rec("busy", "Busy", "new", { activityAt: Date.now() })];
  for (const template of [{}, { triage: "off" }]) {
    const r = await prepareMeeting(makePlugin({ records: recs }), base({ template }));
    assert.ok(r.markdown.indexOf("## Busy") < r.markdown.indexOf("## Quiet"), JSON.stringify(template));
  }
});

test("enrichGroupActivity: raises activity from note mtimes, missing stat ignored", () => {
  const { enrichGroupActivity } = require("../src/writing/meeting.js");
  const groups = [{ projectName: "X", activityAt: 100, records: [{ notePaths: ["Notes/a.md", "Notes/missing.md"] }] }];
  const plugin = { app: { vault: { getAbstractFileByPath: (p) => (p === "Notes/a.md" ? { stat: { mtime: 500 } } : null) } } };
  enrichGroupActivity(plugin, groups);
  const older = [{ projectName: "Y", activityAt: 1000, records: [{ notePaths: ["Notes/a.md"] }] }];
  enrichGroupActivity(plugin, older);
  assert.strictEqual(groups[0].activityAt, 500);
  assert.ok(groups[0].lastNoteEdit, "lastNoteEdit set from note mtime");
  assert.strictEqual(older[0].activityAt, 1000, "an older note does not lower activity");
  assert.ok(older[0].lastNoteEdit, "older note still recorded");
});

test("pickRecentTitles: recency then due urgency then priority", () => {
  const { pickRecentTitles } = require("../src/writing/meeting.js");
  const group = { records: [
    rec("px", "X", "old-overdue", { activityAt: 100, status: "overdue", priority: 1 }),
    rec("px", "X", "new-open", { activityAt: 300, status: "open", priority: 1 }),
    rec("px", "X", "mid-duesoon", { activityAt: 200, status: "due-soon", priority: 2 }),
    rec("px", "X", "same-low", { activityAt: 300, status: "open", priority: 1 }),
  ] };
  assert.deepStrictEqual(pickRecentTitles(group, 3), ["new-open", "same-low", "mid-duesoon"]);
});

test("recent vault chunks preferred within the 2x relevance set", async () => {
  const p = makePlugin({ records: [rec("px", "X", "x")] });
  const now = Date.now();
  p.retrieveSemanticContext = async () => [
    { path: "Notes/old.md", text: "OLD CHUNK", score: 0.9, modifiedAt: now - 10 * 86400000 },
    { path: "Notes/new.md", text: "NEW CHUNK", score: 0.8, modifiedAt: now },
  ];
  await prepareMeeting(p, base());
  const user = projectUser(p, "X");
  assert.ok(user.indexOf("NEW CHUNK") < user.indexOf("OLD CHUNK"), user);
});

test("tone and maxTasks placeholder", () => {
  assert.ok(/^You are a/.test(MEETING_PROJECT_SYSTEM_PROMPT) && /^You are a/.test(MEETING_OVERVIEW_SYSTEM_PROMPT));
  assert.ok(/Follow the user's instructions for structure, headings and length exactly/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
  assert.ok(/If you write a questions list, put it under a `### Questions` heading\./.test(MEETING_PROJECT_SYSTEM_PROMPT));
});

test("maxTasks substituted in instruction", async () => {
  const p = makePlugin();
  await prepareMeeting(p, base({ template: { maxTasks: 3 }, instruction: "List up to {maxTasks} items" }));
  assert.ok(p.calls.every((c) => c.user.includes("List up to 3 items") && !c.user.includes("{maxTasks}")), p.calls.map((c) => c.user).join("\n---\n"));
});

test("friendly overview failure line", async () => {
  const p = makePlugin();
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) throw new Error("rate limited");
    return "### T\nStatus is fine.";
  };
  const r = await prepareMeeting(p, base());
  assert.ok(r.markdown.includes("_I couldn't write the overview this time (rate limited)._"), r.markdown);
});

// ---- Task 4: AI triage, callback, cancellation, onPhase ----
test('triage: one call, digest fields, schema, selection', async () => {
  const p = makePlugin();
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_TRIAGE_SYSTEM_PROMPT) return JSON.stringify({ projects: [
      { id: 'pa', include: true, reason: 'Moved this week' },
      { id: 'pb', include: false, reason: 'Quiet for now' },
      { id: 'pc', include: false, reason: 'Nothing new' },
    ] });
    if (/Project: A/.test(o.user)) return '### Questions\n- Ready? [E1]\n';
    return '### Questions\n- Why now? [E1]\n';
  };
  let seen;
  const r = await prepareMeeting(p, base({ template: { triage: 'ai' }, onTriage: async (x) => { seen = x; return { selected: x.recommended }; } }));
  const triageCall = p.calls.find((c) => c.system === MEETING_TRIAGE_SYSTEM_PROMPT);
  assert.ok(triageCall && triageCall.jsonSchema, 'triage call carries a json schema');
  assert.ok(TRIAGE_SCHEMA && TRIAGE_SCHEMA.properties.projects, 'TRIAGE_SCHEMA exported');
  assert.strictEqual(triageCall.operation, 'write');
  assert.strictEqual(triageCall.model, 'm');
  assert.strictEqual(triageCall.background, false);
  for (const field of ['projectId', 'activityAt', 'overdue', 'dueSoon', 'completedInWindow', 'activityLabel'])
    assert.ok(triageCall.user.includes(field), field);
  assert.deepStrictEqual(seen.rows.map((row) => row.projectId), ['pa', 'pb', 'pc']);
  assert.deepStrictEqual(seen.recommended, ['pa']);
  assert.strictEqual(seen.windowDays, 14);
  assert.strictEqual(seen.triageSource, 'ai');
  assert.deepStrictEqual(r.triage, { selected: ['pa'], total: 3, source: 'ai' });
  assert.ok(!r.markdown.includes('## B') && !r.markdown.includes('## C'));
});

test('triage parse failures check everything, off/single make no call', async () => {
  for (const reply of ['not json', '{"projects":[{"id":"unknown","include":false,"reason":"x"}]}']) {
    const p = makePlugin();
    const orig = p.openaiResponse;
    p.openaiResponse = async (o) => o.system === MEETING_TRIAGE_SYSTEM_PROMPT ? reply : orig(o);
    let rows;
    await prepareMeeting(p, base({ template: { triage: 'ai' }, onTriage: async (x) => { rows = x; return { selected: x.rows.map((r) => r.projectId) }; } }));
    assert.ok(rows.rows.every((r) => r.include) && rows.triageSource === 'unavailable');
  }
  // Plan intent: no triage call when triage is off or only one project is in scope.
  for (const [recs, template] of [[threeProjects(), { triage: 'off' }], [[rec('solo', 'Solo', 'x')], { triage: 'ai' }]]) {
    const p = makePlugin({ records: recs });
    await prepareMeeting(p, base({ template, onTriage: async () => { throw new Error('no modal expected'); } }));
    assert.ok(!p.calls.some((c) => c.system === MEETING_TRIAGE_SYSTEM_PROMPT));
  }
});

test('triage: zero selected cancels without work; excluded projects read nothing', async () => {
  const p = makePlugin();
  const r = await prepareMeeting(p, base({ template: { triage: 'ai' }, onTriage: async () => ({ selected: [] }) }));
  assert.deepStrictEqual(r, { cancelled: true });
  assert.deepStrictEqual(p.noteReads, []);
  assert.ok(!p.vaultQueries);
  assert.strictEqual(p.calls.filter((c) => c.system !== MEETING_TRIAGE_SYSTEM_PROMPT).length, 0);
});

test('triage: onPhase receives triaging/gathering/writing and never fails the run', async () => {
  const phases = [];
  const p = makePlugin();
  p.openaiResponse = async (o) => o.system === MEETING_TRIAGE_SYSTEM_PROMPT ? JSON.stringify({ projects: [] }) : 'body';
  await prepareMeeting(p, base({ template: { triage: 'ai' }, onTriage: async (x) => ({ selected: x.rows.map((r) => r.projectId) }), onPhase: (x) => phases.push(x) }));
  assert.deepStrictEqual(phases, ['triaging', 'gathering', 'writing']);
  const q = makePlugin();
  q.openaiResponse = async (o) => o.system === MEETING_TRIAGE_SYSTEM_PROMPT ? JSON.stringify({ projects: [] }) : 'body';
  await prepareMeeting(q, base({ template: { triage: 'ai' }, onTriage: async (x) => ({ selected: x.rows.map((r) => r.projectId) }), onPhase: () => { throw new Error('ui gone'); } }));
});

test('note mtime order identical across paths', async () => {
  const recs = [rec('quiet', 'Quiet', 'old', { activityAt: 0, notePaths: [] }), rec('busy', 'Busy', 'new', { activityAt: Date.now(), notePaths: [] })];
  for (const template of [{}, { triage: 'off' }, { triage: 'ai' }]) {
    const p = makePlugin({ records: recs });
    p.openaiResponse = async (o) => o.system === MEETING_TRIAGE_SYSTEM_PROMPT ? JSON.stringify({ projects: [] }) : 'body';
    const r = await prepareMeeting(p, base({ template, onTriage: async (x) => ({ selected: x.rows.map((row) => row.projectId) }) }));
    assert.ok(r.markdown.indexOf('## Busy') < r.markdown.indexOf('## Quiet'), JSON.stringify(template));
  }
});

test('triage: batch limit checks the rest; fences and bare array parse; absent onTriage uses picks', async () => {
  const recs = Array.from({ length: 41 }, (_, i) => rec(`p${i}`, `P${String(i).padStart(2, '0')}`, `task ${i}`, { activityAt: 1000 - i }));
  const p = makePlugin({ records: recs });
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_TRIAGE_SYSTEM_PROMPT) return '```json\n[{"id":"p0","include":true,"reason":"Moved this week"}]\n```';
    return 'body';
  };
  const r = await prepareMeeting(p, base({ template: { triage: 'ai' } }));
  const digest = JSON.parse(p.calls.find((c) => c.system === MEETING_TRIAGE_SYSTEM_PROMPT).user);
  assert.strictEqual(digest.length, 40, 'at most 40 rows to the model');
  assert.strictEqual(r.triage.source, 'ai');
  assert.strictEqual(r.triage.total, 41);
  assert.deepStrictEqual(r.triage.selected, recs.map((x) => x.projectId), 'projects omitted by the model stay checked');
  assert.ok(r.markdown.includes('## P00') && r.markdown.includes('## P40'));
  assert.ok(r.markdown.includes('## P01'), 'omitted project is not silently dropped');
});

test('triage: reasons and digest names are scrubbed before truncation', async () => {
  const recs = [rec('pa', 'Dirty #STsync %%[oid:: x]%%', 'task A'), rec('pb', 'B', 'task B')];
  const p = makePlugin({ records: recs });
  p.settings = { syncTag: '#STsync' };
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_TRIAGE_SYSTEM_PROMPT) return JSON.stringify({ projects: [{ id: 'pa', include: true, reason: 'todoist-id:abc #STsync %%oid::x%% looks active and ' + 'x'.repeat(200) }] });
    return 'body';
  };
  let rows;
  await prepareMeeting(p, base({ template: { triage: 'ai' }, onTriage: (x) => { rows = x; return { selected: x.rows.map((r) => r.projectId) }; } }));
  const digest = JSON.parse(p.calls.find((c) => c.system === MEETING_TRIAGE_SYSTEM_PROMPT).user);
  const bad = /#STsync|todoist-id:|%%\[?oid/i;
  const dirty = rows.rows.find((r) => r.projectId === 'pa');
  assert.ok(!bad.test(JSON.stringify(digest)), JSON.stringify(digest));
  assert.ok(!bad.test(dirty.reason), dirty.reason);
  assert.ok(dirty.reason.length <= 120, String(dirty.reason.length));
  assert.ok(dirty.reason.startsWith('looks active'), dirty.reason);
});

// ---- Task 5: ### Questions extraction, placement and fallback ----
test('splitProjectQuestions: exact ### heading, bullets normalised, citations kept', () => {
  assert.deepStrictEqual(
    splitProjectQuestions('Status fine [E1].\n\n### Questions\n* Is it ok? [E2]\n\n## Next\nTail'),
    { body: 'Status fine [E1].\n\n## Next\nTail', questions: ['- Is it ok? [E2]'] },
  );
  assert.deepStrictEqual(splitProjectQuestions('no questions here'), { body: 'no questions here', questions: [] });
  assert.deepStrictEqual(splitProjectQuestions('A [E1].\n\n### questions\n1. Keep this? [E2]\n+ Why now?\n'),
    { body: 'A [E1].', questions: ['- Keep this? [E2]', '- Why now?'] });
  // Wrong level or a longer title is not the questions block.
  assert.deepStrictEqual(splitProjectQuestions('## Questions\n- top\n'), { body: '## Questions\n- top', questions: [] });
  assert.deepStrictEqual(splitProjectQuestions('### Questions to ask\n- nope\n'), { body: '### Questions to ask\n- nope', questions: [] });
  assert.deepStrictEqual(splitProjectQuestions('Body.\n\n### Questions\n\n## End\nAfter'), { body: 'Body.\n\n## End\nAfter', questions: [] });
});

test('splitProjectQuestions: wrapped continuation joins the preceding item', () => {
  assert.deepStrictEqual(splitProjectQuestions('### Questions\n- Can we approve the budget for\nthe Q4 project? [E1]\n\n## Next\nTail'),
    { body: '## Next\nTail', questions: ['- Can we approve the budget for the Q4 project? [E1]'] });
  assert.deepStrictEqual(splitProjectQuestions('### Questions\nPlain prose question\ncontinuation [E1]\n\n## Next\nTail'),
    { body: '## Next\nTail', questions: ['- Plain prose question continuation [E1]'] });
});

test('splitProjectQuestions: blank line ends an item; prose after a blank becomes its own item', () => {
  assert.deepStrictEqual(splitProjectQuestions('### Questions\n- Approve budget?\n\nAlso worth asking about timing.').questions,
    ['- Approve budget?', '- Also worth asking about timing.']);
  // No blank line between them still wraps the preceding item.
  assert.deepStrictEqual(splitProjectQuestions('### Questions\n- Approve budget?\nfor the Q4 project?').questions,
    ['- Approve budget? for the Q4 project?']);
});

test('splitProjectQuestions: numbered, star bullets and CRLF blocks', () => {
  assert.deepStrictEqual(splitProjectQuestions('### Questions\n1) First? [E1]\ncontinued\n2. Second? [E2]').questions,
    ['- First? [E1] continued', '- Second? [E2]']);
  assert.deepStrictEqual(splitProjectQuestions('### Questions\n* First? [E1]\ncontinued\n* Second?').questions,
    ['- First? [E1] continued', '- Second?']);
  assert.deepStrictEqual(splitProjectQuestions('Body.\r\n\r\n### Questions\r\n- Approve? [E1]\r\nor defer?\r\n\r\n## Next\r\nTail'),
    { body: 'Body.\n\n## Next\nTail', questions: ['- Approve? [E1] or defer?'] });
});

test('splitProjectQuestions: nested bullets stay separate; unknown headings stay in body', () => {
  assert.deepStrictEqual(splitProjectQuestions('### Questions\n- Parent?\n  - Child? [E1]\n').questions,
    ['- Parent?', '- Child? [E1]']);
  for (const heading of ['**Questions**', '#### Questions', '### Questions to raise']) {
    const src = `Body.\n\n${heading}\n- Keep me?\n`;
    assert.deepStrictEqual(splitProjectQuestions(src), { body: `Body.\n\n${heading}\n- Keep me?`, questions: [] }, heading);
  }
});

test('splitProjectQuestions: placeholder blocks yield no questions and no heading', () => {
  assert.deepStrictEqual(splitProjectQuestions('### Questions\n- None.'), { body: '', questions: [] });
  assert.deepStrictEqual(splitProjectQuestions('Body.\n\n### Questions\nNone\n\n## Next\nTail'), { body: 'Body.\n\n## Next\nTail', questions: [] });
  assert.deepStrictEqual(splitProjectQuestions('### Questions\n- no questions.'), { body: '', questions: [] });
  assert.deepStrictEqual(splitProjectQuestions('### Questions\n- None.\n- Approve budget?'), { body: '', questions: ['- Approve budget?'] });
  assert.deepStrictEqual(splitProjectQuestions('### Questions\n- None.\n- None\n- Real? [E1]'), { body: '', questions: ['- Real? [E1]'] });
  // A real question that merely starts with "None" is not a placeholder.
  assert.deepStrictEqual(splitProjectQuestions('### Questions\n- None of these work?').questions, ['- None of these work?']);
});

test('sectionBody: template Questions instruction, generic default when absent', () => {
  const tpl = '## Meeting\nPrep.\n\n## Questions\nPick TOP only.\n\n## Rules\nKeep it short.';
  assert.strictEqual(sectionBody(tpl, 'Questions'), 'Pick TOP only.');
  assert.ok(/decision|approval|input/i.test(sectionBody('plain instruction', 'Questions')), 'default instruction');
});

test('questions: project keeps block, top hoists and calls once, both keeps and hoists', async () => {
  for (const q of ['project', 'top', 'both']) {
    const p = makePlugin();
    p.openaiResponse = async (o) => {
      p.calls.push(o);
      if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) return '## Questions\n- Most important? [E1]';
      if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'Overview sentence.';
      if (/Project: A/.test(o.user)) return '### Questions\n- Is it ok? [E1]\n';
      return '### Questions\n- Why now? [E1]\n';
    };
    const r = await prepareMeeting(p, base({ template: { questions: q } }));
    const hasTop = r.markdown.startsWith('## Questions');
    const a = r.markdown.slice(r.markdown.indexOf('## A'), r.markdown.indexOf('## B'));
    assert.strictEqual(hasTop, q === 'top' || q === 'both', q);
    assert.strictEqual(a.includes('### Questions'), q === 'project' || q === 'both', q);
    const beforeA = r.markdown.slice(0, r.markdown.indexOf('## A'));
    assert.strictEqual((beforeA.match(/^## Questions$/gm) || []).length, hasTop ? 1 : 0, 'no duplicate heading ' + q);
    assert.strictEqual(p.calls.filter((c) => c.system === MEETING_QUESTIONS_SYSTEM_PROMPT).length, hasTop ? 1 : 0, 'one top call ' + q);
    assert.ok(!r.markdown.includes('Most important?') || hasTop);
  }
});

test('questions: top fallback keeps every question in grouped numbered format; no questions means no empty top section', async () => {
  const p = makePlugin();
  const orig = p.openaiResponse;
  p.openaiResponse = async (o) => {
    if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) throw new Error('rate limited');
    return orig(o);
  };
  const r = await prepareMeeting(p, base({ template: { questions: 'top' } }));
  const top = slice(r, 'Questions', 'Overview');
  assert.ok(top.startsWith('## Questions'), r.markdown.slice(0, 160));
  assert.strictEqual((r.markdown.match(/Is it ok\?/g) || []).length, 3, 'every question kept by fallback');
  assert.ok(top.includes("couldn't prioritise"), top);
  assert.ok(top.includes('### A') && top.includes('### B') && top.includes('### C'), top);
  assert.deepStrictEqual(top.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.slice(0, 3)), ['1. ', '2. ', '3. '], top);
  const none = makePlugin({ records: [rec('solo', 'Solo', 'x')] });
  none.openaiResponse = async () => 'plain body, no questions';
  const rn = await prepareMeeting(none, base({ template: { questions: 'both' } }));
  assert.ok(!rn.markdown.includes('## Questions'), 'no empty top section');
  assert.ok(!rn.markdown.includes('### Questions'), 'no empty project question block');
});

test('questions: fallback caps 8 across projects with continuous numbering', async () => {
  const recs = [rec('pa', 'A', 'a'), rec('pb', 'B', 'b')];
  const p = makePlugin({ records: recs });
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) throw new Error('rate limited');
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
    const m = /Project: (.+)/.exec(o.user)[1];
    const qs = Array.from({ length: 6 }, (_, i) => `- ${m} Q${i}? [E1]`).join('\n');
    return `### Status\nok [E1].\n\n### Questions\n${qs}`;
  };
  const r = await prepareMeeting(p, base({ template: { questions: 'top', maxQuestions: 10 } }));
  const top = slice(r, 'Questions', 'Overview');
  const nums = top.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.match(/^(\d+)/)[1]));
  assert.deepStrictEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8], top);
  assert.ok(top.includes('A Q5?') && top.includes('B Q1?') && !top.includes('B Q2?'), top);
});

test('questions: citations survive hoisting and are numbered once', async () => {
  const task = rec('pa', 'A', 'A alpha');
  const p = makePlugin({ records: [task] });
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) return '## Questions\n- Decide this? [E1]\n';
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
    return '### Status\nA fact [E1].\n\n### Questions\n- Decide this? [E1]\n';
  };
  const r = await prepareMeeting(p, base({ template: { questions: 'top' } }));
  const top = slice(r, 'Questions', 'Overview');
  assert.ok(top.includes('1. Decide this?'), top);
  assert.ok(!/\[E\d+\]/.test(top), top);
  assert.ok(taskLink(task.url).test(top), top);
  assert.ok(!slice(r, 'A').includes('### Questions'));
});

test('questions: ## Questions instruction is excluded from project calls and feeds the top call', async () => {
  const instruction = '## Meeting\nPrep.\n\n## Questions\nTOP-ONLY pick one.\n\n## For each project\nPROJECT-ONLY body.\n';
  const p = makePlugin();
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) return '- Pick this?';
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
    return '### Status\nok [E1].\n\n### questions\n- Is it ok? [E1]';
  };
  await prepareMeeting(p, base({ template: { questions: 'both' }, instruction }));
  const proj = p.calls.find((c) => /Project: A/.test(c.user)).user;
  assert.ok(!proj.includes('TOP-ONLY') && !proj.includes('## Questions'), proj);
  assert.ok(proj.includes('PROJECT-ONLY'), proj);
  const top = p.calls.find((c) => c.system === MEETING_QUESTIONS_SYSTEM_PROMPT).user;
  assert.ok(top.includes('TOP-ONLY'), top);
  assert.ok(!top.includes('PROJECT-ONLY'), top);
});

test('questions: custom template heading is reused for the top section', async () => {
  const p = makePlugin();
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) return '- Pick this?';
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
    return '### Status\nok [E1].\n\n### Questions\n- Is it ok? [E1]';
  };
  const r = await prepareMeeting(p, base({ template: { questions: 'top' }, instruction: '## Meeting\nPrep.\n\n## Questions for my supervisor\nPick the best one.' }));
  assert.ok(r.markdown.startsWith('## Questions for my supervisor'), r.markdown.slice(0, 120));
});

test('capQuestionBullets: keeps whole bullet blocks with wrapped lines, drops extras', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `- P${i}: Question ${i}?`).join('\n');
  const capped = capQuestionBullets(twelve);
  assert.strictEqual(capped.split('\n').length, 8, capped);
  assert.ok(capped.includes('P0: Question 0?') && !capped.includes('P8:'), capped);
  const wrapped = '- P0: First question\nwrapped detail [E1]\n- P1: Second\n- P2: Third';
  assert.strictEqual(capQuestionBullets(wrapped, 2), '- P0: First question\nwrapped detail [E1]\n- P1: Second');
});

test('questions: grouped model output is numbered continuously, mapped to known names, capped at 8', async () => {
  const p = makePlugin();
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) return [
      '## Questions',
      '### a',
      '1. Q0? [E1]',
      '2. Q1? [E1]',
      '### B',
      '- Q2? [E1]',
      '### Zed',
      '- Q3? [E1]', '- Q4? [E1]', '- Q5? [E1]', '- Q6? [E1]',
      '- Q7? [E1]', '- Q8? [E1]', '- Q9? [E1]',
      '### Late',
      '- Q10? [E1]',
    ].join('\n');
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
    return '### Status\nok [E1].\n\n### Questions\n- Is it ok? [E1]';
  };
  const r = await prepareMeeting(p, base({ template: { questions: 'top' } }));
  const top = slice(r, 'Questions', 'Overview');
  assert.ok(top.startsWith('## Questions\n'), top);
  assert.ok(top.includes('### A\n'), top); // lower-case heading mapped to the real name
  assert.ok(top.includes('### B\n'), top);
  assert.ok(top.includes('### Zed\n'), top); // unknown heading kept as written
  const nums = top.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.match(/^(\d+)/)[1]));
  assert.deepStrictEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8], top);
  assert.ok(top.includes('Q7?') && !top.includes('Q8?') && !top.includes('Q9?'), top);
  assert.ok(!top.includes('### Late') && !top.includes('Q10?'), 'groups emptied by the cap are removed');
  assert.ok(!/\d+\.\s*A:/.test(top), 'no project prefix inside a question');
  const topCall = p.calls.find((c) => c.system === MEETING_QUESTIONS_SYSTEM_PROMPT).user;
  assert.ok(/at most 8/i.test(topCall) && /one line/i.test(topCall) && /### <exact project name>/i.test(topCall), topCall);
  assert.ok(!/^\s*(?:none|no questions)\.?\s*$/im.test(top), 'no empty/None section');
});

test('questions: output without ### groups renders one continuous numbered list', async () => {
  const p = makePlugin();
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) return '## Questions\n- First? [E1]\n2. Second? [E1]\n+ Third? [E1]';
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
    return '### Status\nok [E1].\n\n### Questions\n- Is it ok? [E1]';
  };
  const r = await prepareMeeting(p, base({ template: { questions: 'top' } }));
  const top = slice(r, 'Questions', 'Overview');
  assert.ok(!/^### /m.test(top), top);
  assert.deepStrictEqual(top.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.slice(0, 3)), ['1. ', '2. ', '3. '], top);
  assert.ok(top.includes('First?') && top.includes('Second?') && top.includes('Third?'), top);
});

test('questions: top-call input groups each project’s questions under its real name', async () => {
  const p = makePlugin();
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) return '### A\n- Pick this? [E1]';
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
    const project = /Project: (.+)/.exec(o.user)[1];
    return `### Status\nok [E1].\n\n### Questions\n- ${project} question? [E1]`;
  };
  await prepareMeeting(p, base({ template: { questions: 'both' } }));
  const top = p.calls.find((c) => c.system === MEETING_QUESTIONS_SYSTEM_PROMPT).user;
  assert.ok(top.includes('### A') && top.includes('### B') && top.includes('### C'), top);
  assert.ok(top.includes('A question?') && top.includes('B question?'), top);
  assert.ok(/at most 8/i.test(top) && /one line/i.test(top), top);
});

test('questions: project-body blocks are numbered per project from normalized bullets', async () => {
  const p = makePlugin();
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
    const m = /Project: (.+)/.exec(o.user)[1];
    const qs = m === 'A' ? '1) Keep? [E1]\n* Also? [E1]' : (m === 'B' ? '- Why now? [E1]' : '- None.');
    return `### Status\nok [E1].\n\n### Questions\n${qs}`;
  };
  const r = await prepareMeeting(p, base({ template: { questions: 'project' } }));
  const a = slice(r, 'A', 'B');
  const b = slice(r, 'B', 'C');
  assert.ok(/### Questions\n1\. Keep\?/.test(a), a);
  assert.ok(/2\. Also\?/.test(a), a);
  assert.ok(!/^1\) Keep\?|^[*] Also\?/m.test(a), a);
  assert.ok(/### Questions\n1\. Why now\?/.test(b), b);
  assert.ok(!slice(r, 'C').includes('### Questions'), 'placeholder block removed');
  assert.ok(!/^## Questions\s*$/m.test(r.markdown), 'no top call in project mode');
});

test('questions: placeholder blocks make no top call and no heading', async () => {
  const p = makePlugin();
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) return '## Questions\n- Should not be asked?';
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
    return '### Status\nok [E1].\n\n### Questions\n- None.';
  };
  const r = await prepareMeeting(p, base({ template: { questions: 'both' } }));
  assert.strictEqual(p.calls.filter((c) => c.system === MEETING_QUESTIONS_SYSTEM_PROMPT).length, 0);
  assert.ok(!/^## Questions\s*$/m.test(r.markdown), r.markdown);
  assert.ok(!r.markdown.startsWith('## Questions'), r.markdown.slice(0, 120));
});

test('questions: both drops placeholder-only project blocks but keeps real ones', async () => {
  const setup = (answers = {}) => {
    const p = makePlugin();
    p.openaiResponse = async (o) => {
      p.calls.push(o);
      if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) return '## Questions\n- Top? [E1]';
      if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
      const project = /Project: (.+)/.exec(o.user)[1];
      return `### Status\nok [E1].\n\n### Questions\n- ${answers[project] || 'None.'}`;
    };
    return p;
  };

  const none = await prepareMeeting(setup(), base({ template: { questions: 'both' } }));
  assert.ok(!none.markdown.includes('### Questions'), none.markdown);
  assert.ok(!/\b(?:None\.|No questions\.)/.test(none.markdown), none.markdown);
  assert.ok(!none.markdown.startsWith('## Questions'), none.markdown.slice(0, 160));

  const real = await prepareMeeting(setup({ B: 'Why now? [E1]' }), base({ template: { questions: 'both' } }));
  assert.ok(real.markdown.startsWith('## Questions'), real.markdown.slice(0, 160));
  const a = slice(real, 'A', 'B');
  const b = slice(real, 'B', 'C');
  assert.ok(!a.includes('### Questions') && !a.includes('None.'), a);
  assert.ok(b.includes('### Questions') && b.includes('Why now?'), b);
});

test('maxQuestions: placeholder uses normalized value (default/0 -> 2, 99 -> 10, 1 -> 1, string/fraction)', async () => {
  for (const [value, expected] of [[undefined, 2], [0, 2], [99, 10], [1, 1], ["4", 4], [2.7, 3]]) {
    const p = makePlugin({ records: [rec('solo', 'Solo', 'x')] });
    const tpl = value === undefined ? {} : { maxQuestions: value };
    await prepareMeeting(p, base({ template: tpl, instruction: 'At most {maxQuestions} questions.' }));
    assert.ok(p.calls.length >= 2, 'model calls made');
    assert.ok(p.calls.every((c) => c.user.includes(`At most ${expected} questions.`) && !c.user.includes('{maxQuestions}')),
      `${JSON.stringify(value)} -> ${expected}: ` + p.calls.map((c) => c.user).join('\n---\n'));
  }
});

test('questions: 6 project questions capped to 2 in body and in top-call input', async () => {
  const six = Array.from({ length: 6 }, (_, i) => `- Project A: Question ${i}? [E1]`).join('\n');
  const p = makePlugin({ records: [rec('pa', 'A', 'A one')] });
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_QUESTIONS_SYSTEM_PROMPT) return '## Questions\n- Top pick? [E1]';
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
    return `### Status\nok [E1].\n\n### Questions\n${six}\n`;
  };
  const r = await prepareMeeting(p, base({ template: { questions: 'both' } }));
  const rows = (t) => t.split('\n').filter((l) => /Question \d/.test(l));
  const proj = slice(r, 'A');
  assert.strictEqual(rows(proj).length, 2, proj);
  assert.ok(!proj.includes('Question 2?'), proj);
  const topCall = p.calls.find((c) => c.system === MEETING_QUESTIONS_SYSTEM_PROMPT).user;
  assert.strictEqual(rows(topCall).length, 2, topCall);
  assert.ok(topCall.includes('Question 1?') && !topCall.includes('Question 2?'), topCall);
});

test('questions: custom maxQuestions 4 caps body; a wrapped question counts once', async () => {
  const six = [
    '- Project A: First question for',
    'wrapped detail [E1]',
    '- Project A: Question 1? [E1]',
    '- Project A: Question 2? [E1]',
    '- Project A: Question 3? [E1]',
    '- Project A: Question 4? [E1]',
    '- Project A: Question 5? [E1]',
  ].join('\n');
  const p = makePlugin({ records: [rec('pa', 'A', 'A one')] });
  p.openaiResponse = async (o) => {
    p.calls.push(o);
    if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
    return `### Status\nok [E1].\n\n### Questions\n${six}\n`;
  };
  const r = await prepareMeeting(p, base({ template: { questions: 'project', maxQuestions: 4 } }));
  const proj = slice(r, 'A');
  const q = proj.slice(proj.indexOf('### Questions'));
  assert.strictEqual(q.split('\n').filter((l) => /^\d+\.\s/.test(l)).length, 4, q);
  assert.ok(q.includes('First question for wrapped detail'), q);
  assert.ok(!q.includes('Question 4?'), q);
});

test('questions: cap clamps maxQuestions (99 -> 10, 1 -> 1)', async () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `- Project A: Question ${i}? [E1]`).join('\n');
  for (const [value, expected] of [[99, 10], [1, 1]]) {
    const p = makePlugin({ records: [rec('pa', 'A', 'A one')] });
    p.openaiResponse = async (o) => {
      p.calls.push(o);
      if (o.system === MEETING_OVERVIEW_SYSTEM_PROMPT) return 'ov';
      return `### Status\nok [E1].\n\n### Questions\n${twelve}\n`;
    };
    const r = await prepareMeeting(p, base({ template: { questions: 'project', maxQuestions: value } }));
    const proj = slice(r, 'A');
    assert.strictEqual(proj.split('\n').filter((l) => /Question \d/.test(l)).length, expected, `${value}: ${proj}`);
  }
});

test('privacy: sync markers in projectName are scrubbed from heading and model Project line', async () => {
  const dirty = 'Alpha #STsync %%[oid:: x]%% todoist-id:7';
  const p = makePlugin({ records: [rec('pa', dirty, 'task A')] });
  p.settings = { syncTag: '#STsync' };
  p.openaiResponse = async (o) => { p.calls.push(o); return o.system === MEETING_OVERVIEW_SYSTEM_PROMPT ? 'ov' : '### T\nfact [E1].\n'; };
  const r = await prepareMeeting(p, base());
  const bad = /#STsync|%%\[?oid|todoist-id:/i;
  const projectCalls = p.calls.filter((c) => c.system !== MEETING_OVERVIEW_SYSTEM_PROMPT).map((c) => c.user).join('\n');
  assert.ok(/^Project: Alpha\s*$/m.test(projectCalls), projectCalls);
  assert.ok(!bad.test(projectCalls), projectCalls);
  const heading = r.markdown.split('\n').find((l) => /^## Alpha/.test(l));
  assert.ok(/^## Alpha\s*$/.test(heading || ''), JSON.stringify(heading));
  assert.ok(!bad.test(r.markdown), r.markdown);
});

test('tone: out-of-batch triage rows use a friendly reason', async () => {
  const recs = Array.from({ length: 41 }, (_, i) => rec(`p${i}`, `P${i}`, `task ${i}`, { activityAt: 1000 - i }));
  const p = makePlugin({ records: recs });
  p.openaiResponse = async (o) => {
    if (o.system === MEETING_TRIAGE_SYSTEM_PROMPT) return JSON.stringify([{ id: 'p0', include: true, reason: 'Moved this week' }]);
    return 'body';
  };
  let rows;
  await prepareMeeting(p, base({ template: { triage: 'ai' }, onTriage: (x) => { rows = x; return { selected: x.rows.map((r) => r.projectId) }; } }));
  const out = rows.rows.find((r) => r.projectId === 'p40');
  assert.strictEqual(out.reason, 'I left this one in — there were too many projects to sort them all.');
  assert.ok(!/Not triaged|batch limit/i.test(out.reason), out.reason);
});

test('prompt: task-list guidance reflects template control instead of a separate task list', () => {
  assert.ok(/the template decides how next actions appear/i.test(MEETING_PROJECT_SYSTEM_PROMPT), MEETING_PROJECT_SYSTEM_PROMPT);
  assert.ok(!/task list is added separately/i.test(MEETING_PROJECT_SYSTEM_PROMPT), MEETING_PROJECT_SYSTEM_PROMPT);
  assert.ok(/not write a task list/i.test(MEETING_PROJECT_SYSTEM_PROMPT));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`PASS ${name}`); } catch (err) { failed += 1; console.log(`FAIL ${name}\n${err && err.stack}`); }
  }
  console.log(`passed: ${cases.length - failed}/${cases.length}`);
  process.exit(failed ? 1 : 0);
})();
