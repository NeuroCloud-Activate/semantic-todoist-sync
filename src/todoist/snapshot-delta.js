"use strict";
// Merges a Todoist /sync response into the raw rows of the previous snapshot. Raw rows are kept (not normalized)
// so the caller normalizes the merged result exactly as it does after a full download.

const isDeleted = (row) => Boolean(row && (row.is_deleted || row.isDeleted));
const isDone = (item) => Boolean(item && (item.checked || item.is_completed || item.completed));
const isArchived = (row) => Boolean(row && (row.is_archived || row.isArchived));
const hasId = (row) => row && row.id !== undefined && row.id !== null && String(row.id) !== "";

function upsert(prevRows, changedRows, drop) {
  const byId = new Map();
  for (const row of prevRows || []) if (hasId(row)) byId.set(String(row.id), row);
  for (const row of changedRows || []) {
    if (!hasId(row)) continue; // unknown shape: ignore rather than corrupt the snapshot
    if (isDeleted(row) || drop(row)) byId.delete(String(row.id));
    else byId.set(String(row.id), row);
  }
  return [...byId.values()];
}

// prevRaw: { items, projects, sections } from the last merge, or null. json: the /sync response body.
// A full download (no previous rows, or full_sync: true) replaces; otherwise the changes are merged by id.
// A full sync never lists completed or archived rows, so a delta drops them to stay equivalent.
function mergeSyncResponse(prevRaw, json) {
  const body = json && typeof json === "object" ? json : {};
  const full = !prevRaw || body.full_sync === true;
  const base = full ? {} : prevRaw;
  const never = () => false; // a full response is taken as given, exactly like the old full path
  return {
    full,
    raw: {
      items: upsert(base.items, body.items, full ? never : isDone),
      projects: upsert(base.projects, body.projects, full ? never : isArchived),
      sections: upsert(base.sections, body.sections, full ? never : isArchived)
    }
  };
}

module.exports = { mergeSyncResponse };
