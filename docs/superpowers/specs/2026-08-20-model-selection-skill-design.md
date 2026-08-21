# Design: Standalone Model-Selection Skill + Retire the Forked SDD Skill

Date: 2026-08-20
Status: Approved (pending written-spec review)

## Problem

The project currently carries a customized copy of superpowers' own
`subagent-driven-development` skill in `.opencode/skills/subagent-driven-development/`.
That fork embeds the project's model-selection priority order (`subagent.md` §4–§6)
directly into the skill's Model Selection and Concurrency sections.

The decision is to let **superpowers** become the framework for subagent use in
opencode (and, documented, openchamber), and to remove the fork. Superpowers'
native `subagent-driven-development` skill ships its own scripts
(`sdd-workspace`, `task-brief`, `review-package`) and prompt templates
(`implementer-prompt.md`, `task-reviewer-prompt.md`, `re-review-prompt.md`), so
removing the fork is safe.

Superpowers' native SDD skill has only *generic* model-selection guidance
(mechanical → cheap, integration → standard, design → most-capable,
turn-count-beats-price). It cannot know the project's concrete model list or its
rate-limit/concurrency constraints. This design delivers that project-specific
knowledge to the orchestrator as a dedicated skill, without re-forking
superpowers.

## Goals

1. Provide the concrete, project-specific model-selection logic to the
   orchestrator as a single standalone skill.
2. Remove the forked SDD skill so superpowers' native skill becomes the active
   framework.
3. Keep `subagent.md` as the operator reference but stop duplicating the model
   logic (single source of truth).
4. Document openchamber usage (no new automation in this pass).
5. Preserve the project's rate-limit/concurrency rules that the fork used to
   carry, now in the model-selection skill.

## Non-goals

- Re-derive superpowers' generic role→tier matching logic (mechanical/standard/
  capable, turn-count-beats-price). That stays superpowers' responsibility.
- Build openchamber automation.
- Modify the superpowers plugin's own files (it is external, git-managed).

## Deliverables

### 1. New skill: `.opencode/skills/model-selection/SKILL.md`

The single home for project-specific model-selection knowledge. Contents:

- **General 8-level dispatch priority order** (for implementer, task-reviewer,
  re-reviewer, final-reviewer, researcher, explorer):
  1. llama-unraid — `Gemma-4-26B-A4B` (local, offline, 1 concurrent instance)
  2. OpenCode Zen — `Nemotron 3.5 Lightning Free`
  3. OpenCode Zen — `DeepSeek V4 Flash Free`
  4. OpenCode Go — `DeepSeek V4 Flash` (low reasoning)
  5. OpenAI — `GPT 5.6 Luna` (high reasoning; up to 4 parallel; only below 100%
     weekly usage)
  6. OpenRouter — `Free Models Router` (`openrouter/free`)
  7. Built-in `general` fallback
  8. Built-in `explore` fallback
  - Note the removed models: OpenRouter `nemotron-3.5-lightning:free` and
    `gemma-4-31b-it:free` returned empty responses; do not re-add.

- **Adversarial-reviewer dedicated priority order** (own list, excludes local
  llama — not powerful enough for plan challenge):
  1. OpenCode Zen — `Nemotron 3.5 Lightning Free`
  2. OpenCode Zen — `DeepSeek V4 Flash Free`
  3. OpenCode Go — `DeepSeek V4 Flash` (low reasoning)
  4. OpenAI — `GPT 5.6 Luna` (high reasoning; below-100%-usage gate)

- **Rate-limit and concurrency rules** (project-specific):
  - Max 10 active subagents in parallel.
  - Only one instance of any single `provider:model` whose name contains "Free"
    at a time; different providers' "Free" models may run in parallel.
  - Luna up to 4 parallel instances; skip if OpenAI weekly usage ≥ 100%.
  - llama-unraid local provider: 1 concurrent instance.
  - On `429`/quota/availability error: record it, move to the next model in the
    relevant priority list; do not keep retrying a rate-limited model.

- **Dispatch procedure**:
  - opencode: pick the highest-priority available model that fits the role's
    tier, set the session model to that pick, then dispatch the role profile
    (which omits `model` and inherits the dispatcher's model).
  - openchamber (documented only): apply the same priority order when choosing
    the `model` parameter for a session dispatch.

- **Adversarial emphasis in primary-session planning**: the adversarial reviewer
  runs before dispatch as part of primary-session planning, using its dedicated
  model list above, to challenge plan assumptions, edge cases, dependency probes,
  concurrency/rate-limit correctness, prompt-shape risks, information-flow
  violations, and cascading failure modes.

- Frontmatter: `name: model-selection`, description covering what it does and
  when to load it (before dispatching subagents under superpowers' SDD workflow).

### 2. Remove the fork

Delete `.opencode/skills/subagent-driven-development/` so the
`subagent-driven-development` skill name resolves to superpowers' native skill.

### 3. Update `subagent.md`

Replace the detailed §4–§6 content with a pointer to the model-selection skill
(single source of truth). Keep the roles, concurrency, and ledger structure.
Update any "§4"/"§5"/"§6" references accordingly.

### 4. Update the 7 role profiles (`.opencode/agent/*.md`)

Change the "model assigned per subagent.md §4" wording to reference the
model-selection skill. The adversarial-reviewer profile should reference its
dedicated model list in the model-selection skill.

### 5. Documentation

- openchamber guidance lives inside the model-selection skill (documented only).
- `subagent.md` points at the skill as the authority for model selection.

## Open questions / decisions made

- Concurrency/rate-limit rules move into the model-selection skill (they are
  part of dispatch). Approved by user.
- Adversarial-reviewer uses its own model list, not "most capable"; local llama
  excluded. Approved by user.
- openchamber is documentation-only in this pass. Approved by user.

## Validation

- Verify the forked SDD skill directory is gone and the `subagent-driven-development`
  skill resolves to superpowers' native skill (list skills).
- Verify the model-selection skill is discoverable and loads.
- Verify no dangling references to the deleted fork (grep for the old paths and
  for "subagent.md §4").
- Verify opencode config still loads (no broken references).
