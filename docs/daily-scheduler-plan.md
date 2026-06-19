# Daily Scheduler Feature Notes

Status: implemented in 0.6.2
Target: current Schedule Today's Tasks workflow

## Goal

Schedule Today's Tasks uses Todoist tasks, subtasks, Obsidian vault context, the semantic index, scheduler memory, and the plugin's local reference table to schedule urgent work into practical workday blocks for the current day.

The feature should be lightweight, previewable, and Todoist-first. Google Calendar access is deferred and should not be implemented in the first scheduler build.

## Core Workflow

1. User opens the plugin sidebar and selects Schedule Today's Tasks from the compact function chooser, or runs it from the command palette.
2. Plugin loads the local Todoist reference table and uses cached Todoist snapshots first.
3. Plugin identifies eligible open tasks and subtasks.
4. Plugin gathers relevant Obsidian context through the semantic index and local note references.
5. Plugin estimates task duration in 15-minute steps while respecting the configured minimum task block.
6. Plugin scores and orders candidate tasks by weighted urgency, including semantic context and note recency.
7. Plugin builds a proposed schedule for today using configured workday constraints.
8. Plugin shows a preview before writing changes, including a day timeline where scheduled tasks can be rearranged.
9. On confirmation, plugin updates Todoist task due datetime and duration fields.
10. Existing sync-back logic updates Obsidian task lines from Todoist.

## Eligibility Rules

Default eligible tasks:

- Open Todoist tasks and subtasks.
- Tasks that are overdue.
- Tasks due today.
- Tasks due within the next two days.

The scheduler should only place the highest-priority tasks that can be completed during the configured workday. If there are more eligible tasks than available time, unscheduled tasks should remain unchanged and appear in the preview as not scheduled.

Settings include a due window and customizable excluded labels. Tasks with excluded labels are left out of scheduling unless a future preview refinement explicitly includes them.

## Duration Estimation

Task duration should be stored in Todoist's task duration field.

Duration should be estimated using:

1. Existing Todoist duration, if present.
2. Explicit duration metadata in the task or Obsidian note, if present.
3. Lightweight local scheduler memory from earlier accepted schedules, manual preview edits, Todoist duration updates, and note/task context matches.
4. AI estimate based on task title, task description, parent task, subtasks, linked note context, and relevant vault context.

Generated durations can move in 15-minute steps, but the final duration must stay at or above the configured minimum task block.

Default duration constraints:

- Minimum block per task: 30 minutes.
- Maximum block per task per day: 3 hours.
- Work blocks align to the configured minimum task block in the preview timeline, with duration edits stepping by 15 minutes when allowed by the minimum.

The AI duration request should be conservative and token-limited. It should receive compact task context, relevant note snippets, and any known parent/subtask relationships, not broad vault dumps.

AI duration estimation uses task descriptions and relevant vault snippets by default. The scheduler still validates and bounds the result locally.

If AI confidence is low, the task should still be scheduled when it otherwise fits. The preview should allow the user to adjust duration before applying.

Scheduler memory lives outside configurable settings in a small local plugin data file. It keeps only compact scheduling signals such as Todoist IDs/OIDs, relative note paths, labels, context terms, observed durations, accepted schedule order, promoted suggestions, bumped tasks, manual preview duration/order edits, and local duration policies. It does not trigger background rescheduling.

Quick follow-up, discussion, meeting-planning, coordination, and collaboration tasks should default to the configured minimum task block because they usually represent a brief action or future scheduling step, not the full meeting itself.

## Parent And Subtask Scheduling

Subtasks should usually be scheduled alongside the parent task so related work stays grouped.

Subtasks may be scheduled separately when the subtask represents independent work, such as:

- Reviewing a specific document.
- Sending a follow-up.
- Waiting for information from someone else.
- Preparing a separate deliverable.
- Work that can happen before or after the parent task independently.

The scheduler should detect this through:

- Subtask wording.
- Todoist labels and priority.
- Task description context.
- Obsidian note context.
- Existing parent/subtask relationships in the local reference table.

When the scheduler separates a subtask from its parent, the preview should make that clear.

Follow-up tasks should be eligible for scheduling.

Any subtask scheduled or generated through this feature should be completable within the configured duration limits. If a subtask is too complex, the scheduler should split it into separate clear subtasks with titles that explain the work and requirements.

If a main task requires more time than the configured maximum daily block, the scheduler should split it across two workdays by creating a separate next-workday subtask under the same main task for the remaining work. This split should use the same task interpretation logic used by task creation for due dates, priorities, and deadlines, while keeping note task creation separate from duration scheduling.

## Sidebar And Settings UX

The sidebar keeps chat as the primary interaction:

- `Ask` sends a question to the chat.
- `Tasks` runs task generation for the selected or active note.
- `Run:` selects compact prompt actions, including Schedule Today's Tasks.
- The new-chat control is a small header icon instead of a large button.
- There is no dedicated Plan Workday button.

Daily Scheduler has its own settings tab. Scheduler options are configured there so the feature behaves like a structured workflow, not a free-form prompt.

Settings should stay concise and compact. Each function category should have a brief, plain-language description explaining what the settings in that category modify, but avoid long instructional text. Prefer short labels, one-line helper text, grouped controls, and progressive disclosure for anything advanced.

## Workday Settings

Settings cover:

- Enable Daily Scheduler.
- Default workday start time.
- Default workday end time.
- Lunch block start time.
- Lunch block length.
- Minimum task block size.
- Maximum task block size per day.
- Duration edit step.
- Include overdue tasks.
- Include tasks due within N days.
- Include subtasks.
- Allow independent subtask scheduling.
- Excluded labels.
- Preview before applying schedule.
- Simple scheduling weight controls.

These settings appear under the dedicated Daily Scheduler settings tab.

Expose only simple scheduling weight controls. Use 3-position sliders for each major scheduling signal: less important, moderately important, and more important. Avoid advanced numeric weights in normal settings.

Do not expose separate toggles for explicit-duration metadata or AI duration estimation. Duration estimation should always use the best available context: existing Todoist duration, explicit task or note metadata, the local Todoist task list, RAG context from the vault, and AI reasoning over task complexity.

Defaults:

- Workday start: 8:00 AM.
- Workday end: 4:00 PM.
- Lunch block start: 12:00 PM.
- Lunch block length: 30 minutes.
- Minimum task block: 30 minutes.
- Maximum task block per day: 3 hours.
- Scheduling timeline block: follows the minimum task block.
- Duration edit step: 15 minutes.
- Due window: overdue through next two days.
- Preview before applying: enabled.
- Scheduling weights: default to the plugin's balanced recommended profile.

## Prioritization Model

Scheduling priority should use a weighted combination of:

- Todoist priority.
- Deadline proximity.
- Due date proximity.
- Overdue status.
- Note recency.
- Semantic urgency.
- Parent/subtask dependency.
- Existing task creation logic signals.

The scoring logic should be harmonized with the plugin's existing task and subtask creation logic for priorities, due dates, and deadlines. The scheduler should not introduce a conflicting interpretation of urgency.

Proposed first-pass weights:

- Todoist priority: high.
- Deadline proximity: high.
- Overdue status: high.
- Due date proximity: medium-high.
- Semantic urgency: medium, using relevant vault and task-reference context.
- Note recency: medium, using note-created time when available and file metadata otherwise.
- Parent/subtask dependency: medium.

The first configurable version should expose only 3-position sliders:

- Less important.
- Moderately important.
- More important.

Recommended default slider positions:

- Todoist priority: more important.
- Deadline proximity: more important.
- Overdue status: more important.
- Due date proximity: moderately important.
- Semantic urgency: moderately important.
- Note recency: moderately important.
- Parent/subtask dependency: moderately important.

The UI should present these as simple importance controls, not as raw numeric weights.

All seven signals should be available in the settings, but the category must remain visually compact.

## Todoist-First Scheduling

The scheduler writes approved changes to Todoist first:

- Update due datetime.
- Update task duration.
- Preserve deadlines.
- Preserve labels.
- Preserve priorities.
- Preserve parent/subtask relationships.
- Preserve OID markers and local reference mappings.

If Todoist calendar sync is enabled in the user's Todoist account, Todoist can mirror these scheduled tasks into the user's calendar.

The plugin should not depend on Google Calendar for the core scheduling workflow.

## Deferred Google Calendar Integration

Google Calendar integration is deferred. The current scheduler does not add Google OAuth, Google token storage, or Google Calendar API calls.

Future Google Calendar integration can be experimental and optional.

Purpose:

- Read busy blocks.
- Avoid scheduling tasks over meetings.
- Find available time windows.
- Warn about conflicts before applying Todoist updates.

The plugin should not require Google Calendar access for basic scheduling.

When added later, Google Calendar conflict detection should be desktop-only. When the plugin runs on mobile, the feature should be auto-disabled at runtime even if the synced setting is enabled.

Mobile handling rules:

- Do not remove or hide the Google Calendar settings on mobile.
- Do not overwrite the synced setting value just because the current device is mobile.
- Show the setting as unavailable on mobile with concise helper text such as "Desktop only".
- Skip OAuth, token refresh, free/busy calls, and conflict detection on mobile.
- Preserve any existing desktop Google Calendar configuration so Obsidian settings sync is not disrupted across devices.

Implementation constraints:

- Use Google OAuth installed-app flow with PKCE on desktop.
- Open Google OAuth in the system browser, not an embedded Obsidian webview.
- Use a localhost loopback redirect on desktop.
- Request only free/busy access unless a future feature explicitly needs more.
- Do not treat all-day events as blocking the whole day by default.
- Calendar reads should be cached briefly during one scheduling run.
- Calendar data should not be stored permanently unless absolutely necessary.
- Calendar access should be clearly labeled as experimental.
- Calendar write access should not be added unless there is a separate explicit design decision.

## Performance And API Budget

The feature must be lightweight enough for mobile use.

Performance rules:

- Use the local Todoist reference table before making Todoist API calls.
- Use cached semantic index data before rebuilding or rescanning.
- Batch Todoist updates where practical.
- Avoid full-vault scans during scheduling.
- Limit AI duration estimation to tasks missing usable duration data.
- Send task descriptions and relevant compact vault snippets to AI requests.
- Reuse existing task scoring and context-generation utilities where possible.
- Keep status updates concise and accurate.

AI should support the scheduler, not own the whole workflow. The deterministic scheduler should validate all AI duration estimates and all proposed time blocks before any Todoist write.

## Preview UX

The preview should show:

- Scheduled task title.
- Parent task, if applicable.
- Due date/time to be set.
- Duration to be set.
- Whether the duration was existing, explicit, or AI-estimated.
- Whether a subtask was scheduled separately from its parent.
- Unscheduled eligible tasks that did not fit into today's configured workday.
- Up to ten suggested swaps from unscheduled tasks that could fit today by moving out one scheduled task.
- A concise reason beside each suggested swap.
- Any task moved out by a suggested swap at the bottom of the preview area where suggestions appear.

The preview should allow:

- Apply schedule.
- Undo the last applied schedule.
- Cancel.
- Regenerate.
- Exclude individual tasks.
- Adjust a task duration before applying.
- Rearrange tasks by dragging and dropping them within the workday on compatible devices.
- Move tasks with earlier/later arrow controls on mobile or other devices where drag-and-drop is incompatible.
- Swap in one suggested unscheduled task, automatically moving one scheduled task out of the day preview.

The preview should use a GUI timeline layout:

- Open as an adaptive modal from a small sidebar button.
- Adapt layout and controls to the device screen size and available modal width.
- Show the configured workday as a single compact vertical time column with slots that match the configured minimum task block.
- Show lunch as a blocked time window that cannot receive scheduled tasks.
- Render each scheduled task as a rounded rectangle sized vertically by Todoist duration.
- Show the task name inside each rounded rectangle.
- Preserve parent/subtask grouping visually unless a subtask is scheduled independently.
- Snap dragged tasks to the configured minimum task block.
- Prevent drops outside the configured workday.
- Prevent drops into the configured lunch block.
- Allow manual lunch overlap in preview if the user deliberately moves a task there, with a clear warning.
- Warn or block drops that exceed the daily maximum for a task.
- Recalculate Todoist due datetime values immediately in the preview after reordering.
- Keep the final Todoist update pending until the user explicitly applies the schedule.
- Keep drag-and-drop always available when supported. Use compact mobile controls when the sidebar is narrow or the platform is incompatible with reliable drag-and-drop, including move earlier/later buttons as the rearranging method.

The preview should not show task rationale by default. Keep the preview focused on task title, time, duration, and manual editing.

Suggested swaps are the exception: they should show a brief rationale because the task was not scheduled automatically and the user needs enough context to decide whether to replace another block.

## Safety Rules

- Never overwrite a task's existing specific time without showing it in the preview.
- Treat existing specific Todoist task times as fixed by default.
- Do not move tasks outside the configured workday.
- Do not schedule tasks during the configured lunch block by default.
- Do not schedule more task time than the configured daily capacity.
- Do not delete deadlines.
- Do not change deadlines.
- Do not change task priority, labels, project, section, or parent relationship unless the user explicitly asks for that later.
- Do not automatically reschedule overdue or incomplete tasks in the background. Consider them only when the user runs Schedule Today's Tasks and confirms the preview.
- Do not use Google Calendar data unless the experimental setting is enabled.
- Do not use Google Calendar data on mobile, even when the synced setting is enabled.
- Do not store private calendar event details in the local reference table.

Undo should restore the previous Todoist due datetime and duration values for tasks changed by the last scheduler apply action. If the scheduler created split subtasks for overflow work, undo should remove those newly created subtasks when safe to do so.

## Implemented Scheduler Pieces

- Settings, lunch avoidance, simple 3-position scheduling weight controls, and the Schedule Today's Tasks command.
- Eligible task loading from the local reference table, with Todoist refresh only when local task data is stale.
- Duration estimation from existing Todoist data, scheduler memory, local task context, semantic index context, and compact AI assistance when needed.
- Priority scoring that combines Todoist urgency, deadline and due proximity, semantic urgency, note recency, parent/subtask relationships, and scheduler memory.
- Preview generation with compact timeline controls, moved-out task tracking, up to ten suggested swaps, and undo for the last applied schedule.
- Todoist due datetime and duration updates on apply, followed by normal Obsidian note sync.
- Local scheduler memory for accepted durations, order changes, priority context, promoted suggestions, bumped tasks, compact vault context signals, and duration policies.

## Future Experimental Calendar Conflict Detection

- Add optional desktop-only Google Calendar free/busy integration only after the Todoist-only scheduler is stable.
- Auto-disable Google Calendar conflict detection at runtime on mobile without changing synced settings.
- Add Google OAuth installed-app login with PKCE and localhost redirect for desktop.
- Read busy blocks for the selected workday.
- Schedule around conflicts.
- Show calendar conflict warnings in preview.
- Ignore all-day events by default unless a future setting says otherwise.

## Possible Future Refinements

- Add recurring workday profiles.
- Add project or label filters.
- Add manual pinning for fixed-time tasks.
- Add "schedule tomorrow" and "schedule next workday".
- Add include labels in addition to excluded labels.
