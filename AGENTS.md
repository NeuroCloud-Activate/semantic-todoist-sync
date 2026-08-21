# Project rules

## Subagent-driven development (priority workflow)

- **Read `subagent.md` first.** It is the operator reference for the
  `subagent-driven-development` skill. Follow its model-selection rules (see the
  model-selection skill, `.opencode/skills/model-selection/SKILL.md`) and
  concurrency rules (§3) when dispatching any subagent.
- **Subagent operating rules live in `subagent-rules.md`.** It is injected into
  every agent through `opencode.json` `instructions` and is the complete
  subagent behavior contract. `AGENTS.md` covers how to call subagents
  correctly; it does not restate subagent behavior rules.
- **The primary chat session is the orchestrator, planner, architect, validator, and final
  integrator.** It owns dispatching, coordinating, validating, and integrating all
  subagent work. It breaks work apart into modular, independent units, dispatches
  subagents to implement them, validates all results, and performs final
  integration. Do all implementation and integration through dispatched
  subagents; never do an implementer's or reviewer's work inside the primary
  session — that pollutes context and skips review. **Generally the primary
  session does no coding on its own.**
- **Model selection has no fixed default.** Choose per task from the priority list
  in the model-selection skill (.opencode/skills/model-selection/SKILL.md), based
  on the capability, function, behaviour, and activities the subagent needs.
  Escalate for harder tasks; fall back down the list on rate-limit or
  availability errors.
- **Concurrency — global cap of 10 active subagents.** At most 10 subagents run in
  parallel at any time. Use the budget: break work apart aggressively into
  modular segments (including disjoint sections of the same file with explicit
  line ranges) and parallelize as much as possible. Both code development and
  code review are planned and dispatched as modularized, defined sections so the
  maximum number of sub-agents can work in parallel — this speeds development,
  improves efficiency, raises overall accuracy, and reduces bugs. Only one
  subagent instance of any single `provider:model` whose name contains the word
  "Free" may run at a time (present or future); different providers running
  "Free" models may run in parallel. The OpenAI GPT 5.6 Luna agent supports up to
  4 parallel instances.
- **Project override for Superpowers and OpenCode dispatch:** This rule applies to every Superpowers skill and every OpenCode/OpenChamber dispatch function. The native SDD guidance to serialize implementation subagents does not apply when this project has established independent ownership. The primary may delegate multiple implementations concurrently, including disjoint sections of the same file, only after defining non-overlapping line ranges or symbols, required interfaces and context, merge order, and verification scope. Serialize shared or overlapping regions and unresolved interface dependencies. The primary remains the planner, architect, orchestrator, integrator, and final validator; subagents never coordinate or integrate their own work.
- **The primary session optimizes for maximum subagent parallelism.** As
  orchestrator and planner, the primary session must structure every plan and
  dispatch to use the maximum feasible number of subagents, by modularizing and
  sectioning work into the largest number of independent units (including
  disjoint sections of the same file with explicit line ranges for both
  implementation and review). It does not delegate coordination or validation:
  the primary session remains the validator and final integrator, confirming that
  every subagent's work is correct and integrating it into the codebase.
- **Use the prompt templates to orchestrate dispatch effectively.** Spawnable
  sub-agent profiles in `.opencode/agent/` are **role-based** (`implementer`,
  `task-reviewer`, `re-reviewer`, `adversarial-reviewer`, `final-reviewer`,
  `researcher`, `explorer`) and omit a `model` field so they inherit the
  dispatcher's session model. Before dispatching a role, set your session model
  to the highest-priority available pick from the model-selection skill.
  - **`implementer-prompt.md`** → `implementer` role — dispatch for task
    implementation: read brief first, TDD, self-review, report status
    `DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT`, never dispatch sub-subagents.
  - **`task-reviewer-prompt.md`** → `task-reviewer` role — per-task spec
    compliance + code quality review: verdict `ADDRESSED|NOT ADDRESSED|s?,?`,
    Critical/Important/Minor calibration, do not re-run suites.
  - **`re-review-prompt.md`** → `re-reviewer` role — scoped fix verification after
    round R: per-finding verdicts `ADDRESSED|NOT ADDRESSED`, new breakage
    detection, root-cause vs symptom assessment, adversarial tags
    `FALSE_ASSUMPTION|EDGE_CASE|DEPENDENCY_RISK|NONE`.
  - **`adversarial-agent-review.md`** → `adversarial-reviewer` role — run before
    dispatch to challenge the plan's assumptions, edge cases, dependency probes,
    concurrency/rate-limit correctness, prompt-shape risks, information-flow
    violations, and cascading failure modes. Record open assumptions, high-risk
    chains, suggested rewrites, and a go/no-go recommendation in the plan's
    ledger. Dispatch it on the most capable available model per the model-selection
    skill.
- **Never use opencode's built-in agents as the default sub-agent.** The built-in
  `general` and `explore` agent types inherit the session default model and bypass
  the priority list. Prefer the role profiles (`researcher`, `explorer`). The
  built-in types are documented in the model-selection skill as the two
  lowest-priority fallbacks (priorities 7–8) and must only be used when
  priorities 1–6 are exhausted or rate-limited.
- **Task brief + report contract:** before dispatching an implementer, run
  `scripts/task-brief PLAN_FILE TASK_NUMBER` to extract the task's full text into
  a uniquely named brief file. Name the report file after the brief
  (`task-N-report.md`); the implementer writes full status + commits + one-line
  test summary + concerns to that file. Never dispatch multiple implementation
  subagents in parallel when their edits would conflict (same file/region).
- **Dispatch instructions must be clear, detailed, and self-contained.** Before
  dispatching any subagent, the primary session must give the subagent
  instructions that fully explain its task: the goal, acceptance criteria, scope
  and ownership boundaries (files, line ranges, symbols), relevant invariants
  and constraints, known pitfalls, and how the subagent should verify its work.
  The dispatch must be unambiguous and sufficient on its own — the subagent must
  be able to understand the task completely from its brief alone, without
  inferring missing context or broadening its search. If the primary cannot yet
  write a clear, complete brief for a task, the task must be refined or broken
  down further before dispatch rather than sent out partially specified.
- **Review after each task:** run `scripts/review-package PLAN_FILE BASE HEAD`
  to generate the review package, then dispatch the task reviewer per
  `task-reviewer-prompt.md`. Treat the reviewer's verdict as a gate: if any
  finding is `NOT ADDRESSED` or `s?,?`, enter the fix loop before marking
  the task complete.

## Provider rate limits

- OpenRouter applies a daily cap of **1,000 requests per day** for any model with
  the word "Free" in its model name. Treat `429`, quota, or "free model" errors as
  a fallback signal: record it, then select the next model in priority order from
  the model-selection skill. Do not repeatedly retry a rate-limited model. Spread
  parallel free work across different providers to keep each bucket under its own
  cap.
- OpenAI GPT 5.6 Luna is only used when the OpenAI weekly usage is **below 100%**;
  at or above 100% the account is at its hard limit and no OpenAI model can be
  used — skip it in the priority list. Determine usage from the user-reported
  OpenAI/Codex usage indicator (the session cannot query the weekly usage
  percentage programmatically).

## Product requirements — source of truth

- **`requirements.md` is the primary resource for this plugin's functional
  requirements.** It is the authoritative product contract: it defines how the
  plugin should work and operate, the scope and invariants of each feature, and
  the goal of each function's output (behavior, acceptance criteria, and intended
  results). Before implementing, changing, or validating plugin behavior, read the
  relevant `requirements.md` section and follow it as the contract.
- When `requirements.md` and the implemented behavior disagree, follow its
  `Source of truth` process: describe the intended change explicitly, then update
  the implementation, this contract, and public documentation as separate,
  reviewable work.
- This file remains an operating-instructions file only. It must not duplicate
  `requirements.md` or become a second product-requirements document.

## Publishing requirements — source of truth

- **`publishing.md` is the checklist for meeting Obsidian's plugin publishing
  rules.** It is derived from the official Obsidian developer documentation and
  covers the repository structure (`README.md`, `LICENSE`, `manifest.json`),
  the manifest schema and constraints, semantic-versioning and GitHub release
  asset requirements (`main.js`, `manifest.json`, `styles.css`), and the
  Community directory submission and review-feedback process. Before publishing
  the plugin, read `publishing.md` and confirm every requirement is met.

## Live Obsidian testing vault

- The **`Testing/Canadian Blood Services`** Obsidian vault is the required live-validation
  vault for this project. Before any validation that uses Obsidian or the semantic
  index, it **must** reflect the current development version from the repository root.
- Synchronize the development plugin into
  `Testing/Canadian Blood Services/.obsidian/plugins/semantic-todoist-sync/` before
  validation. At minimum, synchronize `main.js`, `manifest.json`, and `styles.css`,
  and register the plugin in
  `Testing/Canadian Blood Services/.obsidian/community-plugins.json`.
- Verify that the repository and testing-vault manifest versions match and that the
  SHA-256 hashes of the synchronized plugin files match before relying on
  live-validation results.
- Reload Obsidian after synchronization and confirm that
  `Testing/Canadian Blood Services` is the active vault. Never report live Obsidian
  or semantic-index results from a stale testing-vault copy.
- Keep `Testing/` (including `Testing/Canadian Blood Services`) private and ignored by
  Git. Do not commit vault state, semantic-index data, credentials, or generated
  testing artifacts.

## Local coding-agent task sizing

- Treat the local coding agent's controller limit of `max_context_bytes=32000` as a hard per-request budget. This is a byte budget for delegated tool context, not the model's 32K-token context-window claim.
- Never delegate an entire large source file. For files larger than 32 KB, the primary session must first use targeted search and line-range inspection, then delegate only the smallest relevant file set and snippets needed for the bounded task.
- If a delegated request is rejected for `file exceeds max_patch_bytes` or `cumulative context exceeds max_context_bytes`, record the coverage gap and retry with narrower slices or use the configured native fallback. Do not raise the controller limit merely to fit a large file.

## Large-file delegation workflow

- Treat `max_context_bytes=32000` as a hard boundary, not a target to work around by repeated retries.
- For any source file near or above that size, the primary session must inspect the codebase directly first with targeted search and line-range reads. Do not ask a subagent to discover the relevant region by searching the entire file.
- Prefer delegating an already-isolated modular subset, helper, or symbol plus its minimal dependencies when that preserves scope and behavior.
- Otherwise, the primary must send a detailed context packet containing the exact goal, allowlisted files, line ranges, compact snippets, relevant invariants, constraints, observed failure, acceptance criteria, and targeted checks.
- Subagent-side behavior when a file/search budget is exceeded (stop, request narrower context, never invent or broaden) is in `subagent-rules.md`.
- The primary session owns integration into the original file and independently validates changed-file scope, patch correctness, syntax, and external test evidence after delegation.
- Do not raise the controller limit merely to fit a large file.

## Memory tools (via @alkdev/open-memory plugin)

You have access to two tools for managing your context and accessing session
history. These are useful to both the primary session and sub-agents.

### memory({tool: "...", args: {...}})

Read-only tool for introspecting your session history and context state.
Available operations:
- `memory({tool: "help"})` — full reference with examples
- `memory({tool: "summary"})` — quick counts of projects, sessions, messages, todos
- `memory({tool: "sessions"})` — list recent sessions (useful for finding past work)
- `memory({tool: "messages", args: {sessionId: "..."}})` — read a session's conversation
- `memory({tool: "search", args: {query: "..."}})` — search across all conversations
- `memory({tool: "compactions", args: {sessionId: "..."}})` — view compaction checkpoints
- `memory({tool: "context"})` — check your current context window usage

This is the introspection layer behind the SDD ledger-based recovery principle:
you can confirm past session work, search prior conversations, and read
compaction checkpoints rather than relying on memory alone.

### memory_compact()

Trigger compaction on the current session. This summarizes the conversation so
far to free context space.

**When to use memory_compact:**
- When context is above 80% (check with `memory({tool: "context"})`)
- When you notice you're losing track of earlier conversation details
- At natural breakpoints in multi-step tasks (after completing a subtask, before
  starting a new one)
- When the system prompt shows a yellow/red/critical context warning
- Proactively, rather than waiting for automatic compaction at 92%

**When NOT to use memory_compact:**
- When context is below 50% (it wastes a compaction cycle)
- In the middle of a complex edit that you need immediate context for
- When the task is nearly complete (just finish the task instead)

Compaction preserves your most important context in a structured summary — you
will continue the session with the summary as your starting point. Before
compacting, ensure the SDD ledger (`.superpowers/sdd/<plan>/progress.md`) is
current, since the ledger is the durable record that survives compaction.
