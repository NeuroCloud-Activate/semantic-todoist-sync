"use strict";
const assert = require("assert");
const { LOOKUP_SCHEMA, lookupPrompt, shortlistTasks } = require("../src/todoist/lookup.js");

const task = (id, content, o = {}) => ({ id, content, description: "", projectId: "p1", sectionId: "", parentId: "", labels: [], priority: 1, dueDate: "", isCompleted: false, ...o });
const snapshot = {
  tasks: [
    task("t1", "Buy compost", { labels: ["home"], dueDate: "2026-11-01" }),
    task("t2", "Call plumber", { projectId: "p2", labels: ["home"], priority: 4 }),
    task("t3", "Write report", { projectId: "p2", description: "compost budget numbers" }),
    task("t4", "Old compost order", { isCompleted: true, labels: ["home"] })
  ],
  projects: [{ id: "p1", name: "Garden" }, { id: "p2", name: "Work & Home" }],
  sections: [],
  labels: ["home"]
};
const lk = (o = {}) => ({ needsTodoist: true, kind: "question", filters: { words: [], projects: [], labels: [] }, refersToLastAnswer: false, ...o });
const ids = (l) => l.map((t) => t.id);
const cases = {
  "vault-only lookup yields empty shortlist"() {
    assert.deepStrictEqual(shortlistTasks(snapshot, lk({ needsTodoist: false, kind: "none" }), [], 10), []);
    assert.deepStrictEqual(shortlistTasks(null, lk(), [], 10), []);
  },
  "project and label filters narrow first"() {
    assert.deepStrictEqual(ids(shortlistTasks(snapshot, lk({ filters: { words: [], projects: ["work & home"], labels: ["Home"] } }), [], 10)), ["t2"]);
    // a filter matching nothing yields nothing, never everything
    assert.deepStrictEqual(shortlistTasks(snapshot, lk({ filters: { words: [], projects: ["Nope"], labels: [] } }), [], 10), []);
    // words rank within the narrowed set
    assert.deepStrictEqual(ids(shortlistTasks(snapshot, lk({ filters: { words: ["compost"], projects: [], labels: [] } }), [], 10)), ["t1", "t3"]);
    assert.deepStrictEqual(ids(shortlistTasks(snapshot, lk({ filters: { words: [], projects: [], labels: [], priority: 4 } }), [], 10)), ["t2"]);
    assert.deepStrictEqual(ids(shortlistTasks(snapshot, lk({ filters: { words: [], projects: [], labels: [], dueFrom: "2026-10-30", dueTo: "2026-11-02" } }), [], 10)), ["t1"]);
  },
  "change request on those tasks keeps every last-answer task first"() {
    const out = shortlistTasks(snapshot, lk({ kind: "change", refersToLastAnswer: true, filters: { words: ["compost"], projects: [], labels: [] } }), ["t2", "gone"], 10);
    assert.deepStrictEqual(ids(out), ["t2", "t1", "t3"]);
  },
  "cap is respected"() {
    assert.strictEqual(shortlistTasks(snapshot, lk(), [], 2).length, 2);
    assert.strictEqual(shortlistTasks(snapshot, lk({ refersToLastAnswer: true }), ["t1", "t2", "t3"], 1).length, 1);
  },
  "completed tasks excluded unless asked"() {
    assert.ok(!ids(shortlistTasks(snapshot, lk(), [], 10)).includes("t4"));
    assert.ok(ids(shortlistTasks(snapshot, lk({ filters: { words: ["compost"], projects: [], labels: [], includeCompleted: true } }), [], 10)).includes("t4"));
  },
  "tasks snapshot returns its matching task; items alias still works"() {
    const l = lk({ filters: { words: ["plumber"], projects: [], labels: [] } });
    assert.deepStrictEqual(ids(shortlistTasks(snapshot, l, [], 10)), ["t2"]);
    assert.deepStrictEqual(ids(shortlistTasks({ items: snapshot.tasks, projects: snapshot.projects }, l, [], 10)), ["t2"]);
  },
  "same-day task with a time passes dueFrom and dueTo"() {
    const s = { tasks: [task("t9", "Timed", { dueDate: "2026-11-02T10:00:00" })], projects: [], sections: [] };
    for (const f of [{ dueTo: "2026-11-02" }, { dueFrom: "2026-11-02" }]) {
      assert.deepStrictEqual(ids(shortlistTasks(s, lk({ filters: { words: [], projects: [], labels: [], ...f } }), [], 10)), ["t9"]);
    }
  },
  "missing or non-numeric cap falls back to the default"() {
    assert.ok(shortlistTasks(snapshot, lk(), []).length > 0);
    assert.ok(shortlistTasks(snapshot, lk(), [], NaN).length > 0);
  },
  "LOOKUP_SCHEMA is strict-mode compliant; null filters = no filter"() {
    const bad = (s, p = "root") => {
      const o = [];
      if ([].concat(s.type).includes("object")) {
        const k = Object.keys(s.properties);
        if (s.additionalProperties !== false) o.push(p + " additionalProperties");
        if (JSON.stringify([...s.required].sort()) !== JSON.stringify(k.sort())) o.push(p + " required");
        for (const x of k) o.push(...bad(s.properties[x], p + "." + x));
      }
      return o;
    };
    assert.deepStrictEqual(bad(LOOKUP_SCHEMA), []);
    for (const k of ["dueFrom", "dueTo", "priority", "includeCompleted"]) assert.ok(LOOKUP_SCHEMA.properties.filters.properties[k].type.includes("null"), k);
    const nul = { words: [], projects: [], labels: [], dueFrom: null, dueTo: null, priority: null, includeCompleted: null };
    assert.deepStrictEqual(ids(shortlistTasks(snapshot, lk({ filters: nul }), [], 10)).sort(), ["t1", "t2", "t3"]);
  },
  "change request: new due date in filters does not drop the named task"() {
    const sts = { tasks: [
      task("a", "STS sample: buy printer paper", { projectId: "p9" }),
      task("b", "STS sample: book dentist appointment", { projectId: "p9", dueDate: "2026-11-02" }),
      task("c", "STS sample: renew passport", { projectId: "p9", dueDate: "2026-11-03" })
    ], projects: [{ id: "p9", name: "STS Test" }], sections: [] };
    const filters = { words: ["STS sample: buy printer paper", "STS sample: order toner"], projects: ["STS Test"], labels: [], dueFrom: null, dueTo: "2026-11-05", priority: 2, includeCompleted: false };
    assert.ok(ids(shortlistTasks(sts, lk({ kind: "change", filters }), [], 10)).includes("a"));
    // same filters as a question behave as before: the undated task is excluded
    assert.deepStrictEqual(ids(shortlistTasks(sts, lk({ kind: "question", filters: { ...filters, priority: null } }), [], 10)), ["b", "c"]);
    // change with no words still filters by date
    assert.deepStrictEqual(ids(shortlistTasks(sts, lk({ kind: "change", filters: { words: [], projects: [], labels: [], dueTo: "2026-11-02" } }), [], 10)), ["b"]);
    // change whose words match nothing finds nothing
    assert.deepStrictEqual(shortlistTasks(sts, lk({ kind: "change", filters: { ...filters, words: ["zebra"] } }), [], 10), []);
  },
  "change request with words: tasks inside the date/priority range rank first"() {
    const s = { tasks: [
      task("hi", "alpha beta gamma", { dueDate: "2026-12-30" }),
      task("lo", "alpha", { dueDate: "2026-11-02" }),
      task("nodate", "alpha beta")
    ], projects: [], sections: [] };
    const f = { words: ["alpha", "beta", "gamma"], projects: [], labels: [], dueTo: "2026-11-05" };
    const change = (extra, cap) => ids(shortlistTasks(s, lk({ kind: "change", filters: { ...f, ...extra } }), [], cap));
    assert.deepStrictEqual(change({}, 10), ["lo", "hi", "nodate"]);
    // the cap applies after the range ordering
    assert.deepStrictEqual(change({}, 1), ["lo"]);
    // priority ranks the same way
    const p = { tasks: [task("x", "alpha beta", { priority: 1 }), task("y", "alpha", { priority: 4 })], projects: [], sections: [] };
    assert.deepStrictEqual(ids(shortlistTasks(p, lk({ kind: "change", filters: { words: ["alpha", "beta"], projects: [], labels: [], priority: 4 } }), [], 10)), ["y", "x"]);
    // guard: no in-range task still keeps word matches
    assert.deepStrictEqual(change({ dueTo: "2026-01-01" }, 10), ["hi", "nodate", "lo"]);
  },
  "prompt and schema"() {
    assert.ok(/existing tasks/i.test(lookupPrompt("x", "").system) && /not.*new value/i.test(lookupPrompt("x", "").system));
    assert.deepStrictEqual(LOOKUP_SCHEMA.required, ["needsTodoist", "kind", "filters", "refersToLastAnswer", "searchQuery", "reuseEvidence"]);
    assert.strictEqual(LOOKUP_SCHEMA.properties.searchQuery.type, "string");
    assert.strictEqual(LOOKUP_SCHEMA.properties.reuseEvidence.type, "boolean");
    const sys = lookupPrompt("x", "").system;
    assert.ok(/searchQuery/.test(sys) && /standalone/i.test(sys) && /Jim tasks due today/.test(sys), "searchQuery explained with example");
    assert.ok(/always (a )?(useful|filled)|never empty/i.test(sys) && !/Empty string when reuseEvidence/i.test(sys), "searchQuery is always filled, also when reusing");
    assert.ok(/reuseEvidence=true/.test(sys) && /previous answer/i.test(sys), "reuseEvidence explained");
    assert.ok(/P1.*=.*4/s.test(lookupPrompt("x", "").system) && /P4.*=.*1/s.test(lookupPrompt("x", "").system), "priority mapping");
    const p = lookupPrompt("move it", "User: hi");
    assert.ok(p.user.includes("move it") && p.user.includes("User: hi"));
    assert.ok(/needsTodoist.*false/s.test(p.system) && /vault notes/.test(p.system) && /short/i.test(p.system));
  },
  "ties rank by priority, then earliest due date (overdue first), undated last"() {
    const s = { tasks: [
      task("p4near", "a", { priority: 1, dueDate: "2026-10-28" }),
      task("p1none", "b", { priority: 4 }),
      task("p1far", "c", { priority: 4, dueDate: "2026-12-30" }),
      task("p1near", "d", { priority: 4, dueDate: "2026-10-29" }),
      task("p1over", "e", { priority: 4, dueDate: "2026-10-27T09:00:00" }),
      task("p2today", "f", { priority: 3, dueDate: "2026-10-28" })
    ], projects: [], sections: [] };
    assert.deepStrictEqual(ids(shortlistTasks(s, lk(), [], 10)), ["p1over", "p1near", "p1far", "p1none", "p2today", "p4near"]);
    // word relevance still comes first; priority/date only break its ties
    const w = { tasks: [task("lowHit", "budget report", { priority: 1 }), task("hiTie", "budget", { priority: 4 }), task("loTie", "budget", { priority: 2 })], projects: [], sections: [] };
    assert.deepStrictEqual(ids(shortlistTasks(w, lk({ filters: { words: ["budget", "report"], projects: [], labels: [] } }), [], 10)), ["lowHit", "hiTie", "loTie"]);
    // a capped list keeps the most important
    assert.deepStrictEqual(ids(shortlistTasks(s, lk(), [], 2)), ["p1over", "p1near"]);
  },
  "follow-up narrowing the last answer keeps only its tasks that match the new words, first"() {
    const s = { tasks: [
      task("a", "Email Sophie", { priority: 4 }),
      task("b", "Book meeting with Jim", { priority: 2 }),
      task("c", "Call Jim about IRGP", { priority: 3 }),
      task("d", "Jim budget review (not in last answer)", { priority: 4 })
    ], projects: [], sections: [] };
    const out = ids(shortlistTasks(s, lk({ refersToLastAnswer: true, filters: { words: ["Jim"], projects: [], labels: [] } }), ["a", "b", "c"], 10));
    assert.deepStrictEqual(out, ["c", "b", "d"], "last-answer tasks naming Jim lead (ranked), other matches next; unmatched last-answer tasks dropped");
  },
  "look-up prompt tells the model to carry over a Todoist follow-up's filters"() {
    const s = lookupPrompt("what's specific to Jim?", "User: tasks today").system;
    assert.ok(/follow[- ]?up/i.test(s) && /carr(y|ied) over/i.test(s) && /needsTodoist=true/.test(s), s);
  },
  "look-up is told today's date so 'today' becomes a due filter"() {
    const p = lookupPrompt("what tasks do I have to do today", "", "2026-10-28");
    assert.ok(p.system.includes("Today's date is 2026-10-28 (Wednesday)"), p.system);
    assert.ok(/"today" means dueFrom and dueTo are both today's date/.test(p.system), "today mapping");
    assert.ok(!/Today's date/.test(lookupPrompt("x", "").system), "no date line without a date");
  }
};
let failed = 0;
for (const [name, fn] of Object.entries(cases)) {
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.stack}`); }
}
process.exit(failed ? 1 : 0);