"use strict";

// Task placement for chat-created Todoist tasks (Task 7, wave 1).
// Create rows may carry an optional `placement` field set by the model:
//   { kind: "active" }                  - request refers to the open note ("this note", "here")
//   { kind: "named", paths?: string[] } - request names note(s); paths default to ctx.namedPaths
//   { kind: "none" } or missing         - no note referred to -> monthly note
// Contract: row { op, target: { parentId? }, placement? } (top-level parentId accepted as alias);
// ctx { activePath?, namedPaths?, parentLine?: { path } }.
// Only IDs/paths the plugin supplied are honoured (ctx.activePath, ctx.namedPaths, ctx.parentLine).

function choosePlacement(row, ctx) {
  const { activePath, namedPaths, parentLine } = ctx || {};
  const monthly = (reason) => ({ path: "monthly", reason });
  const note = (notePath, reason) => ({ path: "note", notePath, reason });

  // A subtask follows its parent's line wherever it is; no parent line -> monthly under project.
  if (row && (row.target?.parentId || row.parentId)) {
    return parentLine && parentLine.path
      ? note(parentLine.path, "under its parent task's line")
      : monthly("parent task has no line in the vault");
  }

  const placement = row && row.placement;
  const kind = placement && placement.kind;
  if (kind === "active") {
    return activePath ? note(activePath, "request refers to the open note") : monthly("no note is open");
  }
  if (kind === "named") {
    const supplied = new Set(namedPaths || []);
    const paths = [...new Set((placement.paths || namedPaths || []).filter((p) => supplied.has(p)))];
    return paths.length === 1 ? note(paths[0], "request names this note") : monthly("zero or several notes named");
  }
  return monthly("no specific note referred to");
}

module.exports = { choosePlacement };
