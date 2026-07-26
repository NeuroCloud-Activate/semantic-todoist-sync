# Semantic Todoist Sync

Semantic Todoist Sync connects the notes you write in Obsidian with the work
you manage in Todoist. Ask grounded questions, turn notes or selected text into
useful tasks and subtasks, keep a traceable copy in Obsidian, spot duplicates,
and plan today's work before changing anything in Todoist.

It is local-first: you choose the AI provider, models, and external services
you want to use.

## What's New

The current 0.8 series makes everyday capture more flexible and more private.

1. **More provider and model choice.**
   Searchable settings cover OpenAI, Gemini, OpenRouter, and local Open WebUI/Ollama, with per-workflow choices and optional fallbacks.

2. **More grounded output.**
   Search keeps the full index available and uses one provider-neutral check before model choice to filter out action-only false matches. Chat also tidies simple recognized label aliases before checking an answer, so responses stay clearer without changing the original model output.

3. **Smoother everyday control.**
   A clearer sidebar and searchable settings make task capture, scheduling previews, and duplicate review easier to manage.

4. **Model learning that stays useful.**
   Exact-model profiles save carrier and concurrency behavior. Chat only announces material new saves, while AI & Search shows a compact, scrollable list of exact-model operation memories with a Delete button that removes only that memory; the model relearns it next time.

5. **Cleaner presentation.**
   Obsidian no longer reports the `:has` CSS warning.

## Install

- [Install from Obsidian Community Plugins](https://obsidian.md/plugins?id=semantic-todoist-sync)
- [Download the latest release for a manual install](https://github.com/NeuroCloud-Activate/semantic-todoist-sync/releases/latest)

Semantic Todoist Sync works with Obsidian 1.5.0 and newer on desktop, iPhone,
and iPad.

## What it does

- **Search and chat:** Ask questions across your notes with relevant semantic
  context and links back to the source.
- **Notes to Todoist:** Turn a meeting note, project note, or selection into
  main tasks and subtasks. The generated work keeps the requested action,
  people, deliverables, criteria, dates, and dependencies when they are
  present. Descriptions are written as clear, standalone execution briefs.
- **Email to Todoist:** With an optional Cloudflare Worker, forward task-heavy
  emails into the same grounded task workflow.
- **Sync and deduplication:** Keep note tasks and Todoist state aligned, retain
  local references, and review likely duplicates without collapsing distinct
  work.
- **Schedule Today's Tasks:** Preview a practical day from your Todoist work,
  adjust it, and apply or undo the approved schedule.
- **Prompt templates:** Run reusable prompts for summaries, task capture, and
  scheduling from the sidebar or command palette.

## Providers and model choice

The plugin supports:

- OpenAI, with GPT-5.6 Luna at High reasoning as the default generation choice.
- Google Gemini, with Gemini 3.5 Flash Lite as the default generation choice.
- OpenRouter, including full native model IDs such as `openrouter/free`.
- Self-hosted Open WebUI connected to Ollama.

Each workflow has a searchable provider/model picker. You can choose models
and reasoning levels independently for chat, task generation, descriptions,
and embeddings, then set an optional fallback. Embedding indexes stay tied to
their selected provider and model, so switching providers does not mix
incompatible data.

If Open WebUI is connected to Ollama, all AI work in this plugin—including
generation, embeddings, semantic search, chat, task generation, and
descriptions—can run locally on your own machine or network. You do not need a
cloud AI provider for that setup. Todoist, OpenAI, Gemini, OpenRouter, and
Cloudflare remain external services and are contacted only when you configure
and use the related workflow.

## Quick setup

1. Open `Settings > Semantic Todoist Sync` and choose an AI provider. Add its
   credential, or configure your Open WebUI endpoint and sign-in details.
2. Add your Todoist personal token and run the connection check.
3. Choose models in the searchable operation settings. Add a fallback only if
   you want one.
4. Rebuild the semantic index from the setup screen.
5. Optionally configure the email workflow, prompt templates, deduplication,
   or Schedule Today's Tasks.

## Everyday use

Open the sidebar to use `Ask`, `Tasks`, `Index`, or `Run`. The command palette
offers the same actions, plus note sync, email processing, scheduling, and
undo.

For note task capture, use `#STsync` on main tasks and `#STSubSync` on
subtasks. A marker such as `#todo` is a useful signal when writing notes. The
plugin adds local references so later syncs can follow the same work even when
it moves between notes or projects.

Schedule Today's Tasks always opens a preview first. Todoist changes happen
only when you choose `Apply`, and the last applied schedule can be undone.

## Output quality and privacy

- AI-assisted tasks and descriptions are grounded in the current request and
  relevant context, with useful history included only when it helps the work.
- Only content needed for a configured workflow is sent to the provider you
  selected.
- Local semantic indexes, task references, and scheduling memory stay on your
  device and reduce repeat external reads.
- Todoist receives task fields needed for sync only when you use Todoist
  workflows. The optional email flow contacts Cloudflare only when enabled and
  run.
- The plugin does not create a hosted account or require a single AI vendor.

## Model validation snapshot

The complete model comparison gave every model the same provider-neutral
evidence bundles. Scores are GPT-5.6 Sol/high judgments of evidence accuracy
and actionability, not provider claims.

| Provider/Model | Quality / 100 | Percent Tasks Successfully Complete | Avg Input (Tokens) | Est Total Cost | Avg Time (to complete test run) | Sanitized Overall Assessment |
|---|---:|---:|---:|---:|---:|---|
| OpenAI GPT-5.6 Luna high | 95 | 100% (6/6) | ~24.3K | ~$0.10 | ~42s | Most complete, precise, and consistently grounded across chat, task, and description. |
| Gemini 3.5 Flash Lite high | 92 | 100% (6/6) | ~24.5K | ~$0.04 | ~27s | Nearly as strong, fastest cloud result, with only occasional extra breadth. |
| OpenRouter DeepSeek V4 Flash | 90 | 100% (6/6) | ~20.0K | ~$0.0089 | ~196s | Strong evidence use and descriptions; one chat was broader than necessary. |
| OpenRouter Qwen 3.7 Plus | 89 | 100% (6/6) | ~20.7K | ~$0.0346 | ~159s | Consistently grounded and actionable, with good historical interpretation. |
| Open WebUI Qwen3.5 9B HF | 84 | 50% (3/6) | ~26.5K attempted | $0 API | ~488s | Strongest local interpretation when it completed, including the best local historical description; two generation timeouts reduced reliability. |
| OpenRouter `tencent/hy3` high | 79 | 100% (6/6) | ~28.7K | ~$0.01 | ~88s | Strong tasks and descriptions; chat sometimes widened beyond the selected action. |
| Open WebUI `gemma4:e4b` thinking | 76 | 66.7% (4/6) | ~26.5K attempted | $0 API | ~317s | Accurate, concise tasks and usable chat, but both description calls exceeded the local deadline. |
| Open WebUI Gemma 12B Agentic HF | 68 | 33.3% (2/6) | ~26.5K attempted | $0 API | ~427s | The completed task was accurate, but the description overpacked loosely related history and the other note timed out. |
| Open WebUI Qwythos-9B-Claude-Mythos | 67 | 50% (3/6) | ~26.5K attempted | $0 API | ~426s | Grounded task titles and one useful description; chat was excessively broad and another description was too thin. |
| OpenRouter `openrouter/free` | 64 | 100% (6/6) | ~29.1K | $0 | ~124s | Completed the matrix but remained inconsistent and needed bounded recovery. |
| Open WebUI `qwen3.5:4b` | 62 | 66.7% (4/6) | ~26.5K attempted | $0 API | ~332s | Both tasks and descriptions completed after the saved carrier fix; chat remained schema-inaccurate, and descriptions included more peripheral history than useful. |
| OpenRouter Xiaomi MiMo-V2.5 | 60 | 50% (3/6) | ~34.5K attempted | ~$0.0235 | ~385s | Tasks were useful, but truncation and timeout behavior made chat and descriptions unreliable. |
| Open WebUI Google Gemma4 12B (`gemma4:12b`) | n/a | 0% (0/6) | n/a | $0 API | <1s | Still advertised by the stale catalog but currently unavailable from the backend; this is not scored as a speed or quality failure. |
| OpenRouter `tencent/hy3:free` | 0 | 0% (0/6) | n/a | $0 | ~0.5s | Unavailable/404 in the tested catalog; the paid model worked. |

6/6 covers chat, task, and description across two actual/live notes, and every model received the same provider-neutral evidence bundles. Open WebUI advertised 30K, two workers, and one exact-model lane; every individual call stayed within the 16K efficiency target, while Avg Input is the mean three-operation note-workflow total rather than a cap. Local cost excludes hardware/electricity; local tests used an NVIDIA RTX3070 with 8GB VRAM; scores are GPT-5.6 Sol/high judgments, and minor local repair affects reliability, not semantic quality.

## Links

- [Changelog](CHANGELOG.md)
- [License](LICENSE) — GNU General Public License v3.0
