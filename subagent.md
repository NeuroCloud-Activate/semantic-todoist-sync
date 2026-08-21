# Subagent-Driven Development — Operator Reference

This document is the working reference for the `subagent-driven-development` skill.
It defines how the primary chat session dispatches, coordinates, and integrates the
work of subagents, and — critically — **how to choose which model to dispatch for
each delegated task**. Read it before dispatching any subagent.

The skill is superpowers' `subagent-driven-development` skill (provided by the
superpowers plugin); its prompt templates and supporting scripts live in the
plugin's skill directory. Supporting scripts:

- `scripts/sdd-workspace PLAN_FILE` — resolve/create this plan's scratch directory.
- `scripts/task-brief PLAN_FILE N` — extract Task N's full text into a brief file.
- `scripts/review-package PLAN_FILE BASE HEAD` — write a review diff package to a file.

---

## 1. Roles

- **Primary session (you): orchestrator, planner, validator, and final integrator.**
  You break work apart, dispatch, coordinate, and validate. You never implement or
  fix in your own session — that pollutes your context and skips review. Your
  context stays clean for coordination. You remain the validator of all subagent
  output and the final integrator who makes sure everything is put together
  correctly. All implementation and integration is done through dispatched
  subagents; you never do their work for them.
- **Implementer subagent:** one per task (or per file/section, see §3), fresh
  context, builds exactly what the brief says, tests, commits, self-reviews.
- **Task reviewer:** fresh context, reviews one task's diff for spec compliance AND
  code quality. Never skip this gate.
- **Adversarial reviewer:** fresh context, runs `adversarial-agent-review.md`
  before dispatch to challenge the plan's assumptions and delegation instructions.
- **Final code reviewer:** one whole-branch review after all tasks, on the most
  capable model.

**Spawnable profiles are role-based, not model-based.** The profiles in
`.opencode/agent/` (`implementer`, `task-reviewer`, `re-reviewer`,
`adversarial-reviewer`, `final-reviewer`, `researcher`, `explorer`) define the
ROLE each subagent plays; they deliberately omit a `model` field. Because opencode
subagents without a `model` field inherit the model of the primary agent that
invoked them, the dispatcher assigns the model dynamically: before dispatching a
role, the primary session selects the highest-priority available model from the model-selection skill and
sets its session model to that pick — the role subagent then runs on it. This
keeps model selection in one place (the model-selection skill's priority list) and makes every
spawnable profile dynamic.

## 2. The per-task loop

1. Record BASE (`git rev-parse HEAD`) before dispatching.
2. Generate the task brief, dispatch one implementer with the brief + report paths.
3. Handle its report (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED).
4. Generate the review package, dispatch the task reviewer with brief + report + diff.
5. Fix loop (max 5 rounds): rounds 1–3 resume the implementer; rounds 4–5 fresh
   implementer on a more capable model. Every round ends in a scoped re-review.
6. Park or fix per the breaker, then mark complete in the ledger.

**Dispatch quality gate.** The primary session must give every subagent clear,
detailed instructions that fully explain its task: goal, acceptance criteria,
scope and ownership boundaries (files, line ranges, symbols), invariants and
constraints, known pitfalls, and how to verify the work. A subagent must
understand its task completely from the dispatch alone — never from inferred
context or a widened search. If a dispatch cannot be written clearly and
completely, refine or split the task before sending it out.

## 3. Concurrency and parallelization

**Global limit: up to 10 subagents may be actively running in parallel at any
time.** Use that budget. Break work apart into modular, independent segments so as
many subagents as possible run concurrently.

- **The primary session optimizes for maximum subagent parallelism.** As
  orchestrator and planner, it structures every plan and dispatch to use the
  maximum feasible number of subagents by modularizing and sectioning work into
  the largest number of independent units (including disjoint sections of the
  same file with explicit line ranges for both implementation and review). It
  does not delegate coordination or validation: the primary session remains the
  validator and final integrator, confirming that every subagent's work is
  correct and integrating it into the codebase.

- **Break work apart aggressively.** A plan should be decomposed into the largest
  number of independent units of work. Prefer small, focused subagent tasks over
  one large serial chain — each can run on its own model in parallel.
- **Same-file work is allowed.** Multiple subagents may work on the same file when
  they touch different sections. Give each subagent the specific line ranges or
  function/symbol names it owns, keep changes modular and well-isolated, and state
  the ownership boundaries explicitly in the dispatch. The primary session is
  responsible for detecting overlapping edits before dispatch and for integrating
  the results. All code should be written in modular segments.
- Implementers **may** run in parallel with each other **only when** their edits
  are independent (different files, or clearly disjoint sections of the same file
  with explicit line ranges). When in doubt about a conflict, serialize rather
  than corrupt.
- Reviewers may run in parallel with each other and with implementers, subject to
  the 10-subagent global cap. Reviews are also planned as modularized, defined
  sections (per task, per file region, per concern area) so as many reviewer
  sub-agents as possible run concurrently — maximizing throughput, accuracy, and
  bug reduction across both development and review.
- **Free-model gate (see §6):** only one subagent instance of any single
  `provider:model` whose name contains the word "Free" may run at any one time,
  present or future. Different providers running a "Free" model CAN run in
  parallel because they are separate rate-limit buckets.
- **Luna concurrency:** the OpenAI GPT 5.6 Luna agent supports **up to 4 parallel
  instances** (model-selection skill, priority 5). Other agents default to 1 instance unless noted.
- Do not exceed 10 active subagents total. If work is waiting on the cap, dispatch
  the highest-priority work first.

---

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

## 7. Ledger

Every decision you make on the user's behalf is recorded in the plan workspace
ledger (`<repo-root>/.superpowers/sdd/<plan>/progress.md`) as a `Ruling:` line:
preflight rulings, parked findings, and breaker adjudications. At the end, surface
every ruling in your final message under **"Rulings I made"** with what it costs if
wrong. A ruling that dies with the workspace is a decision made in secret.