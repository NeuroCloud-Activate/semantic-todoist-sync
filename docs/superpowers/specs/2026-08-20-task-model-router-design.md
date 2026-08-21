# Design: Enforced Task Model Router

Date: 2026-08-20
Status: Approved for planning

## Problem

OpenCode's current native `task` tool has no call-time model parameter. A
subagent whose role profile omits `model` therefore inherits its parent
session's model. The "Plugin latency and AI token optimization" session proved
this: its parent and every explorer, researcher, adversarial reviewer, and
final reviewer ran on `openai/gpt-5.6-sol` with the `medium` variant.

The project model-selection skill is currently documentation only. It cannot
prevent a Task call from silently inheriting the primary model.

Upstream issue #6651 and PR #11377 propose a `model_tier` Task parameter. A
newer PR #34947 offers direct per-dispatch model overrides and fallback models,
project must remain compatible with released OpenCode rather than depend on an
unmaintained OpenCode fork.

## Goal

Turn the project model-selection policy into an enforced, runtime OpenCode
Task router that prevents managed Superpowers subagents from inheriting the
primary session model.

## Architecture

### Local compatibility plugin

Create an auto-discovered local OpenCode plugin at
`.opencode/plugins/model-selection-router.ts`.

At startup, its `config` hook creates hidden, model-bound clones of every
managed project role (`implementer`, `task-reviewer`, `re-reviewer`,
`adversarial-reviewer`, `final-reviewer`, `researcher`, and `explorer`). Each
clone preserves the source role's prompt and permissions but has an explicit
model and variant.

The plugin then intercepts native `task` calls with `tool.execute.before`:

1. A `tool.definition` hook advertises a `model_tier` Task argument with
   `quick`, `standard`, `advanced`, and `adversarial` values.
2. A fresh managed Task call without `model_tier` fails before a child is
   created. It can never silently inherit the primary model.
3. The router resolves the requested tier to the next eligible candidate,
   replaces `subagent_type` with the matching hidden clone, and removes
   `model_tier` before native Task validation runs.
4. Resume calls (`task_id`) retain their existing child model and are not
   rerouted.
5. Generic built-in `general` and `explore` Task requests are normalized to
   the project `researcher` and `explorer` roles, respectively, before routing.
   Any other unregistered Task role fails closed with an actionable error.

OpenCode's native Task implementation continues to create child sessions,
apply task permissions, handle cancellation, and return results. The plugin
selects only the model-bound role alias; it does not replace Task itself.

### Machine-readable policy

Create `.opencode/skills/model-selection/router-policy.json` as the runtime
policy source. It stores provider IDs, exact model IDs, variants, tier order,
kept in sync by tests.

The exact approved candidate order is:

| Tier | Candidate order |
| --- | --- |
| `quick` | llama-unraid Gemma-4-26B-A4B -> Zen Nemotron 3.5 Lightning Free -> Zen DeepSeek V4 Flash Free -> OpenCode Go DeepSeek V4 Flash (`low`) -> OpenAI GPT 5.6 Luna (`high`) |
| `standard` | Zen Nemotron 3.5 Lightning Free -> Zen DeepSeek V4 Flash Free -> OpenCode Go DeepSeek V4 Flash (`low`) -> OpenAI GPT 5.6 Luna (`high`) |
| `advanced` | Zen Nemotron 3.5 Lightning Free -> Zen DeepSeek V4 Flash Free -> OpenCode Go DeepSeek V4 Flash (`low`) -> OpenAI GPT 5.6 Luna (`high`) |
| `adversarial` | Zen Nemotron 3.5 Lightning Free -> Zen DeepSeek V4 Flash Free -> OpenCode Go DeepSeek V4 Flash (`low`) -> OpenAI GPT 5.6 Luna (`high`); never local llama |

No unlisted model is automatically substituted. If every candidate in the
selected tier is unavailable, at capacity, disabled, or cooling down, the Task
fails clearly rather than inheriting the parent model.

### Availability, limits, and recovery

The router checks configured provider/model availability at startup and only
creates aliases for available candidates. It enforces:

- maximum 10 active routed child sessions;
- 1 concurrent local llama child;
- 1 concurrent instance per candidate whose model name includes `free`;
- up to 4 Luna children;
- 1 concurrent child for other candidates unless a later policy explicitly
  increases it.

Luna is disabled unless the policy's explicit `lunaEnabled` switch is true.
This is necessary because OpenCode cannot query the user's weekly OpenAI usage.

The plugin observes child message errors. On `429`, quota, rate-limit, free
model rejection, or provider-unavailable errors, it marks that candidate as
cooling down for the current OpenCode process. The failed child is not retried
same task then selects the next eligible candidate in the requested tier.

### Observability

The router appends selection metadata to Task results: requested role, normalized
role, tier, selected provider/model/variant, and fallback index. It also writes
structured router logs. This permits session audits to prove that a child used
the policy-selected model rather than the parent model.

## Superpowers coordination

Superpowers continues to call OpenCode's native `task` tool. Its generic model
selection logic chooses `quick`, `standard`, or `advanced`; the adversarial
review flow chooses `adversarial`. The router enforces and executes that choice.
The project guidance must be updated to say `model_tier` is mandatory for fresh
managed dispatches, not to tell the primary to change its own session model.

## Non-goals

- Do not patch OpenCode's installed binary or depend on either unmerged PR.
- Do not replace native Task session/permission/cancellation behavior.
- Do not automatically retry a potentially side-effecting failed child.
- Do not automatically route models outside the approved tier lists.
- Direct `@agent` invocation is not a native Task dispatch and remains outside
  this router's scope.

## Validation

1. Unit-test policy parsing, tier order, local-llama exclusion from adversarial,
   llama/Free/Luna capacity rules, cooldown skips, missing-tier rejection, generic
   role normalization, and resume preservation.
2. Validate the local plugin loads after an OpenCode restart and exposes
   `model_tier` in the native Task schema.
3. Run a read-only explorer dispatch on a parent using a different model; inspect
   the child session metadata/model and prove it used the policy-selected model.
4. Run a second dispatch with the same tier while its first candidate is at
   capacity or cooling down; prove it selects the next candidate.
5. Confirm no managed Task call without `model_tier` can create a child.
