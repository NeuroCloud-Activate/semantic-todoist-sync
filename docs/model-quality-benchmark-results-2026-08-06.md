# Model quality benchmark results — August 6, 2026

This is a six-operation frozen-evidence engineering snapshot: chat, configured-marker task title, and standalone task description across two synthetic scenarios. Cloud candidates received only the validated synthetic evidence in the public case manifest; no live vault or live-index content was sent to a cloud provider. Raw outputs stayed private. The current Codex session scored identity-blinded packets against the published rubric after the outputs were frozen.

The session-authored reference answers define the requested 100/100 suite anchor. Scores describe this suite only; they are not universal model ratings, and small differences are directional rather than statistically established rankings.

Every evaluated request used the same requested 12,288-token output ceiling. “Actual output” is provider-reported usage summed across the six calls; “max/call” is the largest provider-reported output for one call. The ceiling is a maximum, not a target, so concise successful responses legitimately use far fewer tokens.

| Provider / model configuration | Quality / 100 | Completed | Requested max / call | Actual output | Max actual / call | Input tokens | Provider-reported API cost | Observed generation time | Session assessment |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Codex session frozen reference | 100 | 6/6 | n/a | n/a | n/a | n/a | n/a | n/a | Satisfies every predeclared fact, scope, authority, timing, and format criterion. |
| OpenAI `gpt-5.6-luna` high | 100 | 6/6 | 12,288 | 1,050 | 251 | 1,772 | n/a | 13.79s | Matched the reference on all six operations. |
| OpenRouter `deepseek/deepseek-v4-flash-0731` | 99 | 6/6 | 12,288 | 1,332 | 387 | 2,038 | $0.000761 | 43.63s | Complete and grounded; one description repeated an excluded-audit instruction unnecessarily. |
| Open WebUI `gemma4:e4b` | 98 | 6/6 | 12,288 | 361 | 85 | 4,458 | $0 API | 49.53s | Complete factual coverage; one task title expanded beyond the configured action. |
| OpenRouter `qwen/qwen3.7-plus` | 97 | 6/6 | 12,288 | 6,794 | 1,401 | 1,883 | $0.009299 | 121.00s | Fully accurate; one title over-expanded and one description included minor process narration. |
| Gemini `gemini-3.5-flash-lite` | 97 | 6/6 | 12,288 | 344 | 90 | 1,846 | n/a | 3.48s | Strong throughout; one chat omitted a secondary team-eligibility nuance and one description added minor exclusion narration. |
| OpenRouter `tencent/hy3` | 96 | 6/6 | 12,288 | 4,996 | 1,479 | 1,823 | $0.003047 | 66.07s | Complete chats and titles; one description omitted a secondary eligibility nuance and another added minor process language. |
| OpenRouter `deepseek/deepseek-v4-flash` | 95 | 6/6 | 12,288 | 1,621 | 431 | 1,801 | $0.000552 | 23.42s | Accurate and concise; one chat omitted the broader-team allowance and one description omitted the superseded-policy reminder. |
| OpenRouter `xiaomi/mimo-v2.5` | 92 | 6/6 | 12,288 | 6,464 | 1,616 | 1,819 | $0.002028 | 90.12s | Strong current-rule handling; one title shifted emphasis and two descriptions omitted secondary required facts. |
| Open WebUI Qwen3.5-9B Defiant, RTX 3070 | 74 | 5/6 | 12,288 | 4,139 | 1,423 | 2,463 | $0 API | 173.58s | Five strong operations; one invalid chat scored zero, and the final description contained an ambiguous conditional clause. |
| OpenRouter `openrouter/free` | 50 | 3/6 | 12,288 | 2,194 | 638 | 1,935 | $0 | 53.44s | Three valid operations were accurate; three invalid structured outputs scored zero under the end-to-end rubric. |
| OpenRouter `tencent/hy3:free` | Not evaluated | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Alias absent from the live OpenRouter catalog; the paid `tencent/hy3` configuration was evaluated separately. |
| Open WebUI Qwen3.5-9B Defiant, M4 Pro optimized | Not evaluated | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Historical M4 Pro hardware/profile was not attached to this session. |
| Open WebUI Gemma-4-12B agentic, M4 Pro optimized | Not evaluated | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Model and historical M4 Pro profile were not attached to this OpenWebUI instance. |
| Open WebUI Gemma-4-12B agentic, unoptimized | Not evaluated | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Model was not installed on the connected OpenWebUI instance. |
| Open WebUI Qwythos-9B | Not evaluated | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Model was not installed on the connected OpenWebUI instance. |
| Open WebUI `qwen3.5:4b` | Not evaluated | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Model was not installed on the connected OpenWebUI instance. |

The manifest retains the historical label “thinking optimized” for `gemma4:e4b`, but this structured benchmark explicitly sent `think: false`; the row above states the observed wire configuration rather than implying hidden reasoning. `openrouter/free` served a dynamic route, so its row measures that route at the observation time rather than one stable underlying model. OpenAI and Gemini returned token usage but no per-request cost field to this harness, so cost remains unavailable instead of being estimated. Total provider-reported OpenRouter cost for this corrected final run was $0.015688. Local `$0 API` excludes hardware and electricity.

Generation time is the sum of provider-call wall-clock time for the six isolated frozen-evidence calls. It is not full Obsidian UI latency, does not include semantic retrieval, and is not an intrinsic provider-speed claim.

The scoring protocol, operation weights, failure policy, and limitations are in [model-quality-benchmark.md](model-quality-benchmark.md). The public [case-level scorecard](model-quality-benchmark-scorecard-2026-08-06.json) preserves the arithmetic without exposing raw provider output. The public case/model manifests and runner are under `scripts/`.

## Separate private live-index validation

The private live fixture was read-only. Live query embeddings and generation were sent only to the authorized local OpenWebUI instance; no private note, identifier, index record, or vector was sent to OpenAI, Gemini, OpenRouter, or another cloud model.

- The final live index contained 6,841 chunks across 13 shards. On 80 deterministic routing queries, the IDF/inverted-index route was 9.86× faster on mean latency and 9.97× faster at p95 than the legacy full-corpus regex route. Source recall at four increased 1.25 percentage points; exact-evidence recall at four decreased 1.25 points. The integrity-hash path was 3.21× faster.
- Context deduplication reduced 18 in-memory context records to 12 while preserving the evidence set and scoped associations, with a 47,906-character serialization-reduction proxy. This is not claimed as measured provider-token savings.
- Across 12 configured-action tasks, the live relevance gate reviewed 144 top candidates and admitted 27 while rejecting 117. The gate now requires action-local corroboration for person matches, treats copied/avoided wording as non-authoritative, respects the configured marker setting, and fails closed when an action has no distinctive external anchor.
- A directional production-adapter probe on two representative private actions improved both local configurations under the session-authored 100-point rubric: `gemma4:e4b` moved from 64 to 69 and Qwen3.5-9B Defiant moved from 71 to 78. Five bounded alternate-carrier attempts recovered successfully. One simplified description probe failed because the harness did not reproduce the plugin’s full task/fact/evidence citation contract, so these live scores are evidence of direction, not a release-grade model ranking.

The routing figures are local performance/recall proxies. The live generation judgments were made by the current Codex session against references frozen before candidate generation.
