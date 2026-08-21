# Subagent-Use Optimization Audit (superpowers skills)

**Verdict:** Subagent use is largely well-optimized — fresh isolated subagents,
review gates, explicit model selection, and the no-sub-subagents contract are
strong in the core workflow — but parallel-dispatch discipline and the
supporting (non-SDD) skills lag the project's 10-subagent max-parallelism goal.

| Skill | Fresh subagent | Parallel | Review gate | Explicit model | No sub-subagents |
|---|---|---|---|---|---|
| subagent-driven-development | Yes | Gap (sequential impl) | Yes (task+final) | Yes | Yes |
| dispatching-parallel-agents | Yes | Yes | Gap | Gap | Gap |
| executing-plans | N/A (defers to SDD) | N/A | N/A | N/A | N/A |
| requesting-code-review | Yes | N/A (single) | Yes (reviewer) | Gap | Gap |
| receiving-code-review | N/A (no dispatch) | N/A | N/A | N/A | N/A |
| brainstorming / writing-plans | Partial (reviewer prompt only) | N/A | Partial | Gap | Gap |

## Already optimized (confirmed)
- **subagent-driven-development** is the model: a fresh implementer subagent per
  discrete task with isolated, hand-built context; per-task spec+quality review
  gate, scoped re-reviews, and a final whole-branch review; an explicit Model
  Selection section ("always specify the model explicitly"); and a hard
  no-subagents contract in the implementer template. Batching same-shape work
  into one dispatch correctly reduces context churn.
- **executing-plans** correctly defers to SDD when subagents are available — no
  redundant subagent machinery of its own.
- **dispatching-parallel-agents** implements true parallel dispatch (multiple
  dispatches in one response) with focused, self-contained prompts.

## Recommended changes (concrete gaps)
- **SDD forbids parallel implementation** ("never dispatch multiple
  implementation subagents in parallel"). This under-uses the 10-agent cap and
  conflicts with AGENTS.md's max-parallelism rule. Minimal fix: allow parallel
  implementers only on provably disjoint file ranges with explicit line-range
  ownership per dispatch (mirroring the AGENTS.md guidance), while keeping
  single-dispatch for shared regions.
- **dispatching-parallel-agents** lacks explicit model selection, a formal
  review gate, and a no-sub-subagents clause. Minimal fix: add a model-selection
  pointer and a "you do not dispatch subagents" line to its dispatch prompts, and
  route results through a reviewer gate.
- **requesting-code-review / writing-plans / brainstorming reviewer templates**
  use `general-purpose` and omit model selection and the no-sub-subagents
  contract. Minimal fix: align them with the SDD role templates (reference the
  project model-selection skill; add the no-subagents clause).
- **10-subagent cap / per-model free limits** live only in AGENTS.md and the
  project's model-selection skill, not the plugin skills. Minimal fix: leave the
  cap project-owned (already correct) — no plugin change needed.

**Overall:** Core workflow optimized; recommended fixes are small, additive
edits to the parallel-dispatch and reviewer templates, not a redesign.
