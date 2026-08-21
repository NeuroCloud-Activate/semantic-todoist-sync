# Model-Selection Skill + Retire Forked SDD Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a standalone project skill that holds the concrete model-selection logic for superpowers subagent dispatch, remove the forked SDD skill, and repoint all references so superpowers' native SDD skill becomes the framework.

**Architecture:** Add a new skill at `.opencode/skills/model-selection/SKILL.md` that supplies the project-specific model priority order, the adversarial-reviewer's dedicated model list, rate-limit/concurrency rules, and dispatch procedures. Delete `.opencode/skills/subagent-driven-development/` (the fork). Repoint `subagent.md`, `AGENTS.md`, and the role profiles in `.opencode/agent/` at the new skill. Superpowers' native SDD skill and its own scripts/templates take over the workflow.

**Tech Stack:** opencode skills (markdown `SKILL.md` files with frontmatter), markdown documentation, git.

**Spec:** `docs/superpowers/specs/2026-08-20-model-selection-skill-design.md`

## Global Constraints

- All model-priority content below is copied verbatim from the spec; do not reword the model/provider names.
- Do not modify any file inside the superpowers plugin cache (`C:\Users\MattS\.cache\opencode\packages\superpowers@...`). It is external and git-managed.
- Do not re-add OpenRouter `nemotron-3.5-lightning:free` or `gemma-4-31b-it:free` (removed; returned empty responses).
- After the change, no repo file may contain a dangling reference to the deleted fork (`.opencode/skills/subagent-driven-development/`) or to "subagent.md §4" as the model-selection authority.
- Do not edit opencode.json / opencode.jsonc / `.opencode/agent/` permission blocks beyond the specific wording changes in each task.

---

### Task 1: Create the model-selection skill

**Files:**
- Create: `.opencode/skills/model-selection/SKILL.md`

**Interfaces:**
- Produces: skill named `model-selection`, discoverable via the skill loader. Later tasks reference its path (`.opencode/skills/model-selection/SKILL.md`).

- [ ] **Step 1: Create the directory and file**

Create `.opencode/skills/model-selection/` and write `SKILL.md` with exactly this content:

```markdown
---
name: model-selection
description: Use when choosing which model to dispatch a subagent on, before any subagent dispatch in the superpowers subagent-driven-development workflow, and when selecting a model for openchamber session dispatches. Supplies the project's concrete model priority order, the adversarial-reviewer's dedicated model list, and the rate-limit/concurrency rules. Load before dispatching implementer, task-reviewer, re-reviewer, adversarial-reviewer, final-reviewer, researcher, or explorer.
---

# Model Selection

Project-specific model selection for dispatching subagents under superpowers'
subagent-driven-development workflow. This skill supplies what superpowers'
generic model-selection guidance cannot: the concrete models/providers available,
their priority order, and the rate-limit/concurrency rules that govern dispatch.

Generic role->tier matching (mechanical -> cheap, integration -> standard, design ->
most-capable, turn-count-beats-price) comes from superpowers' own SDD skill; use
that to pick a tier, then use this skill to map the tier to an actual model.

## General dispatch priority order

For implementer, task-reviewer, re-reviewer, final-reviewer, researcher, and
explorer. Select the earliest available match that is not rate limited or failing:

1. llama-unraid — `Gemma-4-26B-A4B` — local provider model, private offline
   fallback, no per-request free limit. Only 1 concurrent agent/subagent instance
   is allowed on this provider.
2. OpenCode Zen — `Nemotron 3.5 Lightning Free`
3. OpenCode Zen — `DeepSeek V4 Flash Free`
4. OpenCode Go — `DeepSeek V4 Flash` (low reasoning)
5. OpenAI — `GPT 5.6 Luna` (high reasoning) — up to 4 parallel instances; only
   used when the OpenAI weekly usage is below 100%. At or above 100% the account
   is at its hard limit and no OpenAI model can be used — skip and continue down
   the list.
6. OpenRouter — `Free Models Router` (`openrouter/free`) — lowest priority
   fallback
7. Built-in `general` fallback — pinned to the Free Models Router. Use only when
   priorities 1-6 are exhausted or rate-limited. Never the default.
8. Built-in `explore` fallback — pinned to the Free Models Router. Absolute
   lowest priority; use only when everything above is unavailable.

Removed models — do not re-add: OpenRouter `nemotron-3.5-lightning:free` and
`gemma-4-31b-it:free` (returned empty responses in validation).

## Adversarial-reviewer priority order

The adversarial reviewer uses its own dedicated list. Local llama is excluded —
it is not powerful enough for adversarial plan challenge.

1. OpenCode Zen — `Nemotron 3.5 Lightning Free`
2. OpenCode Zen — `DeepSeek V4 Flash Free`
3. OpenCode Go — `DeepSeek V4 Flash` (low reasoning)
4. OpenAI — `GPT 5.6 Luna` (high reasoning; below-100%-usage gate)

## Rate-limit and concurrency rules

- Max 10 active subagents in parallel.
- Only one instance of any single `provider:model` whose name contains "Free" at
  a time; different providers' "Free" models may run in parallel.
- Luna: up to 4 parallel instances; skip if OpenAI weekly usage is at or above
  100% (hard limit — no OpenAI model can be used).
- llama-unraid local provider: 1 concurrent instance.
- On `429` / insufficient quota / rate-limit / availability error: record it, then
  move to the next model in the relevant priority list. Never keep retrying a
  rate-limited model. Prefer spreading parallel free work across different
  providers so each free bucket stays under its own cap.

## Dispatch procedure

opencode: (1) pick the highest-priority available model above that fits the
role's tier; (2) set your session model to that pick; (3) dispatch the role
profile — each profile in `.opencode/agent/` omits a `model` field and inherits
your session model. Never use the built-in `general`/`explore` agent types as the
default.

openchamber: apply the same priority order when choosing the `model` parameter
for a session dispatch.

## Decision-making defaults

Pose questions to the human only when absolutely necessary. By default, take the
recommended approach and proceed, recording the decision as a `Ruling:` line in
the plan ledger. The only cases that warrant a question are the four stop
conditions from superpowers' subagent-driven-development skill: an irreversible
or destructive operation; a security-sensitive action; a side effect outside the
current worktree that norms say to ask about first (a merge, a push to a shared
branch, a publish); and a plan so broken that every path forward is a guess. For
everything else, decide, ledger the ruling, and keep moving.

## Primary-session planning emphasis

The adversarial reviewer runs before dispatch as part of primary-session
planning: challenge the plan's assumptions, edge cases, dependency probes,
concurrency/rate-limit correctness, prompt-shape risks, information-flow
violations, and cascading failure modes. Record open assumptions, high-risk
chains, suggested rewrites, and a go/no-go recommendation.
```

- [ ] **Step 2: Validate the file exists and has valid frontmatter**

Run:
```powershell
Test-Path -LiteralPath ".opencode\skills\model-selection\SKILL.md"
Get-Content -LiteralPath ".opencode\skills\model-selection\SKILL.md" | Select-Object -First 4
```
Expected: `True`, and the first 4 lines are the frontmatter (`---`, `name: model-selection`, `description: ...`, `---`).

- [ ] **Step 3: Commit**

```bash
git add .opencode/skills/model-selection/SKILL.md
git commit -m "feat(skills): add standalone model-selection skill"
```

---

### Task 2: Remove the forked SDD skill

**Files:**
- Delete: `.opencode/skills/subagent-driven-development/` (entire directory)

**Interfaces:**
- Produces: the `subagent-driven-development` skill name resolves to superpowers' native skill.

- [ ] **Step 1: Delete the fork**

Run:
```powershell
Remove-Item -LiteralPath ".opencode\skills\subagent-driven-development" -Recurse -Force
```

- [ ] **Step 2: Validate the fork is gone**

Run:
```powershell
Test-Path -LiteralPath ".opencode\skills\subagent-driven-development"
```
Expected: `False`.

- [ ] **Step 3: Commit**

```bash
git add -A .opencode/skills/subagent-driven-development
git commit -m "chore(skills): remove forked SDD skill, use superpowers native"
```

---

### Task 3: Repoint `subagent.md` at the model-selection skill

**Files:**
- Modify: `subagent.md` (replace the §4 / §5 / §6 model-selection sections)

**Interfaces:**
- Consumes: the skill created in Task 1.
- Produces: `subagent.md` references the model-selection skill instead of embedding the priority list.

- [ ] **Step 1: Read the current §4–§6 region**

Read `subagent.md` lines 108–222 (sections `## 4. Model selection — priority order`, `## 5. Per-model capabilities (for choosing)`, and `## 6. Provider rate limits`) and confirm the exact boundaries before editing.

- [ ] **Step 2: Replace §4–§6 with a pointer**

Replace the entire content of `## 4. Model selection — priority order` through the end of `## 6. Provider rate limits` with this single section:

```markdown
## 4. Model selection

Model selection is defined in the project's `model-selection` skill
(`.opencode/skills/model-selection/SKILL.md`). Read it before dispatching any
subagent. It holds the concrete priority order, the adversarial-reviewer's own
dedicated model list, the rate-limit and concurrency rules, and the dispatch
procedure for opencode and openchamber.

The spawnable role profiles (`.opencode/agent/`) omit a `model` field and inherit
the dispatcher's session model; set it to the model-selection skill's pick before
dispatching. Generic role-to-tier matching guidance (mechanical / standard /
capable, turn-count-beats-price) comes from superpowers'
subagent-driven-development skill.
```

Keep the rest of `subagent.md` (roles in §1, per-task loop §2, concurrency §3, ledger §7) intact.

- [ ] **Step 3: Validate the replacement**

Run:
```powershell
Select-String -LiteralPath "subagent.md" -Pattern "## 4. Model selection","model-selection skill","## 5.","## 6."
```
Expected: the `## 4. Model selection` heading exists, `model-selection skill` appears, and there are no `## 5.` or `## 6.` section headings remaining.

- [ ] **Step 4: Commit**

```bash
git add subagent.md
git commit -m "docs(subagent): point model selection at model-selection skill"
```

---

### Task 4: Repoint `AGENTS.md` model-selection references

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: the skill created in Task 1.

- [ ] **Step 1: Find model-selection references**

Run:
```powershell
Select-String -LiteralPath "AGENTS.md" -Pattern "subagent.md §4","§4","priority list in"
```
List each matching line with its line number.

- [ ] **Step 2: Update each reference to point at the model-selection skill**

For every line that refers to `subagent.md §4` or to `§4` as the model-selection authority (the priority list), change the wording to reference the model-selection skill. Replace `subagent.md §4` with `the model-selection skill (.opencode/skills/model-selection/SKILL.md)`. For lines that say "set your session model to the highest-priority available pick from `subagent.md` §4", replace `subagent.md` §4 with `the model-selection skill`. For "Dispatch it on the most capable available model per §4", keep the intent but reference the skill. Do not alter concurrency-cap numbers or the free-model/Luna rules; those live on in the skill.

- [ ] **Step 3: Validate no dangling §4 reference remains**

Run:
```powershell
Select-String -LiteralPath "AGENTS.md" -Pattern "subagent.md §4"
```
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): point model selection at model-selection skill"
```

---

### Task 5: Update the 7 role profiles in `.opencode/agent/`

**Files:**
- Modify: `.opencode/agent/implementer.md`
- Modify: `.opencode/agent/task-reviewer.md`
- Modify: `.opencode/agent/re-reviewer.md`
- Modify: `.opencode/agent/adversarial-reviewer.md`
- Modify: `.opencode/agent/final-reviewer.md`
- Modify: `.opencode/agent/researcher.md`
- Modify: `.opencode/agent/explorer.md`

**Interfaces:**
- Consumes: the skill created in Task 1.

- [ ] **Step 1: Update the six non-adversarial profiles**

In each of `implementer.md`, `task-reviewer.md`, `re-reviewer.md`, `final-reviewer.md`, `researcher.md`, `explorer.md`, replace the phrase `per the priority list in subagent.md §4` with `per the model-selection skill (.opencode/skills/model-selection/SKILL.md)`. Keep each profile's parenthetical tier note (e.g. "the highest-priority available model that fits this task", "matched to this diff's size, complexity, and risk", "cheap-to-mid tier for small fix diffs", "the most capable available model at that time").

For `adversarial-reviewer.md`, replace the phrase `per the priority list in subagent.md §4 (the most capable available model)` with `per the adversarial-reviewer model list in the model-selection skill (.opencode/skills/model-selection/SKILL.md)`. Also update the frontmatter `description` lines that say `per subagent.md §4` to say `per the model-selection skill`.

- [ ] **Step 2: Validate all profiles updated**

Run:
```powershell
Select-String -LiteralPath ".opencode\agent\*.md" -Pattern "subagent.md §4"
```
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add .opencode/agent/
git commit -m "docs(agent): point role profiles at model-selection skill"
```

---

### Task 6: Repo-wide validation

**Files:**
- None (read-only validation)

**Interfaces:**
- Validates all prior tasks.

- [ ] **Step 1: Confirm the fork is gone**

Run:
```powershell
Test-Path -LiteralPath ".opencode\skills\subagent-driven-development"
```
Expected: `False`.

- [ ] **Step 2: Confirm the skill exists**

Run:
```powershell
Test-Path -LiteralPath ".opencode\skills\model-selection\SKILL.md"
```
Expected: `True`.

- [ ] **Step 3: Grep for dangling references across the repo (exclude the superpowers cache and node_modules)**

Run:
```powershell
Get-ChildItem -Recurse -File -Include *.md,*.jsonc,*.json -Path . | Where-Object { $_.FullName -notmatch "node_modules|\.git\\|\.cache" } | Select-String -Pattern "subagent-driven-development/","subagent.md §4"
```
Expected: no matches (after the deletions and edits above).

- [ ] **Step 4: Report**

Summarize: which files changed, the commit range, and the validation results. No commit in this task.

---

### Task 7: Audit superpowers' skills for subagent-use optimization across opencode functions

**Files:**
- Research only (read-only). Produces a report file at `docs/superpowers/audits/subagent-optimization-audit.md`.
- Create (if empty): `docs/superpowers/audits/`

**Interfaces:**
- Consumes: the superpowers plugin skill tree under `C:\Users\MattS\.cache\opencode\packages\superpowers@git+https_\github.com\obra\superpowers.git\node_modules\superpowers\skills\`.

**Goal:** Concisely review how superpowers' skills dispatch and use subagents across opencode's functions, and report whether subagent use is maximally optimized — with concrete findings and any minimal, high-value recommendations. Do not modify the superpowers plugin.

- [ ] **Step 1: Inventory the skills that use subagents**

List the skills under the superpowers plugin `skills/` directory. Identify which ones dispatch subagents (via the `task` tool or a Subagent template) — e.g. `subagent-driven-development`, `executing-plans`, `requesting-code-review`, `receiving-code-review`, `brainstorming`, `dispatching-parallel-agents`. Note for each whether it uses fresh subagents, parallel dispatch, task review gates, and explicit model selection.

- [ ] **Step 2: Evaluate optimization across opencode functions**

For each subagent-using skill, assess concisely:
- Is a fresh subagent used per discrete unit of work (isolated context)?
- Is independent work dispatched in parallel, up to the concurrency rules in the model-selection skill?
- Is there a review gate after subagent work?
- Is model selection explicit per dispatch (not silently inherited)?
- Are subagents prevented from spawning their own sub-subagents?

- [ ] **Step 3: Write the concise audit report**

Write `docs/superpowers/audits/subagent-optimization-audit.md` with: a one-line summary verdict; a short table of each skill and its subagent-optimization status (Optimized / Gap); and a bulleted list of concrete gaps with minimal recommended fixes. Keep it under ~60 lines. Clearly separate "confirms already optimized" items from "recommended change" items.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/audits/subagent-optimization-audit.md
git commit -m "docs(audit): subagent-use optimization across superpowers skills"
```
