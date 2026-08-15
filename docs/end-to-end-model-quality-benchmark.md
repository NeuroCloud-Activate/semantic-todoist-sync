# Final-output quality benchmark with workflow diagnosis

This protocol scores only the final rendered AI output produced for chat, task-plan, and task-description operations. It also records the complete semantic workflow so this Codex session can diagnose why an output lost quality, but retrieval and workflow-stage measurements never contribute quality points.

## Reference anchor

The 100/100 anchor is this exact GPT-5.6 Sol High Codex session. Before candidate output inspection, the session reads the complete authorized raw test vault and live semantic index and freezes, for every case, the task or query intent, required and prohibited evidence, material conditions, an ideal chat response, an executable task plan, and a complete task description.

The reference performs the same chat, task-plan, and task-description tasks and is the sole semantic judge. Its ideal final outputs define 100/100. Candidate prompts never receive the frozen ideal answer or judge annotations.

## Output-only quality score

Every final output is scored holistically by this Codex reference session on five output-only dimensions: intent fidelity, factual accuracy, relevance, completeness/actionability, and clarity/usability. Evidence is available to the judge to verify those semantic qualities; evidence-unit counts, citation membership, provider schema mechanics, and deterministic normalization are not scored dimensions.

Each case-operation subcriterion sum is normalized to 0–100 using that operation's maximum. The model score is the macro-average of the chat, task-plan, and task-description means. Because the frozen suite has the same number of cases per operation, this is also the mean of all 36 normalized production output scores.

Retrieval recall, retrieval precision, index size, evidence or fact counts, citation/schema integrity, latency, tokens, cost, provider behavior, schema retries, deterministic normalization, and the oracle condition contribute zero points. Omitting supplied context is not by itself a schema or gate failure; the reference session decides whether an omission makes the final prose less accurate, relevant, complete, actionable, or usable. Rendered prose is scored semantically even when a safely repairable structural or schema mechanic is normalized by the plugin. A terminal model-output failure is an eligible zero; a provider/adapter or plugin/workflow infrastructure failure is excluded from the model-quality denominator. Substantively irrelevant prose loses intent-fidelity and relevance points.

Only 100/100 is labeled **fully meets the final-output requirement**. A material factual error, invented commitment, wrong actor/object, omitted action-critical condition, authority reversal, or unsupported status strengthening prevents the perfect label regardless of averages. Mechanical citation and schema checks do not add or remove semantic-quality points.

## Workflow diagnosis

The private diagnostic trace follows query/task-intent interpretation, semantic evidence identification, live-index retrieval and ranking, authority/currentness/condition resolution, context selection and projection, provider generation, schema validation, final rendering, and this session's final-output judgment.

For every required, supporting, or prohibited evidence unit, the trace distinguishes:

- retrieved and delivered to the provider;
- selected or used by the model;
- cited or attributed in the final output.

When a final output scores below 100, this session assigns a non-scoring cause: `retrieval-or-index`, `context-selection-or-projection`, `generation-reasoning-or-writing`, `schema-or-render`, `mixed`, or `indeterminate`. A separate flag records whether relevant delivered evidence was discarded before the final output. `none` is used only when there is no output-quality deficit.

## Linked production and oracle conditions

The production condition supplies the real production-selected evidence and produces the only public model quality score. The oracle-evidence condition supplies the same provider with the complete frozen required evidence closure and is a counterfactual diagnostic only.

If oracle output quality materially improves, the trace is examined for retrieval or projection loss. If required evidence was delivered but omitted or contradicted, the deficit is attributed to model use/reasoning or later validation/rendering as supported by the trace. If both conditions retain the same deficit, it is not described as a retrieval improvement opportunity without additional evidence.

## Retrieval policy and A/B control

OpenWebUI supplies the authorized live semantic-query embedding for every provider configuration. When that embedding succeeds, it is the sole semantic ranking handle for the user's query. Indexed structured/document handles remain a local fallback for cases where the live embedding is unavailable or intentionally disabled; they are not mixed into max-over-handle ranking because a document vector's near-self-match can crowd query-relevant evidence out of the context window.

The retrieval A/B is reported separately from model quality. It measures required and relevant evidence coverage, prohibited evidence, selected count, and routing work. It never adds quality points.

## Private immutable run binding

Every scored run is private, non-publishable, and hash-bound to the operator-designated GPT-5.6 Sol High session, authorization record, complete raw Markdown vault snapshot, live semantic-index manifest and shards, frozen cases, settings and retrieval policy, evidence ledger, stage artifacts, rubric, raw operation outputs, and blind judge bundles. A full-context-review attestation binds the exact production and oracle bundles inspected by this session.

Candidate-derived proofs record workflow stages 1–7. Stage 8 is derived from the session-authored judge ledger. These proofs validate provenance and support causal diagnosis; they are not quality-score components.

## Fairness, judging, and privacy controls

- Every candidate uses the same raw-vault cases, OpenWebUI embedding index, production evidence policy, operation schemas, and requested 12,288-token output ceiling.
- Candidate identity, provider, latency, cost, and prior scores are hidden during semantic judging.
- This session judges intent fidelity, factual accuracy, relevance, completeness/actionability, and clarity/usability with access to the complete raw vault, index, frozen evidence, and candidate output. Citation and schema integrity remain separate mechanical diagnostics.
- Provider self-scores, provider-as-judge calls, automated semantic grades, and partial-context substitute judges are prohibited. Code validates only hashes, schemas, memberships, arithmetic, and gates.
- For the authorized private benchmark, local and cloud candidates receive the raw vault evidence needed for their cases. No sanitized structural twin or synthetic substitute is used for live validation.
- Privacy transformation applies only to publication. Credentials, raw vault material, personal data, evidence IDs, paths, embeddings, and raw model outputs remain private. Only screened aggregate scores, anonymous diagnostic categories, and non-sensitive methodology may enter the public share.
