/* Live check (plan Task 9), run by hand in the dev vault. Too long to pass inline to `obsidian eval` (crashes its CLI pipe); pass a one-line loader: (async () => await eval(require('fs').readFileSync('<abs path to this file>', 'utf8')))() */
(async () => {
const out = { steps: {}, ok: false };
let pending = false;
const LABEL = 'sts-check';
const NEW_TASK = 'STS check: temp task ' + Date.now().toString(36);
const p = globalThis.__stsStub || app.plugins.plugins['semantic-todoist-sync'];
const fail = (msg) => { throw new Error(msg); };
const guard = (rows, ctx) => {
  if (!Array.isArray(rows) || !rows.length) fail('guard: no rows');
  rows.forEach((r, i) => {
    const tg = r.target || {};
    const where = 'guard: row-' + i + ' (' + r.op + ') ';
    if (r.op === 'delete' || r.op === 'merge') fail(where + 'delete/merge is never allowed');
    if (r.op === 'create') { if (tg.projectId !== ctx.stsId) fail(where + 'create outside STS Test'); }
    else if (!ctx.taskIds.has(String(r.taskId))) fail(where + 'task outside STS Test');
    if (tg.projectId && tg.projectId !== ctx.stsId) fail(where + 'target project outside STS Test');
    if (tg.parentId && !ctx.taskIds.has(String(tg.parentId))) fail(where + 'parent outside STS Test');
    if (tg.sectionId && !ctx.sectionIds.has(String(tg.sectionId))) fail(where + 'section outside STS Test');
    const f = r.fields || {};
    if (f.targetTaskId && !ctx.taskIds.has(String(f.targetTaskId))) fail(where + 'merge target outside STS Test');
    if (f.projectId && f.projectId !== ctx.stsId) fail(where + 'project field outside STS Test');
  });
};
const stable = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
const view = async () => {
  const snap = await p.getTodoistSnapshot(['items', 'projects', 'sections'], true);
  const hits = snap.projects.filter((x) => x.name === 'STS Test');
  if (hits.length !== 1) fail('expected exactly one project named STS Test, found ' + hits.length);
  const stsId = hits[0].id;
  const sts = snap.tasks.filter((t) => t.projectId === stsId).map((t) => ({ id: String(t.id), content: t.content, due: t.dueDate || null, priority: t.priority, labels: (t.labels || []).slice().sort(), parentId: t.parentId || null, sectionId: t.sectionId || null })).sort((a, b) => a.id.localeCompare(b.id));
  const otherTasks = snap.tasks.filter((t) => t.projectId !== stsId).map((t) => 't|' + stable(t)).sort();
  const otherStructure = snap.projects.filter((x) => x.id !== stsId).map((x) => 'p|' + [x.id, x.name, x.parentId || ''].join('|')).concat((snap.sections || []).filter((x) => x.projectId !== stsId).map((x) => 's|' + [x.id, x.name, x.projectId].join('|'))).sort();
  const others = otherTasks.concat(otherStructure);
  const sections = (snap.sections || []).filter((s) => s.projectId === stsId).map((s) => String(s.id));
  return { stsId, sts, others, sections };
};
const ctxOf = (v) => ({ stsId: v.stsId, taskIds: new Set(v.sts.map((t) => t.id)), sectionIds: new Set(v.sections) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const step = async (name, fn) => { try { out.steps[name] = { status: 'OK', detail: await fn() }; } catch (e) { out.steps[name] = { status: 'FAIL', error: String(e && e.message || e) }; throw e; } };
const ask = async (prompt, v) => {
  p.lastTodoistAnswerTaskIds = [];
  const r = await p.chat(prompt, null, [], 'chat-query', { todoist: true });
  return r;
};
const apply = async (tc, v) => {
  guard(tc.rows, ctxOf(v));
  pending = true;
  const res = await p.applyTodoistChanges(tc, tc.rows.map((r, i) => 'row-' + i));
  pending = !!res.undoable;
  if (res.failedAt != null || (res.noteWriteFailed || []).length) fail('apply failed: ' + JSON.stringify({ failedAt: res.failedAt, noteWriteFailed: res.noteWriteFailed }));
  if (!res.undoable) fail('apply not undoable');
  return res;
};
const undo = async () => { const r = await p.undoLastTodoistChanges(false); if (!r || typeof r !== 'object' || ((r.error || r.message) && !r.restored)) fail('undo failed: ' + JSON.stringify(r)); pending = false; return r; };
try {
  const before = await view();
  const ctx = ctxOf(before);
  await step('selfCheck', async () => {
    const bad = [{ op: 'update', taskId: 'x-outside', target: { projectId: 'other' }, fields: {} }, { op: 'create', target: { projectId: 'other' }, fields: {} }, { op: 'create', target: {}, fields: {} }, { op: 'update', taskId: before.sts.length ? before.sts[0].id : 'x', target: { sectionId: 'x-outside' }, fields: {} }, { op: 'update', taskId: before.sts.length ? before.sts[0].id : 'x', target: {}, fields: { projectId: 'other' } }, { op: 'update', taskId: before.sts.length ? before.sts[0].id : 'x', target: { parentId: 'x-outside' }, fields: {} }, { op: 'delete', taskId: before.sts.length ? before.sts[0].id : 'x', fields: {} }, { op: 'merge', taskId: before.sts.length ? before.sts[0].id : 'x', fields: { targetTaskId: 'x-outside' } }];
    bad.forEach((row, i) => { let threw = false; try { guard([row], ctx); } catch (e) { threw = true; } if (!threw) fail('guard accepted bad row ' + i); });
    if (before.sts.length) { guard([{ op: 'update', taskId: before.sts[0].id, target: {}, fields: {} }], ctx); }
    return 'guard rejects ' + bad.length + ' bad rows';
  });
  if (globalThis.__stsSelfTestOnly) { out.ok = true; return JSON.stringify(out); }
  await step('search', async () => {
    const r = await ask('In my STS Test project in Todoist: which tasks do I have? Just answer, change nothing.', before);
    if (r.todoistChanges && r.todoistChanges.rows && r.todoistChanges.rows.length) fail('search produced change rows');
    if (!String(r.answer || '').trim()) fail('empty answer');
    return String(r.answer).slice(0, 120);
  });
  await step('create', async () => {
    const r = await ask("In my STS Test project in Todoist: add a new task '" + NEW_TASK + "' due 2026-11-10.", before);
    const tc = r.todoistChanges;
    if (!tc || !tc.rows || tc.rows.length !== 1 || tc.rows[0].op !== 'create') fail('expected exactly one create row, got ' + JSON.stringify(tc && tc.rows && tc.rows.map((x) => x.op)));
    await apply(tc, before);
    pending = true;
    const mid = await view();
    const made = mid.sts.filter((t) => !ctx.taskIds.has(t.id));
    if (made.length !== 1) fail('expected one new STS task, found ' + made.length);
    if (!same(mid.others, before.others)) fail('other projects changed during create');
    return made[0];
  });
  await step('undoCreate', async () => {
    await undo();
    const now = await view();
    if (!same(now.sts, before.sts)) fail('STS Test differs from before after undoing create');
    if (!same(now.others, before.others)) fail('other projects changed');
    return 'created task removed';
  });
  await step('organize', async () => {
    const subject = before.sts.find((t) => !t.parentId) || before.sts[0];
    if (!subject) fail('STS Test has no task to organize');
    const sec = before.sections.find((s) => s !== subject.sectionId);
    const par = before.sts.find((t) => t.id !== subject.id && !t.parentId && !t.parentId && t.id !== subject.parentId);
    let where;
    if (sec) where = 'to section id ' + sec;
    else if (par) where = "under the task '" + par.content + "'";
    else fail('STS Test has no other section or task to move into');
    const r = await ask("In my STS Test project in Todoist: move the task '" + subject.content + "' " + where + " and add the label '" + LABEL + "' to it. Change nothing else.", before);
    const tc = r.todoistChanges;
    if (!tc || !tc.rows || !tc.rows.length) fail('no organize rows');
    tc.rows.forEach((x, i) => { if (String(x.taskId) !== subject.id) fail('row-' + i + ' touches a task other than the subject'); });
    await apply(tc, before);
    pending = true;
    const mid = await view();
    const t = mid.sts.find((x) => x.id === subject.id);
    if (!t || t.labels.indexOf(LABEL) < 0) fail('label not on task after organize');
    if (t.parentId === subject.parentId && t.sectionId === subject.sectionId) fail('task not moved');
    if (!same(mid.others, before.others)) fail('other projects changed during organize');
    return { id: subject.id, parentId: t.parentId, sectionId: t.sectionId };
  });
  await step('undoOrganize', async () => {
    await undo();
    const now = await view();
    if (!same(now.sts, before.sts)) fail('STS Test differs from before after undoing organize');
    if (now.sts.some((t) => t.labels.indexOf(LABEL) >= 0)) fail('label still present');
    return 'moved back, label gone';
  });
  await step('snapshots', async () => {
    const now = await view();
    if (!same(now.sts, before.sts)) fail('STS Test tasks differ from before');
    if (!same(now.others, before.others)) fail('other projects differ from before');
    return { stsTasks: now.sts.length, otherEntries: now.others.length };
  });
  out.ok = true;
} catch (e) {
  out.error = String(e && e.message || e);
  if (pending) { try { await undo(); out.cleanupUndo = 'done'; } catch (e2) { out.cleanupUndo = 'FAILED: ' + String(e2 && e2.message || e2); } }
}
return JSON.stringify(out);
})()
