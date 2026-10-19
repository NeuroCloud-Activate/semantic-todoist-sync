// Preset wording adapted from obsidian-writing-buddy (MIT License, Copyright (c) 2026 onezeroooo).
"use strict";

// Rows and copy exactly as in the plan's Presets table, in table order.
const REWRITE_PRESETS = [
  {
    id: "grammar",
    title: "Fix spelling & grammar",
    instruction:
      "Correct spelling, grammar and punctuation only. Do not change wording, tone, structure or meaning beyond what a correction requires. Keep Markdown, links and formatting exactly.",
    evidence: "off",
    apply: "replace",
  },
  {
    id: "polish",
    title: "Improve writing",
    instruction:
      "Polish the selected passage. Keep its meaning, claims and every information point unchanged. Improve wording, rhythm, transitions and clarity; keep the author's voice and the terminology used in their notes. Do not add new claims and do not drop existing information.",
    evidence: "toggles",
    apply: "replace",
  },
  {
    id: "plain",
    title: "Plain language",
    instruction:
      "Rewrite the selected passage in plain language for a busy professional reader: short sentences, active voice, common words, one idea per sentence; replace jargon or define it and spell out acronyms on first use. Keep every requirement, fact and information point unchanged.",
    evidence: "off",
    apply: "replace",
  },
  {
    id: "tighten",
    title: "Make concise",
    instruction:
      "Tighten the selected passage. Shorten it noticeably while keeping every key information point. Cut repetition, redundant modifiers and transitions that do no work first.",
    evidence: "off",
    apply: "replace",
  },
  {
    id: "expand",
    title: "Expand",
    instruction:
      "Expand the selected passage. Add supporting detail, examples or explanation without changing its direction or conclusions. Take any new facts only from the evidence and cite them; never invent facts.",
    evidence: "toggles",
    apply: "replace",
  },
  {
    id: "continue",
    title: "Continue writing",
    instruction:
      "Continue writing from where the selected passage ends. Keep person, tense, tone and rhythm consistent with what precedes. Return only the new text that follows the selection; do not repeat the selection. Take any new facts only from the evidence and cite them.",
    evidence: "toggles",
    apply: "after",
  },
  {
    id: "funder",
    title: "Strengthen for funders",
    group: "Grant & policy",
    instruction:
      "Strengthen the selected passage for a grant reviewer. Lead with the most important point and make the need, approach, outcomes and impact explicit and specific; prefer concrete figures, results and commitments over general claims. Take any figures, results or requirements only from the evidence and cite them; never invent data. Do not add commitments the evidence does not support.",
    evidence: "toggles",
    apply: "replace",
  },
  {
    id: "policy",
    title: "Policy wording",
    group: "Grant & policy",
    instruction:
      'Rewrite the selected passage as clear policy text. Use "must" for mandatory requirements, "should" for recommendations and "may" for options, consistently. State who is responsible for what, use active voice, remove ambiguity, and use defined terms consistently with the surrounding document and the evidence. Do not add or remove requirements.',
    evidence: "toggles",
    apply: "replace",
  },
  {
    id: "steps",
    title: "Numbered steps",
    group: "Grant & policy",
    instruction:
      "Convert the selected passage into numbered step-by-step instructions. One action per step, starting with a verb; keep each condition, warning or prerequisite next to the step it applies to. Keep every action and detail; do not add steps.",
    evidence: "off",
    apply: "replace",
  },
  {
    id: "tone-formal",
    title: "Formal",
    group: "Change tone",
    instruction:
      "Rewrite the selected passage in a formal tone. Keep its meaning, facts and every information point unchanged.",
    evidence: "off",
    apply: "replace",
  },
  {
    id: "tone-neutral",
    title: "Neutral",
    group: "Change tone",
    instruction:
      "Rewrite the selected passage in a neutral tone. Keep its meaning, facts and every information point unchanged.",
    evidence: "off",
    apply: "replace",
  },
  {
    id: "tone-persuasive",
    title: "Persuasive",
    group: "Change tone",
    instruction:
      "Rewrite the selected passage in a persuasive tone: lead with the benefit or stakes, use confident active wording, and end with a clear point or call to action. Keep its meaning, facts and every information point unchanged; do not add claims, figures or promises that are not already in the passage.",
    evidence: "off",
    apply: "replace",
  },
  {
    id: "tone-casual",
    title: "Casual",
    group: "Change tone",
    instruction:
      "Rewrite the selected passage in a casual tone. Keep its meaning, facts and every information point unchanged.",
    evidence: "off",
    apply: "replace",
  },
  {
    id: "check",
    title: "Check against my notes",
    instruction:
      "Check the selected passage against the evidence and the surrounding note. Report only contradictions or mismatches backed by evidence: differing figures, amounts, dates, names, program or project titles, commitments, defined terms or timeline. If the evidence includes requirements or guidelines (for example a funding call or policy standard), also flag where the passage misses or contradicts them. For each finding, state what the passage says and what the source says, citing its [En] id. If nothing conflicts, say so plainly; do not turn doubts into conflicts. If the evidence is too thin to judge, say so. Do not rewrite the passage.",
    evidence: "vault",
    apply: "chat",
  },
];

// The typed row is not a preset; its instruction is built on demand.
const TYPED_REWRITE_INSTRUCTION =
  "Rewrite the selected passage according to this request: <typed text>. Keep names, terms and facts unchanged unless the request explicitly asks.";

function typedRewriteInstruction(text) {
  return TYPED_REWRITE_INSTRUCTION.replace("<typed text>", String(text == null ? "" : text));
}

function fileBaseName(path) {
  const value = String(path == null ? "" : path);
  const parts = value.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.length ? parts[parts.length - 1] : value;
}

function planReplacement(editor, recorded, currentPath) {
  if (!recorded || recorded.path !== currentPath) {
    return { ok: false, notice: `Open ${fileBaseName(recorded && recorded.path)} to apply.` };
  }
  const actual = editor.getRange(recorded.from, recorded.to);
  if (actual !== recorded.original) {
    return { ok: false, notice: "Selected text changed; not applied." };
  }
  return { ok: true, from: recorded.from, to: recorded.to };
}

module.exports = { REWRITE_PRESETS, typedRewriteInstruction, planReplacement };
