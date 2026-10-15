"use strict";

function planInsertion(editor, recorded, currentPath) {
  if (!recorded || recorded.path !== currentPath) {
    return { mode: "closed", from: undefined, to: undefined };
  }
  const value = editor.getValue();
  function cursorFallback() {
    const cursor = editor.getCursor();
    return {
      mode: "cursor",
      from: cursor,
      to: cursor,
      notice: "Note changed while writing; inserted at the cursor.",
    };
  }
  let off;
  try {
    off = editor.posToOffset(recorded.from);
  } catch {
    return cursorFallback();
  }
  if (!Number.isFinite(off) || off < 0 || off > value.length) {
    return cursorFallback();
  }
  const want = typeof recorded.prefix === "string" ? recorded.prefix : "";
  const actual = value.slice(Math.max(0, off - want.length), off);
  if (actual === want) {
    return { mode: "recorded", from: recorded.from, to: recorded.to };
  }
  return cursorFallback();
}

function insertDraft(editor, plan, text) {
  editor.replaceRange(text, plan.from, plan.to);
}

function composeDraft(markdown, footnotes, sourcesBlock) {
  const body = typeof markdown === "string" ? markdown : "";
  const foot = typeof footnotes === "string" ? footnotes : "";
  const block = typeof sourcesBlock === "string" ? sourcesBlock : "";
  if (!foot.trim()) {
    if (!block.trim() || !body.trim() || hasSourcesBlock(body)) return body;
    return body + "\n\n" + block;
  }
  if (!body.trim()) return foot;
  const base = body + "\n\n" + foot;
  if (!block.trim() || hasSourcesBlock(base)) return base;
  return base + "\n\n" + block;
}

// A model-echoed Sources searched section never triggers a second code-generated one.
function hasSourcesBlock(text) {
  return /^Sources searched:/m.test(String(text || ""));
}

module.exports = { planInsertion, insertDraft, composeDraft };
