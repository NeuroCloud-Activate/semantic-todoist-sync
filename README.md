# Semantic Todoist Sync

Turn Obsidian notes into Todoist tasks, chat with your vault, and plan your day. Local-first, and you pick the AI service for each job.

## What's new in 0.9.14

- New: **Prompt caching for Claude models** (on by default) lets Anthropic cache the repeated part of each task description request, so the later requests of a note are cheaper and faster. Other models are not affected, and an endpoint that rejects it is handled with one retry and a sidebar note.
- Fixed a repeating warning in settings ('An unreadable or unclaimed semantic-index file is present...') that appeared after updating to 0.9.13. The plugin now recognises both files of each index shard, keeps your active index from ever being offered for deletion, and shows the notice at most once per session.

## What's new in 0.9.13

- Smaller requests: the per-note series and superseded labels are gone (about 15 percent less input, and they did not improve answers in our tests), and descriptions explain each task in the model's own words.
- Better related-note matching: notes are embedded with their title, date and heading path. The first start after updating queues one background re-embed of your index; local embedding models are free, paid ones are charged once.
- Smoother on big vaults: the index opens and rebuilds in small slices, uses less memory, and the settings file only changes when you change a setting.
- Optional **System One decision model**: point it at a server you run, and the plugin orders the evidence it sends to the AI. An optional **Max efficiency** switch sends fewer notes in full. Both are off by default and send task text and short excerpts only to your server.
- New switches: **Require model due dates** (on) and **Semantic search mode** (Exact by default, Routed for very large vaults).
- Reasoning levels follow your endpoint, and Haiku 5.5 defaults to medium.

## Install

- Install from [Obsidian Community Plugins](https://obsidian.md/plugins?id=semantic-todoist-sync), or grab the [latest release](https://github.com/NeuroCloud-Activate/semantic-todoist-sync/releases/latest) for a manual install.
- Needs Obsidian 1.5.0 or later. Works on desktop, iPhone, and iPad.

## What it does

- Ask questions about your notes and jump to the source. Internet Search and Deep Research are optional and off by default.
- Turn a note, a selection, an email, or a saved prompt into tasks, subtasks, and descriptions.
- Keep note tasks and Todoist in sync, and optionally link repeats to the same Todoist task instead of duplicating.
- Preview "Schedule Today's Tasks", tweak the plan, then apply or undo it.

## Providers and models

- Pick OpenAI, Google Gemini, OpenRouter, self-hosted Open WebUI with Ollama, or a Custom OpenAI-compatible service. Embeddings are chosen separately per provider.
- Under **AI Providers** add connections; under **AI Models** pick primary, fallback, and embedding models, with a separate button to check the embedding choice. The shipped embedding default is Custom OpenAI-compatible `qwen3-embedding-0.6b-8k:latest`.
- **Reasoning, made simple.** Thinking models can spend minutes "reasoning" before they answer. Before 0.9.1 the reasoning setting only reached a few model families, so on OpenRouter, gateways, Open WebUI, and custom endpoints it was quietly ignored. Now the plugin finds out what each model supports (from the endpoint's model list and from the model's own replies, no extra requests) and shows the right choices. The default is **Automatic**: it uses the model's recommended level, which today means Low for DeepSeek V4.1 Flash and nothing special for every other model. Pick Low, Medium, High, or Provider default yourself any time, and your choice always wins. If an endpoint turns down a reasoning setting, the plugin finishes your task without it, switches that model's row to Provider default with a short note, and leaves it there until you choose again. **Check model capabilities** in AI Models runs a quick one-time test.
- **System One decision model (optional).** Under the System One settings, enter the address of a server you run, press **Check connection**, and the plugin tests it and calibrates it on your own notes with live steps in the status bar. While it is on, each task's evidence is ordered by relevance before the AI sees it. **Max efficiency** goes further and sends the top 8 passages in full plus one-line pointers for the next 16. Neither switch is on by default, and a failed or slow server simply falls back to the normal order.
- Custom OpenAI-compatible uses one API root you type in full (including `/v1` when your service needs it), an optional display title, and an optional hidden key. "Allow insecure HTTP" stays off unless you knowingly use plain HTTP. Strict jobs need the server to support `response_format.json_schema` or they stop safely. Custom supports discovery, chat, and embeddings, but not web search, the Responses API, streaming, tools, auto-downloading models, multiple endpoints, or provider-specific extras.

## How it works across models

We took one real, messy meeting note from a real vault and had each model turn it into 10 tasks with descriptions and source citations, using the plugin's normal workflow. Two independent AI reviewers scored the results blind against the note, then a final review settled the ranking.

| Rank | Model | Quality (0-100) | Tokens | Time | Takeaway |
| --- | --- | --- | --- | --- | --- |
| 1 | GPT-6 Luna | 83 | ~203k | ~3 min | Leanest and most selective: tight descriptions, correct dates, nothing padded. |
| 2 | Muse Spark 1.3 (Contributor) | 74 (two runs: 73 and 75) | ~164k-185k | ~3.5-4.5 min | Solid and cheapest in tokens; descriptions run longer. |
| 3 | DeepSeek V4.1 Flash (thinking) | 73 | ~409k | ~25 min (ran with others) | Very faithful to the note, but heavy on tokens (lots of hidden reasoning) and one description sprawled. |
| 4 | Qwen 3.8 Flash | 67 | ~276k | ~30 min (ran with others) | Wordy: many padded subtasks and more loosely supported sentences. |
| - | GLM 5.3 Flash | - | - | - | Did not complete: empty replies after spending its whole reasoning budget. |

- Ranks 2 and 3 are a statistical tie: the two Muse runs differed from each other as much as from DeepSeek.
- One real note, one run per model, scored by AI reviewers: a rough guide, not a lab benchmark.
- DeepSeek and Qwen ran at the same time, which inflated their times; token counts are the fairer cost comparison. All models found the same 9 actions and missed the same gap: three unmarked deadlines the note mentioned. That gap belongs to evidence selection, not to any model.

## Quick setup

1. In `Settings > Semantic Todoist Sync`, add a provider under **AI Providers**, then pick models under **AI Models** and check the embedding choice.
2. Add your Todoist token, run the connection check, and rebuild the semantic index.
3. Nice-to-know settings: **Parallel description requests** (default 4, 1–8; Open WebUI stays at 1) and the task deduplication toggle. If an email pauses after a failure, use **Resume** in settings.

## Everyday use

- Sidebar buttons **Ask**, **Tasks**, **Index**, and **Run** cover daily life; the command palette adds note sync, email runs, scheduling, and undo.
- Mark actions with `#todo` (changeable in settings). Main tasks get `#STsync`, subtasks `#STSubSync`. Add `!!1`–`!!4` for priority, a calendar date for a due date, and `{{date}}` for a deadline. Your label, priority, and date rules in settings guide the rest.
- Descriptions explain each task using your notes, with short source notes below. If a source link can't be resolved it is skipped quietly instead of failing the run.
- Email glitches pause just that email instead of retrying forever. Only stored indexes you no longer use are ever offered for deletion, and only after you confirm the exact files.
- Debug logging is off unless you start it, and it needs a small external collector on your own computer.

## Privacy, network, and accounts

- The plugin is free, takes no payments or donations, and has no account of its own. You need a Todoist account and token for Todoist jobs, and a provider account for paid providers; self-hosted options can run without one. No single AI vendor is required, and the source code is open.
- Network use: Todoist jobs reach `api.todoist.com`; AI jobs reach only the provider you picked; the optional System One decision model reaches only the server address you type in (task text and short note excerpts are sent there; leave it off to send nothing); optional Internet Search and Deep Research use your provider's search service; email jobs reach only the helper address you enter; optional debug logging talks only to the collector on your own computer. Each call sends only what that job needs.
- Your index, task links, and scheduling memory stay on your device; Todoist only receives task fields when you run Todoist jobs. Optional debug logging can write to your computer's temp folder via the collector.
- No telemetry is sent to us, there are no ads, and the plugin never installs or updates itself.

## Links

- [Changelog](CHANGELOG.md) and [License](LICENSE), GNU General Public License v3.0. Benchmark details: [benchmark protocol](docs/model-quality-benchmark.md) and [earlier scorecard](docs/model-quality-benchmark-scorecard-2026-08-09.json).
