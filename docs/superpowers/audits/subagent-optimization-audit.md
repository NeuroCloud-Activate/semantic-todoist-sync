# Subagent-Use Optimization Audit (superpowers skills)

**Verdict:** Project guidance now optimizes subagent use for safe maximum parallelism: fresh isolated subagents, review gates, explicit model selection, and a project-wide override permit concurrent work with provably independent ownership. The native superpowers SDD file remains serial by default, but higher-priority project guidance governs every Superpowers skill and every OpenCode/OpenChamber dispatch function.

| Skill | Fresh subagent | Parallel | Review gate | Explicit model | No sub-subagents |
|---|---|---|---|---|---|
| subagent-driven-development | Yes | Yes (project override) | Yes (task+final) | Yes | Yes |
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
- **Project-wide safe-parallelism override** now permits concurrent implementation, including disjoint same-file sections, only with explicit ownership, context, merge order, and validation scope. The primary retains planning, architecture, orchestration, integration, and final validation.

## Recommended changes (concrete gaps)
- **Native SDD serial default:** the external plugin retains it, but project guidance now overrides it safely across every Superpowers/OpenCode/OpenChamber dispatch path. No plugin-cache edit is needed; keep the project rule current if superpowers changes its wording.
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

**Overall:** Project-level subagent use is optimized for maximum safe parallelism; remaining upstream template gaps are governed by the project-wide dispatch rule rather than an unmaintainable plugin-cache fork.
