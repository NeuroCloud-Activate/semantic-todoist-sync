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
   Searchable settings cover OpenAI, Gemini, OpenRouter, and local OpenWebUI/Ollama, with per-workflow choices and optional fallbacks.

2. **More grounded output.**
   Chat, tasks, and descriptions keep the current request and useful context together, so generated work is clearer and easier to act on.

3. **Smoother everyday control.**
   A clearer sidebar and searchable settings make task capture, scheduling previews, and duplicate review easier to manage.

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
- Self-hosted OpenWebUI connected to Ollama.

Each workflow has a searchable provider/model picker. You can choose models
and reasoning levels independently for chat, task generation, descriptions,
and embeddings, then set an optional fallback. Embedding indexes stay tied to
their selected provider and model, so switching providers does not mix
incompatible data.

If OpenWebUI is connected to Ollama, all AI work in this plugin—including
generation, embeddings, semantic search, chat, task generation, and
descriptions—can run locally on your own machine or network. You do not need a
cloud AI provider for that setup. Todoist, OpenAI, Gemini, OpenRouter, and
Cloudflare remain external services and are contacted only when you configure
and use the related workflow.

## Quick setup

1. Open `Settings > Semantic Todoist Sync` and choose an AI provider. Add its
   credential, or configure your OpenWebUI endpoint and sign-in details.
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

This current live-vault comparison gave every model the same two live-note
evidence bundles. Scores are Sol/high judgments of evidence accuracy and
actionability, not provider claims. No private note details are included.

| Provider/model | Quality /100 | Passed | Avg input | Avg time | What we saw |
|---|---:|---:|---:|---:|---|
| OpenAI GPT-5.6 Luna high | 95 | 6/6 | 4.6K est | 13.7s | Strongest and most consistently grounded. |
| Gemini 3.5 Flash Lite | 91 | 6/6 | 4.6K est | 6.4s | Fast and reliable after compatible schema fallback; occasionally broader than needed. |
| OpenRouter `tencent/hy3` high | 80 | 5/6 | 3.9K reported on successful calls | 90.7s across attempts | Strong tasks and one rich description; largest description timed out at 180s. |
| OpenRouter `tencent/hy3:free` | 0 | 0/6 | n/a | 0.1s | Unavailable/404 during comparison. |
| OpenRouter `openrouter/free` | 74 | 6/6 | 4.3K reported | 23.0s | Completed this run, but dynamic route quality varied and one task inferred an unsupported date. |
| OpenWebUI `gemma4:e4b` | 66 | 4/6 | 5.4K reported on successful calls | 48.4s | Focused simple tasks, but inconsistent chat/description structure; not strong enough for a dependable full workflow. |
| OpenWebUI Qwen3.5 9B HF | 69 | 5/6 | 4.2K reported on successful calls | 54.5s | Generally capable, but one description invented unsupported detail and one chat failed shape. |
| OpenWebUI Gemma 12B Agentic HF | 61 | 4/6 | 4.1K reported on successful calls | 70.8s | Useful task/description output, but chat/task reliability and factual precision varied. |

*Footnote: “est” means the provider omitted usage, so the identical bundle’s
production preflight estimate was used. Reported averages use successful calls.
16K is an efficiency target, and every measured or estimated average remained
well below it.*

## Links

- [Changelog](CHANGELOG.md)
- [License](LICENSE) — GNU General Public License v3.0
