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

## Safe maximum parallelism

This project supersedes superpowers' native SDD instruction to serialize
implementation subagents when work has independently provable ownership. Split
work into modular units and dispatch the maximum feasible number concurrently,
subject to the 10-agent and per-model limits above. Same-file delegation is
allowed only when every subagent receives explicit non-overlapping line ranges or
symbols, the minimal required context and interfaces, a stated merge order, and
its verification scope. Serialize shared or overlapping regions and unresolved
interface dependencies.

The primary session remains the planner, architect, orchestrator, integrator of
subagent work, and final validator. It checks ownership before dispatch,
integrates all results, resolves conflicts, and validates the combined change;
subagents never coordinate or integrate their own work.

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
