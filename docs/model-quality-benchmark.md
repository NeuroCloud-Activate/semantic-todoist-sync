# Model quality benchmark protocol

The current benchmark exercises the production plugin against two frozen notes
from the user-designated raw live vault and the vault's current production
semantic index. Each model processes each note once at the same user-visible
boundary as normal plugin use: one query-specific chat operation, one complete
configured-marker-scoped task-generation operation, and one ordered complete
task-description operation. The currently designated notes contain six and
eight configured action scopes respectively. Task descriptions run after task generation and reuse the immutable
note-level semantic prefix with task-local suffixes. Chat builds a separate
query-specific semantic context.

The live inputs, settings, note-case inventory, source tree, and semantic index
are cryptographically frozen before generation and revalidated after the run.
Synthetic fixtures may test parser and workflow mechanics, but they do not
substitute for this performance or quality evidence.

Every generative request uses the same requested 12,288-token output ceiling.
Each logical generation lineage permits the initial provider request and at
most one additional request shared across provider recovery, schema repair, and
workflow retry. Embeddings, discovery, polling, cache administration, parsing,
and deterministic normalization do not consume that generation budget.

The comparison table reports provider-returned generation input and output
tokens across physical dispatches. A `≥` total is a lower bound when a failed
or retried dispatch returned no usage metadata, and `n/a` means the adapter
returned no usable total. OpenRouter API cost is a catalog-rate estimate from
the 2026-08-09 pricing snapshot, applying the reported cache-read token rate
where available; it is not a billing-statement charge. Local OpenWebUI rows
have no external API cost, but their `$0` excludes hardware and electricity.

## Score out of 100

The judging Codex session has the full frozen notes and semantic evidence and
defines the requested 100/100 reference. Candidate identities and workflow
diagnostics are hidden until its judgments are sealed. The score evaluates only
the final rendered AI-model output; retrieval and transport diagnostics carry
no quality points.

Each row is normalized to 100 from these criteria:

| Operation | Raw maximum | Criteria |
|---|---:|---|
| Chat answer | 20 | Intent fidelity 4; factual accuracy 5; relevance 3; completeness/actionability 5; clarity/usability 3. |
| Task plan | 15 | Intent fidelity 3; factual accuracy 3; relevance 2; completeness/actionability 4; clarity/usability 3. |
| Task descriptions | 20 | Intent fidelity 4; factual accuracy 5; relevance 3; completeness/actionability 5; clarity/usability 3. |

The benchmark normalizes each operation type across its eligible note rows and
then gives Chat, Task plan, and Descriptions equal macro weight. A terminal
model-output validation failure remains eligible and scores zero.
Provider/adapter or plugin/workflow infrastructure failures are reported but
excluded from the model-quality denominator. If every row for an operation is
infrastructure-excluded, that operation is reported as `n/a` and receives no
imputed score. No score is imputed for a configuration that fails its
production compatibility gate.

Substantive irrelevance in rendered prose is scored under intent fidelity and
relevance and may materially lower the final-output score. Safely repairable
structure, carrier, schema, or deterministic-normalization mechanics are
reported separately and do not by themselves add or remove quality points. If
a second model output still cannot produce an admissible final output, the
terminal model-output failure remains an eligible zero; provider, adapter, and
plugin infrastructure failures remain excluded from the denominator.

Semantic context is not a fact-reproduction checklist. A response is not failed
merely because it omits a supplied fact. The judge assesses whether the output
faithfully expresses the task or query, remains accurate and relevant, and
contains enough supported information to act. Hard plugin gates are limited to
structure, exact scope identity, allowed-reference membership, and truthful
bindings for claims the output actually makes.

## Run, privacy, and reporting controls

- The raw notes and index may be transmitted only to providers explicitly
  authorized for the private live test. Raw prompts, outputs, note names,
  paths, identifiers, vectors, settings, and credentials remain private.
- Public artifacts contain only reviewed aggregate counts, scores, provider and
  model identities, timings, and sanitized failure categories.
- Provider-native compatibility gates traverse the production adapter, carrier,
  parser, validator, and renderer. Gates are unscored and do not become
  benchmark rows.
- The fixed-input benchmark uses one pass per note and model. It does not repeat
  generations to select a best result or estimate variance.
- Serial versus concurrent execution is not a quality factor. Lane wall time is
  the complete observed plugin lane duration, not a universal provider-speed
  claim; provider routing and backend load may vary independently of order.
- The production semantic index must be ready and clean. Degraded retrieval,
  stale input bindings, substituted cases, or full-index fallback scans are
  reported and may invalidate the run.
- A post-run code correction never retroactively changes the sealed score of
  the code that was actually benchmarked.

## Current comparison

The current comparison contains nine identity-blinded configurations, two
frozen live notes, and 54 actual plugin operation rows. Forty-five final outputs
rendered, three terminal model-output rows remained eligible and scored zero,
and six infrastructure rows were excluded. OpenRouter Luna, DeepSeek, and
Tencent used high reasoning; the other tested profiles used their supported
default. All judgments were sealed before provider/model identities were
unblinded.

The sanitized aggregate result is
`docs/model-quality-benchmark-scorecard-2026-08-09.json`. The 2026-08-06
scorecard is a superseded synthetic-fixture snapshot and is retained only for
historical comparison.
