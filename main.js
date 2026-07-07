const {
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  setIcon,
  requestUrl
} = require("obsidian");

const VIEW_TYPE = "semantic-todoist-sync-view";
const TODOIST_API = "https://api.todoist.com/api/v1";
const SEMANTIC_INDEX_FILE = "semantic-index.json";
const OPENAI_SEMANTIC_INDEX_FILE = "semantic-index.openai.json";
const GEMINI_SEMANTIC_INDEX_FILE = "semantic-index.gemini.json";
const SEMANTIC_INDEX_PATH_META_FILE = "semantic-index-path-meta.json";
const TASK_REFERENCE_SNAPSHOT_FILE = "task-reference-snapshot.json";
const TASK_REFERENCE_INDEX_FILE = "task-reference-index.json";
const SCHEDULER_MEMORY_FILE = "scheduler-memory.json";
const SCHEDULER_MEMORY_MAX_ENTRIES = 500;
const SCHEDULER_MEMORY_MAX_CONTEXT_TERMS = 24;
const SCHEDULER_MEMORY_MAX_CONTEXT_PATHS = 12;
const SCHEDULE_PREVIEW_SUGGESTION_LIMIT = 10;
const SCHEDULE_AI_DURATION_MAX_TASKS = 18;
const SCHEDULER_PEOPLE_FOLLOWUP_POLICY_ID = "people-followup-minimum-duration";
const SCHEDULER_PEOPLE_FOLLOWUP_POLICY_ALIASES = ["people-followup-max-30"];
const SCHEDULER_DEFAULT_FOCUS_POLICY_ID = "default-focused-work-duration";
const SCHEDULER_RELATED_GROUPING_POLICY_ID = "related-task-grouping";
const SEMANTIC_INDEX_SHARD_MAX_BYTES = 4.5 * 1024 * 1024;
const TODOIST_DESCRIPTION_LIMIT = 16000;
const STATUS_ITEM_MIN_VISIBLE_MS = 1000;
const SEMANTIC_INDEX_STARTUP_QUIET_MS = 15000;
const SEMANTIC_INDEX_WARMUP_DELAY_MS = 30000;
const SEMANTIC_INDEX_WARMUP_BATCH_SIZE = 4;
const SEMANTIC_INDEX_WARMUP_PAUSE_MS = 100;
const SEMANTIC_INDEX_FILE_YIELD_INTERVAL = 4;
const SEMANTIC_INDEX_FILE_PAUSE_MS = 25;
const SEMANTIC_INDEX_EMBED_PAUSE_MS = 25;
const GEMINI_EMBEDDING_CONCURRENCY = 3;
const STARTUP_BACKGROUND_TICK_DELAY_MS = 45000;
const STARTUP_PROMPT_TEMPLATE_SETUP_DELAY_MS = 20000;
const STARTUP_SEMANTIC_INDEX_LOAD_DELAY_MS = 15000;
const STARTUP_SEMANTIC_INDEX_RESHARD_DELAY_MS = 120000;
const STARTUP_SUBTASK_REPAIR_DELAY_MS = 60000;
const MIN_EMAIL_AUTO_POLL_INTERVAL_SECONDS = 420;
const SUBTASK_INDENT_REPAIR_VERSION = "stsubsync-indent-v2";
const DEFAULT_TASK_HEADING = "## Semantic Todoist Sync - Action Items";
const DEFAULT_SCHEDULE_TODAY_PROMPT = "Plan today's Todoist tasks into a realistic workday. Prioritize urgent, high-value, and time-sensitive work that can fit today. Use vault and task context to estimate focused work duration, prefer about one hour for ordinary focused-work blocks, keep follow-up/check-in/discussion tasks short when appropriate, split oversized tasks into clear continuation work, and leave due dates, deadlines, priorities, labels, and task titles unchanged.";
const DEFAULT_SCHEDULER_POLICY_TEXT = {
  peopleFollowupRationale: "These blocks represent quick action or outreach by the user, not the actual meeting or conversation time. Cap them at the scheduler minimum duration configured in settings.",
  defaultFocusRationale: "Ordinary focused-work tasks without clear heavy-complexity signals should start near this duration before context, priority, deadlines, and memory adjust them.",
  relatedGroupingRationale: "Related tasks should stay near each other when practical, while Todoist priority, deadline proximity, urgency, recency, and learned memory still drive the main order."
};
const DEFAULT_TASK_DEDUPLICATION_POLICY = [
  "Match only open, incomplete tasks. Completed tasks never satisfy a newly generated action item.",
  "Prefer conservative local matching using task title, intent, rationale, people, project/topic overlap, parent/subtask relationship, due/deadline support, labels, and note references.",
  "When an open existing task is confidently matched, link the new note line to the existing Todoist task with a new local OID, then update Todoist with newer title, due date, deadline, priority, description, and added labels.",
  "Merge labels additively by default. Do not delete existing labels unless that setting is disabled.",
  "Subtasks can match across notes and can be added or updated under the matched parent. Remove an existing subtask only when the newer source clearly says it is obsolete, no longer needed, or should be removed.",
  "Ignore email-routing boilerplate such as reply-to aliases, tracking mailbox wording, ticket-like intake wording, or generic instructions to copy a mailbox; these are not duplicate-task evidence.",
  "Treat same-project tasks as duplicates when one is a richer, poorer, broader, or more concise expression of the same action and the existing task would be satisfied by merging the newer details.",
  "Treat parent and subtask records as duplicates when the subtask merely restates the parent action or the parent only adds context around the same single action; hierarchy alone is not a reason to keep duplicate task records.",
  "Treat identical or near-identical task titles as duplicate candidates even when they sit under different parent tasks, unless parent context clearly changes the object, person, deliverable, or next step.",
  "Do not merge similar tasks across different concrete Todoist projects. Treat Inbox as generic, but two named non-Inbox projects are separate work contexts unless the user explicitly moves or links the task across projects.",
  "Do not merge a distinct component subtask into a broader parent task when the parent contains multiple decisions, questions, recipients, documents, or steps and the subtask represents only one separable piece.",
  "Do not merge a newer specific progress task, such as reviewing a named person's edits, approvals, returned comments, or current status update, into an older broader project task unless both records require the same immediate next action.",
  "If local signals are ambiguous, create a new task unless AI-facilitated ambiguous deduplication is enabled and the AI returns a high-confidence same-action decision."
].join("\n");
const TASK_DEDUPLICATION_POLICY_UPDATE_LIMIT = 8;
const TASK_DEDUPLICATION_AI_CONFIDENCE_THRESHOLD = 88;
const TASK_DEDUPLICATION_AI_MERGE_CONFIDENCE_THRESHOLD = 75;
const TASK_DEDUPLICATION_AI_AMBIGUOUS_BAND = 8;
const PLUGIN_DATA_FOLDER = "Semantic Todoist Sync";
const TASK_CONTEXT_MAX_ROWS = 14;
const TASK_CONTEXT_MAX_ROWS_PER_PATH = 5;
const TASK_CONTEXT_MIN_TASK_SCORE = 1;
const ADAPTIVE_CONTEXT_TIERS = [
  "Active/source note",
  "Todoist task snapshot",
  "Task intent and rationale",
  "Origin meeting or email outcome",
  "Related note thread",
  "Project context",
  "Portfolio context"
];
const ADAPTIVE_CONTEXT_MODE_BUDGETS = {
  chat: { defaultDepth: 4, maxDepth: 7, retrievalMultiplier: 2, maxRetrieval: 24, maxChars: 10000, maxNotes: 7, maxTasks: 12, maxProjects: 5 },
  "task-generation": { defaultDepth: 6, maxDepth: 6, retrievalMultiplier: 2, maxRetrieval: 20, maxChars: 11000, maxNotes: 7, maxTasks: 10, maxProjects: 4 },
  description: { defaultDepth: 7, maxDepth: 7, retrievalMultiplier: 3, maxRetrieval: 28, maxChars: 14000, maxNotes: 8, maxTasks: 14, maxProjects: 6 },
  schedule: { defaultDepth: 7, maxDepth: 7, retrievalMultiplier: 2, maxRetrieval: 18, maxChars: 8000, maxNotes: 6, maxTasks: 16, maxProjects: 6 }
};
const BROAD_CONTEXT_QUERY_RE = /\b(across|all|overall|portfolio|project|projects|priorit(?:y|ies|ize)|important|most important|top|rank|compare|status|where things stand|everything|whole vault|all notes)\b/i;
const TASK_ACTION_CONTEXT_RE = /\b(tasks?|todo|actions?|next steps?|what should i do|complete|finish|work on|how do i|schedule|plan|deadline|due|follow[-\s]?up)\b/i;
const RECENCY_OR_CONFLICT_QUERY_RE = /\b(recent|current|latest|newest|older|past|changed?|updated?|guidance|conflict|conflicting|discrepanc(?:y|ies)|instead|now|history|previous(?:ly)?)\b/i;
const STRONG_MODEL_ESCALATION_THRESHOLD = 95;
const STRONG_MODEL_HARD_ESCALATION_THRESHOLD = 99;
const DEFAULT_PROMPT_TEMPLATE_FILES = [
  {
    filename: "Generate Todoist task list.md",
    createTasks: true,
    insertResponse: true,
    syncTasks: true,
    taskGenerationTemplate: true,
    taskHeading: DEFAULT_TASK_HEADING,
    prompt: "Scan the active note or selected text and generate a Todoist-ready task list. Use the shared task instructions. Include clear main tasks and subtasks only when they are actionable."
  },
  {
    filename: "Extract follow-ups only.md",
    createTasks: true,
    insertResponse: true,
    syncTasks: true,
    taskGenerationTemplate: true,
    taskHeading: DEFAULT_TASK_HEADING,
    prompt: "Scan the active note or selected text and generate only follow-up tasks. Apply the FollowUp tag rules and include enough context to act."
  },
  {
    filename: "Schedule today's tasks.md",
    action: "schedule-today",
    createTasks: false,
    insertResponse: false,
    syncTasks: false,
    prompt: DEFAULT_SCHEDULE_TODAY_PROMPT
  },
  {
    filename: "Summarize active note.md",
    createTasks: false,
    insertResponse: true,
    syncTasks: false,
    prompt: "Summarize the active note in concise plain language.\n\nFocus on decisions, open questions, important context, and next steps. Treat active-note details as the default source and cite the active note at most once. Link to relevant vault notes when context comes from other notes. Do not create Todoist task syntax unless createTasks is changed to true."
  }
];

const DEFAULT_SETTINGS = {
  openaiApiKey: "",
  googleApiKey: "",
  todoistToken: "",
  workerUrl: "",
  workerToken: "",
  aiModelProvider: "openai",
  chatModel: "gpt-5.4",
  chatFallbackModel: "gpt-5.4-mini",
  enableAiModelFallback: true,
  showAiFallbackNotice: true,
  chatMode: "Vault QA",
  embeddingModel: "text-embedding-3-large",
  availableChatModels: ["gpt-5.4", "gpt-5.4-mini"],
  availableEmbeddingModels: ["text-embedding-3-large"],
  availableGeminiModels: ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  availableGeminiEmbeddingModels: ["gemini-embedding-2", "gemini-embedding-001"],
  modelsFetchedAt: "",
  geminiModelsFetchedAt: "",
  defaultOpenArea: "view",
  autoAddActiveContentToContext: true,
  searchIncludeActiveNote: true,
  maxChatContextChunks: 12,
  maxTaskContextChunks: 10,
  maxContextChars: 12000,
  maxActiveNoteContextChars: 2500,
  embeddingBatchSize: 16,
  semanticIndexMaxChunkChars: 1100,
  semanticIndexMaxChunksPerNote: 20,
  semanticIndexEmbeddingPrecision: 4,
  useNoteCreatedTimeForSemanticIndex: true,
  indexedFolders: "",
  excludedFolders: PLUGIN_DATA_FOLDER,
  semanticIndexMeta: {},
  autoUpdateSemanticIndex: true,
  semanticIndexDelaySeconds: 30,
  todoistInboxProjectId: "",
  todoistTaskProjectId: "",
  todoistTaskProjectName: "Inbox",
  availableTodoistProjects: [],
  todoistProjectsFetchedAt: "",
  todoistSectionCache: {},
  syncTag: "#STsync",
  subtaskSyncTag: "#STSubSync",
  excludeSyncTagsFromLabels: true,
  legacyTodoistIdMode: "preserve",
  notesAutoSync: false,
  syncIntervalSeconds: 60,
  syncWorkerCount: 2,
  lastNoteAutoSyncAt: "",
  autoRebuildReferences: true,
  referenceRebuildIntervalMinutes: 360,
  referenceRebuildWorkerCount: 4,
  lastReferenceRebuildAt: "",
  lastReferenceRebuildFingerprint: "",
  lastReferenceRebuildCandidateCount: 0,
  lastSubtaskIndentRepairAt: "",
  lastSubtaskIndentRepairFingerprint: "",
  todoistSnapshotCacheMinutes: 5,
  scheduleTodayEnabled: true,
  scheduleTodayStartTime: "08:00",
  scheduleTodayEndTime: "16:00",
  scheduleTodayLunchStartTime: "12:00",
  scheduleTodayLunchMinutes: 30,
  scheduleTodayMinBlockMinutes: 30,
  scheduleTodayMaxBlockMinutes: 180,
  scheduleTodayAddWindowMinutes: 30,
  scheduleTodayChunkMinutes: 30,
  scheduleTodayDueWindowDays: 2,
  scheduleTodayIncludeOverdue: true,
  scheduleTodayIncludeSubtasks: true,
  scheduleTodayAllowIndependentSubtasks: true,
  scheduleTodayExcludedLabels: "waiting, blocked, someday",
  scheduleTodayWeightTodoistPriority: "more",
  scheduleTodayWeightDeadlineProximity: "more",
  scheduleTodayWeightOverdue: "more",
  scheduleTodayWeightDueDateProximity: "moderate",
  scheduleTodayWeightSemanticUrgency: "moderate",
  scheduleTodayWeightNoteRecency: "moderate",
  scheduleTodayWeightParentDependency: "moderate",
  scheduleTodayLastUndo: null,
  enableTaskDeduplication: true,
  taskDeduplicationStrictness: "conservative",
  taskDeduplicationMergeLabelsAdditive: true,
  taskDeduplicationAllowExplicitSubtaskRemoval: true,
  enableAiAmbiguousTaskDeduplication: true,
  taskDeduplicationAiReviewSensitivity: "balanced",
  taskDeduplicationAiModel: "",
  taskDeduplicationPolicy: DEFAULT_TASK_DEDUPLICATION_POLICY,
  taskDeduplicationPolicyUpdates: [],
  taskDeduplicationLastRunSummary: "",
  taskReferenceSnapshotMeta: {},
  linksAppURI: false,
  subtaskIndentSpaces: 4,
  subtaskIncludeLabels: true,
  subtaskIncludePriority: true,
  subtaskIncludeDueDate: false,
  subtaskIncludeDeadline: false,
  taskCache: {},
  pendingTaskDescriptions: {},
  processedTodoistEventIds: [],
  autoProcessEmails: false,
  emailPollIntervalSeconds: MIN_EMAIL_AUTO_POLL_INTERVAL_SECONDS,
  lastEmailPollAt: "",
  localLog: [],
  maxEmailChars: 18000,
  maxNoteChars: 22000,
  maxGeneratedMainTasks: 10,
  maxGeneratedSubtasksPerMainTask: 4,
  todoistDescriptionMaxChars: 8000,
  emailIncludeSourceListInDescriptions: true,
  noteIncludeSourceListInDescriptions: true,
  emailLogFolder: "Semantic Todoist Sync/Email-To-Todoist",
  promptTemplatesFolder: "Semantic Todoist Sync/Prompts",
  taskGenerationPromptTemplate: "Generate Todoist task list",
  chatFontSizePx: 13,
  taskContextSummaryMaxNotes: 5,
  excludedLinkDomains: "",
  builtInPromptTemplates: [
    {
      name: "Generate Todoist task list",
      prompt: "Scan the active note or selected text and generate a Todoist-ready task list using relevant ranked vault context and the shared task instructions. Include clear main tasks and subtasks only when they are actionable.",
      mode: "tasks",
      createTasks: true,
      taskGenerationTemplate: true
    },
    {
      name: "Extract follow-ups only",
      prompt: "Scan the active note or selected text, use relevant ranked vault context, and generate only follow-up tasks. Apply the FollowUp tag rules and include enough context to act.",
      mode: "tasks",
      createTasks: true,
      taskGenerationTemplate: true
    },
    {
      name: "Schedule today's tasks",
      prompt: DEFAULT_SCHEDULE_TODAY_PROMPT,
      action: "schedule-today",
      createTasks: false,
      insertResponse: false,
      syncAfterInsert: false
    }
  ],
  mainTaskInstructions: "Review the source together with relevant ranked vault context and identify tasks that are required to be actioned or completed. Create a detailed list of tasks with brief context for each. Each task should be no longer than 250 characters. Do not group unrelated items under one main task. Main tasks and subtasks should refer to the same project or program.",
  subtaskInstructions: "Create subtasks only when they are required and supported by the source or relevant ranked vault context. Subtasks should be clear actionable items, not background information.",
  sectionTitleInstructions: "Create one Todoist section for all tasks from the same source. For Notes-To-Todoist, use Notes_YY_MM_DD_Subject based on the note date and note subject. For Email-To-Todoist, use Email_YY_MM_DD_Subject based on the email received date and email subject.",
  dateInstructions: "Determine a task completion deadline and a due date for each main task based on urgency, priority, and complexity. Do not add due dates to subtasks. Avoid weekends and the holidays that apply to the user's locale.",
  tagInstructions: "Only create Todoist labels that are explicitly named in these instructions. Add labels only when the source content clearly matches a configured rule.",
  priorityInstructions: "Assign priority 1 to 4 to each task and subtask, where 4 is highest priority and 1 is no priority.",
  descriptionInstructions: "Include concise, actionable context from the source and relevant ranked vault context so the task can be completed without rereading every note. Focus on people, documents, decisions, dependencies, timing, constraints, and next information needed. Do not open by naming the source note, source subject, or filename.",
  emailMainTaskInstructions: "Review the email chain together with relevant ranked vault context and identify only items that clearly require my action, follow-up, review, decision, or completion. Requests for my review, comments, tracked changes, verification of accuracy, or confirmation of gaps in a draft document are actionable even when phrased politely or sent to multiple recipients. Exclude informational updates, vague possibilities, and tasks owned by others unless I need to follow up on them. Create detailed Todoist tasks that preserve enough email and vault context to act without rereading the full thread.",
  emailSubtaskInstructions: "Create email subtasks only for concrete steps required to complete the parent task and supported by the email or relevant ranked vault context. Do not create subtasks for background details, simple reminders, or loosely related information.",
  emailSectionTitleInstructions: "Create one Todoist section for all tasks from the same email using Email_YY_MM_DD_Subject based on the email received date and subject.",
  emailDateInstructions: "Determine due dates and deadlines from the email's urgency, stated dates, complexity, and sender expectations. Avoid weekends and the holidays that apply to the user's locale. Do not add due dates to subtasks.",
  emailTagInstructions: "Only create Todoist labels explicitly named here. Suggested starter rule: create tasks for follow-up items and add #FollowUp. Add more label rules in plain language for your own people, teams, or projects.",
  emailPriorityInstructions: "Assign priority 1 to 4 to each email-derived task and subtask, where 4 is highest priority and 1 is no priority.",
  emailDescriptionInstructions: "Include concise, actionable email-thread context and relevant ranked vault context so the task can be completed without rereading the full thread. Focus on people, decisions, dependencies, timing, constraints, and next information needed. Do not open by naming the email subject or source file.",
  noteMainTaskInstructions: "Review the active note or selected note text together with relevant ranked vault context and identify only items that clearly require my action, follow-up, review, decision, or completion. Requests for my review, comments, tracked changes, verification of accuracy, or confirmation of gaps in a draft document are actionable even when phrased politely or sent to multiple recipients. Strongly prioritize items I manually marked with #todo and nearby context. Exclude informational discussion, ideas owned by others, vague possibilities, and simple reminders unless the note indicates I need to act or follow up. Create detailed Todoist tasks that reflect the note's current state.",
  noteSubtaskInstructions: "Create note subtasks only for concrete steps required to complete the parent task and supported by the note or relevant ranked vault context. Do not create subtasks for background details, simple reminders, or loosely related information.",
  noteSectionTitleInstructions: "Create one Todoist section for all tasks from the same note using Notes_YY_MM_DD_Subject based on the note date and note subject.",
  noteDateInstructions: "Determine due dates and deadlines from the note's timing, urgency, complexity, and any explicit dates. Avoid weekends and the holidays that apply to the user's locale. Do not add due dates to subtasks.",
  noteTagInstructions: "Only create Todoist labels explicitly named here. Suggested starter rule: create tasks for follow-up items and add #FollowUp. Add more label rules in plain language for your own people, teams, or projects.",
  notePriorityInstructions: "Assign priority 1 to 4 to each note-derived task and subtask, where 4 is highest priority and 1 is no priority.",
  noteDescriptionInstructions: "Include concise, actionable note context and relevant ranked vault context so the task can be completed without rereading every note. Focus on people, documents, decisions, dependencies, timing, constraints, and next information needed. Do not open by naming the active note, source note title, or filename."
};

module.exports = class SemanticTodoistSyncPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.queryEmbeddingCache = new Map();
    this.semanticChunkTermCache = new Map();
    this.semanticIndexPathMeta = new Map();
    this.semanticIndexKnownShardFiles = [];
    this.semanticIndexStorageFingerprint = "";
    this.semanticIndexLoaded = false;
    this.semanticIndexLoadInProgress = false;
    this.semanticIndexLoadPromise = null;
    this.semanticIndexLoadTimer = null;
    this.semanticIndexPathMetaSnapshotFingerprint = "";
    this.semanticIndexReshardTimer = null;
    this.semanticIndexWarmupInProgress = false;
    this.semanticIndexWarmupFingerprint = "";
    this.semanticIndexWarmupPendingFingerprint = "";
    this.taskReferenceIndex = emptyTaskReferenceIndex();
    this.taskReferenceStateRevision = 0;
    this.taskReferenceIndexRevision = -1;
    this.taskReferenceSnapshotFingerprint = "";
    this.taskReferenceSnapshotDirty = true;
    this.schedulerMemory = emptySchedulerMemory();
    this.schedulerMemoryDirty = false;
    this.schedulerMemorySaveTimer = null;
    this.aiActivity = "";
    this.pendingIndexPaths = new Set();
    this.syncInProgress = false;
    this.schedulerInProgress = false;
    this.emailProcessingInProgress = false;
    this.semanticIndexInProgress = false;
    this.semanticIndexOptimizeInProgress = false;
    this.internalNoteWriteUntil = new Map();
    await this.loadSchedulerMemory();
    await this.loadTaskReferenceSnapshot();
    if (this.taskReferenceIndexRevision !== this.taskReferenceStateRevision) this.refreshTaskReferenceIndex();
    await this.migrateSettings();
    if (this.taskReferenceIndexRevision !== this.taskReferenceStateRevision) this.refreshTaskReferenceIndex();
    this.semanticIndexStartupQuietUntil = Date.now() + SEMANTIC_INDEX_STARTUP_QUIET_MS;
    await this.loadSemanticIndexPathMetaSnapshot();
    const compatibleIndexLoaded = await this.ensureCompatibleEmbeddingForChatModel({ loadIndex: false });
    if (!compatibleIndexLoaded) this.queueSemanticIndexLoad();
    this.queueSemanticIndexWarmup();
    const activeMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView);
    this.lastActiveMarkdownLeaf = activeMarkdown?.leaf || null;
    this.addSettingTab(new SemanticTodoistSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => new SemanticTodoistView(leaf, this));

    this.addRibbonIcon("list-checks", "Semantic Todoist Sync", () => this.openSidebar());
    this.addCommand({ id: "semantic-todoist-open-sidebar", name: "Open sidebar", callback: () => this.openSidebar() });
    this.addCommand({ id: "semantic-todoist-rebuild-index", name: "Rebuild semantic vault index", callback: () => this.rebuildSemanticIndex(true) });
    this.addCommand({ id: "semantic-todoist-ask", name: "Ask AI with active context", callback: () => this.askFromActiveContext() });
    this.addCommand({ id: "semantic-todoist-prompt-gpt", name: "Prompt AI from command palette", callback: () => this.promptGptFromCommandPalette() });
    this.addCommand({ id: "semantic-todoist-run-task-template", name: "Run prompts", callback: () => this.runTaskTemplateFromCommandPalette() });
    this.addCommand({ id: "semantic-todoist-search", name: "Search vault semantically", callback: () => this.searchFromSelection() });
    this.addCommand({ id: "semantic-todoist-process-email", name: "Process pending email tasks", callback: () => this.processPendingEmails() });
    this.addCommand({ id: "semantic-todoist-note-to-tasks", name: "Create Todoist tasks from active note", callback: () => this.createTasksFromActiveNote() });
    this.addCommand({ id: "semantic-todoist-schedule-today", name: "Schedule today's tasks", callback: () => this.openScheduleTodayPreview() });
    this.addCommand({ id: "semantic-todoist-undo-schedule-today", name: "Undo last schedule today apply", callback: () => this.undoLastScheduleToday(true) });
    this.addCommand({ id: "semantic-todoist-sync-notes", name: "Sync note tasks with Todoist", callback: () => this.syncNoteTasks() });
    this.addCommand({ id: "semantic-todoist-rebuild-references", name: "Rebuild local Todoist reference table", callback: () => this.rebuildTodoistReferenceTable(true) });
    this.addCommand({ id: "semantic-todoist-repair-subtask-indentation", name: "Repair synced subtask indentation", callback: () => this.repairCachedSubtaskIndentation(true, { force: true, scanAll: true }) });

    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.handleActiveLeafChange(leaf)));
    this.registerEvent(this.app.workspace.on("file-open", () => this.notifySidebarActiveNoteChanged()));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const internalWrite = this.isInternalNoteWrite(file.path);
      if (internalWrite) return;
      this.queueSemanticIndexUpdate(file.path, "modify");
      if (this.settings.notesAutoSync && this.settings.todoistToken) this.queueNoteSync(file.path);
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") this.queueSemanticIndexUpdate(file.path, "create");
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && file.extension === "md") this.removePathFromSemanticIndex(file.path);
    }));

    this.registerInterval(window.setInterval(() => this.backgroundTick(), 30000));
    this.registerInterval(window.setTimeout(() => this.ensurePromptTemplateFolder(false), STARTUP_PROMPT_TEMPLATE_SETUP_DELAY_MS));
    this.registerInterval(window.setTimeout(() => this.backgroundTick(), STARTUP_BACKGROUND_TICK_DELAY_MS));
    this.registerInterval(window.setTimeout(() => this.repairCachedSubtaskIndentation(false), STARTUP_SUBTASK_REPAIR_DELAY_MS));
  }

  async onunload() {
    await this.flushQueuedSettingsSave().catch((error) => console.error("Queued settings flush failed", error));
    window.clearTimeout(this.semanticIndexLoadTimer);
    this.semanticIndexLoadTimer = null;
    window.clearTimeout(this.semanticIndexReshardTimer);
    this.semanticIndexReshardTimer = null;
    window.clearTimeout(this.taskReferenceSnapshotTimer);
    this.taskReferenceSnapshotTimer = null;
    window.clearTimeout(this.schedulerMemorySaveTimer);
    this.schedulerMemorySaveTimer = null;
    await this.flushTaskReferenceSnapshotIfDirty().catch((error) => console.error("Task reference snapshot flush failed", error));
    await this.flushSchedulerMemoryIfDirty().catch((error) => console.error("Scheduler memory flush failed", error));
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async saveSettings() {
    window.clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = null;
    this.settingsSaveQueued = false;
    await this.flushTaskReferenceSnapshotIfDirty();
    await this.saveData(settingsWithoutTaskReferenceTables(this.settings));
  }

  queueSettingsSave(delayMs = 4000) {
    this.settingsSaveQueued = true;
    window.clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = window.setTimeout(() => {
      this.settingsSaveTimer = null;
      this.flushQueuedSettingsSave().catch((error) => console.error("Queued settings save failed", error));
    }, delayMs);
  }

  async flushQueuedSettingsSave() {
    if (!this.settingsSaveQueued) return false;
    window.clearTimeout(this.settingsSaveTimer);
    this.settingsSaveTimer = null;
    this.settingsSaveQueued = false;
    await this.saveData(settingsWithoutTaskReferenceTables(this.settings));
    return true;
  }

  async loadSchedulerMemory() {
    try {
      const raw = await this.app.vault.adapter.read(`${this.manifest.dir}/${SCHEDULER_MEMORY_FILE}`);
      const parsed = JSON.parse(raw || "{}");
      this.schedulerMemory = normalizeSchedulerMemory(parsed);
      this.schedulerMemoryDirty = false;
      const policies = Array.isArray(parsed?.durationPolicies) ? parsed.durationPolicies : [];
      const hasCanonicalPolicy = policies.some((policy) => policy?.id === SCHEDULER_PEOPLE_FOLLOWUP_POLICY_ID);
      const hasLegacyPolicy = policies.some((policy) => SCHEDULER_PEOPLE_FOLLOWUP_POLICY_ALIASES.includes(policy?.id));
      if (!hasCanonicalPolicy || hasLegacyPolicy) this.markSchedulerMemoryDirty(1000);
    } catch {
      this.schedulerMemory = emptySchedulerMemory();
      this.schedulerMemoryDirty = false;
      this.markSchedulerMemoryDirty(1000);
    }
  }

  markSchedulerMemoryDirty(delayMs = 2500) {
    this.schedulerMemoryDirty = true;
    window.clearTimeout(this.schedulerMemorySaveTimer);
    this.schedulerMemorySaveTimer = window.setTimeout(() => {
      this.schedulerMemorySaveTimer = null;
      this.flushSchedulerMemoryIfDirty().catch((error) => console.error("Scheduler memory save failed", error));
    }, delayMs);
  }

  async flushSchedulerMemoryIfDirty() {
    if (!this.schedulerMemoryDirty) return false;
    window.clearTimeout(this.schedulerMemorySaveTimer);
    this.schedulerMemorySaveTimer = null;
    const compact = compactSchedulerMemory(this.schedulerMemory);
    compact.updatedAt = deviceTimestamp();
    await this.app.vault.adapter.write(`${this.manifest.dir}/${SCHEDULER_MEMORY_FILE}`, JSON.stringify(compact));
    this.schedulerMemory = compact;
    this.schedulerMemoryDirty = false;
    return true;
  }

  applySchedulerMemoryToCandidates(candidates) {
    let matched = 0;
    const durationPolicies = schedulerMemoryDurationPolicies(this.schedulerMemory);
    for (const candidate of candidates || []) {
      const memory = schedulerMemoryForCandidate(this.schedulerMemory, candidate);
      if (!memory) continue;
      matched += 1;
      candidate.schedulerMemory = memory;
      const learnedMinutes = learnedSchedulerDurationMinutes(memory);
      if (!candidate.durationMinutes && learnedMinutes) {
        const config = scheduleTodayConfig(this.settings);
        const rounded = roundToScheduleChunk(learnedMinutes, config);
        const adjusted = scheduleDurationWithLocalPolicy(candidate, rounded, config, durationPolicies);
        candidate.durationMinutes = adjusted;
        candidate.durationSource = `${memory.exact ? "scheduler memory" : "similar scheduler memory"}${adjusted < rounded ? "; capped for follow-up" : ""}`;
      }
      candidate.score += schedulerMemoryScoreAdjustment(memory);
      candidate.searchText = [candidate.searchText, schedulerMemoryContextText(memory)].filter(Boolean).join("\n");
    }
    return matched;
  }

  observeSchedulerMemoryForTask(id, task, source = "cache") {
    if (!task || !task.content) return false;
    const entry = schedulerMemoryEntry(this.schedulerMemory, Object.assign({}, task, { id }));
    if (!entry) return false;
    const before = JSON.stringify(entry);
    updateSchedulerMemoryEntry(entry, task, {
      source,
      observedAt: deviceTimestamp(),
      durationMinutes: durationMinutes(task.duration),
      scheduledDateTime: task.scheduledDueDateTime || "",
      scheduledDate: task.scheduledDueDateTime ? datePart(task.scheduledDueDateTime) : task.due_date || "",
      contextPaths: [task.path].filter(Boolean),
      outcome: "observed"
    });
    if (JSON.stringify(entry) !== before) {
      this.markSchedulerMemoryDirty();
      return true;
    }
    return false;
  }

  recordSchedulerPreviewMemory(candidates, context = []) {
    let changed = false;
    const contextPaths = (context || []).map((chunk) => chunk.path).filter(Boolean).slice(0, 8);
    for (const candidate of candidates || []) {
      const entry = schedulerMemoryEntry(this.schedulerMemory, candidate);
      if (!entry) continue;
      const before = JSON.stringify(entry);
      updateSchedulerMemoryEntry(entry, candidate, {
        source: "preview",
        observedAt: deviceTimestamp(),
        durationMinutes: candidate.durationMinutes,
        scheduledDateTime: candidate.scheduledDueDateTime || candidate.dueDate || "",
        scheduledDate: candidate.dueDay || datePart(candidate.dueDate),
        contextPaths,
        outcome: "candidate"
      });
      if (JSON.stringify(entry) !== before) changed = true;
    }
    if (changed) this.markSchedulerMemoryDirty();
    return changed;
  }

  recordSchedulerApplyMemory(preview, scheduled, created = []) {
    const config = preview?.config || scheduleTodayConfig(this.settings);
    const ordered = (scheduled || []).slice().sort((a, b) => a.startMinutes - b.startMinutes || String(a.content).localeCompare(String(b.content)));
    const contextPaths = (preview?.context || []).map((chunk) => chunk.path).filter(Boolean).slice(0, 8);
    let changed = false;
    ordered.forEach((item, index) => {
      const entry = schedulerMemoryEntry(this.schedulerMemory, item);
      if (!entry) return;
      const before = JSON.stringify(entry);
      updateSchedulerMemoryEntry(entry, item, {
        source: "apply",
        observedAt: deviceTimestamp(),
        durationMinutes: item.durationMinutes,
        scheduledDateTime: item.scheduledDateTime,
        scheduledDate: config.today,
        contextPaths,
        orderIndex: index,
        orderTotal: ordered.length,
        startMinutes: item.startMinutes,
        score: item.score,
        outcome: item.promotedFromSuggestion ? "promoted" : "scheduled",
        manualDurationChange: Boolean(item.previewDurationChanged),
        manualOrderChange: Boolean(item.previewOrderChanged)
      });
      if (JSON.stringify(entry) !== before) changed = true;
    });
    for (const item of preview?.bumped || []) {
      const entry = schedulerMemoryEntry(this.schedulerMemory, item);
      if (!entry) continue;
      const before = JSON.stringify(entry);
      updateSchedulerMemoryEntry(entry, item, {
        source: "preview",
        observedAt: deviceTimestamp(),
        durationMinutes: item.durationMinutes,
        scheduledDate: config.today,
        contextPaths,
        outcome: "bumped",
        score: item.score
      });
      if (JSON.stringify(entry) !== before) changed = true;
    }
    for (const item of created || []) {
      const entry = schedulerMemoryEntry(this.schedulerMemory, item);
      if (!entry) continue;
      const before = JSON.stringify(entry);
      updateSchedulerMemoryEntry(entry, item, {
        source: "apply",
        observedAt: deviceTimestamp(),
        durationMinutes: item.durationMinutes,
        scheduledDateTime: item.scheduledDateTime,
        scheduledDate: datePart(item.scheduledDateTime),
        contextPaths,
        outcome: "created-continuation"
      });
      if (JSON.stringify(entry) !== before) changed = true;
    }
    if (changed) this.markSchedulerMemoryDirty();
    return changed;
  }

  async loadTaskReferenceSnapshot() {
    const readJsonFile = async (fileName) => {
      try {
        const raw = await this.app.vault.adapter.read(`${this.manifest.dir}/${fileName}`);
        return JSON.parse(raw || "{}");
      } catch {
        return null;
      }
    };
    const [parsedIndex, snapshot] = await Promise.all([
      readJsonFile(TASK_REFERENCE_INDEX_FILE),
      readJsonFile(TASK_REFERENCE_SNAPSHOT_FILE)
    ]);
    const persistedIndex = parsedIndex ? parsedIndex.index || parsedIndex : null;
    if (snapshot) {
      const currentCount = Object.keys(this.settings.taskCache || {}).length;
      const snapshotCount = Object.keys(snapshot.taskCache || {}).length;
      if (snapshotCount && snapshotCount >= currentCount) {
        this.settings.taskCache = snapshot.taskCache || {};
        this.settings.pendingTaskReferences = snapshot.pendingTaskReferences || {};
        this.settings.pendingTaskDescriptions = snapshot.pendingTaskDescriptions || {};
        this.settings.taskReferenceSnapshotMeta = snapshot.meta || {};
      }
      const compactIndex = persistedIndex || snapshot.index || null;
      if (compactIndex) {
        this.taskReferenceIndex = hydrateTaskReferenceIndex(compactIndex, this.settings);
        this.taskReferenceIndexRevision = this.taskReferenceStateRevision;
      }
      this.taskReferenceSnapshotFingerprint = snapshot.meta?.fingerprint || compactIndex?.fingerprint || taskReferencePayloadFingerprint(this.settings);
      this.taskReferenceSnapshotDirty = false;
      return;
    }
    if (persistedIndex) {
      this.taskReferenceIndex = hydrateTaskReferenceIndex(persistedIndex, this.settings);
      this.taskReferenceIndexRevision = this.taskReferenceStateRevision;
    }
    this.taskReferenceSnapshotFingerprint = taskReferencePayloadFingerprint(this.settings);
    this.taskReferenceSnapshotDirty = Object.keys(this.settings.taskCache || {}).length > 0 || Object.keys(this.settings.pendingTaskReferences || {}).length > 0;
  }

  refreshTaskReferenceIndex() {
    const deduped = dedupeTaskReferenceState(this.settings);
    this.taskReferenceIndex = buildTaskReferenceIndex(this.settings);
    Object.defineProperty(this.settings, "__taskReferenceUsedOids", {
      value: new Set(this.taskReferenceIndex.usedOids),
      writable: true,
      configurable: true,
      enumerable: false
    });
    if (deduped) this.taskReferenceSnapshotDirty = true;
    this.taskReferenceIndexRevision = this.taskReferenceStateRevision;
    return this.taskReferenceIndex;
  }

  getTaskReferenceIndex() {
    if (!this.taskReferenceIndex || this.taskReferenceIndexRevision !== this.taskReferenceStateRevision) {
      return this.refreshTaskReferenceIndex();
    }
    return this.taskReferenceIndex;
  }

  markTaskReferenceStateDirty() {
    this.taskReferenceStateRevision += 1;
    this.taskReferenceSnapshotDirty = true;
    this.queueTaskReferenceSnapshotWrite();
  }

  queueTaskReferenceSnapshotWrite(delayMs = 2500) {
    window.clearTimeout(this.taskReferenceSnapshotTimer);
    this.taskReferenceSnapshotTimer = window.setTimeout(() => {
      this.taskReferenceSnapshotTimer = null;
      this.flushTaskReferenceSnapshotIfDirty().catch((error) => console.error("Task reference snapshot save failed", error));
    }, delayMs);
  }

  async flushTaskReferenceSnapshotIfDirty() {
    if (!this.taskReferenceSnapshotDirty && this.taskReferenceIndexRevision === this.taskReferenceStateRevision && this.taskReferenceSnapshotFingerprint) return false;
    this.refreshTaskReferenceIndex();
    const fingerprint = this.taskReferenceIndex.fingerprint || taskReferencePayloadFingerprint(this.settings);
    if (!this.taskReferenceSnapshotDirty && fingerprint === this.taskReferenceSnapshotFingerprint) return false;
    const meta = {
      version: 1,
      updatedAt: deviceTimestamp(),
      fingerprint,
      taskCount: Object.keys(this.settings.taskCache || {}).length,
      pendingReferenceCount: Object.keys(this.settings.pendingTaskReferences || {}).length,
      pendingDescriptionCount: Object.keys(this.settings.pendingTaskDescriptions || {}).length
    };
    const persistentIndex = persistentTaskReferenceIndex(this.taskReferenceIndex);
    const body = JSON.stringify({
      meta,
      index: persistentIndex,
      taskCache: this.settings.taskCache || {},
      pendingTaskReferences: this.settings.pendingTaskReferences || {},
      pendingTaskDescriptions: this.settings.pendingTaskDescriptions || {}
    });
    await this.app.vault.adapter.write(`${this.manifest.dir}/${TASK_REFERENCE_SNAPSHOT_FILE}`, body);
    await this.app.vault.adapter.write(`${this.manifest.dir}/${TASK_REFERENCE_INDEX_FILE}`, JSON.stringify({ meta, index: persistentIndex }));
    this.settings.taskReferenceSnapshotMeta = meta;
    this.taskReferenceSnapshotFingerprint = fingerprint;
    this.taskReferenceSnapshotDirty = false;
    return true;
  }

  async migrateSettings() {
    let changed = false;
    if ((parseInt(this.settings.emailPollIntervalSeconds, 10) || 0) < MIN_EMAIL_AUTO_POLL_INTERVAL_SECONDS) {
      this.settings.emailPollIntervalSeconds = MIN_EMAIL_AUTO_POLL_INTERVAL_SECONDS;
      changed = true;
    }
    const retrievalDefaults = [
      ["maxChatContextChunks", 8, DEFAULT_SETTINGS.maxChatContextChunks],
      ["maxTaskContextChunks", 6, DEFAULT_SETTINGS.maxTaskContextChunks],
      ["maxContextChars", 7000, DEFAULT_SETTINGS.maxContextChars],
      ["semanticIndexMaxChunkChars", 900, DEFAULT_SETTINGS.semanticIndexMaxChunkChars],
      ["semanticIndexMaxChunksPerNote", 12, DEFAULT_SETTINGS.semanticIndexMaxChunksPerNote],
      ["semanticIndexEmbeddingPrecision", 3, DEFAULT_SETTINGS.semanticIndexEmbeddingPrecision]
    ];
    for (const [key, oldDefault, newDefault] of retrievalDefaults) {
      if (this.settings[key] === oldDefault) {
        this.settings[key] = newDefault;
        changed = true;
      }
    }
    if (!this.settings.chatModel) {
      this.settings.chatModel = DEFAULT_SETTINGS.chatModel;
      changed = true;
    }
    if (normalizeOpenAIModelId(this.settings.chatModel) === "gpt-5.4-mini" && normalizeOpenAIModelId(this.settings.chatFallbackModel) === "gpt-5.4") {
      this.settings.chatModel = DEFAULT_SETTINGS.chatModel;
      this.settings.chatFallbackModel = DEFAULT_SETTINGS.chatFallbackModel;
      changed = true;
    }
    if (Array.isArray(this.settings.availableChatModels) && this.settings.availableChatModels.join("|") === "gpt-5.4-mini|gpt-5.4") {
      this.settings.availableChatModels = DEFAULT_SETTINGS.availableChatModels.slice();
      changed = true;
    }
    const normalizedProviderSetting = normalizeAiProvider(this.settings.aiModelProvider, aiProviderForModel(this.settings.chatModel));
    if (this.settings.aiModelProvider !== normalizedProviderSetting) {
      this.settings.aiModelProvider = normalizedProviderSetting;
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(this.settings, "enableStrongModelEscalation")) {
      delete this.settings.enableStrongModelEscalation;
      changed = true;
    }
    if (!this.settings.chatFallbackModel && usesOpenAIChatModel(this.settings.chatModel)) {
      this.settings.chatFallbackModel = DEFAULT_SETTINGS.chatFallbackModel;
      changed = true;
    }
    const dedupeDefaults = {
      enableTaskDeduplication: DEFAULT_SETTINGS.enableTaskDeduplication,
      taskDeduplicationStrictness: DEFAULT_SETTINGS.taskDeduplicationStrictness,
      taskDeduplicationMergeLabelsAdditive: DEFAULT_SETTINGS.taskDeduplicationMergeLabelsAdditive,
      taskDeduplicationAllowExplicitSubtaskRemoval: DEFAULT_SETTINGS.taskDeduplicationAllowExplicitSubtaskRemoval,
      enableAiAmbiguousTaskDeduplication: DEFAULT_SETTINGS.enableAiAmbiguousTaskDeduplication,
      taskDeduplicationAiReviewSensitivity: DEFAULT_SETTINGS.taskDeduplicationAiReviewSensitivity,
      taskDeduplicationAiModel: DEFAULT_SETTINGS.taskDeduplicationAiModel,
      taskDeduplicationPolicy: DEFAULT_SETTINGS.taskDeduplicationPolicy,
      taskDeduplicationPolicyUpdates: DEFAULT_SETTINGS.taskDeduplicationPolicyUpdates,
      taskDeduplicationLastRunSummary: DEFAULT_SETTINGS.taskDeduplicationLastRunSummary
    };
    for (const [key, value] of Object.entries(dedupeDefaults)) {
      if (this.settings[key] == null || (typeof value === "string" && !this.settings[key])) {
        this.settings[key] = Array.isArray(value) ? value.slice() : value;
        changed = true;
      }
    }
    const calibratedDedupePolicy = calibratedTaskDeduplicationPolicyText(this.settings.taskDeduplicationPolicy);
    if (this.settings.taskDeduplicationPolicy !== calibratedDedupePolicy) {
      this.settings.taskDeduplicationPolicy = calibratedDedupePolicy;
      changed = true;
    }
    if (!this.settings.googleApiKey) {
      this.settings.googleApiKey = DEFAULT_SETTINGS.googleApiKey;
      changed = true;
    }
    if (!Array.isArray(this.settings.availableGeminiModels) || !this.settings.availableGeminiModels.length) {
      this.settings.availableGeminiModels = DEFAULT_SETTINGS.availableGeminiModels;
      changed = true;
    }
    if (!Array.isArray(this.settings.availableGeminiEmbeddingModels) || !this.settings.availableGeminiEmbeddingModels.length) {
      this.settings.availableGeminiEmbeddingModels = DEFAULT_SETTINGS.availableGeminiEmbeddingModels;
      changed = true;
    }
    const preferredProvider = normalizeAiProvider(this.settings.aiModelProvider, aiProviderForModel(this.settings.chatModel));
    if ((preferredProvider === "gemini" && !usesGeminiChatModel(this.settings.chatModel)) || (preferredProvider === "openai" && !usesOpenAIChatModel(this.settings.chatModel))) {
      this.settings.chatModel = preferredChatModelForProvider(this.settings, preferredProvider);
      this.settings.chatFallbackModel = preferredFallbackModelForProvider(this.settings, preferredProvider, this.settings.chatModel);
      this.settings.embeddingModel = preferredEmbeddingModelForProvider(this.settings, preferredProvider);
      changed = true;
    }
    if (this.settings.taskDeduplicationAiModel && aiProviderForModel(this.settings.taskDeduplicationAiModel) !== preferredProvider) {
      this.settings.taskDeduplicationAiModel = "";
      changed = true;
    }
    if (usesGeminiChatModel(this.settings.chatModel) && !usesGeminiEmbeddingModel(this.settings.embeddingModel)) {
      this.settings.embeddingModel = "gemini/gemini-embedding-2";
      changed = true;
    }
    if (usesOpenAIChatModel(this.settings.chatModel) && !usesOpenAIEmbeddingModel(this.settings.embeddingModel)) {
      this.settings.embeddingModel = DEFAULT_SETTINGS.embeddingModel;
      changed = true;
    }
    if (this.settings.syncTag === "#tdsync" || this.settings.syncTag === "tdsync") {
      this.settings.syncTag = "#STsync";
      changed = true;
    }
    if (this.settings.subtaskSyncTag === "#tdsyncsub" || this.settings.subtaskSyncTag === "tdsyncsub") {
      this.settings.subtaskSyncTag = "#STSubSync";
      changed = true;
    }
    if (!this.settings.emailLogFolder || this.settings.emailLogFolder === "Email-To-Todoist") {
      this.settings.emailLogFolder = DEFAULT_SETTINGS.emailLogFolder;
      changed = true;
    }
    if (!this.settings.excludedFolders || this.settings.excludedFolders === "Email-To-Todoist" || this.settings.excludedFolders === DEFAULT_SETTINGS.emailLogFolder) {
      this.settings.excludedFolders = DEFAULT_SETTINGS.excludedFolders;
      changed = true;
    } else if (splitList(this.settings.excludedFolders).includes("Email-To-Todoist")) {
      const folders = splitList(this.settings.excludedFolders).map((folder) => folder === "Email-To-Todoist" ? PLUGIN_DATA_FOLDER : folder);
      this.settings.excludedFolders = normalizedExcludedFolders(folders).join(", ");
      changed = true;
    } else if (!isFolderExcluded(PLUGIN_DATA_FOLDER, splitList(this.settings.excludedFolders).map(trimSlashes))) {
      this.settings.excludedFolders = normalizedExcludedFolders(splitList(this.settings.excludedFolders).concat(PLUGIN_DATA_FOLDER)).join(", ");
      changed = true;
    }
    const descriptionUpdates = {
      descriptionInstructions: [
        "Include the source subject or note title, useful context, and links to referenced files in the Todoist description. Separate details with periods. Do not include preamble.",
        DEFAULT_SETTINGS.descriptionInstructions
      ],
      emailDescriptionInstructions: [
        "Include the email subject, concise thread context, useful vault context, and links to referenced files in the Todoist description. Separate details with periods. Do not include preamble.",
        DEFAULT_SETTINGS.emailDescriptionInstructions
      ],
      noteDescriptionInstructions: [
        "Include the source note title, concise note context, useful vault context, and relevant links in the Todoist description. Separate details with periods. Do not include preamble.",
        DEFAULT_SETTINGS.noteDescriptionInstructions
      ]
    };
    descriptionUpdates.descriptionInstructions.push(
      "Include the source subject or note title, useful source context, and relevant ranked vault context in the Todoist description. Include directly relevant referenced links or files only when they are available and not excluded by settings. Do not mention whether links or linked files were found or missing. Separate details with periods. Do not include preamble."
    );
    descriptionUpdates.emailDescriptionInstructions.push(
      "Include the email subject, concise thread context, and relevant ranked vault context in the Todoist description. Include directly relevant referenced links or files only when they are available and not excluded by settings. Do not mention whether links or linked files were found or missing. Separate details with periods. Do not include preamble."
    );
    descriptionUpdates.noteDescriptionInstructions.push(
      "Include the source note title, concise note context, and relevant ranked vault context in the Todoist description. Include directly relevant referenced links or files only when they are available and not excluded by settings. Do not mention whether links or linked files were found or missing. Separate details with periods. Do not include preamble."
    );
    for (const [key, [oldValue, newValue]] of Object.entries(descriptionUpdates)) {
      if (this.settings[key] === oldValue || descriptionUpdates[key].slice(2).includes(this.settings[key])) {
        this.settings[key] = newValue;
        changed = true;
      }
    }
    const taskInstructionUpdates = {
      mainTaskInstructions: [
        "Review the tasks that are required to be actioned or completed. Create a detailed list of tasks with brief context for each. Each task should be no longer than 250 characters. Do not group unrelated items under one main task. Main tasks and subtasks should refer to the same project or program.",
        DEFAULT_SETTINGS.mainTaskInstructions
      ],
      subtaskInstructions: [
        "Create subtasks only when they are required. Subtasks should be clear actionable items, not background information.",
        DEFAULT_SETTINGS.subtaskInstructions
      ],
      emailMainTaskInstructions: [
        "Review the email chain and identify only items that clearly require my action, follow-up, review, decision, or completion. Exclude informational updates, vague possibilities, and tasks owned by others unless I need to follow up on them. Create detailed Todoist tasks that preserve enough email context to act without rereading the full thread.",
        "Review the email chain together with relevant ranked vault context and identify only items that clearly require my action, follow-up, review, decision, or completion. Exclude informational updates, vague possibilities, and tasks owned by others unless I need to follow up on them. Create detailed Todoist tasks that preserve enough email and vault context to act without rereading the full thread.",
        DEFAULT_SETTINGS.emailMainTaskInstructions
      ],
      emailSubtaskInstructions: [
        "Create email subtasks only for concrete steps required to complete the parent task. Do not create subtasks for background details, simple reminders, or loosely related information.",
        DEFAULT_SETTINGS.emailSubtaskInstructions
      ],
      noteMainTaskInstructions: [
        "Review the active note or selected note text and identify only items that clearly require my action, follow-up, review, decision, or completion. Strongly prioritize items I manually marked with #todo and nearby context. Exclude informational discussion, ideas owned by others, vague possibilities, and simple reminders unless the note indicates I need to act or follow up. Create detailed Todoist tasks that reflect the note's current state.",
        "Review the active note or selected note text together with relevant ranked vault context and identify only items that clearly require my action, follow-up, review, decision, or completion. Strongly prioritize items I manually marked with #todo and nearby context. Exclude informational discussion, ideas owned by others, vague possibilities, and simple reminders unless the note indicates I need to act or follow up. Create detailed Todoist tasks that reflect the note's current state.",
        DEFAULT_SETTINGS.noteMainTaskInstructions
      ],
      noteSubtaskInstructions: [
        "Create note subtasks only for concrete steps required to complete the parent task. Do not create subtasks for background details, simple reminders, or loosely related information.",
        DEFAULT_SETTINGS.noteSubtaskInstructions
      ]
    };
    for (const [key, [oldValue, newValue]] of Object.entries(taskInstructionUpdates)) {
      if (this.settings[key] === oldValue) {
        this.settings[key] = newValue;
        changed = true;
      }
    }
    const validTaskCache = {};
    const basePath = vaultBasePath(this.app);
    for (const [todoistId, task] of Object.entries(this.settings.taskCache || {})) {
      if (task?.oid) {
        const normalized = normalizeStoredTaskReferencePaths(task, basePath);
        validTaskCache[todoistId] = normalized;
        if (JSON.stringify(normalized) !== JSON.stringify(task)) changed = true;
      }
      else changed = true;
    }
    this.settings.taskCache = validTaskCache;
    const validPendingReferences = {};
    for (const [key, reference] of Object.entries(this.settings.pendingTaskReferences || {})) {
      if (reference?.oid) {
        const normalized = normalizeStoredTaskReferencePaths(reference, basePath);
        const nextKey = pendingTaskOidKey(normalized.path || reference.path || "", normalized.oid);
        validPendingReferences[nextKey] = normalized;
        if (nextKey !== key || JSON.stringify(normalized) !== JSON.stringify(reference)) changed = true;
      }
      else changed = true;
    }
    this.settings.pendingTaskReferences = validPendingReferences;
    if (this.settings.pendingTaskDescriptions) {
      const normalizedDescriptions = normalizePendingDescriptionKeys(this.settings.pendingTaskDescriptions, basePath);
      if (JSON.stringify(normalizedDescriptions) !== JSON.stringify(this.settings.pendingTaskDescriptions)) changed = true;
      this.settings.pendingTaskDescriptions = normalizedDescriptions;
    }
    if (changed || this.taskReferenceSnapshotDirty) this.markTaskReferenceStateDirty();
    if (changed) await this.saveSettings();
  }

  async loadSemanticIndex() {
    window.clearTimeout(this.semanticIndexLoadTimer);
    this.semanticIndexLoadTimer = null;
    if (this.semanticIndexLoadPromise) return this.semanticIndexLoadPromise;
    this.semanticIndexLoadPromise = this.loadSemanticIndexInternal();
    try {
      return await this.semanticIndexLoadPromise;
    } finally {
      this.semanticIndexLoadPromise = null;
    }
  }

  async loadSemanticIndexInternal() {
    this.semanticIndexLoadInProgress = true;
    this.refreshSidebarStatus();
    try {
      this.semanticChunkTermCache?.clear?.();
      this.semanticIndexPathMeta?.clear?.();
      this.semanticIndex = [];
      this.semanticIndexLoaded = false;
      const indexFile = this.semanticIndexFileName();
      this.semanticIndexStats = { bytes: 0, path: indexFile };
      let shouldRewriteShardedIndex = false;
      let settingsChanged = false;
      const applyLoaded = async (loaded, file, extraMeta = {}) => {
        this.semanticIndexStats = loaded.stats;
        this.semanticIndexKnownShardFiles = loaded.shardFiles || [];
        this.semanticIndexStorageFingerprint = loaded.storageFingerprint || "";
        const parsed = loaded.parsed || {};
        this.setSidebarStatus("Preparing semantic index...");
        await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
        this.semanticIndex = normalizeSemanticIndexPaths(loaded.chunks || [], this.app);
        const nextMeta = Object.assign({}, parsed.meta || {}, extraMeta, { chunks: this.semanticIndex.length, file });
        if (!shallowObjectEqual(nextMeta, this.settings.semanticIndexMeta || {})) settingsChanged = true;
        this.settings.semanticIndexMeta = nextMeta;
        const loadedShardMaxBytes = Number(parsed.meta?.shardMaxBytes || 0);
        const oversizedLegacyShards = loaded.stats.shards && loaded.stats.bytes > SEMANTIC_INDEX_SHARD_MAX_BYTES && (!loadedShardMaxBytes || loadedShardMaxBytes > SEMANTIC_INDEX_SHARD_MAX_BYTES);
        shouldRewriteShardedIndex = this.semanticIndex.length && ((!loaded.stats.shards && loaded.stats.bytes > SEMANTIC_INDEX_SHARD_MAX_BYTES) || oversizedLegacyShards);
      };
      try {
        const loaded = await this.readSemanticIndexFile(indexFile);
        await applyLoaded(loaded, indexFile);
      } catch (error) {
        if (usesOpenAIEmbeddingModel(this.settings.embeddingModel) && indexFile !== SEMANTIC_INDEX_FILE) {
          try {
            const loaded = await this.readSemanticIndexFile(SEMANTIC_INDEX_FILE);
            await applyLoaded(loaded, SEMANTIC_INDEX_FILE, { legacy: true });
          } catch {}
        }
        if (!this.semanticIndex.length && Array.isArray(this.settings.semanticIndex) && this.settings.semanticIndex.length) {
          this.semanticIndex = normalizeSemanticIndexPaths(this.settings.semanticIndex, this.app);
          delete this.settings.semanticIndex;
          settingsChanged = true;
          await this.saveSemanticIndex();
        }
      }
      if (!this.semanticIndex.length) {
        const nextMeta = {
          model: this.settings.embeddingModel,
          provider: usesGeminiEmbeddingModel(this.settings.embeddingModel) ? "gemini" : "openai",
          file: indexFile,
          chunks: 0
        };
        if (!shallowObjectEqual(nextMeta, this.settings.semanticIndexMeta || {})) settingsChanged = true;
        this.settings.semanticIndexMeta = nextMeta;
      }
      if (Array.isArray(this.settings.semanticIndex)) {
        delete this.settings.semanticIndex;
        settingsChanged = true;
      }
      if (shouldRewriteShardedIndex) this.queueSemanticIndexReshard();
      await this.refreshSemanticIndexPathMetaAsync();
      await this.saveSemanticIndexPathMetaSnapshot();
      if (settingsChanged) await this.saveSettings();
    } finally {
      this.semanticIndexLoaded = true;
      this.semanticIndexLoadInProgress = false;
      this.refreshSidebarStatus();
    }
  }

  queueSemanticIndexLoad(delayMs = STARTUP_SEMANTIC_INDEX_LOAD_DELAY_MS) {
    if (this.semanticIndexLoaded || this.semanticIndexLoadInProgress || this.semanticIndexLoadPromise) return;
    window.clearTimeout(this.semanticIndexLoadTimer);
    this.semanticIndexLoadTimer = window.setTimeout(() => {
      this.semanticIndexLoadTimer = null;
      this.loadSemanticIndexWhenIdle().catch((error) => this.logLocal("Semantic index cache load failed", { error: error.message || String(error) }));
    }, Math.max(1000, delayMs || 0));
    this.refreshSidebarStatus();
  }

  async loadSemanticIndexWhenIdle() {
    if (this.semanticIndexLoaded || this.semanticIndexLoadInProgress) return true;
    if (!this.canStartBackgroundWork()) {
      this.queueSemanticIndexLoad(30000);
      return false;
    }
    await this.loadSemanticIndex();
    this.queueSemanticIndexWarmup();
    return true;
  }

  async ensureSemanticIndexLoaded(reason = "semantic index") {
    if (this.semanticIndexLoaded && (this.semanticIndex || []).length) return true;
    window.clearTimeout(this.semanticIndexLoadTimer);
    this.semanticIndexLoadTimer = null;
    if (!this.semanticIndexLoaded) this.setSidebarStatus(`Loading ${reason}...`);
    await this.loadSemanticIndex();
    this.queueSemanticIndexWarmup();
    return Boolean((this.semanticIndex || []).length);
  }

  semanticIndexPathMetaFingerprint(meta = this.settings.semanticIndexMeta || {}) {
    return shortHash(JSON.stringify({
      model: meta.model || this.settings.embeddingModel || "",
      file: meta.file || this.semanticIndexFileName(),
      chunks: Number(meta.chunks || 0),
      rebuiltAt: meta.rebuiltAt || "",
      updatedAt: meta.updatedAt || "",
      shardCount: Number(meta.shardCount || 0),
      shardBytes: Number(meta.shardBytes || 0)
    }));
  }

  async loadSemanticIndexPathMetaSnapshot() {
    try {
      const raw = await this.app.vault.adapter.read(`${this.manifest.dir}/${SEMANTIC_INDEX_PATH_META_FILE}`);
      const parsed = JSON.parse(raw);
      const expected = this.semanticIndexPathMetaFingerprint();
      if (!parsed || parsed.metaFingerprint !== expected || !Array.isArray(parsed.entries)) return false;
      this.semanticIndexPathMeta = this.semanticIndexPathMeta || new Map();
      this.semanticIndexPathMeta.clear();
      for (const entry of parsed.entries) {
        const path = vaultRelativePath(entry?.path || "", vaultBasePath(this.app));
        if (!path) continue;
        this.semanticIndexPathMeta.set(path, {
          chunks: Number(entry.chunks || 0),
          modifiedAt: Number(entry.modifiedAt || 0)
        });
      }
      this.semanticIndexPathMetaSnapshotFingerprint = expected;
      return this.semanticIndexPathMeta.size > 0;
    } catch {
      return false;
    }
  }

  async saveSemanticIndexPathMetaSnapshot() {
    const entries = Array.from(this.semanticIndexPathMeta || [])
      .filter(([path]) => path)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, meta]) => ({
        path,
        chunks: Number(meta?.chunks || 0),
        modifiedAt: Number(meta?.modifiedAt || 0)
      }));
    const metaFingerprint = this.semanticIndexPathMetaFingerprint();
    const body = JSON.stringify({
      metaFingerprint,
      model: this.settings.embeddingModel,
      indexFile: this.semanticIndexFileName(),
      savedAt: deviceTimestamp(),
      entries
    });
    if (this.semanticIndexPathMetaSnapshotFingerprint === metaFingerprint) return;
    await this.app.vault.adapter.write(`${this.manifest.dir}/${SEMANTIC_INDEX_PATH_META_FILE}`, body);
    this.semanticIndexPathMetaSnapshotFingerprint = metaFingerprint;
  }

  async readSemanticIndexFile(indexFile) {
    this.setSidebarStatus("Loading semantic index manifest...");
    await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
    const raw = await this.app.vault.adapter.read(`${this.manifest.dir}/${indexFile}`);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.shards) && parsed.shards.length) {
      const chunks = [];
      let totalBytes = utf8ByteLength(raw);
      let largestBytes = totalBytes;
      const shardFiles = (parsed.shards || []).map((shard) => shard.file || shard.path || "").filter(Boolean);
      const shardReads = [];
      for (let index = 0; index < shardFiles.length; index += 1) {
        const shardFile = shardFiles[index];
        this.setSidebarStatus(`Loading semantic index shard ${index + 1}/${shardFiles.length}...`);
        await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
        const shardRaw = await this.app.vault.adapter.read(`${this.manifest.dir}/${shardFile}`);
        const shardBytes = utf8ByteLength(shardRaw);
        shardReads[index] = { file: shardFile, hash: shortHash(shardRaw), bytes: shardBytes, parsed: JSON.parse(shardRaw) };
        await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
      }
      for (const shard of shardReads) {
        const shardFile = shard.file || shard.path || "";
        if (!shardFile) continue;
        const shardBytes = shard.bytes || 0;
        totalBytes += shardBytes;
        largestBytes = Math.max(largestBytes, shardBytes);
        chunks.push(...(shard.parsed?.chunks || []));
      }
      return {
        parsed,
        chunks,
        shardFiles,
        storageFingerprint: semanticIndexStorageFingerprint(raw, shardReads),
        stats: { bytes: largestBytes, totalBytes, path: indexFile, files: shardFiles.length + 1, shards: shardFiles.length }
      };
    }
    const bytes = utf8ByteLength(raw);
    return {
      parsed,
      chunks: parsed.chunks || [],
      shardFiles: [],
      storageFingerprint: semanticIndexStorageFingerprint(raw, []),
      stats: { bytes, totalBytes: bytes, path: indexFile, files: 1, shards: 0 }
    };
  }

  async saveSemanticIndex() {
    const indexFile = this.semanticIndexFileName();
    const meta = Object.assign({}, this.settings.semanticIndexMeta || {}, {
        model: this.settings.embeddingModel,
        provider: usesGeminiEmbeddingModel(this.settings.embeddingModel) ? "gemini" : "openai",
        file: indexFile,
        sharded: true,
        shardMaxBytes: SEMANTIC_INDEX_SHARD_MAX_BYTES
    });
    const shards = await semanticIndexShardBodiesAsync(indexFile, meta, this.semanticIndex || [], SEMANTIC_INDEX_SHARD_MAX_BYTES);
    const shardBytes = shards.reduce((sum, shard) => sum + shard.bytes, 0);
    const manifest = {
      meta: Object.assign({}, meta, {
        chunks: (this.semanticIndex || []).length,
        shardCount: shards.length,
        shardBytes
      }),
      shards: shards.map((shard, index) => ({
        file: shard.file,
        chunks: shard.chunkCount,
        bytes: shard.bytes,
        index
      }))
    };
    const manifestBody = JSON.stringify(manifest);
    const shardFiles = shards.map((shard) => shard.file);
    const storageFingerprint = semanticIndexStorageFingerprint(manifestBody, shards);
    const manifestBytes = utf8ByteLength(manifestBody);
    const totalBytes = manifestBytes + shardBytes;
    const stats = {
      bytes: Math.max(manifestBytes, ...shards.map((shard) => shard.bytes)),
      totalBytes,
      path: indexFile,
      files: shards.length + 1,
      shards: shards.length
    };
    if (storageFingerprint === this.semanticIndexStorageFingerprint) {
      this.semanticIndexStats = stats;
      this.semanticIndexKnownShardFiles = shardFiles;
      if (!this.semanticIndexPathMeta?.size && (this.semanticIndex || []).some((chunk) => chunk.path)) await this.refreshSemanticIndexPathMetaAsync();
      await this.saveSemanticIndexPathMetaSnapshot();
      return;
    }
    await this.removeSemanticIndexShardFiles(indexFile, shardFiles, this.semanticIndexKnownShardFiles);
    await asyncPool(shards, 3, async (shard) => {
      await this.app.vault.adapter.write(`${this.manifest.dir}/${shard.file}`, shard.body);
    });
    await this.app.vault.adapter.write(`${this.manifest.dir}/${indexFile}`, manifestBody);
    this.semanticIndexStats = stats;
    this.semanticIndexKnownShardFiles = shardFiles;
    this.semanticIndexStorageFingerprint = storageFingerprint;
    await this.refreshSemanticIndexPathMetaAsync();
    await this.saveSemanticIndexPathMetaSnapshot();
  }

  refreshSemanticIndexPathMeta() {
    this.semanticIndexPathMeta = this.semanticIndexPathMeta || new Map();
    this.semanticIndexPathMeta.clear();
    for (const chunk of this.semanticIndex || []) {
      const path = chunk.path || "";
      if (!path) continue;
      const existing = this.semanticIndexPathMeta.get(path) || { chunks: 0, modifiedAt: 0 };
      existing.chunks += 1;
      existing.modifiedAt = Math.max(existing.modifiedAt || 0, Number(chunk.modifiedAt || 0));
      this.semanticIndexPathMeta.set(path, existing);
    }
  }

  async refreshSemanticIndexPathMetaAsync() {
    this.semanticIndexPathMeta = this.semanticIndexPathMeta || new Map();
    this.semanticIndexPathMeta.clear();
    const chunks = this.semanticIndex || [];
    for (let index = 0; index < chunks.length; index += 1) {
      if (index && index % 100 === 0) await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
      const chunk = chunks[index];
      const path = chunk.path || "";
      if (!path) continue;
      const existing = this.semanticIndexPathMeta.get(path) || { chunks: 0, modifiedAt: 0 };
      existing.chunks += 1;
      existing.modifiedAt = Math.max(existing.modifiedAt || 0, Number(chunk.modifiedAt || 0));
      this.semanticIndexPathMeta.set(path, existing);
    }
  }

  semanticIndexFileName(model = this.settings.embeddingModel) {
    return usesGeminiEmbeddingModel(model) ? GEMINI_SEMANTIC_INDEX_FILE : OPENAI_SEMANTIC_INDEX_FILE;
  }

  semanticIndexWarmupKey() {
    return this.semanticIndexStorageFingerprint || shortHash(JSON.stringify({
      meta: this.settings.semanticIndexMeta || {},
      chunks: (this.semanticIndex || []).length
    }));
  }

  queueSemanticIndexReshard(delayMs = STARTUP_SEMANTIC_INDEX_RESHARD_DELAY_MS) {
    window.clearTimeout(this.semanticIndexReshardTimer);
    if (!(this.semanticIndex || []).length) return;
    this.semanticIndexReshardTimer = window.setTimeout(() => {
      this.semanticIndexReshardTimer = null;
      this.reshardSemanticIndexWhenIdle().catch((error) => this.logLocal("Semantic index shard optimization failed", { error: error.message || String(error) }));
    }, delayMs);
  }

  async reshardSemanticIndexWhenIdle() {
    if (!(this.semanticIndex || []).length) return false;
    if (!this.canStartBackgroundWork() || this.semanticIndexLoadInProgress) {
      this.queueSemanticIndexReshard(30000);
      return false;
    }
    this.semanticIndexInProgress = true;
    this.semanticIndexOptimizeInProgress = true;
    this.setSidebarStatus("Optimizing semantic index shards...");
    try {
      await this.saveSemanticIndex();
      await this.saveSettings();
      this.logLocal("Semantic index shards optimized", {
        files: this.semanticIndexStats?.files || 0,
        shards: this.semanticIndexStats?.shards || 0,
        bytes: this.semanticIndexStats?.totalBytes || this.semanticIndexStats?.bytes || 0
      });
      return true;
    } finally {
      this.semanticIndexInProgress = false;
      this.semanticIndexOptimizeInProgress = false;
      this.setSidebarStatus("Ready");
    }
  }

  async purgeSemanticIndex(showNotice = true) {
    const indexFile = this.semanticIndexFileName();
    await this.removeSemanticIndexFiles(indexFile);
    if (indexFile !== SEMANTIC_INDEX_FILE) await this.removeSemanticIndexFiles(SEMANTIC_INDEX_FILE);
    this.semanticIndex = [];
    this.semanticChunkTermCache?.clear?.();
    window.clearTimeout(this.semanticIndexWarmupTimer);
    this.semanticIndexWarmupTimer = null;
    this.semanticIndexWarmupInProgress = false;
    this.settings.semanticIndexMeta = {
      model: this.settings.embeddingModel,
      provider: usesGeminiEmbeddingModel(this.settings.embeddingModel) ? "gemini" : "openai",
      file: indexFile,
      chunks: 0,
      purgedAt: deviceTimestamp()
    };
    this.semanticIndexStats = { bytes: 0, path: indexFile };
    this.queryEmbeddingCache?.clear?.();
    await this.saveSettings();
    this.logLocal("Semantic index purged", { file: indexFile });
    if (showNotice) new Notice(`Purged semantic index: ${indexFile}`);
  }

  async removeSemanticIndexFiles(indexFile) {
    const manifestShards = [];
    try {
      const raw = await this.app.vault.adapter.read(`${this.manifest.dir}/${indexFile}`);
      const parsed = JSON.parse(raw);
      manifestShards.push(...(parsed.shards || []).map((shard) => shard.file || shard.path || "").filter(Boolean));
    } catch {}
    if (manifestShards.length) await this.removeSemanticIndexShardFiles(indexFile, [], manifestShards);
    await this.removeSemanticIndexShardFiles(indexFile, []);
    try { await this.app.vault.adapter.remove(`${this.manifest.dir}/${indexFile}`); } catch {}
  }

  async removeSemanticIndexShardFiles(indexFile, keepFiles = [], candidateFiles = null) {
    const keep = new Set(keepFiles || []);
    const removeCandidates = Array.isArray(candidateFiles) ? uniqueValues(candidateFiles) : null;
    if (removeCandidates) {
      await asyncPool(removeCandidates, 4, async (candidate) => {
        const name = String(candidate || "").split("/").pop() || "";
        if (!isSemanticIndexShardFile(indexFile, name) || keep.has(name)) return;
        const path = String(candidate || "").includes("/") ? candidate : `${this.manifest.dir}/${name}`;
        try { await this.app.vault.adapter.remove(path); } catch {}
      });
      return;
    }
    try {
      const listed = await this.app.vault.adapter.list(this.manifest.dir);
      for (const path of listed?.files || []) {
        const name = path.split("/").pop() || "";
        if (!isSemanticIndexShardFile(indexFile, name) || keep.has(name)) continue;
        try { await this.app.vault.adapter.remove(path); } catch {}
      }
    } catch {}
  }

  async ensureCompatibleEmbeddingForChatModel(options = {}) {
    const loadIndex = options.loadIndex !== false;
    const before = this.settings.embeddingModel;
    if (usesGeminiChatModel(this.settings.chatModel) && !usesGeminiEmbeddingModel(this.settings.embeddingModel)) {
      this.settings.embeddingModel = "gemini/gemini-embedding-2";
    }
    if (usesOpenAIChatModel(this.settings.chatModel) && !usesOpenAIEmbeddingModel(this.settings.embeddingModel)) {
      const openaiModels = this.settings.availableEmbeddingModels || [];
      this.settings.embeddingModel = openaiModels.includes("text-embedding-3-large") ? "text-embedding-3-large" : DEFAULT_SETTINGS.embeddingModel;
    }
    if (this.settings.embeddingModel !== before) {
      this.queryEmbeddingCache?.clear?.();
      this.semanticIndexLoaded = false;
      this.semanticIndex = [];
      this.semanticIndexPathMeta?.clear?.();
      this.semanticIndexPathMetaSnapshotFingerprint = "";
      if (loadIndex) await this.loadSemanticIndex();
      else this.queueSemanticIndexLoad();
      await this.saveSettings();
      return loadIndex;
    }
    return false;
  }

  async setChatModel(value) {
    this.settings.chatModel = value;
    this.settings.aiModelProvider = aiProviderForModel(value);
    this.ensureSameProviderFallbackModel();
    await this.ensureCompatibleEmbeddingForChatModel();
    await this.saveSettings();
  }

  async setAiModelProvider(value) {
    const provider = normalizeAiProvider(value, this.settings.aiModelProvider || aiProviderForModel(this.settings.chatModel));
    const beforeEmbedding = this.settings.embeddingModel;
    this.settings.aiModelProvider = provider;
    this.settings.chatModel = preferredChatModelForProvider(this.settings, provider);
    this.settings.chatFallbackModel = preferredFallbackModelForProvider(this.settings, provider, this.settings.chatModel);
    this.settings.embeddingModel = preferredEmbeddingModelForProvider(this.settings, provider);
    if (this.settings.taskDeduplicationAiModel && aiProviderForModel(this.settings.taskDeduplicationAiModel) !== provider) {
      this.settings.taskDeduplicationAiModel = "";
    }
    if (this.settings.embeddingModel !== beforeEmbedding) {
      this.queryEmbeddingCache?.clear?.();
      this.semanticIndexLoaded = false;
      this.semanticIndex = [];
      this.semanticIndexPathMeta?.clear?.();
      this.semanticIndexPathMetaSnapshotFingerprint = "";
      await this.loadSemanticIndex();
    }
    await this.saveSettings();
  }

  ensureSameProviderFallbackModel() {
    const provider = aiProviderForModel(this.settings.chatModel);
    const fallback = this.settings.chatFallbackModel || "";
    if ((provider === "gemini" && usesGeminiChatModel(fallback)) || (provider === "openai" && usesOpenAIChatModel(fallback))) return;
    this.settings.chatFallbackModel = preferredFallbackModelForProvider(this.settings, provider, this.settings.chatModel);
  }

  async setEmbeddingModel(value) {
    this.settings.embeddingModel = value;
    this.queryEmbeddingCache?.clear?.();
    await this.loadSemanticIndex();
    await this.saveSettings();
  }

  async setLegacyTodoistIdMode(value) {
    this.settings.legacyTodoistIdMode = value === "convert" ? "convert" : "preserve";
    await this.saveSettings();
  }

  handleActiveLeafChange(leaf) {
    if (leaf?.view instanceof MarkdownView && leaf.view.file) this.lastActiveMarkdownLeaf = leaf;
    this.notifySidebarActiveNoteChanged();
  }

  notifySidebarActiveNoteChanged() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof SemanticTodoistView) view.handleActiveNoteChanged();
    }
  }

  setSidebarStatus(message) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof SemanticTodoistView) view.setStatus(message);
    }
  }

  refreshSidebarStatus() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof SemanticTodoistView) view.setStatus(view.currentStatus || "Ready");
    }
  }

  async withAiActivity(label, work) {
    const previous = this.aiActivity || "";
    const activity = singleLine(label || "Working");
    this.aiActivity = activity;
    this.logLocal("AI activity started", { activity });
    this.refreshSidebarStatus();
    try {
      const result = await work();
      this.logLocal("AI activity complete", { activity });
      return result;
    } catch (error) {
      this.logLocal("AI activity failed", { activity, error: error.message || String(error) });
      throw error;
    } finally {
      this.aiActivity = previous;
      this.refreshSidebarStatus();
    }
  }

  queueSemanticIndexWarmup() {
    window.clearTimeout(this.semanticIndexWarmupTimer);
    if (!(this.semanticIndex || []).length) return;
    const warmupKey = this.semanticIndexWarmupKey();
    if (warmupKey && this.semanticIndexWarmupFingerprint === warmupKey) return;
    this.semanticIndexWarmupPendingFingerprint = warmupKey;
    this.semanticIndexWarmupTimer = window.setTimeout(() => this.warmSemanticIndexCaches(), SEMANTIC_INDEX_WARMUP_DELAY_MS);
  }

  async warmSemanticIndexCaches() {
    if (this.semanticIndexWarmupInProgress || !(this.semanticIndex || []).length) return;
    this.semanticIndexWarmupInProgress = true;
    const warmupKey = this.semanticIndexWarmupPendingFingerprint || this.semanticIndexWarmupKey();
    this.refreshSidebarStatus();
    try {
      const chunks = (this.semanticIndex || []).filter((chunk) => this.isIndexablePath(chunk.path || ""));
      for (let i = 0; i < chunks.length; i += SEMANTIC_INDEX_WARMUP_BATCH_SIZE) {
        if (this.aiActivity || this.semanticIndexInProgress || this.syncInProgress || this.emailProcessingInProgress) {
          await delay(250);
          i -= SEMANTIC_INDEX_WARMUP_BATCH_SIZE;
          continue;
        }
        for (const chunk of chunks.slice(i, i + SEMANTIC_INDEX_WARMUP_BATCH_SIZE)) this.semanticChunkTerms(chunk);
        await idlePause(SEMANTIC_INDEX_WARMUP_PAUSE_MS);
      }
    } finally {
      if (warmupKey && warmupKey === this.semanticIndexWarmupKey()) this.semanticIndexWarmupFingerprint = warmupKey;
      this.semanticIndexWarmupPendingFingerprint = "";
      this.semanticIndexWarmupInProgress = false;
      this.semanticIndexWarmupTimer = null;
      this.refreshSidebarStatus();
    }
  }

  canStartBackgroundWork() {
    return !this.aiActivity &&
      !this.semanticIndexInProgress &&
      !this.syncInProgress &&
      !this.schedulerInProgress &&
      !this.emailProcessingInProgress &&
      !this.referenceRebuildInProgress;
  }

  backgroundTick() {
    const now = Date.now();
    if (!this.canStartBackgroundWork()) return;
    if (this.settings.autoProcessEmails && this.settings.workerUrl && this.settings.workerToken && elapsedMs(this.settings.lastEmailPollAt) >= emailAutoPollIntervalSeconds(this.settings) * 1000) {
      this.processPendingEmails(false, { automatic: true });
    }
    if (this.settings.notesAutoSync && this.settings.todoistToken && elapsedMs(this.settings.lastNoteAutoSyncAt) >= Math.max(60, this.settings.syncIntervalSeconds) * 1000) {
      this.settings.lastNoteAutoSyncAt = deviceTimestamp(new Date(now));
      this.syncNoteTasks(false, false);
    }
    if (this.settings.autoRebuildReferences && this.settings.todoistToken && elapsedMs(this.settings.lastReferenceRebuildAt) >= Math.max(30, Number(this.settings.referenceRebuildIntervalMinutes || 360)) * 60 * 1000) {
      this.maybeRebuildTodoistReferences(false);
    }
  }

  logLocal(message, data = {}) {
    const entry = { at: deviceTimestamp(), message, data: sanitizeLogData(data) };
    this.settings.localLog = [entry, ...(this.settings.localLog || [])].slice(0, 100);
    this.queueSettingsSave();
  }

  requireApiAccess(requireWorker = false) {
    this.requireAiAccess();
    this.requireTodoistAccess();
    if (requireWorker) this.requireEmailWorkerAccess();
  }

  requireAiAccess() {
    const missing = [];
    if (usesOpenAIChatModel(this.settings.chatModel) && !this.settings.openaiApiKey) missing.push("OpenAI API key");
    if (usesGeminiChatModel(this.settings.chatModel) && !this.settings.googleApiKey) missing.push("Google API key");
    if (usesOpenAIEmbeddingModel(this.settings.embeddingModel) && !this.settings.openaiApiKey) missing.push("OpenAI API key");
    if (usesGeminiEmbeddingModel(this.settings.embeddingModel) && !this.settings.googleApiKey) missing.push("Google API key");
    if (missing.length) throw new Error(`Add ${missing.join(", ")} in Semantic Todoist Sync settings.`);
  }

  requireTodoistAccess() {
    if (!this.settings.todoistToken) throw new Error("Add a Todoist API token in Semantic Todoist Sync settings.");
  }

  requireEmailWorkerAccess() {
    const missing = [];
    if (!this.settings.workerUrl) missing.push("Cloudflare Worker URL");
    if (!this.settings.workerToken) missing.push("Cloudflare Worker token");
    if (missing.length) throw new Error(`Add ${missing.join(", ")} in Semantic Todoist Sync settings.`);
  }

  async openSidebar() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      if (this.settings.defaultOpenArea === "left" && this.app.workspace.getLeftLeaf) {
        leaf = this.app.workspace.getLeftLeaf(false);
      } else if (this.settings.defaultOpenArea === "right" && this.app.workspace.getRightLeaf) {
        leaf = this.app.workspace.getRightLeaf(false);
      } else {
        leaf = this.app.workspace.getLeaf(false);
      }
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async askFromActiveContext() {
    await this.openSidebar();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (view && view instanceof SemanticTodoistView) {
      const active = await this.getActiveMarkdownContext();
      view.setPrompt(active.selection || active.text || "");
    }
  }

  async promptGptFromCommandPalette() {
    new PromptModal(this.app, "Prompt AI", async (prompt) => {
      await this.openSidebar();
      const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
      if (view && view instanceof SemanticTodoistView) {
        view.setPrompt(prompt);
        await view.ask();
      }
    }).open();
  }

  async runTaskTemplateFromCommandPalette() {
    const templates = await this.getPromptTemplates();
    new TaskTemplateModal(this.app, templates, async ({ template, insertIntoNote, syncAfterInsert }) => {
      await this.runPromptTemplate(template, { insertIntoNote, syncAfterInsert, showNotice: true });
    }).open();
  }

  queueNoteSync(path) {
    if (!this.isSyncableTaskPath(path)) return;
    window.clearTimeout(this.noteSyncTimer);
    this.noteSyncPath = path;
    this.noteSyncTimer = window.setTimeout(() => this.syncFileNotes(path, false), 1200);
  }

  cancelQueuedNoteSync(path = "") {
    if (path && this.noteSyncPath && this.noteSyncPath !== path) return;
    window.clearTimeout(this.noteSyncTimer);
    this.noteSyncTimer = null;
    this.noteSyncPath = "";
  }

  markInternalNoteWrite(path, ms = 5000) {
    if (!path) return;
    this.internalNoteWriteUntil = this.internalNoteWriteUntil || new Map();
    this.internalNoteWriteUntil.set(path, Date.now() + ms);
  }

  isInternalNoteWrite(path) {
    const until = this.internalNoteWriteUntil?.get(path) || 0;
    if (!until) return false;
    if (Date.now() <= until) return true;
    this.internalNoteWriteUntil.delete(path);
    return false;
  }

  queueSemanticIndexUpdate(path, reason = "change") {
    if (!this.settings.autoUpdateSemanticIndex || !this.isIndexablePath(path)) return;
    if (!aiAccessConfigured(this.settings)) return;
    if (!this.shouldQueueSemanticIndexUpdate(path, reason)) return;
    this.pendingIndexPaths.add(path);
    window.clearTimeout(this.semanticIndexTimer);
    this.semanticIndexTimer = window.setTimeout(() => this.flushSemanticIndexUpdates(), Math.max(5, this.settings.semanticIndexDelaySeconds) * 1000);
    this.refreshSidebarStatus();
  }

  shouldQueueSemanticIndexUpdate(path, reason = "change") {
    const indexed = this.semanticIndexPathMeta?.get(path);
    const now = Date.now();
    if (!indexed && !this.semanticIndexLoaded && now < (this.semanticIndexStartupQuietUntil || 0)) {
      this.logLocal("Skipped startup semantic index event before cache hydration", { path, reason });
      return false;
    }
    if (!indexed) return true;
    if (reason === "task-reference") return true;
    if (now < (this.semanticIndexStartupQuietUntil || 0)) {
      this.logLocal("Skipped startup semantic index event for indexed note", { path, reason });
      return false;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    const fileModifiedAt = file instanceof TFile ? Number(file.stat?.mtime || 0) : 0;
    if (fileModifiedAt && indexed.modifiedAt && fileModifiedAt <= indexed.modifiedAt + 1000) {
      this.logLocal("Skipped unchanged semantic index event", { path, reason });
      return false;
    }
    return true;
  }

  async searchFromSelection() {
    const active = await this.getActiveMarkdownContext();
    const query = active.selection || active.title || "";
    const results = await this.retrieveSemanticContext(query, 8);
    new Notice(results.length ? `Found ${results.length} semantic matches.` : "No semantic matches found.");
    await this.openSidebar();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (view && view instanceof SemanticTodoistView) {
      view.renderSearchResults(query, results);
    }
  }

  async getActiveMarkdownContext(pathOverride = "") {
    if (pathOverride) {
      const selected = this.app.vault.getAbstractFileByPath(pathOverride);
      if (selected instanceof TFile) {
        if (this.isExcludedPath(selected.path)) return { title: "", path: "", text: "", selection: "" };
        const text = await this.app.vault.cachedRead(selected);
        return { title: selected.basename, path: selected.path, text, selection: "" };
      }
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView) ||
      (this.lastActiveMarkdownLeaf?.view instanceof MarkdownView ? this.lastActiveMarkdownLeaf.view : null);
    const file = view?.file;
    if (!view || !file) return { title: "", path: "", text: "", selection: "" };
    if (this.isExcludedPath(file.path)) return { title: "", path: "", text: "", selection: "" };
    const editor = view.editor;
    const selection = editor?.getSelection?.() || "";
    const text = await this.app.vault.cachedRead(file);
    return { title: file.basename, path: file.path, text, selection };
  }

  async rebuildSemanticIndex(showNotice) {
    if (this.semanticIndexInProgress) {
      if (showNotice) new Notice("Semantic indexing is already running.");
      return false;
    }
    this.semanticIndexInProgress = true;
    window.clearTimeout(this.semanticIndexTimer);
    this.semanticIndexTimer = null;
    this.pendingIndexPaths.clear();
    let previousIndex = this.semanticIndex || [];
    let previousMeta = Object.assign({}, this.settings.semanticIndexMeta || {});
    const startedAt = Date.now();
    this.setSidebarStatus("Indexing vault...");
    try {
      this.logLocal("Semantic index rebuild started", { existingChunks: (previousIndex || []).length });
      await this.ensureCompatibleEmbeddingForChatModel();
      if (!this.semanticIndexLoaded && Number(this.settings.semanticIndexMeta?.chunks || 0) > 0) {
        this.setSidebarStatus("Loading existing semantic index cache...");
        await this.ensureSemanticIndexLoaded("semantic index cache");
      }
      previousIndex = this.semanticIndex || previousIndex;
      previousMeta = Object.assign({}, this.settings.semanticIndexMeta || previousMeta);
      this.requireAiAccess();
      const files = this.orderSemanticIndexFiles(this.getIndexableFiles());
      if (!files.length) throw new Error("No indexable Markdown notes were found. Check Indexed folders and Excluded folders in settings.");
      const chunks = [];
      await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
      for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
        const file = files[fileIndex];
        if (fileIndex % SEMANTIC_INDEX_FILE_YIELD_INTERVAL === 0) {
          this.setSidebarStatus(`Reading vault notes ${fileIndex + 1}/${files.length}...`);
          await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
        }
        const text = await this.app.vault.cachedRead(file);
        const createdMeta = semanticCreatedMetadataForFile(file, text, this.settings);
        const fileChunks = chunkMarkdown(text, this.settings.semanticIndexMaxChunkChars, this.settings.semanticIndexMaxChunksPerNote);
        for (let index = 0; index < fileChunks.length; index += 1) {
          chunks.push({ id: `${file.path}#${index}`, path: file.path, title: file.basename, text: fileChunks[index], modifiedAt: file.stat?.mtime || 0, createdAt: createdMeta.createdAt, createdAtSource: createdMeta.createdAtSource });
        }
      }
      this.setSidebarStatus("Preparing task reference chunks...");
      await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
      chunks.push(...this.semanticTaskReferenceChunks());
      if (!chunks.length) throw new Error("No indexable note text was found. The existing semantic index was left unchanged.");

      const reuseMap = buildSemanticChunkReuseMap(previousIndex, this.settings, previousMeta);
      const embedded = await this.embedSemanticChunks(chunks, reuseMap, "vault chunks");
      const indexed = embedded.indexed;

      this.semanticIndex = indexed;
      this.semanticChunkTermCache?.clear?.();
      this.queueSemanticIndexWarmup();
      this.settings.semanticIndexMeta = {
        model: this.settings.embeddingModel,
        rebuiltAt: deviceTimestamp(),
        chunks: indexed.length,
        maxChunkChars: this.settings.semanticIndexMaxChunkChars,
        maxChunksPerNote: this.settings.semanticIndexMaxChunksPerNote,
        embeddingPrecision: this.settings.semanticIndexEmbeddingPrecision
      };
      await this.saveSemanticIndex();
      await this.saveSettings();
      this.logLocal("Semantic index rebuilt", { files: files.length, chunks: indexed.length, embedded: embedded.embedded, reused: embedded.reused, ms: Date.now() - startedAt });
      if (showNotice) new Notice(`Semantic index rebuilt: ${indexed.length} chunks from ${files.length} notes.`);
      return true;
    } catch (error) {
      this.semanticIndex = previousIndex;
      this.settings.semanticIndexMeta = previousMeta;
      await this.saveSettings();
      this.logLocal("Semantic index rebuild failed", { error: error.message || String(error) });
      if (showNotice) new Notice(`Semantic index rebuild failed: ${error.message || error}`);
      return false;
    } finally {
      this.semanticIndexInProgress = false;
      this.setSidebarStatus("Ready");
      this.refreshSidebarStatus();
    }
  }

  getIndexableFiles() {
    const include = splitList(this.settings.indexedFolders).map(trimSlashes);
    const exclude = splitList(this.settings.excludedFolders).map(trimSlashes);
    return this.app.vault.getMarkdownFiles().filter((file) => {
      return this.isIndexablePath(file.path, include, exclude);
    });
  }

  semanticIndexPriorityRanks() {
    const ranks = new Map();
    const addFile = (file, rank) => {
      if (!(file instanceof TFile) || file.extension !== "md" || !this.isIndexablePath(file.path)) return;
      const existing = ranks.get(file.path);
      if (existing === undefined || rank < existing) ranks.set(file.path, rank);
    };
    addFile(this.app.workspace.getActiveViewOfType(MarkdownView)?.file, 0);
    addFile(this.lastActiveMarkdownLeaf?.view instanceof MarkdownView ? this.lastActiveMarkdownLeaf.view.file : null, 0);
    const leaves = typeof this.app.workspace.getLeavesOfType === "function" ? this.app.workspace.getLeavesOfType("markdown") : [];
    for (const leaf of leaves || []) addFile(leaf?.view instanceof MarkdownView ? leaf.view.file : null, 1);
    if (typeof this.app.workspace.iterateAllLeaves === "function") {
      this.app.workspace.iterateAllLeaves((leaf) => addFile(leaf?.view instanceof MarkdownView ? leaf.view.file : null, 1));
    }
    return ranks;
  }

  orderSemanticIndexFiles(files) {
    const priorityRanks = this.semanticIndexPriorityRanks();
    return Array.from(files || []).sort((a, b) => {
      const aPriority = priorityRanks.has(a.path) ? priorityRanks.get(a.path) : 2;
      const bPriority = priorityRanks.has(b.path) ? priorityRanks.get(b.path) : 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      const aModified = Number(a.stat?.mtime || 0);
      const bModified = Number(b.stat?.mtime || 0);
      if (aModified !== bModified) return bModified - aModified;
      return String(a.path || "").localeCompare(String(b.path || ""));
    });
  }

  hasUsableSemanticIndex() {
    const meta = this.settings.semanticIndexMeta || {};
    return Boolean((this.semanticIndex || []).length && Number(meta.chunks || 0) > 0 && meta.rebuiltAt);
  }

  getSyncableTaskFiles() {
    const exclude = splitList(this.settings.excludedFolders).map(trimSlashes);
    return this.app.vault.getMarkdownFiles().filter((file) => {
      return this.isSyncableTaskPath(file.path, exclude);
    });
  }

  isSyncableTaskPath(path, exclude) {
    if (isEmailLogPath(path, this.settings)) return true;
    if (this.isExcludedPath(path, exclude)) return false;
    return true;
  }

  isExcludedPath(path, exclude) {
    return isFolderExcluded(path, exclude || splitList(this.settings.excludedFolders).map(trimSlashes));
  }

  isIndexablePath(path, include, exclude) {
    const includeFolders = include || splitList(this.settings.indexedFolders).map(trimSlashes);
    const excludeFolders = exclude || splitList(this.settings.excludedFolders).map(trimSlashes);
    if (isEmailLogPath(path, this.settings)) return false;
    if (includeFolders.length && !includeFolders.some((folder) => path === folder || path.startsWith(`${folder}/`))) return false;
    if (this.isExcludedPath(path, excludeFolders)) return false;
    return true;
  }

  async flushSemanticIndexUpdates() {
    if (this.semanticIndexInProgress) {
      window.clearTimeout(this.semanticIndexTimer);
      this.semanticIndexTimer = window.setTimeout(() => this.flushSemanticIndexUpdates(), 10000);
      this.refreshSidebarStatus();
      return;
    }
    if (!this.pendingIndexPaths.size) {
      this.semanticIndexTimer = null;
      this.refreshSidebarStatus();
      return;
    }
    if (!this.hasUsableSemanticIndex() && Number(this.settings.semanticIndexMeta?.chunks || 0) > 0) {
      await this.ensureSemanticIndexLoaded("semantic index cache");
    }
    if (!this.hasUsableSemanticIndex()) {
      await this.rebuildSemanticIndex(false);
      return;
    }
    const paths = Array.from(this.pendingIndexPaths);
    this.pendingIndexPaths.clear();
    this.semanticIndexTimer = null;
    this.semanticIndexInProgress = true;
    this.setSidebarStatus("Indexing vault changes...");
    try {
      this.logLocal("Semantic index update started", { files: paths.length });
      let changedFiles = 0;
      for (let index = 0; index < paths.length; index += 1) {
        const path = paths[index];
        this.setSidebarStatus(`Indexing changed note ${index + 1}/${paths.length}...`);
        await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
        if (await this.reindexFile(path)) changedFiles += 1;
        await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
      }
      if (!changedFiles) {
        this.logLocal("Semantic index unchanged", { files: paths.length });
        return;
      }
      this.settings.semanticIndexMeta = Object.assign({}, this.settings.semanticIndexMeta, {
        rebuiltAt: this.settings.semanticIndexMeta?.rebuiltAt || "",
        updatedAt: deviceTimestamp(),
        chunks: (this.semanticIndex || []).length,
        model: this.settings.embeddingModel,
        maxChunkChars: this.settings.semanticIndexMaxChunkChars,
        maxChunksPerNote: this.settings.semanticIndexMaxChunksPerNote,
        embeddingPrecision: this.settings.semanticIndexEmbeddingPrecision
      });
      await this.saveSemanticIndex();
      await this.saveSettings();
      this.logLocal("Semantic index updated", { files: changedFiles, checked: paths.length, chunks: this.settings.semanticIndexMeta.chunks });
    } catch (error) {
      console.error(error);
      this.logLocal("Semantic index update failed", { error: error.message || String(error) });
    } finally {
      this.semanticIndexInProgress = false;
      this.setSidebarStatus("Ready");
    }
  }

  async reindexFile(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || !this.isIndexablePath(path)) return this.removePathFromSemanticIndex(path, false);
    this.requireAiAccess();
    const text = await this.app.vault.cachedRead(file);
    const createdMeta = semanticCreatedMetadataForFile(file, text, this.settings);
    const chunks = chunkMarkdown(text, this.settings.semanticIndexMaxChunkChars, this.settings.semanticIndexMaxChunksPerNote)
      .map((chunk, index) => ({ id: `${path}#${index}`, path, title: file.basename, text: chunk, modifiedAt: file.stat?.mtime || 0, createdAt: createdMeta.createdAt, createdAtSource: createdMeta.createdAtSource }));
    chunks.push(...this.semanticTaskReferenceChunks(path));
    if (semanticPathChunksMatch(this.semanticIndex, path, chunks)) return this.refreshSemanticPathChunkMetadata(path, chunks);
    await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
    const previousIndex = this.semanticIndex || [];
    const reuseMap = buildSemanticChunkReuseMap(previousIndex, this.settings, this.settings.semanticIndexMeta || {});
    const embedded = await this.embedSemanticChunks(chunks, reuseMap, `changed chunks for ${file.basename || path}`);
    this.semanticIndex = previousIndex.filter((chunk) => chunk.path !== path).concat(embedded.indexed);
    this.semanticChunkTermCache?.clear?.();
    this.queueSemanticIndexWarmup();
    this.logLocal("Semantic note index refreshed", { path, chunks: chunks.length, embedded: embedded.embedded, reused: embedded.reused });
    return true;
  }

  async embedSemanticChunks(chunks, reuseMap = new Map(), label = "semantic chunks") {
    const indexed = new Array(chunks.length);
    const pending = [];
    let reused = 0;
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const reusedChunk = reusedSemanticChunk(chunk, reuseMap);
      if (reusedChunk) {
        indexed[index] = reusedChunk;
        reused += 1;
      } else {
        pending.push({ chunk, index });
      }
    }
    const batchSize = semanticEmbeddingBatchSize(this.settings);
    let embedded = 0;
    if (!pending.length) this.setSidebarStatus(`Reusing ${reused} unchanged ${label}...`);
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      this.setSidebarStatus(`Embedding ${label} ${Math.min(embedded + batch.length, pending.length)}/${pending.length}${reused ? `; reused ${reused}` : ""}...`);
      const embeddings = await this.embedTexts(batch.map((item) => semanticChunkEmbeddingInput(item.chunk)), "document");
      for (let j = 0; j < batch.length; j += 1) {
        const item = batch[j];
        indexed[item.index] = Object.assign({}, item.chunk, { embedding: compactEmbedding(embeddings[j], this.settings.semanticIndexEmbeddingPrecision) });
      }
      embedded += batch.length;
      await idlePause(SEMANTIC_INDEX_EMBED_PAUSE_MS);
    }
    return { indexed, embedded, reused };
  }

  refreshSemanticPathChunkMetadata(path, nextChunks) {
    const currentById = new Map((this.semanticIndex || [])
      .filter((chunk) => chunk.path === path)
      .map((chunk) => [chunk.id, chunk]));
    let changed = false;
    for (const next of nextChunks || []) {
      const current = currentById.get(next.id);
      if (!current) continue;
      const nextModifiedAt = Number(next.modifiedAt || 0);
      if (nextModifiedAt && Number(current.modifiedAt || 0) !== nextModifiedAt) {
        current.modifiedAt = nextModifiedAt;
        changed = true;
      }
      const nextCreatedAt = Number(next.createdAt || 0);
      if (nextCreatedAt && Number(current.createdAt || 0) !== nextCreatedAt) {
        current.createdAt = nextCreatedAt;
        changed = true;
      }
      const nextCreatedAtSource = String(next.createdAtSource || "");
      if (nextCreatedAtSource && String(current.createdAtSource || "") !== nextCreatedAtSource) {
        current.createdAtSource = nextCreatedAtSource;
        changed = true;
      }
    }
    if (changed) this.refreshSemanticIndexPathMeta();
    return changed;
  }

  queueTaskReferenceIndexUpdate(path) {
    const notePath = vaultRelativePath(path, vaultBasePath(this.app));
    const hasPersistedIndex = this.hasUsableSemanticIndex() || Number(this.settings.semanticIndexMeta?.chunks || 0) > 0;
    if (!notePath || !this.settings.autoUpdateSemanticIndex || !hasPersistedIndex) return;
    this.queueSemanticIndexUpdate(notePath, "task-reference");
  }

  semanticTaskReferenceChunks(pathFilter = "") {
    const basePath = vaultBasePath(this.app);
    const groups = new Map();
    const referenceIndex = this.getTaskReferenceIndex();
    const childTextByParentOid = referenceIndex.childTextByParentOid;
    const addTask = (id, task, source) => {
      const path = vaultRelativePath(task?.path || "", basePath);
      if (!path || (pathFilter && path !== pathFilter) || !this.isIndexablePath(path)) return;
      const row = semanticTaskReferenceText(id, task, this.settings, childTextByParentOid.get(String(task?.oid || "").toUpperCase()) || "");
      if (!row) return;
      const group = groups.get(path) || { path, rows: [], modifiedAt: 0 };
      group.rows.push(row);
      group.modifiedAt = Math.max(group.modifiedAt || 0, Date.parse(task?.cachedAt || "") || 0);
      groups.set(path, group);
    };
    for (const [id, task] of referenceIndex.entries) addTask(id, task, "cache");
    for (const reference of referenceIndex.pendingReferences) addTask("", reference, "pending");
    const chunks = [];
    for (const group of groups.values()) {
      const file = this.app.vault.getAbstractFileByPath(group.path);
      const title = file instanceof TFile ? `${file.basename} Todoist task references` : `${group.path.split("/").pop()?.replace(/\.md$/i, "") || group.path} Todoist task references`;
      const textChunks = chunkTaskReferenceRows(group.path, group.rows, Math.max(1600, this.settings.semanticIndexMaxChunkChars || 1100));
      for (let index = 0; index < textChunks.length; index += 1) {
        chunks.push({
          id: `${group.path}#todoist-reference-${index}`,
          path: group.path,
          title,
          text: textChunks[index],
          kind: "todoist-task-reference",
          source: "local-reference-table",
          modifiedAt: group.modifiedAt || (file instanceof TFile ? file.stat?.mtime || 0 : 0)
        });
      }
    }
    return chunks;
  }

  async removePathFromSemanticIndex(path, save = true) {
    const before = (this.semanticIndex || []).length;
    this.semanticIndex = (this.semanticIndex || []).filter((chunk) => chunk.path !== path);
    const changed = before !== this.semanticIndex.length;
    if (changed) {
      this.semanticChunkTermCache?.clear?.();
      this.queueSemanticIndexWarmup();
    }
    if (save && changed) {
      this.settings.semanticIndexMeta = Object.assign({}, this.settings.semanticIndexMeta, {
        updatedAt: deviceTimestamp(),
        chunks: this.semanticIndex.length
      });
      await this.saveSemanticIndex();
      await this.saveSettings();
    }
    return changed;
  }

  async embedTexts(texts, role = "document") {
    const normalized = texts.map((text) => clamp(String(text || ""), 8000));
    if (usesGeminiEmbeddingModel(this.settings.embeddingModel)) {
      return this.geminiEmbedTexts(normalized, role);
    }
    const response = await requestUrl({
      url: "https://api.openai.com/v1/embeddings",
      method: "POST",
      headers: {
        authorization: `Bearer ${this.settings.openaiApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: this.settings.embeddingModel, input: normalized }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OpenAI embeddings returned ${response.status}: ${redactSecrets(response.text)}`);
    }
    return response.json.data.map((item) => item.embedding);
  }

  async geminiEmbedTexts(texts, role = "document") {
    const model = normalizeGeminiModelId(this.settings.embeddingModel || DEFAULT_SETTINGS.availableGeminiEmbeddingModels[0]);
    if (!texts.length) return [];
    const embeddings = new Array(texts.length);
    await asyncPool(texts, geminiEmbeddingConcurrency(this.settings), async (text, index) => {
      const body = this.geminiEmbeddingRequestBody(model, text, role);
      const response = await this.geminiEmbeddingRequest(model, body);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Gemini embeddings returned ${response.status}: ${redactSecrets(response.text)}`);
      }
      embeddings[index] = response.json?.embedding?.values || [];
    });
    return embeddings;
  }

  geminiEmbeddingRequestBody(model, text, role = "document") {
    const body = {
      content: { parts: [{ text: geminiEmbeddingInput(text, role, model) }] }
    };
    if (model === "gemini-embedding-001") body.taskType = role === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
    return body;
  }

  async geminiEmbeddingRequest(model, body) {
    let response = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await requestUrl({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`,
        method: "POST",
        headers: {
          "x-goog-api-key": this.settings.googleApiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        throw: false
      });
      if (![429, 500, 502, 503, 504].includes(response.status)) return response;
      await delay(750 * (attempt + 1));
    }
    return response;
  }

  async retrieveSemanticContext(query, limit) {
    if (!(this.semanticIndex || []).length && Number(this.settings.semanticIndexMeta?.chunks || 0) > 0) {
      await this.ensureSemanticIndexLoaded("semantic search index");
    }
    const index = (this.semanticIndex || []).filter((chunk) => this.isIndexablePath(chunk.path || ""));
    if (!index.length) return this.retrieveLexicalContext(query, limit);
    const cacheKey = `${this.settings.embeddingModel}:${singleLine(query).slice(0, 500)}`;
    let queryEmbedding = this.queryEmbeddingCache.get(cacheKey);
    if (!queryEmbedding) {
      [queryEmbedding] = await this.embedTexts([query || ""], "query");
      this.queryEmbeddingCache.set(cacheKey, queryEmbedding);
        if (this.queryEmbeddingCache.size > 50) this.queryEmbeddingCache.delete(this.queryEmbeddingCache.keys().next().value);
    }
    const queryTerms = termCounts(query);
    const poolSize = Math.max(limit * 6, 40);
    const useNoteCreatedTime = semanticNoteCreatedTimeEnabled(this.settings);
    const semanticRawCandidates = index
      .map((chunk) => {
        const semantic = cosine(queryEmbedding, chunk.embedding);
        const scores = this.contextLexicalScores(chunk, queryTerms);
        const lexical = scores.lexical;
        const title = scores.title;
        return { chunk, semantic, lexical, title, useNoteCreatedTime, recency: recencyBoost(contextCandidateFreshnessAt({ chunk, useNoteCreatedTime })) };
      });
    await this.hydrateCandidateCreatedTimes(semanticRawCandidates, Math.max(poolSize * 2, 60));
    const semanticCandidates = rankContextCandidates(semanticRawCandidates)
      .slice(0, poolSize);
    const lexicalCandidates = this.lexicalContextCandidates(query, poolSize);
    const candidates = rankContextCandidates(mergeContextCandidates(semanticCandidates, lexicalCandidates));
    return diversifyContextCandidates(candidates, limit).map((item) => annotateContextChunk(item));
  }

  async retrieveAdaptiveSemanticContext(query, mode = "chat", baseLimit = 8, prompt = "") {
    return this.retrieveSemanticContext(query, adaptiveSemanticRetrievalLimit(this.settings, mode, baseLimit, prompt || query));
  }

  retrieveLexicalContext(query, limit) {
    return this.lexicalContextCandidates(query, limit).slice(0, limit).map((item) => annotateContextChunk(item));
  }

  lexicalContextCandidates(query, limit) {
    const chunks = (this.semanticIndex || []).filter((chunk) => this.isIndexablePath(chunk.path || ""));
    const queryTerms = termCounts(query);
    const useNoteCreatedTime = semanticNoteCreatedTimeEnabled(this.settings);
    return rankContextCandidates(chunks
      .map((chunk) => {
        const scores = this.contextLexicalScores(chunk, queryTerms);
        const lexical = scores.lexical;
        const title = scores.title;
        return { chunk, semantic: 0, lexical, title, useNoteCreatedTime, recency: recencyBoost(contextCandidateFreshnessAt({ chunk, useNoteCreatedTime })) };
      })
      .filter((item) => item.lexical > 0 || item.title > 0))
      .slice(0, Math.max(limit, 1));
  }

  contextLexicalScores(chunk, queryTerms) {
    const entry = this.semanticChunkTerms(chunk);
    return {
      lexical: lexicalScoreFromCounts(queryTerms, entry.allTerms),
      title: lexicalScoreFromCounts(queryTerms, entry.titleTerms)
    };
  }

  async hydrateCandidateCreatedTimes(candidates, maxPaths = 80) {
    const ranked = rankContextCandidates(candidates || []);
    const paths = [];
    const seen = new Set();
    const useNoteCreatedTime = semanticNoteCreatedTimeEnabled(this.settings);
    for (const item of ranked) {
      const chunk = item.chunk || item;
      const path = chunk.path || "";
      const hasUsableCreatedAt = Number(chunk.createdAt || 0) && (useNoteCreatedTime || chunk.createdAtSource === "file");
      if (!path || hasUsableCreatedAt || seen.has(path)) continue;
      if (chunk.kind === "todoist-task-reference" || chunk.source === "local-reference-table") continue;
      const relevance = contextCandidateRelevanceScore(item);
      if (relevance < 0.08 && !(item.lexical || item.title)) continue;
      seen.add(path);
      paths.push(path);
      if (paths.length >= Math.max(1, maxPaths || 1)) break;
    }
    if (!paths.length) return 0;
    let hydrated = 0;
    this.semanticCreatedAtPathCache = this.semanticCreatedAtPathCache || new Map();
    for (let index = 0; index < paths.length; index += 1) {
      const notePath = paths[index];
      let createdMeta = this.semanticCreatedAtPathCache.get(notePath);
      if (createdMeta === undefined) {
        createdMeta = { createdAt: 0, createdAtSource: "" };
        try {
          const file = this.app.vault.getAbstractFileByPath(notePath);
          if (file instanceof TFile) {
            createdMeta = useNoteCreatedTime
              ? semanticCreatedMetadataForFile(file, await this.app.vault.cachedRead(file), this.settings)
              : semanticCreatedMetadataForFile(file, "", this.settings);
          }
        } catch {}
        this.semanticCreatedAtPathCache.set(notePath, createdMeta);
      }
      const createdAt = Number(createdMeta?.createdAt || 0);
      const createdAtSource = String(createdMeta?.createdAtSource || "");
      if (createdAt) {
        for (const chunk of this.semanticIndex || []) {
          const shouldApply = chunk.path === notePath && (!chunk.createdAt || (!useNoteCreatedTime && chunk.createdAtSource !== "file"));
          if (shouldApply) {
            chunk.createdAt = createdAt;
            if (createdAtSource) chunk.createdAtSource = createdAtSource;
            hydrated += 1;
          }
        }
        for (const item of candidates || []) {
          const chunk = item.chunk || item;
          const shouldApply = chunk.path === notePath && (!chunk.createdAt || (!useNoteCreatedTime && chunk.createdAtSource !== "file"));
          if (shouldApply) {
            chunk.createdAt = createdAt;
            if (createdAtSource) chunk.createdAtSource = createdAtSource;
          }
          if (chunk.path === notePath) item.recency = recencyBoost(contextCandidateFreshnessAt(item));
        }
      }
      if (index % 12 === 11) await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
    }
    return hydrated;
  }

  semanticChunkTerms(chunk) {
    this.semanticChunkTermCache = this.semanticChunkTermCache || new Map();
    const key = chunk.id || `${chunk.path || ""}:${shortHash(chunk.text || "")}`;
    const fingerprint = `${chunk.path || ""}:${chunk.title || ""}:${String(chunk.text || "").length}:${shortHash(String(chunk.text || "").slice(0, 500))}`;
    const existing = this.semanticChunkTermCache.get(key);
    if (existing?.fingerprint === fingerprint) return existing;
    const entry = {
      fingerprint,
      allTerms: termCounts(`${chunk.title || ""} ${chunk.path || ""} ${chunk.text || ""}`),
      titleTerms: termCounts(`${chunk.title || ""} ${chunk.path || ""}`)
    };
    this.semanticChunkTermCache.set(key, entry);
    if (this.semanticChunkTermCache.size > Math.max(1000, (this.semanticIndex || []).length * 2)) {
      this.semanticChunkTermCache.clear();
    }
    return entry;
  }

  async buildTaskContext(active, chunks, query = "") {
    const queryText = [query, active?.title, active?.selection].filter(Boolean).join("\n");
    const queryTerms = taskSearchTermCounts(queryText);
    const contentQueryTerms = taskContentQueryTermCounts(queryText);
    const chunkPaths = new Set((chunks || []).map((chunk) => chunk.path).filter(Boolean));
    const matchedTaskFiles = this.taskFilesMatchingQuery(queryText, queryTerms, chunkPaths, 8);
    const matchedTaskPaths = new Set(matchedTaskFiles.map((file) => file.path));
    const referenceIndex = this.getTaskReferenceIndex();
    const taskCacheEntries = referenceIndex.entries;
    const cachedTaskPaths = referenceIndex.cachedTaskPaths;
    const byPath = new Map();
    if (active?.path) byPath.set(active.path, active.text || "");
    for (const file of matchedTaskFiles) {
      if (!file.path || byPath.has(file.path)) continue;
      byPath.set(file.path, await this.app.vault.cachedRead(file));
    }
    for (const chunk of chunks || []) {
      if (!chunk.path || byPath.has(chunk.path)) continue;
      const file = this.app.vault.getAbstractFileByPath(chunk.path);
      if (file instanceof TFile) byPath.set(chunk.path, await this.app.vault.cachedRead(file));
    }
    const taskRows = [];
    const matchedPathTaskCounts = {};
    for (const [path, text] of byPath.entries()) {
      const lines = String(text || "").split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const parsed = parseTaskLine(lines[i], i, path, lines, this.settings) || parseTaskReferenceLine(lines[i], i, path, this.settings);
        if (!parsed) continue;
        const exactPath = matchedTaskPaths.has(path);
        const activePath = path === active?.path;
        const semanticContextPath = chunkPaths.has(path);
        if (exactPath && !activePath && cachedTaskPaths.has(path)) continue;
        if (exactPath) matchedPathTaskCounts[path] = (matchedPathTaskCounts[path] || 0) + 1;
        const taskScore = taskReferenceScore(parsed, contentQueryTerms, queryText);
        const includeFromMatchedPath = exactPath && !parsed.isSubtask && taskScore >= TASK_CONTEXT_MIN_TASK_SCORE;
        const includeFromContext = activePath || (semanticContextPath && taskScore >= TASK_CONTEXT_MIN_TASK_SCORE);
        if (!includeFromContext && !includeFromMatchedPath) continue;
        taskRows.push({
          key: taskReferenceKey(parsed),
          path,
          priority: path === active?.path ? 3 : exactPath ? 2 : 1,
          score: taskScore,
          text: formatTaskReference(parsed, this.settings)
        });
      }
    }
    const contextPaths = new Set(byPath.keys());
    const hasMatchedTaskPath = matchedTaskPaths.size > 0;
    const childTextByParentOid = referenceIndex.childTextByParentOid;
    const cachedTasks = taskCacheEntries
      .map(([id, task]) => {
        const notePath = task.path || "";
        const noteRefMatch = (task.noteRefs || []).some((ref) => ref?.path && contextPaths.has(ref.path));
        const sameContextPath = Boolean(notePath && contextPaths.has(notePath)) || noteRefMatch;
        const matchedPath = Boolean(notePath && matchedTaskPaths.has(notePath));
        const activeTaskPath = Boolean(active?.path && notePath === active.path);
        if (matchedPath) matchedPathTaskCounts[notePath] = (matchedPathTaskCounts[notePath] || 0) + 1;
        const taskScore = taskReferenceScore(task, contentQueryTerms, queryText, childTextByParentOid.get(String(task.oid || "").toUpperCase()) || "");
        const score = taskScore + recencyBoost(Date.parse(task.cachedAt || 0));
        return { id, task, score, taskScore, sameContextPath, matchedPath, activeTaskPath };
      })
      .filter((item) => {
        if (hasMatchedTaskPath && !item.matchedPath && !item.sameContextPath) return false;
        if (item.matchedPath && !item.activeTaskPath && item.task.isSubtask) return false;
        return item.score > 0 || item.activeTaskPath || (item.matchedPath && !item.task.isSubtask && item.taskScore >= TASK_CONTEXT_MIN_TASK_SCORE);
      })
      .sort((a, b) => Number(b.matchedPath) - Number(a.matchedPath) || Number(b.sameContextPath) - Number(a.sameContextPath) || b.score - a.score)
      .slice(0, 30)
      .map((item) => ({
        key: taskReferenceKey(item.task, item.id),
        path: item.task.path || "",
        priority: item.matchedPath ? 2 : item.sameContextPath ? 1 : 0,
        score: item.score,
        text: formatCachedTaskReference(item.id, item.task, this.settings)
      }));
    const noteSummaries = matchedTaskFiles
      .map((file) => matchedTaskNoteSummary(file, matchedPathTaskCounts[file.path] || 0))
      .filter(Boolean);
    const merged = limitTaskRowsForChat(uniqueTaskReferenceRows(taskRows.concat(cachedTasks)
      .sort((a, b) => b.priority - a.priority || b.score - a.score)
    ))
      .map((item) => item.text);
    return truncateMarkdownAtWord(noteSummaries.concat(merged).join("\n"), 4500);
  }

  buildAdaptiveContextPack(options = {}) {
    const mode = options.mode || "chat";
    const prompt = [options.prompt, options.sourceTitle, options.sourceSummary].filter(Boolean).join("\n");
    const depth = adaptiveContextDepth(mode, prompt);
    const budget = adaptiveContextBudget(mode);
    const basePath = vaultBasePath(this.app);
    const citationMap = options.citationMap instanceof Map ? options.citationMap : null;
    const query = [
      prompt,
      options.active?.title,
      options.active?.selection,
      (options.tasks || []).map((task) => task.content || task.title || "").join("\n")
    ].filter(Boolean).join("\n");
    const noteCards = adaptiveNoteCardsFromChunks(options.context || [], query, this.settings, {
      depth,
      maxCards: budget.maxNotes,
      basePath,
      citationMap
    });
    const taskCards = this.adaptiveTaskCards({
      depth,
      mode,
      query,
      active: options.active || null,
      tasks: options.tasks || [],
      context: options.context || [],
      maxCards: budget.maxTasks
    });
    const projectCards = adaptiveProjectCards(noteCards, taskCards, {
      depth,
      maxCards: budget.maxProjects
    });
    const text = formatAdaptiveContextPack({
      depth,
      mode,
      prompt: query,
      sourceTitle: options.sourceTitle || options.active?.title || "",
      active: options.active || null,
      noteCards,
      taskCards,
      projectCards,
      taskContext: options.taskContext || "",
      settings: this.settings
    }, Math.min(budget.maxChars, this.settings.maxContextChars ? Math.max(5000, this.settings.maxContextChars) : budget.maxChars));
    return { depth, mode, noteCards, taskCards, projectCards, text };
  }

  adaptiveTaskCards(options = {}) {
    const depth = Number(options.depth || 4);
    const query = options.query || "";
    const queryTerms = taskSearchTermCounts(query);
    const contextPaths = new Set((options.context || []).map((chunk) => chunk.path).filter(Boolean));
    const activePath = options.active?.path || "";
    const explicitTasks = flattenTaskPlan(options.tasks || []);
    const referenceIndex = this.getTaskReferenceIndex();
    const childTextByParentOid = referenceIndex.childTextByParentOid || new Map();
    const candidates = [];
    const addCard = (id, task, source, sourcePriority = 0) => {
      if (!task?.content) return;
      const notePath = vaultRelativePath(task.path || activePath || "", vaultBasePath(this.app));
      const childText = childTextByParentOid.get(String(task.oid || "").toUpperCase()) || "";
      const score = taskReferenceScore(task, queryTerms, query, childText);
      const pathMatch = Boolean(notePath && (notePath === activePath || contextPaths.has(notePath)));
      const broad = depth >= 7;
      const taskKnowledge = taskKnowledgeSnapshot(task, this.settings, childText, task.knowledge || task.taskKnowledge || null);
      if (!broad && !pathMatch && score <= 0 && source !== "current task") return;
      const dueScore = task.due_date || task.deadline_date || task.scheduledDueDateTime ? 0.35 : 0;
      const priorityScore = (normalizePriority(task.priority) - 1) * 0.25;
      const recency = recencyBoost(Date.parse(task.cachedAt || task.createdAt || 0));
      candidates.push({
        id: id || task.id || task.oid || "",
        title: task.content || "",
        path: notePath,
        source,
        score: sourcePriority + score + priorityScore + dueScore + recency + (pathMatch ? 1.25 : 0),
        status: task.isCompleted ? "completed" : task.isSubtask ? "subtask" : "open",
        priority: normalizePriority(task.priority),
        due: task.due_date || task.scheduledDueDateTime || "",
        deadline: task.deadline_date || "",
        labels: (task.labels || []).map(cleanLabel).filter(Boolean),
        project: task.projectName || "",
        section: task.section || "",
        parent: task.parentContent || "",
        todoistLink: id ? todoistTaskMarkdownLink(id, this.settings, task.content || "Open task") : "",
        knowledge: taskKnowledge,
        evidence: truncateAtWord(taskKnowledge.evidence || task.description || childText || "", 420)
      });
    };
    for (const task of explicitTasks) addCard(task.id || "", Object.assign({}, task, { path: task.path || activePath }), "current task", 3);
    for (const [id, task] of referenceIndex.entries || []) addCard(id, task, "local reference table", 0);
    for (const task of referenceIndex.pendingReferences || []) addCard("", task, "pending local reference", 0.4);
    return uniqueAdaptiveTaskCards(candidates)
      .sort((a, b) => b.score - a.score || b.priority - a.priority || String(a.title).localeCompare(String(b.title)))
      .slice(0, Math.max(1, options.maxCards || adaptiveContextBudget(options.mode || "chat").maxTasks));
  }

  taskFilesMatchingQuery(queryText, queryTerms, contextPaths = new Set(), limit = 8) {
    if (!Object.keys(queryTerms || {}).length) return [];
    const files = this.getSyncableTaskFiles();
    const requiredDateTokens = specificDateTokens(queryText);
    return files
      .map((file) => {
        const pathText = `${file.basename || ""} ${file.path || ""}`;
        const lexical = taskSearchLexicalScore(queryTerms, pathText);
        const dateScore = datePhraseOverlapScore(queryText, pathText);
        const contextPenalty = contextPaths.has(file.path) ? -0.01 : 0;
        return { file, score: lexical + dateScore + recencyBoost(file.stat?.mtime || 0) + contextPenalty };
      })
      .filter((item) => {
        if (!requiredDateTokens.size) return true;
        return dateTokensOverlap(requiredDateTokens, dateSearchTokens(`${item.file.basename || ""} ${item.file.path || ""}`));
      })
      .filter((item) => item.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit))
      .map((item) => item.file);
  }

  async chat(prompt, activeOverride = null, history = []) {
    const schedulerMemoryUpdate = await this.tryUpdateSchedulerMemoryFromChat(prompt);
    if (schedulerMemoryUpdate) return { answer: schedulerMemoryUpdate, context: [] };
    const dedupePolicyUpdate = await this.tryUpdateTaskDeduplicationPolicyFromChat(prompt);
    if (dedupePolicyUpdate) return { answer: dedupePolicyUpdate, context: [] };
    await this.ensureCompatibleEmbeddingForChatModel();
    this.requireAiAccess();
    const active = activeOverride || (this.settings.autoAddActiveContentToContext ? await this.getActiveMarkdownContext() : null);
    const query = [prompt, active?.title, active?.selection].filter(Boolean).join("\n");
    const context = await this.retrieveAdaptiveSemanticContext(query, "chat", this.settings.maxChatContextChunks, prompt);
    const activeText = active?.text ? (active.selection || active.text) : "";
    const sources = formatSourceLinks(active, context);
    const taskContext = await this.buildTaskContext(active, context, prompt);
    const adaptivePack = this.buildAdaptiveContextPack({
      mode: "chat",
      prompt,
      active,
      sourceTitle: active?.title || "",
      sourceSummary: activeText,
      context,
      taskContext
    });
    const modelChoice = this.aiModelForRequest("chat", { prompt, context, adaptivePack, taskContext });
    let response = await this.withAiActivity("Answering question", () => this.openaiResponse({
      model: modelChoice.model,
      system: [
        "You are a concise Obsidian sidebar assistant.",
        "Answer in plain language, usually in 3-6 short bullets or 1-3 short paragraphs.",
        "Use note evidence as the backbone of the answer: active note and ranked vault context first, then project context, then existing Todoist task references only as supporting pointers.",
        "Do not structure a vault answer around existing tasks unless the user asks about tasks, schedules, due dates, Todoist, or what to do next.",
        "Treat the active note as implied source context: cite it at most once in a response unless the user asks for line-by-line sourcing.",
        "When using context from other vault notes, cite the relevant note directly from the supplied source list near the claim it supports.",
        "Use markdown links exactly as supplied, and do not invent sources.",
        "When providing any link, use descriptive linked text in markdown form such as [task title](url) or [note title](url). Do not display full raw URLs in the visible answer.",
        "When relevant vault notes conflict on the same topic, treat the newest matching note as the current guidance unless the user asks for historical comparison.",
        "Treat task context as the local reference table for generated and synced Todoist tasks, including tasks connected to the active or relevant vault notes; task references should confirm or point to actions, not replace the note evidence.",
        "Task-context Todoist links and note links are allowed sources even when the note is not listed in the semantic source links.",
        "Use the task context to identify whether a task already exists before suggesting task creation.",
        "When referring to an existing task, include its supplied Todoist task link when available after explaining the relevant note-based evidence.",
        "Avoid long preambles."
      ].join(" "),
      user: [
        `Mode: ${this.settings.chatMode}`,
        "",
        "Recent chat:",
        formatChatHistory(history),
        "",
        "Active note context:",
        activeText || "No active note context.",
        "",
        "Allowed source links:",
        sources || "No source links available.",
        "",
        "Note-first vault context with secondary task pointers:",
        adaptivePack.text || taskContext || "No adaptive context found.",
        "",
        "User prompt:",
        prompt
      ].join("\n"),
      appendFallbackNotice: this.settings.showAiFallbackNotice !== false
    }));
    if (modelChoice.useStrong && this.settings.showAiFallbackNotice !== false && modelIdentity(this.lastAiResponseModel) === modelIdentity(modelChoice.model)) {
      response = `${String(response || "").trimEnd()}\n\nStronger AI model used: ${modelDisplayName(modelChoice.model)}`;
    }
    return { answer: response, context };
  }

  async tryUpdateSchedulerMemoryFromChat(prompt) {
    let command = parseSchedulerMemoryChatCommand(prompt, this.settings);
    if (!command) return "";
    const config = scheduleTodayConfig(this.settings);
    const policies = normalizeSchedulerDurationPolicies(this.schedulerMemory?.durationPolicies);
    if (command.showOnly) return schedulerMemoryPolicySummary(policies, config);
    try {
      this.requireAiAccess();
      const aiCommand = await this.interpretSchedulerMemoryPolicyCommand(prompt, policies, config);
      command = mergeSchedulerMemoryChatCommands(command, aiCommand);
    } catch (error) {
      this.logLocal("Scheduler memory AI policy interpretation skipped", { error: error.message || String(error) });
    }
    let changed = false;
    const updatePolicy = (id, updater) => {
      const index = policies.findIndex((policy) => policy.id === id);
      const current = index >= 0 ? policies[index] : normalizeSchedulerDurationPolicies([{ id }]).find((policy) => policy.id === id);
      if (!current) return;
      const next = updater(Object.assign({}, current));
      if (!next) return;
      if (index >= 0) policies[index] = next;
      else policies.push(next);
      changed = true;
    };
    if (command.peopleFollowupMinimum) {
      updatePolicy(SCHEDULER_PEOPLE_FOLLOWUP_POLICY_ID, (policy) => Object.assign(policy, {
        enabled: true,
        maxMinutesSetting: "scheduleTodayMinBlockMinutes",
        rationale: DEFAULT_SCHEDULER_POLICY_TEXT.peopleFollowupRationale
      }));
    } else if (command.peopleFollowupMaxMinutes) {
      updatePolicy(SCHEDULER_PEOPLE_FOLLOWUP_POLICY_ID, (policy) => Object.assign(policy, {
        enabled: true,
        maxMinutes: command.peopleFollowupMaxMinutes,
        maxMinutesSetting: "",
        rationale: "These blocks represent quick action or outreach by the user, not the actual meeting or conversation time."
      }));
    }
    if (command.defaultFocusMinutes) {
      updatePolicy(SCHEDULER_DEFAULT_FOCUS_POLICY_ID, (policy) => Object.assign(policy, {
        enabled: true,
        targetMinutes: command.defaultFocusMinutes
      }));
    }
    if (command.relatedGrouping != null) {
      updatePolicy(SCHEDULER_RELATED_GROUPING_POLICY_ID, (policy) => Object.assign(policy, {
        enabled: command.relatedGrouping !== false,
        boost: command.relatedGroupingBoost || policy.boost || 0.45
      }));
    }
    if (!changed) return schedulerMemoryPolicySummary(policies, config);
    this.schedulerMemory = normalizeSchedulerMemory(Object.assign({}, this.schedulerMemory || {}, {
      version: 2,
      updatedAt: deviceTimestamp(),
      durationPolicies: policies
    }));
    this.markSchedulerMemoryDirty(0);
    await this.flushSchedulerMemoryIfDirty();
    return `Updated scheduler memory.\n\n${schedulerMemoryPolicySummary(this.schedulerMemory.durationPolicies, config)}`;
  }

  async interpretSchedulerMemoryPolicyCommand(prompt, policies, config) {
    const json = await this.withAiActivity("Reading scheduler memory instruction", () => this.openaiResponse({
      model: this.settings.chatModel,
      jsonSchema: schedulerMemoryPolicyCommandSchema(),
      system: [
        "Interpret a user's instruction about local scheduler memory policies.",
        "Return only JSON matching the schema.",
        "The plugin will apply only validated policy fields locally; do not invent unrelated settings.",
        "Use null or unchanged values when the user did not clearly request a change.",
        "People follow-up/discussion policies should usually use the configured minimum duration when the user mentions quick follow-up, discussion, coordination, collaboration, or outreach tasks."
      ].join(" "),
      user: [
        "Current scheduler memory policies:",
        formatSchedulerDurationPolicies(policies, config),
        "",
        "Current scheduler settings:",
        `Minimum task block minutes: ${config.minBlockMinutes}`,
        `Maximum task block minutes: ${config.maxBlockMinutes}`,
        "",
        "User instruction:",
        prompt
      ].join("\n")
    }));
    const parsed = JSON.parse(json);
    return schedulerMemoryPolicyCommandFromAi(parsed);
  }

  async tryUpdateTaskDeduplicationPolicyFromChat(prompt) {
    const command = parseTaskDeduplicationPolicyChatCommand(prompt);
    if (!command) return "";
    if (command.showOnly) return taskDeduplicationPolicySettingsSummary(this.settings);
    if (command.reset) {
      this.settings.taskDeduplicationPolicy = DEFAULT_TASK_DEDUPLICATION_POLICY;
      this.recordTaskDeduplicationPolicyUpdate("Reset to the default policy from chat.");
      await this.saveSettings();
      return `Reset task deduplication policy.\n\n${taskDeduplicationPolicySettingsSummary(this.settings)}`;
    }
    const currentPolicy = taskDeduplicationPolicyText(this.settings);
    let nextPolicy = appendTaskDeduplicationPolicyInstruction(currentPolicy, command.updateText || prompt);
    let impact = taskDeduplicationPolicyImpactText(this.settings, nextPolicy);
    const model = taskDeduplicationAiModel(this.settings);
    if (command.updateText && hasChatCredentialForModel(this.settings, model)) {
      try {
        const interpreted = await this.interpretTaskDeduplicationPolicyCommand(prompt, currentPolicy);
        if (interpreted.policyText) nextPolicy = interpreted.policyText;
        if (interpreted.impactSummary) impact = interpreted.impactSummary;
      } catch (error) {
        this.logLocal("Task deduplication policy AI interpretation skipped", { error: error.message || String(error) });
      }
    }
    this.settings.taskDeduplicationPolicy = normalizeTaskDeduplicationPolicyText(nextPolicy);
    this.recordTaskDeduplicationPolicyUpdate(command.updateText || prompt);
    await this.saveSettings();
    return `Updated task deduplication policy.\n\n${taskDeduplicationPolicySettingsSummary(this.settings)}\n\nImpact: ${impact}`;
  }

  async interpretTaskDeduplicationPolicyCommand(prompt, currentPolicy) {
    const json = await this.withAiActivity("Updating task deduplication policy", () => this.openaiResponse({
      model: taskDeduplicationAiModel(this.settings),
      jsonSchema: taskDeduplicationPolicyCommandSchema(),
      system: [
        "Interpret a user's instruction about local task deduplication and merge policy.",
        "Return only JSON matching the schema.",
        "Keep the policy concise, conservative, and local-first.",
        "Do not remove these principles unless explicitly requested: completed tasks are not duplicates, confident matches reuse existing Todoist tasks with new local OIDs, labels are additive by default, and subtask removal requires explicit obsolete language."
      ].join(" "),
      user: [
        "Current task deduplication policy:",
        currentPolicy,
        "",
        "User instruction:",
        prompt
      ].join("\n")
    }));
    const parsed = JSON.parse(json);
    return taskDeduplicationPolicyCommandFromAi(parsed, currentPolicy);
  }

  recordTaskDeduplicationPolicyUpdate(instruction) {
    const entry = {
      at: deviceTimestamp(),
      instruction: truncateAtWord(singleLine(instruction || ""), 240),
      impact: taskDeduplicationPolicyImpactText(this.settings)
    };
    this.settings.taskDeduplicationPolicyUpdates = [entry, ...(this.settings.taskDeduplicationPolicyUpdates || [])].slice(0, TASK_DEDUPLICATION_POLICY_UPDATE_LIMIT);
  }

  aiModelForRequest(mode, options = {}) {
    const primary = options.primaryModel || this.settings.chatModel || DEFAULT_SETTINGS.chatModel;
    const decision = this.strongModelEscalationDecision(mode, Object.assign({}, options, { primaryModel: primary }));
    if (decision.useStrong) {
      this.logLocal("Strong AI model selected", {
        mode,
        from: modelDisplayName(primary),
        to: modelDisplayName(decision.model),
        score: decision.score,
        reasons: decision.reasons
      });
      return decision;
    }
    return decision;
  }

  strongModelEscalationDecision(mode, options = {}) {
    const primary = options.primaryModel || this.settings.chatModel || DEFAULT_SETTINGS.chatModel;
    return {
      model: primary,
      primaryModel: primary,
      strongModel: "",
      useStrong: false,
      score: 0,
      signals: {},
      reasons: []
    };
  }

  strongModelForPrimary(primaryModel) {
    if (usesGeminiChatModel(primaryModel)) {
      const primary = normalizeGeminiModelId(primaryModel);
      const preferred = this.settings.chatFallbackModel && usesGeminiChatModel(this.settings.chatFallbackModel)
        ? `gemini/${normalizeGeminiModelId(this.settings.chatFallbackModel)}`
        : "";
      const models = this.settings.availableGeminiModels?.length ? this.settings.availableGeminiModels : DEFAULT_SETTINGS.availableGeminiModels;
      return uniqueValues([preferred].concat(rankGeminiFallbackModels(models)
        .map((model) => `gemini/${normalizeGeminiModelId(model)}`)
        .filter((model) => isUsableGeminiChatModel(model) && normalizeGeminiModelId(model) !== primary))).slice(0, 1)[0] || "";
    }
    if (usesOpenAIChatModel(primaryModel)) {
      const primary = normalizeOpenAIModelId(primaryModel);
      const preferred = this.settings.chatFallbackModel && usesOpenAIChatModel(this.settings.chatFallbackModel)
        ? normalizeOpenAIModelId(this.settings.chatFallbackModel)
        : DEFAULT_SETTINGS.chatFallbackModel;
      return uniqueValues([preferred].concat(this.settings.availableChatModels || DEFAULT_SETTINGS.availableChatModels || [])
        .map((model) => normalizeOpenAIModelId(model))
        .filter((model) => model && model !== primary)).slice(0, 1)[0] || "";
    }
    return "";
  }

  async openaiResponse({ model, system, user, jsonSchema, appendFallbackNotice = false }) {
    const primaryModel = model || this.settings.chatModel || DEFAULT_SETTINGS.chatModel;
    const candidates = [primaryModel].concat(this.sameProviderFallbackModels(primaryModel));
    let lastError = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidateModel = candidates[index];
      try {
        if (index > 0) this.setSidebarStatus(`Retrying AI with ${modelDisplayName(candidateModel)}...`);
        const response = usesGeminiChatModel(candidateModel)
          ? await this.geminiResponse({ model: candidateModel, system, user, jsonSchema })
          : await this.openaiProviderResponse({ model: candidateModel, system, user, jsonSchema });
        this.lastAiResponseModel = candidateModel;
        if (index > 0 && appendFallbackNotice && !jsonSchema) {
          return `${String(response || "").trimEnd()}\n\nAI fallback model used: ${modelDisplayName(candidateModel)}`;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (!this.settings.enableAiModelFallback || index >= candidates.length - 1 || !isTransientAiModelError(error)) throw error;
        this.logLocal("AI model fallback triggered", {
          from: modelDisplayName(candidateModel),
          to: modelDisplayName(candidates[index + 1]),
          error: error.message || String(error)
        });
      }
    }
    throw lastError;
  }

  sameProviderFallbackModels(primaryModel) {
    if (!this.settings.enableAiModelFallback) return [];
    if (usesGeminiChatModel(primaryModel)) {
      const primary = normalizeGeminiModelId(primaryModel);
      const models = this.settings.availableGeminiModels?.length ? this.settings.availableGeminiModels : DEFAULT_SETTINGS.availableGeminiModels;
      const preferred = this.settings.chatFallbackModel && usesGeminiChatModel(this.settings.chatFallbackModel)
        ? `gemini/${normalizeGeminiModelId(this.settings.chatFallbackModel)}`
        : "";
      return uniqueValues([preferred].concat(rankGeminiFallbackModels(models)
        .map((model) => `gemini/${normalizeGeminiModelId(model)}`)
        .filter((model) => isUsableGeminiChatModel(model) && normalizeGeminiModelId(model) !== primary))).slice(0, 1);
    }
    const primary = normalizeOpenAIModelId(primaryModel);
    const preferred = this.settings.chatFallbackModel && usesOpenAIChatModel(this.settings.chatFallbackModel)
      ? normalizeOpenAIModelId(this.settings.chatFallbackModel)
      : "";
    return uniqueValues([preferred].concat((this.settings.availableChatModels || [])
      .map((model) => normalizeOpenAIModelId(model))
      .filter((model) => model && model !== primary))).slice(0, 1);
  }

  async openaiProviderResponse({ model, system, user, jsonSchema }) {
    const body = {
      model: normalizeOpenAIModelId(model || this.settings.chatModel || DEFAULT_SETTINGS.chatModel),
      background: true,
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: user }] }
      ]
    };
    if (jsonSchema) {
      body.text = { format: { type: "json_schema", name: "semantic_todoist_tasks", strict: true, schema: jsonSchema } };
    }
    let response = await this.openaiResponsesRequest("POST", "/responses", body);
    if (response.status === 400 && /background/i.test(response.text || "")) {
      const foregroundBody = Object.assign({}, body);
      delete foregroundBody.background;
      response = await this.openaiResponsesRequest("POST", "/responses", foregroundBody);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OpenAI returned ${response.status}: ${redactSecrets(response.text)}`);
    }
    const completed = await this.waitForOpenAIResponse(response.json);
    return completed.output_text || extractOutputText(completed);
  }

  async geminiResponse({ model, system, user, jsonSchema }) {
    const modelId = normalizeGeminiModelId(model || this.settings.chatModel || "gemini-3.5-flash");
    const generationConfig = {};
    if (jsonSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = geminiCompatibleSchema(jsonSchema);
    }
    let response = await requestUrl({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`,
      method: "POST",
      headers: {
        "x-goog-api-key": this.settings.googleApiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system || "" }] },
        contents: [{ role: "user", parts: [{ text: user || "" }] }],
        generationConfig
      }),
      throw: false
    });
    if (jsonSchema && response.status === 400) {
      const fallbackSystem = [
        system || "",
        "Return syntactically valid JSON only. Do not wrap it in markdown. Match the requested schema exactly."
      ].filter(Boolean).join(" ");
      response = await requestUrl({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`,
        method: "POST",
        headers: {
          "x-goog-api-key": this.settings.googleApiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: fallbackSystem }] },
          contents: [{ role: "user", parts: [{ text: [
            "JSON schema to match:",
            JSON.stringify(geminiCompatibleSchema(jsonSchema)),
            "",
            user || ""
          ].join("\n") }] }],
          generationConfig: { responseMimeType: "application/json" }
        }),
        throw: false
      });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Gemini returned ${response.status}: ${redactSecrets(response.text)}`);
    }
    const text = extractGeminiText(response.json);
    if (!text) throw new Error(`Gemini returned no text: ${redactSecrets(response.text)}`);
    return jsonSchema ? extractJsonPayload(text) : text;
  }

  async openaiResponsesRequest(method, path, body) {
    return requestUrl({
      url: `https://api.openai.com/v1${path}`,
      method,
      headers: {
        authorization: `Bearer ${this.settings.openaiApiKey}`,
        "content-type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      throw: false
    });
  }

  async waitForOpenAIResponse(responseJson) {
    let current = responseJson || {};
    const startedAt = Date.now();
    const maxWaitMs = 4 * 60 * 1000;
    while (true) {
      const status = current.status || "completed";
      if (status === "completed") return current;
      if (["failed", "cancelled", "canceled", "incomplete"].includes(status)) {
        throw new Error(`OpenAI response ${status}: ${JSON.stringify(current.error || current.incomplete_details || {})}`);
      }
      if (!current.id) throw new Error(`OpenAI response did not return an id: ${JSON.stringify(current)}`);
      if (Date.now() - startedAt > maxWaitMs) throw new Error("OpenAI response did not complete within 4 minutes.");
      await delay(2500);
      const poll = await this.openaiResponsesRequest("GET", `/responses/${encodeURIComponent(current.id)}`);
      if (poll.status < 200 || poll.status >= 300) throw new Error(`OpenAI poll returned ${poll.status}: ${redactSecrets(poll.text)}`);
      current = poll.json || {};
    }
  }

  async refreshOpenAIModels(showNotice = true) {
    let loadedOpenAI = 0;
    let loadedGemini = 0;
    if (this.settings.openaiApiKey) {
      const modelsResponse = await requestUrl({
        url: "https://api.openai.com/v1/models",
        method: "GET",
        headers: { authorization: `Bearer ${this.settings.openaiApiKey}` },
        throw: false
      });
      if (modelsResponse.status < 200 || modelsResponse.status >= 300) {
        throw new Error(`OpenAI models returned ${modelsResponse.status}: ${redactSecrets(modelsResponse.text)}`);
      }
      const ids = (modelsResponse.json.data || []).map((model) => model.id).sort();
      const embeddings = ids.filter((id) => /embedding/i.test(id));
      const chat = ids.filter((id) => {
        if (/embedding|whisper|tts|transcribe|moderation|image|dall-e|sora/i.test(id)) return false;
        return /^(gpt|o[0-9]|chatgpt)/i.test(id);
      });
      this.settings.availableChatModels = chat;
      this.settings.availableEmbeddingModels = embeddings;
      this.settings.modelsFetchedAt = deviceTimestamp();
      loadedOpenAI = chat.length + embeddings.length;
      if (usesOpenAIChatModel(this.settings.chatModel) && !chat.includes(normalizeOpenAIModelId(this.settings.chatModel)) && chat.length) this.settings.chatModel = preferredChatModelForProvider(this.settings, "openai");
      if (usesOpenAIEmbeddingModel(this.settings.embeddingModel) && !embeddings.includes(normalizeOpenAIModelId(this.settings.embeddingModel))) {
        this.settings.embeddingModel = embeddings.includes("text-embedding-3-large") ? "text-embedding-3-large" : embeddings[0] || this.settings.embeddingModel;
      }
    }
    if (this.settings.googleApiKey) {
      const geminiModels = await this.fetchGeminiModels();
      this.settings.availableGeminiModels = geminiModels.chat.length ? geminiModels.chat : DEFAULT_SETTINGS.availableGeminiModels;
      this.settings.availableGeminiEmbeddingModels = geminiModels.embeddings.length ? geminiModels.embeddings : DEFAULT_SETTINGS.availableGeminiEmbeddingModels;
      this.settings.geminiModelsFetchedAt = deviceTimestamp();
      loadedGemini = this.settings.availableGeminiModels.length + this.settings.availableGeminiEmbeddingModels.length;
    }
    if (!this.settings.openaiApiKey && !this.settings.googleApiKey) throw new Error("Add an OpenAI API key or Google API key first.");
    if (!usesGeminiChatModel(this.settings.chatModel) && !usesOpenAIChatModel(this.settings.chatModel)) {
      this.settings.chatModel = DEFAULT_SETTINGS.chatModel;
    }
    this.ensureSameProviderFallbackModel();
    await this.ensureCompatibleEmbeddingForChatModel();
    await this.saveSettings();
    this.queryEmbeddingCache.clear();
    if (showNotice) new Notice(`Loaded ${loadedOpenAI} OpenAI models and ${loadedGemini} Gemini models.`);
  }

  async fetchGeminiModels() {
    const response = await requestUrl({
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      method: "GET",
      headers: { "x-goog-api-key": this.settings.googleApiKey },
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Gemini models returned ${response.status}: ${redactSecrets(response.text)}`);
    }
    const models = response.json?.models || [];
    const chat = [];
    const embeddings = [];
    for (const model of models) {
      const id = normalizeGeminiModelId(model.name || "");
      const methods = model.supportedGenerationMethods || [];
      if (!id) continue;
      if (methods.includes("generateContent") && /^gemini-/i.test(id)) chat.push(id);
      if (methods.includes("embedContent") && /embedding/i.test(id)) embeddings.push(id);
    }
    for (const preferred of ["gemini-3.1-flash-lite", "gemini-3.5-flash"]) {
      if (!chat.includes(preferred)) chat.unshift(preferred);
    }
    return {
      chat: Array.from(new Set(chat)).sort((a, b) => a.localeCompare(b)),
      embeddings: Array.from(new Set(embeddings)).sort((a, b) => a.localeCompare(b))
    };
  }

  async createTaskPlan(source) {
    await this.ensureCompatibleEmbeddingForChatModel();
    const sourceSummary = compressSourceForTaskPrompt(source, this.settings);
    const taskQuery = `${source.title}\n${sourceSummary}`;
    const context = await this.retrieveAdaptiveSemanticContext(taskQuery, "task-generation", this.settings.maxTaskContextChunks, source.templateInstructions || "");
    const taskContext = await this.buildTaskContext(
      source.type === "note" ? { path: source.path || "", text: source.text || "" } : null,
      context,
      taskQuery
    );
    const contextNotes = contextNotesForTaskPlan(context, source.path, Math.max(this.settings.taskContextSummaryMaxNotes || 0, adaptiveContextBudget("task-generation").maxNotes));
    const taskInstructions = this.taskInstructionsForSource(source.type);
    const maxMainTasks = generationMainTaskLimit(this.settings);
    const maxSubtasks = generationSubtaskLimit(this.settings);
    const instructions = [
      source.templateInstructions ? `Selected prompt:\n${source.templateInstructions}` : "",
      `Generation limits:\nCreate no more than ${maxMainTasks} main tasks. Create no more than ${maxSubtasks} subtasks under any main task. It is better to create fewer high-confidence tasks than to fill the limit.`,
      taskGenerationRequirements(taskInstructions, this.settings)
    ].filter(Boolean).join("\n\n");
    const adaptivePack = this.buildAdaptiveContextPack({
      mode: "task-generation",
      prompt: [taskQuery, instructions].join("\n"),
      active: source.type === "note" ? { title: source.title, path: source.path || "", text: source.text || "" } : null,
      sourceTitle: source.title,
      sourceSummary,
      context,
      taskContext
    });
    const modelChoice = this.aiModelForRequest("task-generation", {
      prompt: [taskQuery, instructions].join("\n"),
      context,
      adaptivePack,
      taskContext,
      taskCount: maxMainTasks + maxSubtasks
    });
    const json = await this.withAiActivity("Generating task list", () => this.openaiResponse({
      model: modelChoice.model,
      jsonSchema: taskCreationSchema(maxMainTasks, maxSubtasks),
      system: [
        "Create Todoist task structure from the supplied source.",
        "Return only JSON matching the schema.",
        "Follow the Main task requirements for every top-level task and the Subtask requirements for every subtask.",
        "Use the active source content and adaptive task/meeting/project context for every task-generation decision, including main tasks and subtasks.",
        "Treat the vault context as required supporting context when it is available, but only use lines that are relevant to the source and task request.",
        "When ranked vault context conflicts on the same topic, prefer the newest matching note as the current guidance while preserving older notes only as background.",
        "Return exactly one section_name for the generated task group. Build section_name from the Section title instructions in settings.",
        "Create only tasks that are truly actionable by the user. Skip informational discussion, vague ideas, duplicate tasks, status updates, and work clearly owned by someone else unless the user must follow up.",
        source.type === "note" ? "For notes, treat #todo markers and nearby lines as the strongest signal for user-owned actions. If no #todo markers exist, use only explicit action or follow-up language." : "For emails, use only explicit action, follow-up, review, waiting-on, or decision requests from the email thread.",
        `Hard limits: maximum ${maxMainTasks} main tasks and maximum ${maxSubtasks} subtasks per main task.`,
        "Labels must omit the leading #. Do not create any label unless it is explicitly named in the tag instructions.",
        "Use subtasks only when a main task has concrete required steps, dependencies, or follow-up actions.",
        "Do not write task descriptions in this step. Descriptions are generated in a separate pass after local OIDs are assigned.",
        "For date fields, follow the Dates and Deadlines instructions exactly. Use null for due_date or deadline_date when the source and settings do not support that field.",
        "due_date and deadline_date are separate fields. Do not copy one into the other unless the Dates and Deadlines instructions explicitly say to do that.",
        `Today is ${today()}. Use this only to interpret relative dates when the Dates and Deadlines instructions allow a date.`
      ].join(" "),
      user: [
        "Task generation request:",
        instructions,
        "",
        `Source type: ${source.type}`,
        `Source title: ${source.title}`,
        `Fallback section name if the Section title instructions cannot be applied: ${source.sectionName || ""}`,
        "",
        "Source content:",
        sourceSummary,
        "",
        "Adaptive task, meeting, project, and portfolio context (required supporting context when available; locally ranked and compacted):",
        adaptivePack.text || taskContext || "No adaptive context found."
      ].join("\n")
    }));
    const parsed = JSON.parse(json);
    const allowedLabels = labelsAllowedByInstructions(taskInstructions.tags);
    parsed.tasks = limitGeneratedTasks((parsed.tasks || []).map((task) => cleanTask(task, allowedLabels, this.settings)).filter((task) => task.content), maxMainTasks, maxSubtasks);
    if (!parsed.tasks.length) {
      const fallbackTask = explicitReviewRequestFallbackTask(source, sourceSummary, this.settings);
      if (fallbackTask) parsed.tasks = [cleanTask(fallbackTask, allowedLabels, this.settings)].filter((task) => task.content);
    }
    parsed.sectionName = cleanGeneratedSectionName(parsed.section_name || parsed.sectionName || source.sectionName);
    parsed.contextNotes = contextNotes;
    parsed.sourceSummary = sourceSummary;
    parsed.semanticContext = context;
    parsed.adaptiveContextDepth = adaptivePack.depth;
    parsed.descriptionInstructions = taskInstructions.descriptions;
    return parsed;
  }

  async refineTaskDescriptions(tasks, sourceSummary, context, sourceTitle, descriptionInstructions, options = {}) {
    const mainTasks = (tasks || []).map((task, index) => ({
      index,
      title: task.content || "",
      currentDescription: task.description || "",
      labels: task.labels || [],
      subtasks: (task.subtasks || []).map((subtask) => subtask.content).filter(Boolean)
    }));
    if (!mainTasks.length) return;
    const citationState = contextCitationState(options.contextNotes || [], options.basePath || "", options.citeContextNotes !== false);
    const citationMap = citationState.citationMap;
    const citeContextNotes = citationState.citeContextNotes;
    const contextQuery = [sourceTitle, sourceSummary, mainTasks.map((task) => task.title).join("\n")].join("\n");
    const adaptivePack = this.buildAdaptiveContextPack({
      mode: "description",
      prompt: contextQuery,
      sourceTitle,
      sourceSummary,
      tasks,
      context,
      citationMap,
      active: { title: sourceTitle || "", path: "", text: sourceSummary || "" }
    });
    const modelChoice = this.aiModelForRequest("description", {
      prompt: contextQuery,
      context,
      adaptivePack,
      taskContext: adaptivePack.text || "",
      taskCount: mainTasks.length
    });
    this.setSidebarStatus(`Writing descriptions for ${mainTasks.length} main task${mainTasks.length === 1 ? "" : "s"}...`);
    const json = await this.withAiActivity(`Writing ${mainTasks.length} task description${mainTasks.length === 1 ? "" : "s"}`, () => this.openaiResponse({
      model: modelChoice.model,
      jsonSchema: taskDescriptionSchema(),
      system: [
        "Write Todoist main-task descriptions only.",
        "Do not change task titles, due dates, priorities, labels, or subtasks.",
        "For each main task, write one concrete, useful paragraph between 120 and 900 characters, usually 2-4 sentences.",
        "Every description must pass this local quality gate: at least 80 characters, at least 12 words, not empty, not title-only, not a generic instruction to review/use the source, and not a close paraphrase of the task title.",
        "Do not repeat or paraphrase the task title.",
        "Start with the actionable context itself: name the relevant people, documents, program, meeting, decision, dependency, timing, or constraint when the source provides it.",
        "Do not start by naming, citing, or describing the active note, primary note, source title, email subject, or filename.",
        "Do not write openings like 'The note says', 'The source records', 'The email indicates', a source-title recap, or any filename-first framing.",
        "Then explain why the task matters or what must be clarified so the task can be actioned without reopening every source.",
        "Do not copy raw note lines. Summarize the active note and ranked relevant vault context into useful action context.",
        "Use the adaptive context pack as required supporting context when it is available; prioritize the highest-ranked excerpts that explain intent, rationale, dependencies, constraints, people, documents, program status, or next information needed.",
        "When context notes conflict on the same topic, prefer the newest matching context note as current guidance and use older notes only as background.",
        citeContextNotes ? "When a sentence uses information primarily from a numbered context note, add the matching context note citation at the end of that sentence, using syntax like (1). Do not cite the active or primary source. Use only supplied Context Note numbers." : "Do not add numbered context-note citations.",
        "Explain the useful why/so-what behind the context in plain language so the task can be actioned without reopening every source.",
        "Never return an empty description. Never say only to use the source material.",
        "Avoid vague openings such as 'This task requires', 'Review the source', 'Complete the task', or 'Use the source material'.",
        "Do not mention whether web links or linked files were found, missing, excluded, or unavailable.",
        "Do not include source lists, headings, bullets, tags, section names, date metadata, or subtask lists.",
        "Subtasks must not receive descriptions."
      ].join(" "),
      user: [
        `Source title for internal grounding only; do not include it verbatim in descriptions: ${sourceTitle || ""}`,
        "",
        "Description instructions:",
        descriptionInstructions || "",
        "",
        `Excluded link domains: ${excludedLinkDomains(this.settings).join(", ") || "none"}`,
        "",
        "Local validation rule:",
        "Descriptions that are too short, too generic, title-only, or under 12 words are rejected and require a second AI call. Make the first response specific enough to avoid that.",
        "",
        "Context-note citation rule:",
        contextCitationInstructions(citeContextNotes),
        "",
        "Main tasks needing descriptions:",
        JSON.stringify(mainTasks),
        "",
        "Active source content:",
        sourceSummary || "",
        "",
        "Adaptive portfolio-level context for writing task descriptions:",
        adaptivePack.text || formatContext(context, this.settings.maxContextChars, this.settings, contextQuery, { citationMap, basePath: options.basePath || "" }) || "No relevant vault context found."
      ].join("\n")
    }));
    const parsed = JSON.parse(json);
    for (const item of parsed.descriptions || []) {
      const task = tasks[item.index];
      if (!task || task.isSubtask) continue;
      const summary = cleanTaskDescriptionSummary(item.description || "", task.content, sourceTitle, this.settings, citationState);
      task.description = truncateAtWord(summary || task.description || "", 1200);
      for (const subtask of task.subtasks || []) subtask.description = "";
    }
    const weakTasks = (tasks || []).map((task, index) => ({ task, index })).filter(({ task }) => !isUsefulDescriptionSummary(task.description, task.content, this.settings));
    if (weakTasks.length) {
      this.logLocal("Task descriptions needed improvement", {
        count: weakTasks.length,
        tasks: weakTasks.map(({ task }) => ({ title: task.content || "", reason: descriptionQualityReason(task.description, task.content, this.settings) }))
      });
      this.setSidebarStatus(`Improving ${weakTasks.length} task description${weakTasks.length === 1 ? "" : "s"}...`);
      await this.repairTaskDescriptions(weakTasks, sourceSummary, context, sourceTitle, descriptionInstructions, options);
    }
    this.setSidebarStatus("Finalizing task descriptions...");
    for (const task of tasks || []) {
      if (!isUsefulDescriptionSummary(task.description, task.content, this.settings)) {
        task.description = fallbackActionSummary(task, sourceSummary, context, sourceTitle, this.settings);
      }
      for (const subtask of task.subtasks || []) subtask.description = "";
    }
  }

  async repairTaskDescriptions(weakTasks, sourceSummary, context, sourceTitle, descriptionInstructions, options = {}) {
    const repairItems = weakTasks.map(({ task, index }) => ({
      index,
      title: task.content || "",
      labels: task.labels || [],
      subtasks: (task.subtasks || []).map((subtask) => subtask.content).filter(Boolean)
    }));
    if (!repairItems.length) return;
    const citationState = contextCitationState(options.contextNotes || [], options.basePath || "", options.citeContextNotes !== false);
    const citationMap = citationState.citationMap;
    const citeContextNotes = citationState.citeContextNotes;
    const contextQuery = [sourceTitle, sourceSummary, repairItems.map((task) => task.title).join("\n")].join("\n");
    const adaptivePack = this.buildAdaptiveContextPack({
      mode: "description",
      prompt: contextQuery,
      sourceTitle,
      sourceSummary,
      tasks: repairItems.map((item) => Object.assign({}, weakTasks.find(({ index }) => index === item.index)?.task || {}, { content: item.title })),
      context,
      citationMap,
      active: { title: sourceTitle || "", path: "", text: sourceSummary || "" }
    });
    const modelChoice = this.aiModelForRequest("description", {
      prompt: contextQuery,
      context,
      adaptivePack,
      taskContext: adaptivePack.text || "",
      taskCount: repairItems.length,
      validationRepair: true
    });
    const json = await this.withAiActivity(`Improving ${repairItems.length} task description${repairItems.length === 1 ? "" : "s"}`, () => this.openaiResponse({
      model: modelChoice.model,
      jsonSchema: taskDescriptionSchema(),
      system: [
        "Improve incomplete Todoist main-task descriptions.",
        "Return only JSON matching the schema.",
        "Each description must be 80-1200 characters and must explain the specific context, rationale, dependencies, people, documents, and next information needed to action the task.",
        "Use active source content first, then use the adaptive portfolio-level context as required supporting context when available. Do not repeat the title. Do not say to use the source material.",
        "When context notes conflict on the same topic, prefer the newest matching context note as current guidance and use older notes only as background.",
        "Do not start by naming, citing, or describing the active note, primary note, source title, email subject, or filename. Start with the information needed to action the task.",
        citeContextNotes ? "When a sentence uses information primarily from a numbered context note, add the matching context note citation at the end of that sentence, using syntax like (1). Do not cite the active or primary source. Use only supplied Context Note numbers." : "Do not add numbered context-note citations.",
        "Do not mention whether web links or linked files were found, missing, excluded, or unavailable.",
        "Do not include source lists, headings, bullets, tags, dates, section names, metadata, or subtask lists."
      ].join(" "),
      user: [
        `Source title for internal grounding only; do not include it verbatim in descriptions: ${sourceTitle || ""}`,
        "",
        "Description instructions:",
        descriptionInstructions || "",
        "",
        `Excluded link domains: ${excludedLinkDomains(this.settings).join(", ") || "none"}`,
        "",
        "Context-note citation rule:",
        contextCitationInstructions(citeContextNotes),
        "",
        "Tasks needing improved descriptions:",
        JSON.stringify(repairItems),
        "",
        "Active source content:",
        sourceSummary || "",
        "",
        "Adaptive portfolio-level context for repairing task descriptions:",
        adaptivePack.text || formatContext(context, Math.min(this.settings.maxContextChars || 8000, 8000), this.settings, contextQuery, { citationMap, basePath: options.basePath || "" }) || "No relevant vault context found."
      ].join("\n")
    }));
    const parsed = JSON.parse(json);
    for (const item of parsed.descriptions || []) {
      const match = weakTasks.find(({ index }) => index === item.index);
      if (!match) continue;
      const summary = cleanTaskDescriptionSummary(item.description || "", match.task.content, sourceTitle, this.settings, citationState);
      if (isUsefulDescriptionSummary(summary, match.task.content, this.settings)) match.task.description = truncateAtWord(summary, 1200);
    }
  }

  taskInstructionsForSource(type) {
    const prefix = type === "email" ? "email" : "note";
    const fallback = {
      main: this.settings.mainTaskInstructions,
      subtasks: this.settings.subtaskInstructions,
      sectionTitle: this.settings.sectionTitleInstructions,
      dates: this.settings.dateInstructions,
      tags: this.settings.tagInstructions,
      priorities: this.settings.priorityInstructions,
      descriptions: this.settings.descriptionInstructions
    };
    return {
      main: this.settings[`${prefix}MainTaskInstructions`] || fallback.main,
      subtasks: this.settings[`${prefix}SubtaskInstructions`] || fallback.subtasks,
      sectionTitle: this.settings[`${prefix}SectionTitleInstructions`] || fallback.sectionTitle,
      dates: this.settings[`${prefix}DateInstructions`] || fallback.dates,
      tags: this.settings[`${prefix}TagInstructions`] || fallback.tags,
      priorities: this.settings[`${prefix}PriorityInstructions`] || fallback.priorities,
      descriptions: this.settings[`${prefix}DescriptionInstructions`] || fallback.descriptions
    };
  }

  async openScheduleTodayPreview(template = null) {
    try {
      const scheduleTemplate = template || await this.resolveScheduleTodayTemplate();
      const preview = await this.buildScheduleTodayPreview(scheduleTemplate);
      new ScheduleTodayModal(this.app, this, preview).open();
    } catch (error) {
      console.error(error);
      this.logLocal("Schedule today preview failed", { error: error.message || String(error) });
      new Notice(`Schedule today failed: ${error.message || error}`);
      this.setSidebarStatus("Ready");
    }
  }

  async resolveScheduleTodayTemplate() {
    try {
      const templates = await this.getPromptTemplates();
      const selected = templates.find((template) => isScheduleTodayTemplate(template));
      if (selected) return selected;
    } catch (error) {
      console.error(error);
    }
    return {
      name: "Schedule today's tasks",
      prompt: DEFAULT_SCHEDULE_TODAY_PROMPT,
      action: "schedule-today",
      createTasks: false,
      insertResponse: false,
      syncAfterInsert: false
    };
  }

  async buildScheduleTodayPreview(template = null) {
    if (this.schedulerInProgress) throw new Error("Schedule Today is already planning tasks.");
    this.schedulerInProgress = true;
    this.setSidebarStatus("Planning today's tasks...");
    try {
      if (!this.settings.scheduleTodayEnabled) throw new Error("Enable Schedule Today's Tasks in settings first.");
      this.requireAiAccess();
      this.requireTodoistAccess();
      await this.ensureCompatibleEmbeddingForChatModel();
      const scheduleConfig = scheduleTodayConfig(this.settings);
      scheduleConfig.durationPolicies = schedulerMemoryDurationPolicies(this.schedulerMemory);
      const snapshot = await this.getTodoistSnapshot(["items", "projects", "sections"], false);
      const tasks = enrichTodoistTasksWithSnapshot(snapshot).filter((task) => !task.isCompleted);
      const candidates = scheduleTodayCandidates(tasks, this.settings, scheduleConfig, this.schedulerMemory);
      const memoryMatches = this.applySchedulerMemoryToCandidates(candidates);
      if (!candidates.length) {
        return emptyScheduleTodayPreview(scheduleConfig, "No overdue tasks or tasks due within the configured window were found.");
      }
      const query = candidates.slice(0, 24).map((item) => item.searchText).join("\n");
      const context = query ? await this.retrieveAdaptiveSemanticContext(query, "schedule", Math.min(6, Math.max(3, this.settings.maxTaskContextChunks || 6)), template?.prompt || DEFAULT_SCHEDULE_TODAY_PROMPT) : [];
      const semanticPriorityMatches = applySemanticContextToScheduleCandidates(candidates, context, scheduleConfig);
      const taskContext = await this.buildTaskContext(null, context, query);
      const adaptivePack = this.buildAdaptiveContextPack({
        mode: "schedule",
        prompt: [query, template?.prompt || DEFAULT_SCHEDULE_TODAY_PROMPT].join("\n"),
        sourceTitle: "Schedule today's tasks",
        tasks: candidates,
        context,
        taskContext
      });
      const adaptiveSignalMatches = applyAdaptiveContextPackToScheduleCandidates(candidates, adaptivePack, scheduleConfig);
      const durationTriage = prepareScheduleDurationTriage(candidates, scheduleConfig, this.settings);
      const durationModelChoice = this.aiModelForRequest("schedule", {
        prompt: [query, template?.prompt || DEFAULT_SCHEDULE_TODAY_PROMPT].join("\n"),
        context,
        adaptivePack,
        taskContext,
        taskCount: durationTriage.aiCandidates.length
      });
      const durationEstimateModel = durationModelChoice.model || schedulerDurationEstimateModel(this.settings);
      await this.estimateScheduleTodayDurations(durationTriage.aiCandidates, context, adaptivePack.text || taskContext, scheduleConfig, template, {
        force: true,
        totalMissing: durationTriage.totalMissing,
        model: durationEstimateModel
      });
      const preview = planScheduleToday(candidates, scheduleConfig, this.settings);
      preview.durationTriage = durationTriage.summary;
      preview.context = context.map((chunk) => ({
        title: chunk.title || "",
        path: chunk.path || "",
        score: chunk.matchScore || 0
      })).slice(0, 6);
      this.logLocal("Schedule today preview prepared", {
        candidates: candidates.length,
        scheduled: preview.scheduled.length,
        fixed: preview.fixed.length,
        unscheduled: preview.unscheduled.length,
        split: preview.splitSubtasks.length,
        memoryMatches,
        semanticPriorityMatches,
        adaptiveSignalMatches,
        durationAiCandidates: durationTriage.aiCandidates.length,
        durationLocalOnly: durationTriage.localOnlyCount,
        durationAiModel: modelDisplayName(durationEstimateModel)
      });
      this.recordSchedulerPreviewMemory(candidates, context);
      return preview;
    } finally {
      this.schedulerInProgress = false;
      this.setSidebarStatus("Ready");
    }
  }

  async estimateScheduleTodayDurations(candidates, context, taskContext, scheduleConfig, template = null, options = {}) {
    const missing = options.force ? (candidates || []).filter(Boolean) : (candidates || []).filter((candidate) => !candidate.durationMinutes);
    if (!missing.length) return;
    const totalMissing = Math.max(missing.length, Number(options.totalMissing || 0));
    const skipped = Math.max(0, totalMissing - missing.length);
    const durationModel = options.model || schedulerDurationEstimateModel(this.settings);
    this.setSidebarStatus(`Estimating ${missing.length} triaged duration${missing.length === 1 ? "" : "s"}...`);
    const schedulerPrompt = String(template?.prompt || DEFAULT_SCHEDULE_TODAY_PROMPT).trim();
    const schedulerPromptName = singleLine(template?.name || template?.source || "Schedule today's tasks");
    const durationPolicies = schedulerMemoryDurationPolicies(this.schedulerMemory);
    const durationPolicyText = formatSchedulerDurationPolicies(durationPolicies, scheduleConfig);
    const compactTasks = missing.map((candidate) => ({
      id: candidate.id,
      title: candidate.content,
      description: truncateAtWord(singleLine(candidate.description || ""), 420),
      labels: candidate.labels || [],
      priority: candidate.priority,
      due: candidate.dueDate || "",
      deadline: candidate.deadlineDate || "",
      parent: candidate.parentContent || "",
      note: candidate.path || "",
      isSubtask: Boolean(candidate.isSubtask),
      intent: candidate.intent || candidate.knowledge?.intent || "",
      rationale: candidate.rationale || candidate.knowledge?.rationale || "",
      outcomeType: candidate.outcomeType || candidate.knowledge?.outcomeType || ""
    }));
    let parsed = { estimates: [] };
    try {
      const json = await this.withAiActivity(`Estimating ${missing.length} triaged task duration${missing.length === 1 ? "" : "s"}`, () => this.openaiResponse({
        model: durationModel,
        jsonSchema: scheduleDurationSchema(),
        system: [
          "Estimate practical work durations for Todoist scheduling.",
          "Return only JSON matching the schema.",
          "Use current general knowledge, task title, task description, parent/subtask context, existing Todoist task context, and relevant vault snippets.",
          "The scheduler settings remain authoritative for candidate selection, due window, workday boundaries, lunch, block sizes, weights, excluded labels, and whether subtasks can be scheduled independently.",
          "Use the selected scheduler prompt only to coordinate duration-estimation assumptions, split-title style, subtask independence reasoning, and practical sequencing preferences that are compatible with those settings.",
          "Estimate the time required for focused work by the user, not elapsed waiting time.",
          `Use ${scheduleConfig.durationStepMinutes}-minute duration increments only, and never return less than the ${scheduleConfig.minBlockMinutes}-minute minimum duration.`,
          "Follow the scheduler memory duration policies exactly when estimating duration.",
          `Maximum same-day work block is ${scheduleConfig.maxBlockMinutes} minutes. If a task is larger, return the total estimate and a clear continuation title for the remaining work.`,
          "Set independent_subtask to true only for subtasks that should be scheduled separately, such as document review, follow-up, waiting-on-information check-ins, replies, approvals, or dependency work. Otherwise subtasks should stay with the parent task.",
          "For follow-up tasks, estimate the time to complete the follow-up action.",
          "For waiting-on tasks, estimate a short check-in or follow-up if action is still needed.",
          "Do not change due dates, deadlines, priorities, labels, or task titles."
        ].join(" "),
        user: [
          `Today: ${scheduleConfig.today}`,
          `Workday: ${minutesToClock(scheduleConfig.startMinutes)}-${minutesToClock(scheduleConfig.endMinutes)}. Timeline chunk size: ${scheduleConfig.chunkMinutes} minutes. Duration step: ${scheduleConfig.durationStepMinutes} minutes.`,
          `Scheduler prompt: ${schedulerPromptName}`,
          schedulerPrompt,
          "",
          "Scheduler memory duration policies:",
          durationPolicyText || "No scheduler memory duration policies found.",
          "",
          "Tasks needing duration estimates:",
          JSON.stringify(compactTasks),
          "",
          "Relevant vault context:",
          formatContext(context, Math.min(6000, this.settings.maxContextChars || 6000), this.settings, compactTasks.map((task) => task.title).join("\n")) || "No relevant vault context found.",
          "",
          "Adaptive task, meeting, project, and local reference context:",
          taskContext || "No matching local task context found."
        ].join("\n")
      }));
      parsed = JSON.parse(json);
    } catch (error) {
      this.logLocal("Schedule duration AI estimate failed; using local estimates", { tasks: missing.length, skipped, error: error.message || String(error) });
      for (const candidate of missing) {
        candidate.durationMinutes = scheduleDurationWithLocalPolicy(candidate, candidate.durationMinutes || fallbackScheduleDuration(candidate, scheduleConfig), scheduleConfig, durationPolicies);
        candidate.durationSource = candidate.durationSource || "local estimate";
        candidate.durationConfidence = candidate.durationConfidence || "low";
        candidate.splitTitle = scheduleContinuationTitle(candidate);
      }
      return;
    }
    const byId = new Map((parsed.estimates || []).map((item) => [String(item.id || ""), item]));
    for (const candidate of missing) {
      const estimate = byId.get(candidate.id);
      const minutes = roundToScheduleChunk(Number(estimate?.minutes || 0), scheduleConfig);
      const source = estimate ? "AI estimate" : candidate.durationSource || "local estimate";
      const rawMinutes = minutes || candidate.durationMinutes || fallbackScheduleDuration(candidate, scheduleConfig);
      const adjustedMinutes = scheduleDurationWithLocalPolicy(candidate, rawMinutes, scheduleConfig, durationPolicies);
      candidate.durationMinutes = adjustedMinutes;
      candidate.durationSource = adjustedMinutes < roundToScheduleChunk(rawMinutes, scheduleConfig) ? `${source}; capped for follow-up` : source;
      candidate.durationConfidence = estimate?.confidence || candidate.durationConfidence || "medium";
      candidate.independentSubtask = this.settings.scheduleTodayAllowIndependentSubtasks === false ? false : estimate?.independent_subtask != null ? Boolean(estimate.independent_subtask) : candidate.independentSubtask;
      candidate.splitTitle = singleLine(estimate?.split_title || "") || candidate.splitTitle || scheduleContinuationTitle(candidate);
    }
  }

  async applyScheduleToday(preview) {
    const scheduled = (preview?.scheduled || []).filter((item) => item.id && !item.fixed);
    const splitSubtasks = preview?.splitSubtasks || [];
    if (!scheduled.length && !splitSubtasks.length) {
      new Notice("No schedule changes to apply.");
      return { updated: 0, created: 0 };
    }
    this.schedulerInProgress = true;
    this.setSidebarStatus("Applying today's schedule...");
    try {
      this.requireTodoistAccess();
      const previousById = new Map();
      const commands = [];
      for (const item of scheduled) {
        const cached = this.settings.taskCache?.[item.id] || {};
        previousById.set(item.id, {
          id: item.id,
          dueDate: item.remoteDueDate || cached.scheduledDueDateTime || cached.due_date || "",
          duration: normalizeTodoistDuration(item.remoteDuration || cached.duration || null)
        });
        commands.push({
          type: "item_update",
          uuid: uuid(),
          args: {
            id: item.id,
            due: { date: item.scheduledDateTime },
            duration: { amount: item.durationMinutes, unit: "minute" }
          }
        });
      }
      const tempMap = new Map();
      for (const item of splitSubtasks) {
        const tempId = uuid();
        tempMap.set(tempId, item);
        commands.push({
          type: "item_add",
          temp_id: tempId,
          uuid: uuid(),
          args: {
            content: item.content,
            parent_id: item.parentId,
            priority: normalizePriority(item.priority),
            labels: (item.labels || []).map(cleanLabel).filter(Boolean),
            due: { date: item.scheduledDateTime },
            duration: { amount: item.durationMinutes, unit: "minute" }
          }
        });
      }
      const response = await this.todoistSync(commands);
      const created = [];
      for (const [tempId, item] of tempMap.entries()) {
        const id = response.temp_id_mapping?.[tempId] || "";
        if (!id) continue;
        item.id = id;
        item.oid = item.oid || generateUniqueOid(this.settings);
        created.push({ id, oid: item.oid, path: item.path || "", parentId: item.parentId || "" });
        this.cacheTask(id, Object.assign({}, item, {
          isSubtask: true,
          due_date: datePart(item.scheduledDateTime),
          scheduledDueDateTime: item.scheduledDateTime,
          duration: { amount: item.durationMinutes, unit: "minute" },
          parentOid: item.parentOid || "",
          parentContent: item.parentContent || "",
          parentLineNumber: item.parentLineNumber ?? null,
          description: ""
        }));
        await this.insertScheduledSubtaskIntoNote(item);
      }
      for (const item of scheduled) {
        const cached = this.settings.taskCache?.[item.id] || {};
        this.settings.taskCache[item.id] = Object.assign({}, cached, {
          due_date: datePart(item.scheduledDateTime),
          scheduledDueDateTime: item.scheduledDateTime,
          duration: { amount: item.durationMinutes, unit: "minute" },
          cachedAt: deviceTimestamp()
        });
        await this.updateScheduleMarkersInNote(item.id, item.scheduledDateTime, item.durationMinutes);
      }
      this.recordSchedulerApplyMemory(preview, scheduled, splitSubtasks);
      this.settings.scheduleTodayLastUndo = {
        at: deviceTimestamp(),
        previous: Array.from(previousById.values()),
        created
      };
      this.markTaskReferenceStateDirty();
      await this.saveSettings();
      this.logLocal("Schedule today applied", { updated: scheduled.length, created: created.length, date: preview?.config?.today || today() });
      new Notice(`Scheduled ${scheduled.length} task${scheduled.length === 1 ? "" : "s"}${created.length ? ` and created ${created.length} continuation subtask${created.length === 1 ? "" : "s"}` : ""}.`);
      return { updated: scheduled.length, created: created.length };
    } finally {
      this.schedulerInProgress = false;
      this.setSidebarStatus("Ready");
    }
  }

  async undoLastScheduleToday(showNotice = true) {
    const undo = this.settings.scheduleTodayLastUndo;
    if (!undo?.previous?.length && !undo?.created?.length) {
      if (showNotice) new Notice("No Schedule Today changes to undo.");
      return { restored: 0, removed: 0 };
    }
    this.schedulerInProgress = true;
    this.setSidebarStatus("Undoing schedule...");
    try {
      this.requireTodoistAccess();
      const commands = [];
      for (const item of undo.previous || []) {
        const args = { id: item.id };
        if (item.dueDate) args.due = { date: item.dueDate };
        else args.due = null;
        args.duration = item.duration?.amount ? item.duration : null;
        commands.push({ type: "item_update", uuid: uuid(), args });
      }
      if (commands.length) await this.todoistSync(commands);
      let removed = 0;
      for (const item of undo.created || []) {
        if (!item.id) continue;
        const ok = await this.deleteTodoistTask(item.id).catch((error) => {
          this.logLocal("Schedule undo delete failed", { id: item.id, error: error.message || String(error) });
          return false;
        });
        if (!ok) continue;
        await this.removeScheduledSubtaskFromNote(item);
        delete this.settings.taskCache[item.id];
        removed += 1;
      }
      for (const item of undo.previous || []) {
        const cached = this.settings.taskCache?.[item.id];
        if (!cached) continue;
        cached.scheduledDueDateTime = isDateTimeString(item.dueDate) ? item.dueDate : "";
        cached.due_date = item.dueDate ? datePart(item.dueDate) : null;
        cached.duration = normalizeTodoistDuration(item.duration);
        cached.cachedAt = deviceTimestamp();
        await this.updateScheduleMarkersInNote(item.id, cached.scheduledDueDateTime, durationMinutes(cached.duration), { removeIfEmpty: true });
      }
      this.settings.scheduleTodayLastUndo = null;
      this.markTaskReferenceStateDirty();
      await this.saveSettings();
      this.logLocal("Schedule today undone", { restored: undo.previous?.length || 0, removed });
      if (showNotice) new Notice(`Undid schedule changes for ${undo.previous?.length || 0} task${undo.previous?.length === 1 ? "" : "s"}.`);
      return { restored: undo.previous?.length || 0, removed };
    } finally {
      this.schedulerInProgress = false;
      this.setSidebarStatus("Ready");
    }
  }

  async updateScheduleMarkersInNote(taskId, scheduledDateTime, minutes, options = {}) {
    const cached = this.settings.taskCache?.[taskId];
    if (!cached?.path) return false;
    const file = this.app.vault.getAbstractFileByPath(cached.path);
    if (!(file instanceof TFile)) return false;
    const lines = (await this.app.vault.read(file)).split("\n");
    const idx = lines.findIndex((line) => getTodoistId(line, this.settings) === taskId || (cached.oid && getTaskOid(line) === cached.oid));
    if (idx === -1) return false;
    const next = setScheduleMarker(lines[idx], scheduledDateTime, minutes, options);
    if (next === lines[idx]) return false;
    lines[idx] = cached.isSubtask ? ensureSubtaskIndent(next, { isSubtask: true }, this.settings) : next;
    repairSyncedSubtaskIndentationLines(lines, this.settings);
    this.markInternalNoteWrite(cached.path);
    await this.app.vault.modify(file, lines.join("\n"));
    return true;
  }

  async insertScheduledSubtaskIntoNote(item) {
    if (!item?.path || !item?.parentOid) return false;
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) return false;
    const lines = (await this.app.vault.read(file)).split("\n");
    const parentIndex = lines.findIndex((line) => getTaskOid(line) === item.parentOid || getTodoistId(line, this.settings) === item.parentId);
    if (parentIndex < 0) return false;
    let insertAt = parentIndex + 1;
    const parentIndent = indentationLevel(lines[parentIndex]);
    while (insertAt < lines.length) {
      const line = lines[insertAt] || "";
      if (!line.trim()) {
        insertAt += 1;
        continue;
      }
      if (/^\s*[-*]\s+\[[ xX]\]/.test(line) && indentationLevel(line) > parentIndent) {
        insertAt += 1;
        continue;
      }
      break;
    }
    const taskLine = parsedTaskToLine(Object.assign({}, item, {
      isSubtask: true,
      due_date: datePart(item.scheduledDateTime),
      deadline_date: null,
      description: "",
      isCompleted: false
    }), this.settings, item.id);
    const line = setScheduleMarker(`${desiredSubtaskIndent(this.settings)}${taskLine.trimStart()}`, item.scheduledDateTime, item.durationMinutes);
    lines.splice(insertAt, 0, line);
    repairSyncedSubtaskIndentationLines(lines, this.settings);
    this.markInternalNoteWrite(item.path);
    await this.app.vault.modify(file, lines.join("\n"));
    return true;
  }

  async removeScheduledSubtaskFromNote(item) {
    if (!item?.path) return false;
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) return false;
    const lines = (await this.app.vault.read(file)).split("\n");
    const idx = lines.findIndex((line) => (item.oid && getTaskOid(line) === item.oid) || (item.id && getTodoistId(line, this.settings) === item.id));
    if (idx < 0) return false;
    lines.splice(idx, 1);
    this.markInternalNoteWrite(item.path);
    await this.app.vault.modify(file, lines.join("\n"));
    return true;
  }

  async processPendingEmails(showNotice = true, options = {}) {
    if (this.emailProcessingInProgress) return;
    this.emailProcessingInProgress = true;
    this.setSidebarStatus("Processing email tasks...");
    try {
      this.logLocal("Email processing started", { automatic: Boolean(options?.automatic) });
      await this.ensureCompatibleEmbeddingForChatModel();
      this.requireAiAccess();
      this.requireTodoistAccess();
      this.requireEmailWorkerAccess();
      if (options?.automatic) {
        this.settings.lastEmailPollAt = deviceTimestamp();
        this.queueSettingsSave();
      }
      const pending = await this.workerJson("/pending?limit=25", "GET");
      if (!options?.automatic) this.settings.lastEmailPollAt = deviceTimestamp();
      const emails = pending.emails || [];
      if (!emails.length) {
        if (options?.automatic) this.queueSettingsSave();
        else await this.saveSettings();
        this.logLocal("Email poll complete", { pending: 0 });
        if (showNotice) new Notice("No pending email tasks.");
        return;
      }
      let count = 0;
      for (const item of emails) {
        const email = await this.workerJson(`/email?id=${encodeURIComponent(item.id)}`, "GET");
        const parsed = parseRawEmail(email.raw || "");
        const subject = decodeHeader(email.subject || parsed.subject || "(no subject)");
        const cloudflareReceivedAt = email.receivedAt || "";
        const receivedAt = originalEmailReceivedAt(parsed, cloudflareReceivedAt);
        const fallbackSectionName = makeSectionName(receivedAt, subject);
        const emailSourceText = [
          `From: ${email.from || parsed.from || ""}`,
          `To: ${email.to || parsed.to || ""}`,
          `Original email received: ${receivedAt}`,
          cloudflareReceivedAt ? `Forward received by Cloudflare: ${cloudflareReceivedAt}` : "",
          `Subject: ${subject}`,
          "",
          parsed.text
        ].filter(Boolean).join("\n");
        const plan = await this.createTaskPlan({
          type: "email",
          title: subject,
          text: emailSourceText,
          sectionName: fallbackSectionName,
          maxChars: this.settings.maxEmailChars
        });
        const sectionName = plan.sectionName || fallbackSectionName;
        const tasks = plan.tasks || [];
        enforceGeneratedTaskLimits(tasks, this.settings);
        this.setSidebarStatus("Creating local email task OIDs...");
        ensureGeneratedTaskMetadata(tasks, sectionName, this.settings);
        assignGeneratedTaskOids(tasks, this.settings);
        this.setSidebarStatus("Preparing descriptions and Todoist section...");
        const sectionIdPromise = this.getTaskProjectId().then((projectId) => this.ensureTodoistSectionId(projectId, sectionName));
        const descriptionPromise = this.refineTaskDescriptions(tasks, plan.sourceSummary, plan.semanticContext || [], subject, plan.descriptionInstructions, {
          contextNotes: plan.contextNotes || [],
          basePath: vaultBasePath(this.app),
          citeContextNotes: this.settings.emailIncludeSourceListInDescriptions !== false
        })
          .then(() => {
            this.setSidebarStatus("Adding email source context...");
            addContextToTaskDescriptions(tasks, plan.contextNotes || [], { title: subject, path: "", text: emailSourceText }, this.settings, plan.semanticContext || [], vaultBasePath(this.app), this.settings.emailIncludeSourceListInDescriptions !== false);
          });
        const [sectionId] = await Promise.all([sectionIdPromise, descriptionPromise]);
        enforceGeneratedTaskLimits(tasks, this.settings);
        await this.applyTaskDeduplicationPlan(tasks, {
          source: "email",
          path: "",
          sectionName,
          contextNotes: plan.contextNotes || [],
          semanticContext: plan.semanticContext || []
        });
        this.setSidebarStatus("Syncing Todoist section...");
        const created = await this.createTodoistTaskBatch(sectionName, tasks, sectionId);
        await this.appendEmailLog({ subject, from: email.from || parsed.from, receivedAt, cloudflareReceivedAt, sectionName, tasks: created });
        await this.workerJson("/complete", "POST", { id: item.id });
        count += 1;
      }
      await this.saveSettings();
      this.logLocal("Email processing complete", { processed: count });
      if (showNotice) new Notice(`Processed ${count} email${count === 1 ? "" : "s"} into Todoist.`);
    } catch (error) {
      console.error(error);
      this.logLocal("Email task processing failed", { error: error.message || String(error) });
      if (showNotice) new Notice(`Email task processing failed: ${error.message || error}`);
    } finally {
      this.emailProcessingInProgress = false;
      this.setSidebarStatus("Ready");
    }
  }

  async workerJson(path, method, body) {
    if (!isHttpsUrl(this.settings.workerUrl)) {
      throw new Error("Cloudflare Worker URL must be a valid HTTPS URL.");
    }
    const response = await requestUrl({
      url: `${this.settings.workerUrl.replace(/\/+$/, "")}${path}`,
      method,
      headers: {
        authorization: `Bearer ${this.settings.workerToken}`,
        "content-type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Cloudflare returned ${response.status}: ${redactSecrets(response.text)}`);
    }
    return response.json;
  }

  async createCloudflareSetupNote(showNotice = true) {
    const folder = trimSlashes(this.settings.emailLogFolder || "Email-To-Todoist");
    await ensureVaultFolder(this.app, folder);
    const path = `${folder}/Cloudflare Email Setup.md`;
    const workerUrl = this.settings.workerUrl || "https://your-worker.your-subdomain.workers.dev";
    const lines = [
      "# Cloudflare Email-To-Todoist Setup",
      "",
      `Updated: ${deviceTimestamp()}`,
      "",
      "Use this checklist when setting up Email-To-Todoist for your own Cloudflare account, domain, Worker, and forwarding address.",
      "",
      "Important: the Worker token below is a local shared secret generated by this plugin. It is not your Cloudflare account API token. Copy the same value into your Worker as a secret, then paste the Worker URL into the plugin.",
      "",
      "1. In Cloudflare, add or select the domain that will receive forwarded task emails.",
      "2. Enable Email Routing for the domain.",
      "3. Create or confirm the destination address, such as emailtasks@your-domain.example.",
      "4. Deploy an email queue Worker compatible with Semantic Todoist Sync. The recommended Worker keeps a small KV queue state key at state/pending.json so empty pending checks use KV reads instead of KV list operations.",
      "5. Set the Worker URL in this plugin to the queue endpoint.",
      "6. Generate a Worker token in this plugin and set the same value as the shared secret expected by the Worker.",
      "7. Send a test forwarded email with one clear action item.",
      "8. In Obsidian, use Email-To-Todoist > Process pending email tasks to confirm the queue, AI extraction, Todoist section creation, task sync, and email log all work.",
      "",
      "Current Plugin Values",
      "",
      `- Worker URL: ${workerUrl}`,
      `- Email log folder: ${folder}`,
      `- Auto-process emails: ${this.settings.autoProcessEmails ? "on" : "off"}`,
      `- Email poll interval: ${emailAutoPollIntervalSeconds(this.settings)} seconds minimum for automatic polling`,
      `- Worker token set in plugin: ${this.settings.workerToken ? "yes" : "no"}`,
      "",
      "Notes",
      "",
      "- This note is only a setup checklist. It does not modify Cloudflare, Todoist, or the working email workflow.",
      "- Keep the Worker token private. It is not written into this note.",
      "- Automatic polling is clamped to at least 420 seconds to leave room under Cloudflare KV Free limits.",
      "- The current compatible Worker updates state/pending.json whenever email arrives or is completed. If that state is missing, the Worker lists pending email keys once to rebuild it, then returns to the low-list path.",
      "- If you need a Cloudflare account API token for manual Worker deployment tooling, create it from Cloudflare Profile > API Tokens. That token is separate from the plugin Worker token.",
      "- The plugin sends only email content selected for processing, retrieved vault context, and task fields needed to create Todoist tasks.",
      "- Do not reuse the Worker token anywhere else.",
      "- After changing domains or Worker URLs, send a test email before enabling automatic processing."
    ];
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      this.markInternalNoteWrite(path);
      await this.app.vault.modify(existing, lines.join("\n"));
    }
    else await this.app.vault.create(path, lines.join("\n"));
    if (showNotice) new Notice(`Cloudflare setup note updated: ${path}`);
    return path;
  }

  openSetupUrl(url) {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      new Notice(`Open this URL in your browser: ${url}`);
    }
  }

  async validateAiSetup(showNotice = true) {
    await this.ensureCompatibleEmbeddingForChatModel();
    this.requireAiAccess();
    await this.refreshOpenAIModels(false);
    if (showNotice) new Notice("AI provider connected and model list refreshed.");
  }

  async validateTodoistSetup(showNotice = true) {
    this.requireTodoistAccess();
    await this.refreshTodoistProjects(false);
    if (showNotice) new Notice("Todoist connected and projects refreshed.");
  }

  async validateEmailSetup(showNotice = true) {
    this.requireAiAccess();
    this.requireTodoistAccess();
    this.requireEmailWorkerAccess();
    const pending = await this.workerJson("/pending?limit=1", "GET");
    if (showNotice) new Notice(`Email Worker connected. Pending emails: ${(pending.emails || []).length}.`);
  }

  async validateNotesWorkflowSetup(showNotice = true) {
    await this.validateAiSetup(false);
    await this.validateTodoistSetup(false);
    if (showNotice) new Notice("Notes-To-Todoist is ready. AI and Todoist are connected.");
  }

  async validateConfiguredSetup(showNotice = true) {
    const results = [];
    try {
      await this.validateAiSetup(false);
      results.push("AI ready");
    } catch (error) {
      results.push(`AI needs setup: ${error.message || error}`);
    }
    try {
      await this.validateTodoistSetup(false);
      results.push("Todoist ready");
    } catch (error) {
      results.push(`Todoist needs setup: ${error.message || error}`);
    }
    if (this.settings.workerUrl || this.settings.workerToken) {
      try {
        await this.validateEmailSetup(false);
        results.push("Email Worker ready");
      } catch (error) {
        results.push(`Email Worker needs setup: ${error.message || error}`);
      }
    } else {
      results.push("Email Worker not configured");
    }
    this.logLocal("Setup validation complete", { results });
    if (showNotice) new Notice(results.join(" | "));
    return results;
  }

  async generateWorkerToken(showNotice = true) {
    this.settings.workerToken = randomSetupToken();
    await this.saveSettings();
    if (showNotice) new Notice("Generated a local Worker token. Use the same value in your Cloudflare Worker secret.");
    return this.settings.workerToken;
  }

  async createTasksFromActiveNote() {
    try {
      this.requireAiAccess();
      this.setSidebarStatus("Creating tasks...");
      const active = await this.getActiveMarkdownContext();
      if (!active.path) throw new Error("Open a markdown note first.");
      const template = await this.resolveTaskGenerationTemplate();
      const result = await this.generateTaskListFromTemplate(template, {
        active,
        showNotice: true
      });
      if (!result.tasks.length) new Notice("No actionable tasks found in the active note.");
    } catch (error) {
      console.error(error);
      new Notice(`Note task creation failed: ${error.message || error}`);
    } finally {
      this.setSidebarStatus("Ready");
    }
  }

  async generateTaskListFromTemplate(template, options = {}) {
    await this.ensureCompatibleEmbeddingForChatModel();
    this.requireAiAccess();
    this.setSidebarStatus("Creating tasks...");
    const active = options.active || await this.getActiveMarkdownContext();
    try {
      if (!active.path) throw new Error("Open a markdown note first.");
      const shouldInsert = options.insertIntoNote ?? template.insertResponse ?? true;
      const shouldSyncAfterInsert = options.syncAfterInsert ?? template.syncAfterInsert ?? false;
      if (shouldInsert && shouldSyncAfterInsert) this.requireTodoistAccess();
      const fallbackSectionName = makeNoteSectionName(active.title, active.text, active.path);
      const plan = await this.createTaskPlan({
        type: "note",
        title: active.title,
        path: active.path,
        text: active.selection || active.text,
        sectionName: fallbackSectionName,
        maxChars: this.settings.maxNoteChars,
        templateInstructions: template.prompt
      });
      const sectionName = plan.sectionName || fallbackSectionName;
      const tasks = plan.tasks || [];
      if (!tasks.length) return { tasks: [], markdown: "" };
      this.setSidebarStatus("Creating local task OIDs...");
      enforceGeneratedTaskLimits(tasks, this.settings);
      ensureGeneratedTaskMetadata(tasks, sectionName, this.settings);
      assignGeneratedTaskOids(tasks, this.settings);
      let preparedSectionId = "";
      this.setSidebarStatus(shouldInsert && shouldSyncAfterInsert ? "Preparing descriptions and Todoist section..." : "Writing task descriptions...");
      const sectionIdPromise = shouldInsert && shouldSyncAfterInsert
        ? this.getTaskProjectId().then((projectId) => this.ensureTodoistSectionId(projectId, sectionName))
        : Promise.resolve("");
      const descriptionPromise = this.refineTaskDescriptions(tasks, plan.sourceSummary, plan.semanticContext || [], active.title, plan.descriptionInstructions, {
        contextNotes: plan.contextNotes || [],
        basePath: vaultBasePath(this.app),
        citeContextNotes: this.settings.noteIncludeSourceListInDescriptions !== false
      })
        .then(() => {
          this.setSidebarStatus("Adding source context to descriptions...");
          addContextToTaskDescriptions(tasks, plan.contextNotes || [], active, this.settings, plan.semanticContext || [], vaultBasePath(this.app), this.settings.noteIncludeSourceListInDescriptions !== false);
        });
      [preparedSectionId] = await Promise.all([sectionIdPromise, descriptionPromise]);
      enforceGeneratedTaskLimits(tasks, this.settings);
      await this.applyTaskDeduplicationPlan(tasks, {
        source: "note",
        path: active.path,
        sectionName,
        contextNotes: plan.contextNotes || [],
        semanticContext: plan.semanticContext || []
      });
      this.savePendingTaskDescriptions(active.path, tasks);
      this.savePendingTaskReferences(active.path, tasks);
      await this.saveSettings();
      const noteLines = taskPlanToMarkdown(tasks, this.settings);
      const contextSummary = renderContextSummary(plan.contextNotes || []);
      const markdown = `${renderTaskHeading(this.settings, template)}\n\n${noteLines.join("\n")}${contextSummary ? `\n\n${contextSummary}` : ""}`;
      if (shouldInsert) {
        const file = this.app.vault.getAbstractFileByPath(active.path);
        this.cancelQueuedNoteSync(active.path);
        this.markInternalNoteWrite(active.path);
        await appendMarkdownBlock(this.app, file, markdown);
        if (shouldSyncAfterInsert) {
          this.cancelQueuedNoteSync(active.path);
          this.setSidebarStatus("Syncing Todoist tasks...");
          const sectionId = preparedSectionId || await this.ensureTodoistSectionId(await this.getTaskProjectId(), sectionName);
          assignGeneratedTaskSectionId(tasks, sectionId);
          this.savePendingTaskReferences(active.path, tasks);
          await this.saveSettings();
          this.setSidebarStatus("Syncing Todoist tasks...");
          await delay(1000);
          await this.syncFileNotes(active.path, false);
        }
      }
      if (options.showNotice) {
        const action = shouldInsert ? (shouldSyncAfterInsert ? "inserted and synced" : "inserted") : "shown in chat only";
        new Notice(`Generated ${tasks.length} main task${tasks.length === 1 ? "" : "s"} from "${template.name}" and ${action}.`);
      }
      return { tasks, markdown, contextNotes: plan.contextNotes || [], semanticContext: plan.semanticContext || [] };
    } finally {
      this.setSidebarStatus("Ready");
    }
  }

  async runPromptTemplate(template, options = {}) {
    if (isScheduleTodayTemplate(template)) {
      await this.openScheduleTodayPreview(template);
      return { action: "schedule-today", tasks: [], markdown: "", contextNotes: [], semanticContext: [] };
    }
    if (template?.createTasks !== false) {
      return this.generateTaskListFromTemplate(template, options);
    }
    return this.runPromptResponseTemplate(template, options);
  }

  async runPromptTemplateWithTaskGeneration(template, options = {}) {
    return this.generateTaskListFromTemplate(template, options);
  }

  async runPromptResponseTemplate(template, options = {}) {
    await this.ensureCompatibleEmbeddingForChatModel();
    this.requireAiAccess();
    const active = options.active || await this.getActiveMarkdownContext();
    if (!active.path) throw new Error("Open a markdown note first.");
    const shouldInsert = options.insertIntoNote ?? template.insertResponse ?? true;
    this.setSidebarStatus("Running prompt...");
    try {
      const prompt = [
        template.prompt || "",
        "",
        "Use the active note and relevant vault context. Follow the prompt instructions exactly. Do not create Todoist task syntax unless the prompt explicitly asks for it."
      ].join("\n").trim();
      const result = await this.chat(prompt, active, []);
      const heading = renderPromptResponseHeading(template);
      const markdown = `${heading}\n\n${result.answer || ""}`;
      if (shouldInsert) {
        const file = this.app.vault.getAbstractFileByPath(active.path);
        if (!(file instanceof TFile)) throw new Error("Active note was not found.");
        this.cancelQueuedNoteSync(active.path);
        this.markInternalNoteWrite(active.path);
        await appendMarkdownBlock(this.app, file, markdown);
      }
      if (options.showNotice) new Notice(`Ran prompt "${template.name || "Prompt"}"${shouldInsert ? " and inserted the response" : ""}.`);
      return { answer: result.answer, markdown, contextNotes: contextNotesForTaskPlan(result.context || [], active.path, this.settings.taskContextSummaryMaxNotes), semanticContext: result.context || [], tasks: [] };
    } finally {
      this.setSidebarStatus("Ready");
    }
  }

  async resolveTaskGenerationTemplate(selectedTemplate = null) {
    const templates = await this.getPromptTemplates();
    const candidates = templates.filter((template) => isTaskGenerationTemplate(template));
    const configured = singleLine(this.settings.taskGenerationPromptTemplate || DEFAULT_SETTINGS.taskGenerationPromptTemplate);
    const byConfigured = candidates.find((template) => template.source === configured || template.name === configured);
    if (byConfigured) return byConfigured;
    const defaultTemplate = candidates.find((template) => template.name === DEFAULT_SETTINGS.taskGenerationPromptTemplate);
    if (defaultTemplate) return defaultTemplate;
    if (candidates.length) return candidates[0];
    return {
      name: DEFAULT_SETTINGS.taskGenerationPromptTemplate,
      prompt: "Scan the active note or selected text and generate a Todoist-ready task list. Use the shared task instructions. Include clear main tasks and subtasks only when they are actionable.",
      createTasks: true,
      insertResponse: true,
      syncAfterInsert: true,
      taskGenerationTemplate: true,
      taskHeading: DEFAULT_TASK_HEADING
    };
  }

  async getPromptTemplates() {
    await this.ensurePromptTemplateFolder(false);
    const templates = [];
    const folder = trimSlashes(this.settings.promptTemplatesFolder || "");
    if (!folder) return [...(this.settings.builtInPromptTemplates || [])].map((template) => Object.assign({ source: "Built in", createTasks: true }, template));
    const files = this.app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${folder}/`));
    for (const file of files) {
      const text = await this.app.vault.cachedRead(file);
      templates.push(parsePromptTemplateFile(file, text));
    }
    if (templates.length) return templates;
    return [...(this.settings.builtInPromptTemplates || [])].map((template) => Object.assign({ source: "Built in", createTasks: true }, template));
  }

  async ensurePromptTemplateFolder(showNotice = false) {
    const folder = trimSlashes(this.settings.promptTemplatesFolder || "");
    if (!folder) return;
    try {
      await ensureVaultFolder(this.app, folder);
      let created = 0;
      for (const template of DEFAULT_PROMPT_TEMPLATE_FILES) {
        const path = `${folder}/${template.filename}`;
        const existingTemplate = this.app.vault.getAbstractFileByPath(path);
        if (existingTemplate instanceof TFile) continue;
        await this.app.vault.create(path, promptTemplateFileText(template));
        created += 1;
      }
      if (showNotice && created) new Notice(`Prompt template folder updated: ${folder}`);
    } catch (error) {
      this.logLocal("Prompt template folder setup failed", { error: error.message || String(error) });
      if (showNotice) new Notice(`Prompt template folder setup failed: ${error.message || error}`);
    }
  }

  async syncNoteTasks(showNotice = true, fullScan = true) {
    if (this.syncInProgress) return;
    this.syncInProgress = true;
    this.setSidebarStatus("Syncing note tasks...");
    try {
      this.logLocal("Note sync started", { fullScan });
      this.settings.lastNoteAutoSyncAt = deviceTimestamp();
      this.requireTodoistAccess();
      this.setSidebarStatus("Syncing Todoist changes...");
      await this.pullTodoistUpdates();
      this.setSidebarStatus("Reconciling Todoist references...");
      const reconciled = await this.reconcileTodoistTaskCache();
      const files = fullScan ? this.getSyncableTaskFiles() : [];
      const totals = { files: files.length, created: 0, updated: 0, relinked: 0, deleted: 0, completedForgotten: 0, normalized: 0, conflicts: 0, staleReferences: reconciled.removed, preservedCompleted: reconciled.preservedCompleted || 0 };
      const workerCount = syncWorkerCount(this.settings);
      await asyncPool(files, workerCount, async (file) => {
        this.setSidebarStatus(`Syncing notes: ${file.basename}`);
        const stats = await this.syncFileNotes(file.path, false);
        mergeSyncStats(totals, stats);
      });
      totals.workers = workerCount;
      this.setSidebarStatus("Confirming Todoist sync...");
      this.logLocal("Note sync complete", totals);
      if (showNotice) new Notice("Semantic Todoist note sync complete.");
      return totals;
    } catch (error) {
      console.error(error);
      this.logLocal("Note sync failed", { error: error.message || String(error) });
      if (showNotice) new Notice(`Note sync failed: ${error.message || error}`);
    } finally {
      this.syncInProgress = false;
      this.setSidebarStatus("Ready");
    }
  }

  async repairCachedSubtaskIndentation(showNotice = true, options = {}) {
    if (this.subtaskIndentRepairInProgress) return { scanned: 0, files: 0, repaired: 0 };
    const fingerprint = subtaskIndentRepairFingerprint(this.settings);
    if (!options.force && this.settings.lastSubtaskIndentRepairFingerprint === fingerprint) {
      return { scanned: 0, files: 0, repaired: 0 };
    }
    this.subtaskIndentRepairInProgress = true;
    this.setSidebarStatus("Repairing subtask indentation...");
    const referenceIndex = this.getTaskReferenceIndex();
    const paths = options.scanAll ? this.app.vault.getMarkdownFiles().map((file) => file.path) : Array.from(referenceIndex.pathsForIndentRepair);
    const stats = { scanned: paths.length, files: 0, repaired: 0 };
    const byOid = referenceIndex.byOid;
    try {
      await asyncPool(paths, Math.min(2, syncWorkerCount(this.settings)), async (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        const lines = (await this.app.vault.read(file)).split("\n");
        const repaired = repairSyncedSubtaskIndentationLines(lines, this.settings, byOid);
        if (!repaired) return;
        this.markInternalNoteWrite(path);
        await this.app.vault.modify(file, lines.join("\n"));
        stats.files += 1;
        stats.repaired += repaired;
      });
      this.settings.lastSubtaskIndentRepairAt = deviceTimestamp();
      this.settings.lastSubtaskIndentRepairFingerprint = fingerprint;
      await this.saveSettings();
      this.logLocal("Subtask indentation repair complete", stats);
      if (showNotice) new Notice(`Repaired ${stats.repaired} synced subtask indentation${stats.repaired === 1 ? "" : "s"} in ${stats.files} note${stats.files === 1 ? "" : "s"}.`);
      return stats;
    } catch (error) {
      this.logLocal("Subtask indentation repair failed", { error: error.message || String(error) });
      if (showNotice) new Notice(`Subtask indentation repair failed: ${error.message || error}`);
      return stats;
    } finally {
      this.subtaskIndentRepairInProgress = false;
      this.setSidebarStatus("Ready");
    }
  }

  async rebuildTodoistReferenceTable(showNotice = true) {
    return this.rebuildTodoistReferenceTableInternal({ showNotice, force: true });
  }

  async recoverTodoistIdsFromTaskNames(showNotice = true) {
    const stats = await this.rebuildTodoistReferenceTableInternal({ showNotice: false, force: true });
    if (showNotice && stats) {
      new Notice(`Recovered ${stats.recoveredMissingTodoistIds || 0} missing Todoist ID reference${stats.recoveredMissingTodoistIds === 1 ? "" : "s"} by matching note task names. Matched ${stats.matched || 0} total reference${stats.matched === 1 ? "" : "s"}.`);
    }
    return stats;
  }

  async maybeRebuildTodoistReferences(showNotice = false) {
    if (this.syncInProgress || this.emailProcessingInProgress || this.referenceRebuildInProgress) return null;
    return this.rebuildTodoistReferenceTableInternal({ showNotice, force: false });
  }

  async rebuildTodoistReferenceTableInternal({ showNotice = true, force = true } = {}) {
    if (this.referenceRebuildInProgress) return;
    this.referenceRebuildInProgress = true;
    const stats = {
      files: 0,
      scannedTasks: 0,
      matched: 0,
      directIdMatches: 0,
      oidMatches: 0,
      contentMatches: 0,
      unmatched: 0,
      noteReferenceUpdates: 0,
      conflicts: 0,
      todoistTasksRead: 0,
      recoveredMissingTodoistIds: 0,
      skipped: false,
      reason: ""
    };
    this.setSidebarStatus("Rebuilding Todoist references...");
    try {
      this.logLocal("Todoist reference rebuild started", { force });
      if (!this.settings.todoistToken) throw new Error("Add a Todoist API token first.");
      const files = this.getSyncableTaskFiles();
      const localState = await this.referenceRebuildLocalState(files);
      stats.files = files.length;
      stats.scannedTasks = localState.candidateCount;
      if (!localState.candidateCount) {
        this.settings.taskCache = {};
        this.settings.pendingTaskReferences = {};
        this.markTaskReferenceStateDirty();
        this.settings.lastReferenceRebuildAt = deviceTimestamp();
        this.settings.lastReferenceRebuildFingerprint = localState.fingerprint;
        this.settings.lastReferenceRebuildCandidateCount = 0;
        await this.saveSettings();
        this.logLocal("Todoist reference rebuild skipped", Object.assign(stats, {
          skipped: true,
          reason: "No syncable note task references were found."
        }));
        if (showNotice) new Notice("No syncable note task references were found.");
        return stats;
      }
      const cacheCount = Object.keys(this.settings.taskCache || {}).length;
      const unchanged = localState.fingerprint && localState.fingerprint === this.settings.lastReferenceRebuildFingerprint;
      const hasFreshRemoteSnapshot = this.hasFreshTodoistSnapshot(["items", "projects", "sections"]);
      if (!force && unchanged && cacheCount >= localState.candidateCount && hasFreshRemoteSnapshot) {
        stats.skipped = true;
        stats.reason = "Local references unchanged and a fresh Todoist snapshot is already available.";
        this.settings.lastReferenceRebuildAt = deviceTimestamp();
        this.settings.lastReferenceRebuildCandidateCount = localState.candidateCount;
        await this.saveSettings();
        this.logLocal("Todoist reference rebuild skipped", stats);
        return stats;
      }
      const remote = await this.getAllTodoistReferenceTasks({ force });
      stats.todoistTasksRead = remote.tasks.length;
      const remoteById = new Map(remote.tasks.map((task) => [task.id, task]));
      const oldCache = Object.assign({}, this.settings.taskCache || {});
      const oldSettings = Object.assign({}, this.settings, { taskCache: oldCache });
      const nextCache = {};
      const nextSettings = Object.assign({}, this.settings, { taskCache: nextCache });
      const workerCount = referenceRebuildWorkerCount(this.settings);
      await asyncPool(files, workerCount, async (file) => {
        this.setSidebarStatus(`Rebuilding references: ${file.basename}`);
        const state = localState.files.get(file.path);
        if (!state?.candidateCount) return;
        const lines = state.lines.slice();
        const matchedByLine = new Map();
        let changed = false;
        for (let i = 0; i < lines.length; i += 1) {
          if (!isReferenceRebuildCandidate(lines[i], this.settings)) continue;
          const preflightLine = preflightTaskLine(lines[i], this.settings);
          if (preflightLine !== lines[i]) {
            lines[i] = preflightLine;
            changed = true;
            stats.noteReferenceUpdates += 1;
          }
          const parsed = parseTaskLine(lines[i], i, file.path, lines, oldSettings) || parseTaskReferenceLine(lines[i], i, file.path, oldSettings);
          if (!parsed?.content) continue;
          const parentId = findMatchedParentId(parsed, lines, matchedByLine);
          const legacyId = (shouldConvertLegacyTodoistIds(this.settings) || hasSemanticSyncMarker(lines[i], this.settings)) ? getLegacyTodoistId(lines[i]) : "";
          const oidId = parsed.oid ? todoistIdForOid(oldSettings, parsed.oid) : "";
          let match = legacyId ? remoteById.get(legacyId) : null;
          if (match) stats.directIdMatches += 1;
          if (!match && oidId) {
            match = remoteById.get(oidId);
            if (match) stats.oidMatches += 1;
          }
          if (!match && parsed.id) {
            match = remoteById.get(parsed.id);
            if (match) stats.directIdMatches += 1;
          }
          if (!match) {
            const matchCandidates = parsed.isCompleted ? remote.tasks : remote.tasks.filter((task) => !task.isCompleted);
            match = findExistingTodoistTaskMatch(parsed, matchCandidates, parentId);
            if (match) {
              stats.contentMatches += 1;
              if (parsed.oid && !oidId && !legacyId && !parsed.id) stats.recoveredMissingTodoistIds += 1;
            }
          }
          if (!match) {
            stats.unmatched += 1;
            continue;
          }
          stats.matched += 1;
          const existingOid = parsed.oid || oldCache[match.id]?.oid || "";
          const oid = uniqueOidForRebuiltReference(existingOid, match.id, nextSettings);
          const parentMatch = parentId ? matchedByLine.get(parentLineIndex(parsed, lines)) : null;
          const remoteParsed = parsedTaskFromTodoistReference(match, parsed, oid, file.path, i, parentMatch);
          const entry = referenceCacheEntry(match.id, remoteParsed, this.settings, oldCache[match.id]);
          nextCache[match.id] = nextCache[match.id] ? mergeReferenceCacheEntry(nextCache[match.id], entry) : entry;
          matchedByLine.set(i, { id: match.id, oid });
          if (singleLine(parsed.content || "") !== singleLine(match.content || "")) stats.conflicts += 1;
          const normalized = normalizeTaskOidLine(lines[i], oid, this.settings, match.id);
          if (normalized !== lines[i]) {
            lines[i] = normalized;
            changed = true;
            stats.noteReferenceUpdates += 1;
          }
        }
        if (changed) {
          this.markInternalNoteWrite(file.path);
          await this.app.vault.modify(file, lines.join("\n"));
        }
      });
      this.settings.taskCache = nextCache;
      this.settings.pendingTaskReferences = {};
      this.markTaskReferenceStateDirty();
      this.settings.lastReferenceRebuildAt = deviceTimestamp();
      this.settings.lastReferenceRebuildFingerprint = localState.fingerprint;
      this.settings.lastReferenceRebuildCandidateCount = localState.candidateCount;
      await this.saveSettings();
      await this.repairCachedSubtaskIndentation(false, { force: true });
      this.logLocal("Todoist reference table rebuilt", Object.assign({}, stats, { workers: workerCount }));
      if (showNotice) new Notice(`Rebuilt ${stats.matched} Todoist reference${stats.matched === 1 ? "" : "s"}. ${stats.unmatched} note task${stats.unmatched === 1 ? "" : "s"} not matched.`);
      return stats;
    } catch (error) {
      console.error(error);
      this.logLocal("Todoist reference rebuild failed", { error: error.message || String(error) });
      if (showNotice) new Notice(`Reference rebuild failed: ${error.message || error}`);
      throw error;
    } finally {
      this.referenceRebuildInProgress = false;
      this.setSidebarStatus("Ready");
    }
  }

  async referenceRebuildLocalState(files = this.getSyncableTaskFiles()) {
    const state = { files: new Map(), candidateCount: 0, fingerprint: "" };
    const partsByFile = new Map();
    const workerCount = referenceRebuildWorkerCount(this.settings);
    await asyncPool(files, workerCount, async (file) => {
      const original = await this.app.vault.cachedRead(file);
      const lines = original.split("\n");
      const candidateLines = [];
      for (let i = 0; i < lines.length; i += 1) {
        if (!isReferenceRebuildCandidate(lines[i], this.settings)) continue;
        state.candidateCount += 1;
        candidateLines.push(`${i}:${singleLine(lines[i])}`);
      }
      if (candidateLines.length) {
        state.files.set(file.path, { lines, candidateCount: candidateLines.length });
        partsByFile.set(file.path, `${file.path}::${candidateLines.join("|")}`);
      }
    });
    const parts = files.map((file) => partsByFile.get(file.path)).filter(Boolean);
    state.fingerprint = shortHash(parts.join("\n"));
    return state;
  }

  async getAllTodoistReferenceTasks({ force = false } = {}) {
    const snapshot = await this.getTodoistSnapshot(["items", "projects", "sections"], force);
    const projects = snapshot.projects;
    const sectionsById = new Map(snapshot.sections.map((section) => [section.id, section]));
    const tasks = enrichTodoistTasksWithSnapshot(snapshot);
    return { tasks, projects, sectionsById };
  }

  async getTodoistSnapshot(resourceTypes = ["items", "projects", "sections"], force = false) {
    const requested = Array.from(new Set(resourceTypes)).sort();
    const key = requested.join(",");
    const cached = this.todoistSnapshotCache;
    const ttlMs = Math.max(1, Number(this.settings.todoistSnapshotCacheMinutes || 5)) * 60 * 1000;
    if (!force && cached?.key === key && elapsedMs(cached.fetchedAt) < ttlMs) return cached.snapshot;
    const body = new URLSearchParams();
    body.set("sync_token", "*");
    body.set("resource_types", JSON.stringify(requested));
    const response = await requestUrl({
      url: `${TODOIST_API}/sync`,
      method: "POST",
      headers: { authorization: `Bearer ${this.settings.todoistToken}`, "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`Todoist snapshot returned ${response.status}: ${redactSecrets(response.text)}`);
    const json = response.json || {};
    const projects = normalizeTodoistProjects(json.projects || []);
    const sections = normalizeTodoistSections(json.sections || [], "");
    const tasks = (json.items || [])
      .filter((task) => !task.is_deleted)
      .map(normalizeTodoistTask)
      .filter((task) => task.id && task.content);
    const snapshot = { tasks, projects, sections, fetchedAt: deviceTimestamp() };
    this.todoistSnapshotCache = { key, fetchedAt: deviceTimestamp(), snapshot };
    if (projects.length) {
      this.settings.availableTodoistProjects = projects;
      this.settings.todoistProjectsFetchedAt = deviceTimestamp();
    }
    if (sections.length) {
      this.settings.todoistSectionCache = this.settings.todoistSectionCache || {};
      const sectionsByProject = new Map();
      for (const section of sections) {
        const list = sectionsByProject.get(section.projectId) || [];
        list.push(section);
        sectionsByProject.set(section.projectId, list);
      }
      for (const [projectId, list] of sectionsByProject.entries()) {
        this.settings.todoistSectionCache[projectId] = { fetchedAt: deviceTimestamp(), sections: list };
      }
    }
    await this.saveSettings();
    return snapshot;
  }

  hasFreshTodoistSnapshot(resourceTypes = ["items", "projects", "sections"]) {
    const requested = Array.from(new Set(resourceTypes)).sort();
    const key = requested.join(",");
    const ttlMs = Math.max(1, Number(this.settings.todoistSnapshotCacheMinutes || 5)) * 60 * 1000;
    return Boolean(this.todoistSnapshotCache?.key === key && elapsedMs(this.todoistSnapshotCache.fetchedAt) < ttlMs);
  }

  async syncFileNotes(path, showNotice = true) {
    this.fileSyncInProgress = this.fileSyncInProgress || new Set();
    if (this.fileSyncInProgress.has(path)) return emptySyncStats();
    this.fileSyncInProgress.add(path);
    const stats = emptySyncStats();
    try {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return stats;
    const original = await this.app.vault.read(file);
    const lines = original.split("\n");
    const creations = [];
    const existingUpdates = [];
    const lineToTemp = new Map();
    const presentIds = new Set();
    const relinked = [];
    let changed = false;
    let remoteTasksById = new Map();
    try {
      const snapshot = await this.getTodoistSnapshot(["items", "projects", "sections"], false);
      remoteTasksById = new Map(enrichTodoistTasksWithSnapshot(snapshot).map((task) => [task.id, task]));
    } catch (error) {
      this.logLocal("Todoist snapshot unavailable for file sync compare", { path, error: error.message || String(error) });
    }

    for (let i = 0; i < lines.length; i += 1) {
      const preflightLine = preflightTaskLine(lines[i], this.settings);
      if (preflightLine !== lines[i]) {
        lines[i] = preflightLine;
        changed = true;
        stats.normalized += 1;
      }
      const parsed = parseTaskLine(lines[i], i, path, lines, this.settings);
      if (!parsed || !parsed.isSyncTask) continue;
      if (!parsed.isSubtask && !parsed.section) {
        parsed.section = makeNoteSectionName(file.basename, original, path);
        lines[i] = addSectionToTaskLine(lines[i], parsed.section, this.settings);
        changed = true;
        stats.normalized += 1;
      }
      if (parsed.id) {
        parsed.oid = parsed.oid || oidForTodoistId(this.settings, parsed.id) || generateUniqueOid(this.settings);
        const normalizedLine = normalizeTaskOidLine(lines[i], parsed.oid, this.settings);
        if (normalizedLine !== lines[i]) {
          lines[i] = normalizedLine;
          changed = true;
          stats.normalized += 1;
        }
        presentIds.add(parsed.id);
        Object.assign(parsed, this.descriptionStateForParsedTask(parsed));
        existingUpdates.push(parsed);
      } else {
        const cachedId = this.findCachedTaskIdForParsedTask(parsed);
        if (cachedId) {
          const cached = this.settings.taskCache?.[cachedId] || {};
          parsed.id = cachedId;
          parsed.oid = parsed.oid || oidForTodoistId(this.settings, cachedId) || generateUniqueOid(this.settings);
          parsed.projectId = cached.projectId || parsed.projectId || "";
          parsed.projectName = cached.projectName || parsed.projectName || "";
          parsed.sectionId = cached.sectionId || parsed.sectionId || "";
          parsed.section = cached.section || parsed.section || "";
          Object.assign(parsed, this.descriptionStateForParsedTask(parsed));
          presentIds.add(cachedId);
          existingUpdates.push(parsed);
          relinked.push(parsed);
          continue;
        }
        const tempId = uuid();
        parsed.tempId = tempId;
        parsed.oid = parsed.oid || generateUniqueOid(this.settings);
        parsed.sectionId = this.pendingSectionIdForParsedTask(parsed);
        if (!parsed.isSubtask && parsed.section && !parsed.sectionId) {
          parsed.sectionId = await this.ensureTodoistSectionId(await this.getTaskProjectId(), parsed.section);
        }
        Object.assign(parsed, this.descriptionStateForParsedTask(parsed));
        creations.push(parsed);
        lineToTemp.set(i, tempId);
      }
    }

    const remoteRelinked = await this.relinkCreationsToExistingTodoistTasks(creations, lineToTemp);
    for (const parsed of remoteRelinked) {
      presentIds.add(parsed.id);
      existingUpdates.push(parsed);
      relinked.push(parsed);
    }

    if (creations.length) this.setSidebarStatus(`Creating ${creations.length} Todoist task${creations.length === 1 ? "" : "s"}...`);
    const tempToReal = await this.createTodoistTasksFromNote(creations, lineToTemp);
    for (const parsed of relinked) {
      lines[parsed.lineNumber] = syncLocationMarkersOnTaskLine(addTodoistLink(lines[parsed.lineNumber], parsed.id, this.settings, parsed.oid), parsed, this.settings);
      changed = true;
      stats.relinked += 1;
    }
    for (const parsed of creations) {
      const id = tempToReal[parsed.tempId];
      if (!id) continue;
      parsed.id = id;
      parsed.oid = parsed.oid || generateUniqueOid(this.settings);
      presentIds.add(id);
      lines[parsed.lineNumber] = ensureSubtaskIndent(addTodoistLink(lines[parsed.lineNumber], id, this.settings, parsed.oid), parsed, this.settings);
      this.cacheTask(id, parsed);
      changed = true;
      stats.created += 1;
    }

    if (existingUpdates.length) this.setSidebarStatus(`Confirming ${existingUpdates.length} existing task${existingUpdates.length === 1 ? "" : "s"}...`);
    for (const parsed of existingUpdates) {
      const cached = this.settings.taskCache[parsed.id];
      const remote = remoteTasksById.get(parsed.id) || null;
      if (remote) {
        applyRemoteTodoistLocation(parsed, remote);
        const syncedLine = syncLocationMarkersOnTaskLine(lines[parsed.lineNumber], parsed, this.settings);
        if (syncedLine !== lines[parsed.lineNumber]) {
          lines[parsed.lineNumber] = syncedLine;
          changed = true;
          stats.normalized += 1;
        }
      }
      const signature = parsedTaskSignature(parsed);
      if (cached?.signature === signature && !remote) continue;
      const remoteParsed = remote ? todoistTaskToParsedTask(remote, parsed, this.settings) : null;
      const remoteSignature = remoteParsed ? parsedTaskSignature(remoteParsed) : "";
      const cachedSignature = cached?.signature || (cached ? parsedTaskSignature(cached) : "");
      const remoteChangedSinceCache = remoteParsed && (!cachedSignature || remoteSignature !== cachedSignature);
      if (remoteChangedSinceCache) {
        Object.assign(parsed, remoteParsed);
        const remoteLine = taskLineWithStableIndent(lines[parsed.lineNumber], parsed, this.settings, parsed.id);
        if (remoteLine !== lines[parsed.lineNumber]) {
          lines[parsed.lineNumber] = remoteLine;
          changed = true;
          stats.normalized += 1;
        }
        this.cacheTask(parsed.id, parsed);
        continue;
      }
      if (remoteSignature && remoteSignature === signature) {
        this.cacheTask(parsed.id, remoteParsed || parsed);
        continue;
      }
      const conflict = await this.todoistConflictForLocalUpdate(parsed, cached, remote);
      if (conflict) {
        const todoistContent = conflict.content || parsed.content;
        lines[parsed.lineNumber] = ensureSubtaskIndent(
          preserveTaskIndent(lines[parsed.lineNumber], replaceTaskLineContent(lines[parsed.lineNumber], todoistContent, this.settings)),
          parsed,
          this.settings
        );
        parsed.content = todoistContent;
        parsed.description = conflict.description || parsed.description;
        changed = true;
        stats.conflicts += 1;
        this.cacheTask(parsed.id, parsed);
        continue;
      }
      const todoistUpdated = await this.updateTodoistFromParsedTask(parsed, remote);
      if (todoistUpdated === false) continue;
      this.cacheTask(parsed.id, parsed);
      stats.updated += 1;
    }

    this.setSidebarStatus("Checking removed note tasks...");
    const removalStats = await this.deleteTodoistTasksMissingFromFile(path, presentIds);
    stats.deleted = removalStats.deleted;
    stats.completedForgotten = removalStats.completedForgotten;
    const repairedSubtaskIndentation = repairSyncedSubtaskIndentationLines(lines, this.settings);
    if (repairedSubtaskIndentation) {
      changed = true;
      stats.normalized += repairedSubtaskIndentation;
    }
    if (changed) {
      this.markInternalNoteWrite(path);
      await this.app.vault.modify(file, lines.join("\n"));
    }
    await this.saveSettings();
    if (showNotice) new Notice(`Synced ${creations.length + existingUpdates.length} task line${creations.length + existingUpdates.length === 1 ? "" : "s"}${stats.deleted ? ` and deleted ${stats.deleted} removed Todoist task${stats.deleted === 1 ? "" : "s"}` : ""}.`);
    return stats;
    } finally {
      this.fileSyncInProgress.delete(path);
    }
  }

  async createTodoistTasksFromNote(tasks, lineToTemp) {
    if (!tasks.length) return {};
    const projectId = await this.getTaskProjectId();
    const projectName = await this.todoistProjectNameForId(projectId);
    const commands = [];
    const sectionRefs = new Map();
    for (const task of tasks) {
      task.projectId = task.projectId || projectId;
      task.projectName = task.projectName || projectName;
      if (task.isSubtask || !task.section) continue;
      if (sectionRefs.has(task.section)) continue;
      sectionRefs.set(task.section, task.sectionId || this.pendingSectionIdForParsedTask(task) || await this.ensureTodoistSectionId(projectId, task.section));
    }
    for (const task of tasks) {
      const parent = findParentForTask(task, lineToTemp, this.settings);
      if (!parent && !task.isSubtask && task.section && !sectionRefs.get(task.section)) {
        throw new Error(`Todoist section was not available for ${task.section}.`);
      }
      commands.push({
        type: "item_add",
        temp_id: task.tempId,
        uuid: uuid(),
        args: todoistArgsFromParsedTask(task, projectId, parent, sectionRefs.get(task.section), this.settings)
      });
    }
    this.logLocal("Todoist task create prepared", {
      tasks: tasks.length,
      rootTasks: tasks.filter((task) => !task.isSubtask).length,
      sections: Array.from(sectionRefs.entries()).map(([name, id]) => ({ name, id }))
    });
    const response = await this.todoistSync(commands);
    const mapping = response.temp_id_mapping || {};
    for (const parsed of tasks) {
      if (mapping[parsed.tempId]) parsed.id = mapping[parsed.tempId];
    }
    return mapping;
  }

  async relinkCreationsToExistingTodoistTasks(creations, lineToTemp) {
    if (!creations.length) return [];
    let existing = [];
    try {
      const remote = await this.getAllTodoistReferenceTasks({ force: false });
      existing = remote.tasks.filter((task) => !task.isCompleted);
    } catch (error) {
      this.logLocal("Todoist snapshot unavailable for relink check", { error: error.message || String(error) });
      existing = (await this.getTodoistProjectTasks(await this.getTaskProjectId())).filter((task) => !task.isCompleted);
    }
    if (!existing.length) return [];
    const relinked = [];
    for (let i = creations.length - 1; i >= 0; i -= 1) {
      const task = creations[i];
      const parentId = findParentForTask(task, lineToTemp, this.settings);
      const match = findExistingTodoistTaskMatch(task, existing, parentId);
      if (!match) continue;
      task.id = match.id;
      task.oid = task.oid || oidForTodoistId(this.settings, match.id) || generateUniqueOid(this.settings);
      task.description = task.description || match.description || "";
      task.sectionId = match.sectionId || task.sectionId || "";
      task.section = match.section || task.section || "";
      task.projectId = match.projectId || task.projectId || "";
      task.projectName = match.projectName || task.projectName || "";
      relinked.push(task);
      creations.splice(i, 1);
    }
    return relinked.reverse();
  }

  async getTodoistProjectTasks(projectId) {
    if (!projectId) return [];
    const cached = this.todoistSnapshotCache;
    const ttlMs = Math.max(1, Number(this.settings.todoistSnapshotCacheMinutes || 5)) * 60 * 1000;
    if (cached?.snapshot?.tasks && elapsedMs(cached.fetchedAt) < ttlMs) {
      return cached.snapshot.tasks.filter((task) => String(task.projectId || "") === String(projectId));
    }
    const response = await this.todoistRequest(`/tasks?project_id=${encodeURIComponent(projectId)}`).catch(() => []);
    const tasks = Array.isArray(response) ? response : response.results || [];
    return tasks.map(normalizeTodoistTask).filter((task) => task.id && task.content);
  }

  async createTodoistTaskBatch(sectionName, tasks, existingSectionId = "") {
    if (!tasks.length) return [];
    const projectId = await this.getTaskProjectId();
    const projectName = await this.todoistProjectNameForId(projectId);
    const taskTemps = [];
    const sectionId = existingSectionId || await this.ensureTodoistSectionId(projectId, sectionName);
    assignGeneratedTaskSectionId(tasks, sectionId);
    const commands = [];
    const existingUpdates = [];
    for (const task of tasks) {
      task.projectId = task.projectId || projectId;
      task.projectName = task.projectName || projectName;
      let mainRef = task.id || "";
      if (task.id) {
        existingUpdates.push(task);
      } else {
        const mainTempId = uuid();
        mainRef = mainTempId;
        taskTemps.push({ tempId: mainTempId, task });
        commands.push({ type: "item_add", temp_id: mainTempId, uuid: uuid(), args: todoistTaskArgs(task, { section_id: sectionId }, this.settings) });
      }
      for (const subtask of task.subtasks || []) {
        subtask.projectId = subtask.projectId || projectId;
        subtask.projectName = subtask.projectName || projectName;
        subtask.parentId = subtask.parentId || task.id || "";
        if (subtask.id) {
          existingUpdates.push(subtask);
          continue;
        }
        const subTempId = uuid();
        taskTemps.push({ tempId: subTempId, task: subtask });
        commands.push({ type: "item_add", temp_id: subTempId, uuid: uuid(), args: todoistTaskArgs(subtask, { parent_id: mainRef }, this.settings) });
      }
    }
    this.logLocal("Email Todoist task create prepared", {
      tasks: taskTemps.length,
      rootTasks: tasks.length,
      existingUpdates: existingUpdates.length,
      section: sectionName,
      sectionId
    });
    if (commands.length) {
      const response = await this.todoistSync(commands);
      for (const item of taskTemps) if (response.temp_id_mapping?.[item.tempId]) item.task.id = response.temp_id_mapping[item.tempId];
    }
    if (existingUpdates.length) {
      let remoteById = new Map();
      try {
        const snapshot = await this.getTodoistSnapshot(["items", "projects", "sections"], false);
        remoteById = new Map(enrichTodoistTasksWithSnapshot(snapshot).map((task) => [task.id, task]));
      } catch (error) {
        this.logLocal("Todoist snapshot unavailable for dedupe update compare", { error: error.message || String(error) });
      }
      for (const task of existingUpdates) await this.updateTodoistFromParsedTask(task, remoteById.get(task.id) || null);
    }
    return tasks;
  }

  async applyTaskDeduplicationPlan(tasks, options = {}) {
    const stats = emptyTaskDeduplicationStats();
    const flat = flattenTaskPlan(tasks || []);
    stats.checked = flat.length;
    if (!tasks?.length || this.settings.enableTaskDeduplication === false) return stats;
    this.setSidebarStatus("Checking for existing tasks...");
    const generatedDedupe = await deduplicateGeneratedTaskBatch(tasks, this.settings, options, (task, decision, mergeOptions) => this.aiTaskDeduplicationMerge(task, decision, mergeOptions));
    stats.generatedDuplicates += generatedDedupe.merged;
    stats.aiUsed += generatedDedupe.aiUsed || 0;
    stats.ambiguous += generatedDedupe.ambiguous || 0;
    stats.candidateFlags.push(...(generatedDedupe.candidateFlags || []));
    stats.matches.push(...generatedDedupe.matches);
    const candidates = this.taskDeduplicationCandidates();
    if (!candidates.length) {
      stats.created = flattenTaskPlan(tasks).length;
      this.settings.taskDeduplicationLastRunSummary = taskDeduplicationRunSummary(stats);
      if (stats.generatedDuplicates) {
        this.logLocal("Task deduplication complete", {
          source: options.source || "",
          checked: stats.checked,
          merged: stats.merged,
          created: stats.created,
          ambiguous: stats.ambiguous,
          copiedSubtasks: stats.copiedSubtasks,
          generatedDuplicates: stats.generatedDuplicates,
          aiUsed: stats.aiUsed
        });
      }
      await this.postTaskDeduplicationCandidateFlags(stats, options);
      return stats;
    }
    for (const task of tasks) {
      const mainDecision = await this.taskDeduplicationDecision(task, candidates, Object.assign({}, options, { isSubtask: false }));
      if (isAiMediatedTaskDeduplicationCandidate(mainDecision)) {
        if (this.settings.enableAiAmbiguousTaskDeduplication !== true) {
          stats.candidateFlags.push(taskDeduplicationCandidateFlag(task, mainDecision, this.settings, options));
          stats.ambiguous += 1;
          stats.created += 1;
          for (const subtask of task.subtasks || []) stats.created += 1;
          continue;
        }
        const aiMerge = await this.aiTaskDeduplicationMerge(task, mainDecision, options);
        if (aiMerge?.used) stats.aiUsed += 1;
        if (aiMerge?.match !== true) {
          stats.ambiguous += 1;
          continue;
        }
        applyTaskDeduplicationMatch(task, mainDecision, this.settings, options);
        applyAiTaskDeduplicationMerge(task, aiMerge.task, this.settings);
        stats.merged += 1;
        stats.matches.push(taskDeduplicationMatchSummary(task, mainDecision));
        await this.mergeDeduplicatedSubtasks(task, candidates, stats, options);
      } else {
        stats.created += 1;
      }
      for (const subtask of task.subtasks || []) {
        if (subtask.id) stats.merged += 1;
        else stats.created += 1;
      }
    }
    this.settings.taskDeduplicationLastRunSummary = taskDeduplicationRunSummary(stats);
    this.logLocal("Task deduplication complete", {
      source: options.source || "",
      checked: stats.checked,
      merged: stats.merged,
      created: stats.created,
      ambiguous: stats.ambiguous,
      copiedSubtasks: stats.copiedSubtasks,
      generatedDuplicates: stats.generatedDuplicates,
      aiUsed: stats.aiUsed
    });
    await this.postTaskDeduplicationCandidateFlags(stats, options);
    return stats;
  }

  async postTaskDeduplicationCandidateFlags(stats = emptyTaskDeduplicationStats(), options = {}) {
    const flags = (stats.candidateFlags || []).filter(Boolean);
    if (!flags.length || this.settings.enableAiAmbiguousTaskDeduplication === true) return;
    const message = taskDeduplicationCandidateChatMessage(flags, options);
    this.settings.taskDeduplicationLastRunSummary = `${this.settings.taskDeduplicationLastRunSummary || taskDeduplicationRunSummary(stats)} Local-only candidate details were posted to chat.`;
    this.logLocal("Task deduplication local-only candidates flagged", {
      source: options.source || "",
      path: options.path || "",
      candidates: flags.length
    });
    try {
      if (!this.app?.workspace?.getLeavesOfType) return;
      await this.openSidebar();
      const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
      if (view && view instanceof SemanticTodoistView) view.addMessage("assistant", message);
    } catch (error) {
      this.logLocal("Task deduplication chat flag skipped", { error: error.message || String(error), candidates: flags.length });
    }
  }

  taskDeduplicationCandidates() {
    const index = this.getTaskReferenceIndex();
    const candidates = [];
    for (const [id, task] of index.entries || []) {
      if (!id || !task?.content || task.isCompleted) continue;
      const childText = index.childTextByParentOid.get(String(task.oid || "").toUpperCase()) || "";
      const parentContext = taskReferenceParentContext(task, index);
      const enrichedTask = Object.assign({}, task, parentContext, { id: String(id), childText });
      const knowledge = enrichedTask.knowledge?.intent ? enrichedTask.knowledge : taskKnowledgeSnapshot(enrichedTask, this.settings, childText, enrichedTask.knowledge || null);
      candidates.push({ id: String(id), task: Object.assign(enrichedTask, { knowledge }) });
    }
    return candidates;
  }

  async taskDeduplicationDecision(task, candidates, options = {}) {
    return bestTaskDeduplicationMatch(task, candidates, this.settings, options);
  }

  async aiTaskDeduplicationDecision(task, localDecision, options = {}) {
    const candidate = localDecision.candidate;
    const json = await this.withAiActivity("Checking possible duplicate task", () => this.openaiResponse({
      model: taskDeduplicationAiModel(this.settings),
      jsonSchema: taskDeduplicationAiDecisionSchema(),
      system: [
        "Decide whether a newly generated task and an existing open Todoist task are the same actionable work item.",
        "Be conservative. Nuanced related tasks should not match.",
        "Completed tasks are not provided and must not be inferred as duplicates.",
        "Return match true only when the existing task would satisfy the new action after being updated with newer source details."
      ].join(" "),
      user: [
        "Deduplication policy:",
        taskDeduplicationPolicyText(this.settings),
        "",
        "New generated task:",
        taskDeduplicationAiTaskCard(task),
        "",
        "Existing open task:",
        taskDeduplicationAiTaskCard(candidate.task),
        "",
        `Local score: ${localDecision.confidence || 0}`,
        `Workflow source: ${options.source || "task generation"}`
      ].join("\n")
    }));
    const parsed = JSON.parse(json);
    return {
      match: parsed?.match === true && Number(parsed?.confidence || 0) >= TASK_DEDUPLICATION_AI_CONFIDENCE_THRESHOLD,
      confidence: Number(parsed?.confidence || 0),
      reason: truncateAtWord(singleLine(parsed?.reason || ""), 160)
    };
  }

  async aiTaskDeduplicationMerge(task, localDecision, options = {}) {
    const candidate = localDecision.candidate;
    if (!candidate?.task) return null;
    const model = taskDeduplicationAiModel(this.settings);
    if (!hasChatCredentialForModel(this.settings, model)) return null;
    try {
      const json = await this.withAiActivity("Combining duplicate task details", () => this.openaiResponse({
        model,
        jsonSchema: taskDeduplicationAiMergeSchema(this.settings),
        system: [
          "Run the task generation workflow for a likely duplicate pair.",
          "Confirm whether the two task records are the same actionable work item using the source/context notes and Todoist context.",
          "Ignore email routing, reply-to aliases, mailbox-copy instructions, and ticket-tracking boilerplate unless that routing work is the actual requested action.",
          "Treat richer/poorer same-action records as duplicates when the existing task can be updated to satisfy the new task.",
          "Treat parent/subtask pairs as duplicates when one merely restates the other or adds context around the same single next action.",
          "Treat identical or near-identical titles under different parents as duplicates unless the parent context changes the person, object, deliverable, or next step.",
          "Treat different concrete non-Inbox Todoist projects as separate work contexts. Do not merge similar tasks across different named projects unless the source explicitly says the task moved or spans both projects.",
          "Return match false when one task is only a distinct component of a broader parent task with multiple decisions, questions, recipients, documents, or steps.",
          "Return match false when a newer task reflects specific progress, such as reviewing a named person's edits, approvals, returned comments, or a current status update, and the older task is a broader project/status task.",
          "If they are the same, return one merged generated task that preserves the clearest title plus useful non-conflicting details from both records.",
          "If they are only related, return match false and keep the proposed merged task empty."
        ].join(" "),
        user: [
          "Deduplication policy:",
          taskDeduplicationPolicyText(this.settings),
          "",
          taskDeduplicationSourceContextText(options),
          "",
          options.intraBatch ? "Later generated task likely duplicating an earlier generated task:" : "New generated task likely duplicating an existing Todoist task:",
          taskDeduplicationAiTaskCard(task),
          "",
          options.intraBatch ? "Earlier generated task to keep if merged:" : "Existing open Todoist task to update if merged:",
          taskDeduplicationAiTaskCard(candidate.task),
          "",
          `Local candidate score: ${localDecision.confidence || 0}`,
          `Local candidate reasons: ${(localDecision.reasons || []).join("; ")}`,
          `Workflow source: ${options.source || "task generation"}`,
          "",
          "Return the same task shape used by task generation: content, due_date, deadline_date, priority, labels, and subtasks."
        ].filter(Boolean).join("\n")
      }));
      const parsed = JSON.parse(json);
      const confidence = Number(parsed?.confidence || 0);
      return {
        used: true,
        match: parsed?.match === true && confidence >= TASK_DEDUPLICATION_AI_MERGE_CONFIDENCE_THRESHOLD,
        confidence,
        reason: truncateAtWord(singleLine(parsed?.reason || ""), 160),
        task: taskDeduplicationAiMergeTaskFromResponse(parsed, candidate.task, task, this.settings)
      };
    } catch (error) {
      this.logLocal("Task deduplication AI merge skipped", { error: error.message || String(error) });
      return null;
    }
  }

  async mergeDeduplicatedSubtasks(parentTask, candidates, stats, options = {}) {
    if (!parentTask?.id) return;
    const existingChildren = candidates.filter((candidate) => {
      const task = candidate.task || {};
      return task.isSubtask && (String(task.parentId || "") === String(parentTask.id) || (task.parentOid && String(task.parentOid).toUpperCase() === String(parentTask.oid || "").toUpperCase()));
    });
    if (!existingChildren.length) return;
    const nextSubtasks = [];
    const usedExistingIds = new Set();
    for (const subtask of parentTask.subtasks || []) {
      const decision = await this.taskDeduplicationDecision(subtask, existingChildren, Object.assign({}, options, {
        isSubtask: true,
        parentId: parentTask.id,
        parentContent: parentTask.content
      }));
      if (isAiMediatedTaskDeduplicationCandidate(decision)) {
        if (this.settings.enableAiAmbiguousTaskDeduplication !== true) {
          stats.candidateFlags.push(taskDeduplicationCandidateFlag(subtask, decision, this.settings, Object.assign({}, options, {
            isSubtask: true,
            parentContent: parentTask.content
          })));
          nextSubtasks.push(subtask);
          continue;
        }
        const aiMerge = await this.aiTaskDeduplicationMerge(subtask, decision, Object.assign({}, options, {
          isSubtask: true,
          parentId: parentTask.id,
          parentContent: parentTask.content
        }));
        if (aiMerge?.used) stats.aiUsed += 1;
        if (aiMerge?.match !== true) {
          nextSubtasks.push(subtask);
          continue;
        }
        applyTaskDeduplicationMatch(subtask, decision, this.settings, Object.assign({}, options, { parentTask }));
        applyAiTaskDeduplicationMerge(subtask, aiMerge.task, this.settings);
        subtask.isSubtask = true;
        subtask.parentId = parentTask.id;
        subtask.parentOid = parentTask.oid || "";
        subtask.parentContent = parentTask.content || "";
        usedExistingIds.add(decision.id);
        stats.matches.push(taskDeduplicationMatchSummary(subtask, decision));
      }
      if (subtask.id && this.settings.taskDeduplicationAllowExplicitSubtaskRemoval !== false && isExplicitSubtaskRemovalInstruction(subtask)) {
        stats.removedSubtasks += 1;
        continue;
      }
      nextSubtasks.push(subtask);
    }
    parentTask.subtasks = nextSubtasks;
  }

  async ensureTodoistSectionId(projectId, sectionName) {
    const existing = await this.resolveTodoistSectionId(projectId, sectionName);
    if (existing) return existing;
    const tempId = uuid();
    const response = await this.todoistSync([{
      type: "section_add",
      temp_id: tempId,
      uuid: uuid(),
      args: { project_id: projectId, name: sectionName }
    }]);
    const sectionId = response.temp_id_mapping?.[tempId] || "";
    if (!sectionId) throw new Error(`Todoist section could not be created: ${sectionName}`);
    this.rememberTodoistSection(projectId, sectionName, sectionId);
    await this.saveSettings();
    return sectionId;
  }

  async resolveTodoistSectionId(projectId, sectionName) {
    const name = singleLine(sectionName);
    if (!projectId || !name) return "";
    const key = sectionKey(name);
    let sections = await this.getTodoistSections(projectId, false);
    let match = sections.find((section) => sectionKey(section.name) === key);
    if (!match) {
      sections = await this.getTodoistSections(projectId, true);
      match = sections.find((section) => sectionKey(section.name) === key);
    }
    return match?.id || "";
  }

  async getTodoistSections(projectId, force = false) {
    this.settings.todoistSectionCache = this.settings.todoistSectionCache || {};
    const cached = this.settings.todoistSectionCache[projectId];
    if (!force && cached?.sections && elapsedMs(cached.fetchedAt) < 10 * 60 * 1000) return cached.sections;
    const sectionsJson = await this.todoistRequest(`/sections?project_id=${encodeURIComponent(projectId)}`);
    const sections = normalizeTodoistSections(Array.isArray(sectionsJson) ? sectionsJson : sectionsJson.results || [], projectId);
    this.settings.todoistSectionCache[projectId] = { fetchedAt: deviceTimestamp(), sections };
    await this.saveSettings();
    return sections;
  }

  rememberTodoistSection(projectId, sectionName, sectionId) {
    if (!projectId || !sectionName || !sectionId) return;
    this.settings.todoistSectionCache = this.settings.todoistSectionCache || {};
    const cached = this.settings.todoistSectionCache[projectId] || { fetchedAt: deviceTimestamp(), sections: [] };
    const sections = (cached.sections || []).filter((section) => section.id !== String(sectionId) && sectionKey(section.name) !== sectionKey(sectionName));
    sections.push({ id: String(sectionId), name: singleLine(sectionName), projectId: String(projectId) });
    this.settings.todoistSectionCache[projectId] = { fetchedAt: deviceTimestamp(), sections };
  }

  forgetTodoistSection(projectId, sectionId, sectionName = "") {
    if (!projectId || !this.settings.todoistSectionCache?.[projectId]) return;
    const key = sectionKey(sectionName);
    const cached = this.settings.todoistSectionCache[projectId];
    const sections = (cached.sections || []).filter((section) => {
      if (sectionId && String(section.id || "") === String(sectionId)) return false;
      if (key && sectionKey(section.name) === key) return false;
      return true;
    });
    this.settings.todoistSectionCache[projectId] = { fetchedAt: deviceTimestamp(), sections };
  }

  async todoistSync(commands) {
    const body = new URLSearchParams();
    body.set("commands", JSON.stringify(commands));
    const response = await requestUrl({
      url: `${TODOIST_API}/sync`,
      method: "POST",
      headers: { authorization: `Bearer ${this.settings.todoistToken}`, "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`Todoist sync returned ${response.status}: ${redactSecrets(response.text)}`);
    const failed = response.json.sync_status && Object.entries(response.json.sync_status).find(([, status]) => status !== "ok");
    if (failed) throw new Error(`Todoist command failed: ${JSON.stringify(failed)}`);
    this.todoistSnapshotCache = null;
    return response.json;
  }

  async todoistRequest(path, method = "GET", body) {
    const response = await requestUrl({
      url: `${TODOIST_API}${path}`,
      method,
      headers: { authorization: `Bearer ${this.settings.todoistToken}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      throw: false
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`Todoist returned ${response.status}: ${redactSecrets(response.text)}`);
    if (String(method || "GET").toUpperCase() !== "GET") this.todoistSnapshotCache = null;
    return response.json;
  }

  async deleteTodoistTask(taskId) {
    const response = await requestUrl({
      url: `${TODOIST_API}/tasks/${taskId}`,
      method: "DELETE",
      headers: { authorization: `Bearer ${this.settings.todoistToken}` },
      throw: false
    });
    if (response.status === 404) return true;
    if (response.status < 200 || response.status >= 300) throw new Error(`Todoist delete returned ${response.status}: ${redactSecrets(response.text)}`);
    this.todoistSnapshotCache = null;
    return true;
  }

  async deleteTodoistTasksMissingFromFile(path, presentIds) {
    let deleted = 0;
    let forgotCompleted = 0;
    const deletedSections = new Map();
    const cachedEntries = this.getTaskReferenceIndex().byPath.get(vaultRelativePath(path, vaultBasePath(this.app))) || [];
    for (const [id, cached] of cachedEntries) {
      if (presentIds.has(id)) continue;
      if (cached.isCompleted) {
        delete this.settings.taskCache[id];
        forgotCompleted += 1;
        continue;
      }
      const ok = await this.deleteTodoistTask(id).catch((error) => {
        this.logLocal("Todoist delete failed", { id, path, error: error.message || String(error) });
        return false;
      });
      if (!ok) continue;
      if (!cached.isSubtask && cached.sectionId) {
        deletedSections.set(cached.sectionId, {
          sectionId: cached.sectionId,
          section: cached.section || "",
          projectId: cached.projectId || ""
        });
      }
      delete this.settings.taskCache[id];
      deleted += 1;
    }
    if (deleted || forgotCompleted) this.markTaskReferenceStateDirty();
    if (forgotCompleted) this.logLocal("Completed note task references forgotten after local line removal", { path, tasks: forgotCompleted });
    if (deletedSections.size) await this.cleanupEmptyTodoistSections(Array.from(deletedSections.values()));
    return { deleted, completedForgotten: forgotCompleted };
  }

  async cleanupEmptyTodoistSections(sections) {
    const candidates = uniqueSectionCleanupCandidates(sections);
    if (!candidates.length) return 0;
    let snapshot = null;
    try {
      snapshot = await this.getTodoistSnapshot(["items", "sections"], true);
    } catch (error) {
      this.logLocal("Todoist section cleanup skipped", { error: error.message || String(error) });
      return 0;
    }
    let deleted = 0;
    const referenceIndex = this.getTaskReferenceIndex();
    for (const section of candidates) {
      if (!section.sectionId) continue;
      const hasLocalTasks = (referenceIndex.bySectionId.get(String(section.sectionId)) || []).length > 0;
      if (hasLocalTasks) continue;
      const hasRemoteTasks = (snapshot.tasks || []).some((task) => String(task.sectionId || "") === String(section.sectionId));
      if (hasRemoteTasks) continue;
      const ok = await this.deleteTodoistSection(section.sectionId).catch((error) => {
        this.logLocal("Todoist section delete failed", { sectionId: section.sectionId, section: section.section || "", error: error.message || String(error) });
        return false;
      });
      if (!ok) continue;
      this.forgetTodoistSection(section.projectId, section.sectionId, section.section);
      deleted += 1;
    }
    if (deleted) this.logLocal("Empty Todoist sections deleted", { sections: deleted });
    return deleted;
  }

  async deleteTodoistSection(sectionId) {
    if (!sectionId) return false;
    const response = await requestUrl({
      url: `${TODOIST_API}/sections/${encodeURIComponent(sectionId)}`,
      method: "DELETE",
      headers: { authorization: `Bearer ${this.settings.todoistToken}` },
      throw: false
    });
    if (response.status === 404) return true;
    if (response.status < 200 || response.status >= 300) throw new Error(`Todoist section delete returned ${response.status}: ${redactSecrets(response.text)}`);
    this.todoistSnapshotCache = null;
    return true;
  }

  async reconcileTodoistTaskCache() {
    const referenceIndex = this.getTaskReferenceIndex();
    const entries = referenceIndex.entries;
    const preservedCompleted = [];
    let checked = 0;
    let activeTodoistIds = null;
    try {
      const snapshot = await this.getTodoistSnapshot(["items", "projects", "sections"], false);
      activeTodoistIds = new Set(snapshot.tasks.map((task) => task.id));
    } catch (error) {
      this.logLocal("Todoist snapshot unavailable for cache reconcile", { error: error.message || String(error) });
    }
    for (const [id, cached] of entries) {
      checked += 1;
      if (!activeTodoistIds && cached.isCompleted) continue;
      const exists = activeTodoistIds ? activeTodoistIds.has(id) : await this.todoistTaskExists(id);
      if (exists) continue;
      const noteTouched = await this.preserveMissingTodoistTaskInNote(id, cached, "missing from active Todoist snapshot");
      preservedCompleted.push({ id, oid: cached.oid || "", path: cached.path || "", noteTouched });
    }
    if (preservedCompleted.length) {
      this.markTaskReferenceStateDirty();
      await this.saveSettings();
      this.logLocal("Todoist cache reconciled", { checked, removed: 0, preservedCompleted: preservedCompleted.length });
    }
    return { checked, removed: 0, preservedCompleted: preservedCompleted.length };
  }

  async todoistTaskExists(taskId) {
    const response = await requestUrl({
      url: `${TODOIST_API}/tasks/${taskId}`,
      method: "GET",
      headers: { authorization: `Bearer ${this.settings.todoistToken}`, "content-type": "application/json" },
      throw: false
    });
    if (response.status === 404) return false;
    if (response.status >= 200 && response.status < 300) return true;
    this.logLocal("Todoist cache check skipped", { id: taskId, status: response.status });
    return true;
  }

  async removeDeletedTodoistTaskFromNote(cached) {
    if (!cached?.path || !cached.oid) return false;
    const file = this.app.vault.getAbstractFileByPath(cached.path);
    if (!(file instanceof TFile)) return false;
    const lines = (await this.app.vault.read(file)).split("\n");
    const removeIndexes = new Set();
    for (let i = 0; i < lines.length; i += 1) {
      if (getTaskOid(lines[i]) !== cached.oid) continue;
      removeIndexes.add(i);
      if (!cached.isSubtask) {
        const parentIndent = indentationLevel(lines[i]);
        for (let j = i + 1; j < lines.length; j += 1) {
          if (!/^\s*[-*]\s+\[[ xX]\]/.test(lines[j])) {
            if (!lines[j].trim()) continue;
            break;
          }
          if (indentationLevel(lines[j]) <= parentIndent) break;
          removeIndexes.add(j);
        }
      }
    }
    if (!removeIndexes.size) return false;
    const kept = lines.filter((_, index) => !removeIndexes.has(index));
    repairSyncedSubtaskIndentationLines(kept, this.settings);
    this.markInternalNoteWrite(cached.path);
    await this.app.vault.modify(file, kept.join("\n"));
    return true;
  }

  async cachedTaskLineIsChecked(taskId, cached) {
    if (!cached?.path) return false;
    const file = this.app.vault.getAbstractFileByPath(cached.path);
    if (!(file instanceof TFile)) return false;
    const lines = (await this.app.vault.read(file)).split("\n");
    return lines.some((line) => {
      if (taskId && getTodoistId(line, this.settings) === String(taskId)) return /^\s*[-*]\s+\[[xX]\]/.test(line);
      if (cached.oid && getTaskOid(line) === cached.oid) return /^\s*[-*]\s+\[[xX]\]/.test(line);
      return false;
    });
  }

  async preserveMissingTodoistTaskInNote(taskId, cached, reason = "") {
    if (!cached) return false;
    let noteTouched = false;
    if (cached.path) {
      await this.updateCachedLine(String(taskId || ""), (line) => {
        const next = line.replace(/^(\s*[-*]\s+\[)[ xX](\])/, "$1x$2");
        if (next !== line) noteTouched = true;
        return next;
      });
    }
    cached.isCompleted = true;
    cached.signature = parsedTaskSignature(cached);
    cached.cachedAt = deviceTimestamp();
    cached.completedPreservedAt = deviceTimestamp();
    if (reason) cached.completedPreservedReason = reason;
    this.taskReferenceSnapshotDirty = true;
    return noteTouched;
  }

  async getInboxProjectId() {
    if (this.settings.todoistInboxProjectId) return this.settings.todoistInboxProjectId;
    const projects = await this.getTodoistProjects();
    const inbox = projects.find((project) => project.isInbox) ||
      projects.find((project) => String(project.name || "").toLowerCase() === "inbox");
    if (!inbox) throw new Error("Todoist Inbox project was not found.");
    this.settings.todoistInboxProjectId = inbox.id;
    await this.saveSettings();
    return inbox.id;
  }

  async getTaskProjectId() {
    if (this.settings.todoistTaskProjectId) return this.settings.todoistTaskProjectId;
    const inboxId = await this.getInboxProjectId();
    this.settings.todoistTaskProjectId = inboxId;
    this.settings.todoistTaskProjectName = this.settings.todoistTaskProjectName || "Inbox";
    await this.saveSettings();
    return inboxId;
  }

  async getTodoistProjects() {
    const projectsJson = await this.todoistRequest("/projects");
    const projects = normalizeTodoistProjects(Array.isArray(projectsJson) ? projectsJson : projectsJson.results || []);
    this.settings.availableTodoistProjects = projects;
    this.settings.todoistProjectsFetchedAt = deviceTimestamp();
    const inbox = projects.find((project) => project.isInbox) || projects.find((project) => project.name.toLowerCase() === "inbox");
    if (inbox) {
      this.settings.todoistInboxProjectId = inbox.id;
      if (!this.settings.todoistTaskProjectId) {
        this.settings.todoistTaskProjectId = inbox.id;
        this.settings.todoistTaskProjectName = inbox.name;
      }
    }
    await this.saveSettings();
    return projects;
  }

  async refreshTodoistProjects(showNotice = true) {
    if (!this.settings.todoistToken) throw new Error("Add a Todoist API token first.");
    const projects = await this.getTodoistProjects();
    const selected = projects.find((project) => project.id === this.settings.todoistTaskProjectId);
    if (!selected && projects.length) {
      const inbox = projects.find((project) => project.isInbox) || projects.find((project) => project.name.toLowerCase() === "inbox") || projects[0];
      this.settings.todoistTaskProjectId = inbox.id;
      this.settings.todoistTaskProjectName = inbox.name;
      await this.saveSettings();
    }
    if (showNotice) new Notice(`Loaded ${projects.length} Todoist project${projects.length === 1 ? "" : "s"}.`);
  }

  async updateTodoistFromParsedTask(task, remote = null) {
    const cached = this.settings.taskCache?.[task.id] || null;
    const cachedCompleted = Boolean(cached?.isCompleted);
    const remoteCompleted = remote ? Boolean(remote.isCompleted) : cachedCompleted;
    if (task.isCompleted) {
      if (!remoteCompleted) {
        await this.setTodoistTaskCompletionState(task.id, true);
      }
      return true;
    }
    if (remoteCompleted) {
      const reopened = await this.setTodoistTaskCompletionState(task.id, false);
      if (!reopened) return false;
      remote = null;
    }
    const updates = todoistUpdatePayload(task, remote, this.settings);
    if (Object.keys(updates).length) await this.todoistRequest(`/tasks/${task.id}`, "POST", updates);
    return true;
  }

  async setTodoistTaskCompletionState(taskId, completed) {
    const endpoint = completed ? "close" : "reopen";
    const response = await requestUrl({
      url: `${TODOIST_API}/tasks/${encodeURIComponent(taskId)}/${endpoint}`,
      method: "POST",
      headers: { authorization: `Bearer ${this.settings.todoistToken}`, "content-type": "application/json" },
      throw: false
    });
    if (response.status === 404) {
      this.logLocal("Todoist completion update skipped because task was not found", { id: taskId, completed });
      return false;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`Todoist completion returned ${response.status}: ${redactSecrets(response.text)}`);
    this.todoistSnapshotCache = null;
    return true;
  }

  async todoistConflictForLocalUpdate(parsed, cached, remoteOverride = null) {
    if (!cached || !parsed?.id) return null;
    const remote = remoteOverride || await this.todoistRequest(`/tasks/${parsed.id}`).catch(() => null);
    if (!remote) return null;
    const remoteContent = singleLine(remote.content || "");
    const cachedContent = singleLine(cached.content || "");
    if (remoteContent && remoteContent !== cachedContent && remoteContent !== singleLine(parsed.content || "")) {
      return {
        content: remoteContent,
        description: remote.description || cached.description || parsed.description || ""
      };
    }
    return null;
  }

  async pullTodoistUpdates() {
    if (!Object.keys(this.settings.taskCache || {}).length) return;
    const activities = await this.todoistRequest("/activities").catch(() => ({ results: [] }));
    const savedEvents = new Set(this.settings.processedTodoistEventIds || []);
    const events = (activities.results || []).filter((event) => !savedEvents.has(event.id));
    let snapshotTasksById = null;
    if (events.some((event) => /updated|added|completed|uncompleted|deleted|removed/i.test(event.event_type || event.eventType || ""))) {
      const snapshot = await this.getTodoistSnapshot(["items", "projects", "sections"], false).catch(() => null);
      if (snapshot?.tasks) snapshotTasksById = new Map(enrichTodoistTasksWithSnapshot(snapshot).map((task) => [task.id, task]));
    }
    for (const event of events) {
      const taskId = event.object_id || event.objectId;
      const eventType = event.event_type || event.eventType;
      if (!taskId || !this.settings.taskCache[taskId]) continue;
      if (/deleted|removed/i.test(eventType)) {
        const cached = this.settings.taskCache[taskId];
        const movedTask = snapshotTasksById?.get(String(taskId)) || null;
        if (movedTask) {
          await this.updateTaskLineFromTodoist(taskId, movedTask);
          savedEvents.add(event.id);
          continue;
        }
        const stillExists = await this.todoistTaskExists(taskId);
        if (stillExists) {
          this.logLocal("Todoist removal event preserved active task", { id: taskId, path: cached.path || "" });
          savedEvents.add(event.id);
          continue;
        }
        if (cached.isCompleted || await this.cachedTaskLineIsChecked(taskId, cached)) {
          await this.preserveMissingTodoistTaskInNote(taskId, cached, "Todoist removal event for completed local task");
          this.logLocal("Todoist removal event preserved completed task in note", { id: taskId, path: cached.path || "" });
          savedEvents.add(event.id);
          continue;
        }
        await this.removeDeletedTodoistTaskFromNote(cached);
        delete this.settings.taskCache[taskId];
        this.markTaskReferenceStateDirty();
        savedEvents.add(event.id);
        continue;
      }
      if (/uncompleted/i.test(eventType)) await this.setTaskLineChecked(taskId, false);
      else if (/completed/i.test(eventType)) await this.setTaskLineChecked(taskId, true);
      if (/updated|added/i.test(eventType)) {
        const task = snapshotTasksById?.get(String(taskId)) || null;
        if (task) await this.updateTaskLineFromTodoist(taskId, task);
      }
      savedEvents.add(event.id);
    }
    this.settings.processedTodoistEventIds = Array.from(savedEvents).slice(-500);
    await this.saveSettings();
  }

  async setTaskLineChecked(taskId, checked) {
    const cached = this.settings.taskCache[taskId];
    if (!cached) return;
    await this.updateCachedLine(taskId, (line) => line.replace(/^(\s*[-*]\s+\[)[ xX](\])/, `$1${checked ? "x" : " "}$2`));
    cached.isCompleted = Boolean(checked);
    cached.signature = parsedTaskSignature(cached);
    cached.cachedAt = deviceTimestamp();
    this.markTaskReferenceStateDirty();
  }

  async updateTaskLineFromTodoist(taskId, task) {
    const cached = this.settings.taskCache[taskId];
    if (!cached) return;
    const projectId = String(task.project_id || task.projectId || cached.projectId || "");
    const projectName = await this.todoistProjectNameForId(projectId);
    const parsed = todoistTaskToParsedTask(Object.assign({}, task, { projectId, projectName }), Object.assign({}, cached, {
      oid: cached.oid || oidForTodoistId(this.settings, taskId) || generateUniqueOid(this.settings),
      parentOid: cached.parentOid || "",
      parentContent: cached.parentContent || "",
      parentLineNumber: cached.parentLineNumber ?? null,
      id: taskId
    }), this.settings);
    await this.updateCachedLine(taskId, (line) => {
      return taskLineWithStableIndent(line, parsed, this.settings, taskId);
    });
    this.cacheTask(taskId, parsed);
  }

  async todoistProjectNameForId(projectId) {
    if (!projectId) return "";
    let project = (this.settings.availableTodoistProjects || []).find((item) => String(item.id) === String(projectId));
    if (project) return project.name || "";
    const projects = await this.getTodoistProjects().catch(() => []);
    project = projects.find((item) => String(item.id) === String(projectId));
    return project?.name || "";
  }

  async updateCachedLine(taskId, replacer) {
    const cached = this.settings.taskCache[taskId];
    const file = this.app.vault.getAbstractFileByPath(cached.path);
    if (!(file instanceof TFile)) return;
    const lines = (await this.app.vault.read(file)).split("\n");
    const idx = lines.findIndex((line) => getTodoistId(line, this.settings) === taskId || (cached.oid && getTaskOid(line) === cached.oid));
    if (idx === -1) return;
    const originalLine = lines[idx];
    const nextLine = replacer(originalLine);
    const hasSubtaskMarker = hasSubtaskSyncMarker(originalLine, this.settings) || hasSubtaskSyncMarker(nextLine, this.settings);
    const isSubtask = Boolean(hasSubtaskMarker || cached.isSubtask || cached.parentId || cached.parent_id || cached.parentOid);
    lines[idx] = isSubtask ? ensureSubtaskIndent(nextLine, { isSubtask: true }, this.settings) : nextLine;
    repairSyncedSubtaskIndentationLines(lines, this.settings);
    this.markInternalNoteWrite(cached.path);
    await this.app.vault.modify(file, lines.join("\n"));
  }

  cacheTask(id, task) {
    const existingDescription = this.settings.taskCache?.[id]?.description || "";
    const incomingDescription = !task.isSubtask && isRichTodoistDescription(task.description) ? task.description : "";
    const description = task.isSubtask ? "" : sanitizeStoredTodoistDescription(incomingDescription || existingDescription || "", this.settings);
    const oid = task.oid || this.settings.taskCache?.[id]?.oid || generateUniqueOid(this.settings);
    const path = vaultRelativePath(task.path, vaultBasePath(this.app));
    const pendingReference = oid ? this.settings.pendingTaskReferences?.[pendingTaskOidKey(path, oid)] : null;
    const parentReference = parentReferenceForParsedTask(task, this.settings) || {};
    const knowledgeTask = Object.assign({}, task, {
      oid,
      path,
      description,
      parentId: task.parentId || task.parent_id || parentReference.id || pendingReference?.parentId || this.settings.taskCache?.[id]?.parentId || "",
      parentOid: task.parentOid || parentReference.oid || pendingReference?.parentOid || this.settings.taskCache?.[id]?.parentOid || "",
      parentContent: task.parentContent || parentReference.content || pendingReference?.parentContent || this.settings.taskCache?.[id]?.parentContent || "",
      section: task.section || pendingReference?.section || "",
      projectName: task.projectName || pendingReference?.projectName || this.settings.taskCache?.[id]?.projectName || ""
    });
    const knowledge = taskKnowledgeSnapshot(knowledgeTask, this.settings, "", this.settings.taskCache?.[id]?.knowledge || pendingReference?.knowledge || null);
    this.settings.taskCache[id] = {
      oid,
      path,
      lineNumber: task.lineNumber,
      content: task.content,
      description,
      labels: task.labels,
      priority: task.priority,
      due_date: task.due_date || null,
      deadline_date: task.deadline_date || null,
      duration: normalizeTodoistDuration(task.duration),
      scheduledDueDateTime: task.scheduledDueDateTime || task.due_datetime || (task.due_date && isDateTimeString(task.due_date) ? task.due_date : ""),
      isCompleted: task.isCompleted,
      isSubtask: Boolean(task.isSubtask),
      parentId: task.parentId || task.parent_id || parentReference.id || pendingReference?.parentId || this.settings.taskCache?.[id]?.parentId || "",
      parentOid: task.parentOid || parentReference.oid || pendingReference?.parentOid || this.settings.taskCache?.[id]?.parentOid || "",
      parentContent: task.parentContent || parentReference.content || pendingReference?.parentContent || this.settings.taskCache?.[id]?.parentContent || "",
      parentLineNumber: Number.isFinite(task.parentLineNumber) ? task.parentLineNumber : Number.isFinite(parentReference.lineNumber) ? parentReference.lineNumber : this.settings.taskCache?.[id]?.parentLineNumber ?? null,
      section: task.section || pendingReference?.section || "",
      sectionId: task.sectionId || pendingReference?.sectionId || this.settings.taskCache?.[id]?.sectionId || "",
      projectId: task.projectId || task.project_id || pendingReference?.projectId || this.settings.taskCache?.[id]?.projectId || "",
      projectName: task.projectName || pendingReference?.projectName || this.settings.taskCache?.[id]?.projectName || "",
      noteRefs: mergeNoteReferences(this.settings.taskCache?.[id]?.noteRefs || [], [noteReferenceForTask(Object.assign({}, task, { path }), oid)]),
      knowledge,
      signature: parsedTaskSignature(task),
      cachedAt: deviceTimestamp()
    };
    if (this.settings.pendingTaskDescriptions) {
      delete this.settings.pendingTaskDescriptions[pendingTaskKey(path, task)];
      delete this.settings.pendingTaskDescriptions[pendingTaskContentKey(path, task)];
      if (oid) delete this.settings.pendingTaskDescriptions[pendingTaskOidKey(path, oid)];
    }
    if (this.settings.pendingTaskReferences && oid) delete this.settings.pendingTaskReferences[pendingTaskOidKey(path, oid)];
    this.markTaskReferenceStateDirty();
    this.queueTaskReferenceIndexUpdate(path);
    this.observeSchedulerMemoryForTask(id, this.settings.taskCache[id], "task-cache");
  }

  savePendingTaskDescriptions(path, tasks) {
    this.settings.pendingTaskDescriptions = this.settings.pendingTaskDescriptions || {};
    const notePath = vaultRelativePath(path, vaultBasePath(this.app));
    for (const task of flattenTaskPlan(tasks)) {
      if (task.isSubtask) continue;
      const description = task.description || "";
      if (!description) continue;
      this.settings.pendingTaskDescriptions[pendingTaskKey(notePath, task)] = description;
      this.settings.pendingTaskDescriptions[pendingTaskContentKey(notePath, task)] = description;
      if (task.oid) this.settings.pendingTaskDescriptions[pendingTaskOidKey(notePath, task.oid)] = description;
    }
    this.markTaskReferenceStateDirty();
  }

  savePendingTaskReferences(path, tasks) {
    this.settings.pendingTaskReferences = this.settings.pendingTaskReferences || {};
    const createdAt = deviceTimestamp();
    const notePath = vaultRelativePath(path, vaultBasePath(this.app));
    for (const task of tasks || []) {
      if (task.oid) this.settings.pendingTaskReferences[pendingTaskOidKey(notePath, task.oid)] = {
        id: task.id || "",
        oid: task.oid,
        path: notePath,
        content: task.content || "",
        description: task.description || "",
        section: task.section || "",
        sectionId: task.sectionId || "",
        projectId: task.projectId || "",
        projectName: task.projectName || "",
        isSubtask: false,
        parentId: "",
        parentOid: "",
        parentContent: "",
        knowledge: taskKnowledgeSnapshot(Object.assign({}, task, { path: notePath }), this.settings, "", task.knowledge || null),
        createdAt
      };
      for (const subtask of task.subtasks || []) {
        if (!subtask.oid) continue;
        this.settings.pendingTaskReferences[pendingTaskOidKey(notePath, subtask.oid)] = {
          id: subtask.id || "",
          oid: subtask.oid,
          parentOid: task.oid || "",
          parentId: task.id || "",
          parentContent: task.content || "",
          path: notePath,
          content: subtask.content || "",
          description: "",
          section: task.section || "",
          sectionId: task.sectionId || "",
          projectId: subtask.projectId || task.projectId || "",
          projectName: subtask.projectName || task.projectName || "",
          isSubtask: true,
          knowledge: taskKnowledgeSnapshot(Object.assign({}, subtask, {
            path: notePath,
            parentOid: task.oid || "",
            parentId: task.id || "",
            parentContent: task.content || "",
            section: task.section || "",
            projectName: subtask.projectName || task.projectName || ""
          }), this.settings, "", subtask.knowledge || null),
          createdAt
        };
      }
    }
    this.markTaskReferenceStateDirty();
    this.queueTaskReferenceIndexUpdate(notePath);
  }

  descriptionStateForParsedTask(task) {
    if (task.isSubtask) return { description: "", descriptionShouldSync: false };
    const pending = this.pendingDescriptionForParsedTask(task);
    const cached = task.id ? this.settings.taskCache?.[task.id]?.description : "";
    const description = pending || cached || "";
    return {
      description: description ? sanitizeStoredTodoistDescription(description, this.settings) : "",
      descriptionShouldSync: Boolean(pending)
    };
  }

  pendingDescriptionForParsedTask(task) {
    const pending = this.settings.pendingTaskDescriptions || {};
    return (task.oid && pending[pendingTaskOidKey(task.path, task.oid)]) ||
      pending[pendingTaskKey(task.path, task)] ||
      pending[pendingTaskContentKey(task.path, task)] ||
      "";
  }

  pendingReferenceForParsedTask(task) {
    const pending = this.settings.pendingTaskReferences || {};
    return (task.oid && pending[pendingTaskOidKey(task.path, task.oid)]) || null;
  }

  pendingSectionIdForParsedTask(task) {
    return this.pendingReferenceForParsedTask(task)?.sectionId || "";
  }

  findCachedTaskIdForParsedTask(task) {
    const referenceIndex = this.getTaskReferenceIndex();
    if (task.oid) {
      const oidId = referenceIndex.byOid.get(String(task.oid || "").toUpperCase()) || "";
      if (oidId) return oidId;
    }
    const signature = parsedTaskSignature(task);
    const key = pendingTaskKey(task.path, task);
    const contentKey = pendingTaskContentKey(task.path, task);
    const pathEntries = referenceIndex.byPath.get(task.path) || [];
    for (const [id, cached] of pathEntries) if (cached.signature === signature || pendingTaskKey(cached.path, cached) === key || pendingTaskContentKey(cached.path, cached) === contentKey) return id;
    return "";
  }

  async cacheLoggedTasks(path, tasks, sectionName) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return 0;
    const lines = (await this.app.vault.read(file)).split("\n");
    const byId = new Map();
    const byOid = new Map();
    let cached = 0;
    for (const task of tasks || []) {
      if (task.id) byId.set(task.id, Object.assign({ isCompleted: false, isSubtask: false, section: sectionName }, task));
      if (task.oid) byOid.set(task.oid, Object.assign({ isCompleted: false, isSubtask: false, section: sectionName }, task));
      for (const subtask of task.subtasks || []) {
        if (subtask.id) byId.set(subtask.id, Object.assign({ isCompleted: false, isSubtask: true, section: "" }, subtask));
        if (subtask.oid) byOid.set(subtask.oid, Object.assign({ isCompleted: false, isSubtask: true, section: "" }, subtask));
      }
    }
    for (let i = 0; i < lines.length; i += 1) {
      const parsed = parseTaskLine(lines[i], i, path, lines, this.settings) || {};
      const oid = parsed.oid || getTaskOid(lines[i]);
      const id = parsed.id || getTodoistId(lines[i], this.settings) || byOid.get(oid)?.id;
      const task = byId.get(id) || byOid.get(oid);
      if (!task) continue;
      if (!id) continue;
      this.cacheTask(id, Object.assign({}, parsed, task, {
        oid: oid || task.oid,
        path,
        lineNumber: i,
        allLines: lines,
        description: task.description || parsed.description || "",
        labels: (task.labels || []).map(cleanLabel).filter(Boolean),
        priority: normalizePriority(task.priority),
        due_date: task.due_date || null,
        deadline_date: task.deadline_date || null,
        isCompleted: Boolean(task.isCompleted || parsed.isCompleted),
        isSubtask: Boolean(task.isSubtask || parsed.isSubtask),
        parentId: task.parentId || task.parent_id || parsed.parentId || "",
        parentOid: task.parentOid || parsed.parentOid || "",
        parentContent: task.parentContent || parsed.parentContent || "",
        parentLineNumber: Number.isFinite(task.parentLineNumber) ? task.parentLineNumber : parsed.parentLineNumber ?? null,
        section: task.section || parsed.section || (task.isSubtask || parsed.isSubtask ? "" : sectionName),
        sectionId: task.sectionId || parsed.sectionId || "",
        projectId: task.projectId || parsed.projectId || this.settings.todoistTaskProjectId || this.settings.todoistInboxProjectId || "",
        projectName: task.projectName || parsed.projectName || this.settings.todoistTaskProjectName || ""
      }));
      cached += 1;
    }
    await this.saveSettings();
    return cached;
  }

  async appendEmailLog({ subject, from, receivedAt, cloudflareReceivedAt, sectionName, tasks }) {
    const folder = trimSlashes(this.settings.emailLogFolder || DEFAULT_SETTINGS.emailLogFolder);
    await ensureVaultFolder(this.app, folder);
    const noteTitle = emailTaskNoteTitle(receivedAt, subject);
    const path = uniqueMarkdownPath(this.app, folder, noteTitle);
    const lines = [
      `# ${noteTitle}`,
      "",
      `Date processed: ${deviceTimestamp()}`,
      `Original email received: ${receivedAt || ""}`,
      cloudflareReceivedAt ? `Forward received by Cloudflare: ${cloudflareReceivedAt}` : "",
      `From: ${from || ""}`,
      `Email subject: ${subject || ""}`,
      `Todoist section: ${sectionName}`,
      "",
      "## Synced Todoist Tasks"
    ].filter(Boolean);
    for (const task of tasks || []) {
      lines.push(parsedTaskToLine(Object.assign({ isCompleted: false, isSubtask: false, section: sectionName }, task), this.settings, task.id));
      for (const subtask of task.subtasks || []) {
        const line = parsedTaskToLine(Object.assign({ isCompleted: false, isSubtask: true }, subtask), this.settings, subtask.id);
        lines.push(`${desiredSubtaskIndent(this.settings)}${line.trimStart()}`);
      }
    }
    if (!tasks?.length) lines.push("- No actionable tasks were found.");
    this.markInternalNoteWrite(path);
    await this.app.vault.create(path, `${lines.join("\n")}\n`);
    const cached = await this.cacheLoggedTasks(path, tasks || [], sectionName);
    let syncStats = emptySyncStats();
    try {
      syncStats = await this.syncFileNotes(path, false);
    } catch (error) {
      this.logLocal("Email task note sync initialization failed", { path, error: error.message || String(error) });
    }
    this.logLocal("Email task note created", { path, tasks: flattenTaskPlan(tasks || []).length, cached, syncStats, syncable: isEmailLogPath(path, this.settings), sectionName });
  }
};

class SemanticTodoistView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.messages = [];
    this.selectedPath = "";
    this.includeActiveNote = plugin.settings.searchIncludeActiveNote !== false;
    this.statusDisplayEntries = new Map();
    this.statusRefreshTimer = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Semantic Todoist Sync"; }
  getIcon() { return "list-checks"; }

  async onOpen() {
    this.render();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.handleActiveNoteChanged()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.handleActiveNoteChanged()));
  }

  async onClose() {
    window.clearTimeout(this.statusRefreshTimer);
    this.statusRefreshTimer = null;
    this.statusDisplayEntries?.clear?.();
  }

  setPrompt(text) {
    if (this.promptEl) this.promptEl.value = text;
  }

  renderSearchResults(query, results) {
    this.renderRelevantNotes(results);
    this.addMessage("user", `Search: ${query}`);
    this.addMessage("assistant", results.length ? `Found ${results.length} relevant notes.` : "No semantic matches found.");
  }

  render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("semantic-todoist-view");
    container.style.setProperty("--semantic-todoist-chat-font-size", `${this.plugin.settings.chatFontSizePx || DEFAULT_SETTINGS.chatFontSizePx}px`);
    const header = container.createDiv({ cls: "semantic-todoist-header" });
    header.createEl("h3", { text: "Semantic Todoist Sync" });
    const indexButton = header.createEl("button", { text: "Index" });
    indexButton.onclick = async () => {
      this.setStatus("Indexing vault...");
      try {
        await this.plugin.rebuildSemanticIndex(true);
      } catch (error) {
        console.error(error);
        this.setStatus(`Index failed: ${error.message || error}`);
        new Notice(`Index failed: ${error.message || error}`);
      }
    };
    const headerNewChatButton = header.createEl("button", { cls: "semantic-todoist-header-icon", attr: { "aria-label": "New chat", title: "New chat" } });
    setIcon(headerNewChatButton, "message-square-plus");
    headerNewChatButton.onclick = () => this.newChat();
    const noteRow = container.createDiv({ cls: "semantic-todoist-note-row" });
    noteRow.createSpan({ cls: "semantic-todoist-note-label", text: "Active note" });
    const picker = noteRow.createDiv({ cls: "semantic-todoist-note-picker" });
    const pickerLine = picker.createDiv({ cls: "semantic-todoist-note-picker-line" });
    this.noteInputEl = pickerLine.createEl("input", { type: "search", cls: "semantic-todoist-note-select semantic-todoist-note-search", placeholder: "Search or select note..." });
    this.noteChatToggleEl = pickerLine.createEl("label", { cls: "semantic-todoist-note-chat-toggle", attr: { title: "Include active note in chat search", "aria-label": "Include active note in chat search" } });
    const includeCheckbox = this.noteChatToggleEl.createEl("input", { type: "checkbox", attr: { "aria-label": "Include active note in chat search" } });
    this.noteChatCheckboxEl = includeCheckbox;
    includeCheckbox.checked = this.includeActiveNote;
    this.noteChatToggleTextEl = this.noteChatToggleEl.createSpan({ text: this.includeActiveNote ? "On" : "Off" });
    includeCheckbox.onchange = async () => {
      this.includeActiveNote = includeCheckbox.checked;
      this.plugin.settings.searchIncludeActiveNote = this.includeActiveNote;
      await this.plugin.saveSettings();
      this.refreshActiveSummary();
    };
    this.noteInputEl.oninput = () => {
      if (!this.noteInputEl.value.trim()) {
        this.selectedPath = "";
        this.noteSearchDirty = true;
        if (this.noteResultsEl) this.noteResultsEl.empty();
        return;
      }
      this.noteSearchDirty = true;
      this.renderNoteSearchResults();
    };
    this.noteInputEl.onfocus = () => {
      this.noteSearchDirty = true;
      this.noteInputEl.select();
      if (this.noteResultsEl) this.noteResultsEl.empty();
    };
    this.noteInputEl.onblur = () => {
      window.setTimeout(() => {
        this.hideNoteSearch();
        this.refreshActiveSummary();
      }, 150);
    };
    this.noteInputEl.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.hideNoteSearch();
        this.refreshActiveSummary();
        return;
      }
      if (event.key !== "Enter") return;
      const first = this.getNoteSearchMatches(this.noteInputEl.value)[0];
      if (first) {
        event.preventDefault();
        this.selectNote(first.path);
      }
    };
    this.noteResultsEl = picker.createDiv({ cls: "semantic-todoist-note-results" });
    this.relevantEl = container.createDiv({ cls: "semantic-todoist-relevant" });
    this.relevantEl.setText("Relevant notes will appear here after search or chat.");
    this.messagesEl = container.createDiv({ cls: "semantic-todoist-conversation" });
    this.promptEl = container.createEl("textarea", { cls: "semantic-todoist-chat-prompt", placeholder: "Ask about your vault or draft a prompt..." });
    this.promptEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      this.ask();
    });
    const actionRow = container.createDiv({ cls: "semantic-todoist-action-row" });
    actionRow.createSpan({ cls: "semantic-todoist-action-label", text: "Run:" });
    this.actionSelectEl = actionRow.createEl("select", { cls: "semantic-todoist-action-select", attr: { "aria-label": "Action prompt to run", title: "Choose a scheduler action or prompt template" } });
    this.actionSelectEl.createEl("option", { text: "Loading actions...", value: "" });
    this.populateSidebarActionOptions();
    const toolbar = container.createDiv({ cls: "semantic-todoist-toolbar" });
    const askButton = toolbar.createEl("button", { cls: "semantic-todoist-ask-button", attr: { title: "Ask a chat question using vault context" }, text: "Ask" });
    askButton.onclick = async () => {
      await this.ask();
    };
    const tasksButton = toolbar.createEl("button", { cls: "semantic-todoist-tasks-button", attr: { title: "Generate Todoist tasks from the selected or active note" }, text: "Tasks" });
    tasksButton.onclick = async () => {
      await this.runDefaultTaskPrompt();
    };
    const runButton = toolbar.createEl("button", { cls: "semantic-todoist-run-action", attr: { title: "Run the selected scheduler action or prompt" }, text: "Run" });
    runButton.onclick = async () => {
      await this.runSelectedSidebarAction();
    };
    this.statusEl = container.createDiv({ cls: "semantic-todoist-status" });
    this.setStatus("Ready");
    this.refreshActiveSummary();
  }

  async ask() {
    try {
      const prompt = this.promptEl.value.trim();
      if (!prompt) return;
      this.setStatus("Asking AI...");
      const history = this.messages.slice(-8);
      this.addMessage("user", prompt);
      this.addMessage("assistant", "Thinking...");
      const active = await this.getSelectedActiveContext();
      if (this.promptEl) this.promptEl.value = "";
      const result = await this.plugin.chat(prompt, active, history);
      this.renderRelevantNotes(result.context);
      this.replaceLastAssistantMessage(result.answer);
      this.setStatus("Ready");
    } catch (error) {
      console.error(error);
      this.replaceLastAssistantMessage(`Error: ${error.message || error}`);
      this.setStatus(`Chat failed: ${error.message || error}`);
    }
  }

  async runDefaultTaskPrompt() {
    try {
      this.setStatus("Creating tasks...");
      const active = await this.getSelectedActiveContext({ forceInclude: true });
      if (!active.path) throw new Error("Open a markdown note first.");
      const template = await this.plugin.resolveTaskGenerationTemplate();
      const insertIntoNote = template.insertResponse !== false;
      const syncAfterInsert = template.syncAfterInsert === true;
      const result = await this.plugin.runPromptTemplate(template, { active, insertIntoNote, syncAfterInsert, showNotice: true });
      this.addMessage("user", `Tasks: ${template.name || "Default task prompt"}`);
      this.addMessage("assistant", result.markdown || "No actionable tasks found.");
      this.setStatus("Ready");
    } catch (error) {
      console.error(error);
      this.addMessage("assistant", `Error: ${error.message || error}`);
      this.setStatus(`Task creation failed: ${error.message || error}`);
    }
  }

  async populateSidebarActionOptions() {
    if (!this.actionSelectEl) return;
    const previous = this.actionSelectEl.value || "";
    this.sidebarActionTemplates = [];
    while (this.actionSelectEl.firstChild) this.actionSelectEl.removeChild(this.actionSelectEl.firstChild);
    const options = [];
    let scheduleOption = null;
    const promptOptions = [];
    try {
      const templates = await this.plugin.getPromptTemplates();
      this.sidebarActionTemplates = templates || [];
      this.sidebarActionTemplates.forEach((template, index) => {
        const name = singleLine(template.name || template.path || `Prompt ${index + 1}`);
        const option = { value: `prompt:${index}`, label: shortTitle(name, 56) };
        if (isScheduleTodayTemplate(template)) {
          if (!scheduleOption) scheduleOption = option;
          return;
        }
        promptOptions.push(option);
      });
    } catch (error) {
      console.error(error);
      options.push({ value: "prompts", label: "Prompts..." });
    }
    if (this.plugin.settings.scheduleTodayEnabled !== false) options.unshift(scheduleOption || { value: "schedule", label: "Schedule today" });
    options.push(...promptOptions);
    if (!options.length) options.push({ value: "", label: "No actions available" });
    for (const option of options) this.actionSelectEl.createEl("option", { text: option.label, value: option.value });
    const values = new Set(options.map((option) => option.value));
    this.actionSelectEl.value = values.has(previous) ? previous : options[0].value;
  }

  sidebarTemplateChoices(template = {}) {
    const createsTasks = template.createTasks !== false;
    const insertIntoNote = template.insertResponse === true || createsTasks;
    const syncAfterInsert = createsTasks && insertIntoNote && template.syncAfterInsert === true;
    return { insertIntoNote, syncAfterInsert };
  }

  async runSelectedSidebarAction() {
    const action = this.actionSelectEl?.value || (this.plugin.settings.scheduleTodayEnabled !== false ? "schedule" : "prompts");
    if (action === "schedule") {
      await this.plugin.openScheduleTodayPreview();
      return;
    }
    if (action === "prompts") {
      await this.openPromptTemplates();
      return;
    }
    if (action.startsWith("prompt:")) {
      const index = Number(action.split(":")[1]);
      const template = this.sidebarActionTemplates?.[index];
      if (!template) {
        await this.populateSidebarActionOptions();
        throw new Error("Select a prompt and try again.");
      }
      if (isScheduleTodayTemplate(template)) {
        await this.plugin.openScheduleTodayPreview(template);
        return;
      }
      try {
        this.setStatus(template.createTasks === false ? "Running prompt..." : "Creating tasks...");
        const active = await this.getSelectedActiveContext({ forceInclude: true });
        const choices = this.sidebarTemplateChoices(template);
        const result = await this.plugin.runPromptTemplate(template, Object.assign({ active, showNotice: true }, choices));
        this.addMessage("user", `Prompt: ${template.name || "Selected prompt"}`);
        this.addMessage("assistant", result.markdown || result.answer || "No response generated.");
        this.setStatus("Ready");
      } catch (error) {
        console.error(error);
        this.addMessage("assistant", `Error: ${error.message || error}`);
        this.setStatus(`Prompt failed: ${error.message || error}`);
      }
      return;
    }
  }

  async openPromptTemplates() {
    const templates = await this.plugin.getPromptTemplates();
    new TaskTemplateModal(this.plugin.app, templates, async ({ template, insertIntoNote, syncAfterInsert }) => {
      try {
        this.setStatus(template.createTasks === false ? "Running prompt..." : "Creating tasks...");
        const active = await this.getSelectedActiveContext({ forceInclude: true });
        const result = await this.plugin.runPromptTemplate(template, { active, insertIntoNote, syncAfterInsert, showNotice: true });
        this.addMessage("user", `Prompt: ${template.name}`);
        this.addMessage("assistant", result.markdown || result.answer || "No response generated.");
        this.setStatus("Ready");
      } catch (error) {
        console.error(error);
        this.addMessage("assistant", `Error: ${error.message || error}`);
        this.setStatus(`Task creation failed: ${error.message || error}`);
      }
    }).open();
  }

  newChat() {
    this.messages = [];
    this.renderMessages();
    this.renderRelevantNotes([]);
    this.setStatus("Ready");
  }

  setStatus(message = "Ready") {
    this.currentStatus = message || "Ready";
    if (!this.statusEl) return;
    const { items, nextDelay } = this.statusItemsForDisplay();
    this.renderStatusItems(items);
    this.scheduleStatusRefresh(nextDelay);
  }

  statusItemsForDisplay(now = Date.now()) {
    const rawItems = activeWorkflowStatusItems(this.plugin, this.currentStatus);
    const activeItems = isReadyWorkflowStatusItems(rawItems) ? [] : rawItems;
    const activeKeys = new Set();
    activeItems.forEach((item, index) => {
      const key = workflowStatusItemKey(item);
      activeKeys.add(key);
      const existing = this.statusDisplayEntries.get(key);
      this.statusDisplayEntries.set(key, {
        item,
        firstSeen: existing?.firstSeen ?? now,
        lastSeen: now,
        order: existing?.order ?? now + index / 100
      });
    });
    const visible = [];
    let nextDelay = 0;
    for (const [key, entry] of this.statusDisplayEntries.entries()) {
      const isActive = activeKeys.has(key);
      const remaining = STATUS_ITEM_MIN_VISIBLE_MS - (now - entry.firstSeen);
      if (isActive || remaining > 0) {
        visible.push(entry);
        if (!isActive && remaining > 0) nextDelay = nextDelay ? Math.min(nextDelay, remaining) : remaining;
      } else {
        this.statusDisplayEntries.delete(key);
      }
    }
    const items = visible
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.item);
    return { items: items.length ? items : [{ label: "Status", value: "Ready" }], nextDelay };
  }

  scheduleStatusRefresh(delayMs) {
    window.clearTimeout(this.statusRefreshTimer);
    this.statusRefreshTimer = null;
    if (!delayMs) return;
    this.statusRefreshTimer = window.setTimeout(() => {
      this.statusRefreshTimer = null;
      this.setStatus(this.currentStatus || "Ready");
    }, Math.max(0, Math.ceil(delayMs) + 25));
  }

  renderStatusItems(items) {
    this.statusEl.empty();
    const line1 = this.statusEl.createDiv({ cls: "semantic-todoist-status-line" });
    items.forEach((item, index) => {
      if (index) line1.createSpan({ cls: "semantic-todoist-status-separator", text: " | " });
      line1.createEl("strong", { text: `${item.label}:` });
      line1.createSpan({ text: ` ${item.value}` });
    });
  }

  async getSelectedActiveContext(options = {}) {
    if (!options.forceInclude && !this.includeActiveNote) return { title: "", path: "", text: "", selection: "" };
    return this.plugin.getActiveMarkdownContext(this.selectedPath);
  }

  handleActiveNoteChanged() {
    if (!this.selectedPath) this.refreshActiveSummary();
  }

  selectNote(path) {
    this.selectedPath = path;
    this.noteSearchDirty = false;
    this.hideNoteSearch();
    this.refreshActiveSummary();
  }

  getNoteSearchMatches(query) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return [];
    return this.plugin.app.vault.getMarkdownFiles()
      .filter((file) => {
        const path = file.path.toLowerCase();
        return path.includes(needle) || file.basename.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        const aName = a.basename.toLowerCase().startsWith(needle) ? 0 : 1;
        const bName = b.basename.toLowerCase().startsWith(needle) ? 0 : 1;
        return aName - bName || a.path.localeCompare(b.path);
      })
      .slice(0, 8);
  }

  renderNoteSearchResults() {
    if (!this.noteResultsEl || !this.noteInputEl) return;
    this.noteResultsEl.empty();
    const query = this.noteInputEl.value;
    if (!query.trim()) return;
    const matches = this.getNoteSearchMatches(query);
    if (!matches.length) {
      this.noteResultsEl.createDiv({ text: "No matching notes." });
      return;
    }
    for (const file of matches) {
      const item = this.noteResultsEl.createDiv({ cls: "semantic-todoist-note-result" });
      item.createEl("strong", { text: file.basename });
      item.createDiv({ text: file.path });
      item.onclick = () => this.selectNote(file.path);
    }
  }

  async refreshActiveSummary() {
    const active = await this.plugin.getActiveMarkdownContext(this.selectedPath);
    if (this.noteChatCheckboxEl) this.noteChatCheckboxEl.checked = this.includeActiveNote;
    this.updateNoteChatToggleState();
    if (this.noteInputEl) this.noteInputEl.placeholder = this.includeActiveNote ? "Search notes..." : "Search notes... (chat off)";
    if (!this.includeActiveNote) {
      this.updateNotePickerLabel(active.title || active.path || "");
      return;
    }
    if (!active.path) {
      this.updateNotePickerLabel("");
      return;
    }
    this.updateNotePickerLabel(active.title || active.path, active.selection ? "Selection" : "");
  }

  hideNoteSearch() {
    if (this.noteResultsEl) this.noteResultsEl.empty();
    this.noteSearchDirty = false;
  }

  updateNotePickerLabel(label, state = "") {
    const noteText = label ? shortTitle(label, 34) : "No active note";
    const stateText = state ? ` | ${state}` : "";
    if (!this.noteInputEl) return;
    if (!this.noteSearchDirty) this.noteInputEl.value = `${noteText}${stateText}`;
    this.noteInputEl.title = label ? `${label}${stateText}` : `No active note${stateText}`;
  }

  updateNoteChatToggleState() {
    if (!this.noteChatToggleEl) return;
    const included = Boolean(this.includeActiveNote);
    this.noteChatToggleEl.classList.toggle("is-chat-included", included);
    this.noteChatToggleEl.classList.toggle("is-chat-excluded", !included);
    this.noteChatToggleEl.title = included ? "Active note included in chat search" : "Active note excluded from chat search";
    this.noteChatToggleEl.setAttribute("aria-label", this.noteChatToggleEl.title);
    if (this.noteChatToggleTextEl) this.noteChatToggleTextEl.setText(included ? "On" : "Off");
  }

  renderRelevantNotes(chunks) {
    if (!this.relevantEl) return;
    this.relevantEl.empty();
    this.relevantEl.createEl("strong", { text: "Relevant notes" });
    const uniqueChunks = uniqueChunksByPath(chunks);
    if (!uniqueChunks.length) {
      this.relevantEl.createDiv({ text: "No relevant notes found." });
      return;
    }
    const tabs = this.relevantEl.createDiv({ cls: "semantic-todoist-source-tabs" });
    for (const chunk of uniqueChunks.slice(0, 4)) {
      const card = tabs.createDiv({ cls: "semantic-todoist-source-card" });
      card.setText(chunk.title || chunk.path);
      card.title = chunk.path;
      card.onclick = () => {
        const file = this.plugin.app.vault.getAbstractFileByPath(chunk.path);
        if (file instanceof TFile) this.plugin.app.workspace.getLeaf(true).openFile(file);
      };
    }
  }

  addMessage(role, text) {
    this.messages.push({ role, text: role === "assistant" ? embedBareMarkdownLinks(text) : text });
    this.renderMessages();
  }

  replaceLastAssistantMessage(text) {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      if (this.messages[i].role === "assistant") {
        this.messages[i].text = embedBareMarkdownLinks(text);
        this.renderMessages();
        return;
      }
    }
    this.addMessage("assistant", text);
  }

  renderMessages() {
    if (!this.messagesEl) return;
    this.messagesEl.empty();
    for (const message of this.messages) {
      const bubble = this.messagesEl.createDiv({ cls: `semantic-todoist-message semantic-todoist-message-${message.role}` });
      bubble.createDiv({ cls: "semantic-todoist-message-role", text: message.role === "user" ? "You" : "AI" });
      const textEl = bubble.createDiv({ cls: "semantic-todoist-message-text" });
      if (message.role === "assistant") {
        MarkdownRenderer.renderMarkdown(message.text, textEl, "", this);
      } else {
        textEl.setText(message.text);
      }
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}

class SemanticTodoistSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.activeTab = "Setup";
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("semantic-todoist-settings");
    new Setting(containerEl).setName("Semantic Todoist Sync").setHeading();
    const tabs = containerEl.createDiv({ cls: "semantic-todoist-tabs" });
    let activeButton = null;
    for (const tab of ["Setup", "Basic", "API Access", "Email-To-Todoist", "Notes-To-Todoist", "Daily Scheduler", "Task Deduplication", "References", "Activity"]) {
      const button = tabs.createEl("button", { text: tab });
      if (this.activeTab === tab) {
        button.addClass("is-active");
        activeButton = button;
      }
      button.onclick = () => {
        this.tabScrollLeft = tabs.scrollLeft;
        this.activeTab = tab;
        this.display();
      };
    }
    if (this.activeTab === "Setup") this.renderSetup(containerEl);
    if (this.activeTab === "Basic") this.renderBasic(containerEl);
    if (this.activeTab === "API Access") this.renderApi(containerEl);
    if (this.activeTab === "Email-To-Todoist") this.renderEmail(containerEl);
    if (this.activeTab === "Notes-To-Todoist") this.renderNotes(containerEl);
    if (this.activeTab === "Daily Scheduler") this.renderScheduleToday(containerEl);
    if (this.activeTab === "Task Deduplication") this.renderTaskDeduplication(containerEl);
    if (this.activeTab === "References") this.renderReferences(containerEl);
    if (this.activeTab === "Activity") this.renderActivity(containerEl);
    tabs.scrollLeft = Number(this.tabScrollLeft || 0);
    if (activeButton) {
      const alignActiveTab = () => activeButton.scrollIntoView({ block: "nearest", inline: "center" });
      if (typeof window !== "undefined" && window.requestAnimationFrame) window.requestAnimationFrame(alignActiveTab);
      else alignActiveTab();
    }
  }

  renderSetup(containerEl) {
    settingsHeading(containerEl, "Quick Setup", "Follow these steps in order. AI credentials and Todoist access are required for both workflows. Cloudflare is optional and only needed for Email-To-Todoist.");
    settingsHeading(containerEl, "Step 1 - AI Provider", "Create a provider key in your browser, paste it below, then validate. OpenAI is the default provider; Gemini remains optional.");
    setupStatusSetting(containerEl, "Open provider key pages", aiSetupSummary(this.plugin.settings), [
      ["Gemini API keys", () => this.plugin.openSetupUrl("https://aistudio.google.com/app/apikey")],
      ["Gemini instructions", () => this.plugin.openSetupUrl("https://ai.google.dev/gemini-api/docs/api-key")],
      ["OpenAI API keys", () => this.plugin.openSetupUrl("https://platform.openai.com/api-keys")]
    ]);
    secretSetting(containerEl, "Google Gemini API key", this.plugin, "googleApiKey");
    secretSetting(containerEl, "OpenAI API key", this.plugin, "openaiApiKey");
    aiProviderSetting(containerEl, this.plugin, () => this.display());
    settingsHeading(containerEl, "AI Models", "Choose the primary chat model, one same-provider fallback, and the embedding model used for semantic vault indexing.");
    new Setting(containerEl).setName("Configured AI models").setDesc(configuredAiModelSummary(this.plugin));
    modelDropdownSetting(containerEl, "Primary AI model", "Used for sidebar chat, vault question-answering, task generation, descriptions, prompts, and scheduler estimates.", this.plugin, "chatModel", "availableChatModels");
    modelDropdownSetting(containerEl, "Embedding model", "Used for semantic vault indexing. The plugin keeps this on the same provider as the selected AI model by default.", this.plugin, "embeddingModel", "availableEmbeddingModels");
    toggleSetting(containerEl, "Automatic same-provider fallback", "When the selected AI model is temporarily overloaded or rate-limited, retry once with another available model from the same provider.", this.plugin, "enableAiModelFallback");
    aiFallbackModelSetting(containerEl, this.plugin);
    toggleSetting(containerEl, "Show fallback model in chat", "When a sidebar answer uses the fallback model, append a short note at the bottom of the response.", this.plugin, "showAiFallbackNotice");
    new Setting(containerEl).setName("Available AI models").setDesc(modelSummary(this.plugin.settings)).addButton((button) => button.setButtonText("Refresh").onClick(async () => {
      try {
        await this.plugin.refreshOpenAIModels(true);
        this.display();
      } catch (error) {
        new Notice(`Could not load AI models: ${error.message || error}`);
      }
    }));
    new Setting(containerEl).setName("Validate AI access").setDesc("Tests the saved provider key by loading available chat and embedding models.").addButton((button) => button.setButtonText("Test AI").setCta().onClick(async () => {
      try {
        await this.plugin.validateAiSetup(true);
        this.display();
      } catch (error) {
        new Notice(`AI setup check failed: ${error.message || error}`);
      }
    }));
    settingsHeading(containerEl, "Step 2 - Todoist", "Open Todoist in a browser, copy your personal API token from Settings > Integrations > Developer, paste it below, then validate.");
    setupStatusSetting(containerEl, "Open Todoist token pages", todoistSetupSummary(this.plugin.settings), [
      ["Token instructions", () => this.plugin.openSetupUrl("https://todoist.com/help/articles/find-your-api-token-Jpzx9IIlB")],
      ["Todoist web settings", () => this.plugin.openSetupUrl("https://todoist.com/app/settings/integrations/developer")]
    ]);
    secretSetting(containerEl, "Todoist API token", this.plugin, "todoistToken");
    todoistProjectSetting(containerEl, this.plugin, () => this.display());
    new Setting(containerEl).setName("Validate Todoist access").setDesc("Tests the saved Todoist token and refreshes available projects.").addButton((button) => button.setButtonText("Test Todoist").setCta().onClick(async () => {
      try {
        await this.plugin.validateTodoistSetup(true);
        this.display();
      } catch (error) {
        new Notice(`Todoist setup check failed: ${error.message || error}`);
      }
    }));
    settingsHeading(containerEl, "Step 3 - Notes-To-Todoist", "Enable the Notes-to-Todoist workflow in Semantic Todoist Sync after AI and Todoist both validate. Cloudflare is not required for note tasks.");
    setupStatusSetting(containerEl, "Notes-To-Todoist", notesSetupSummary(this.plugin.settings), [
      ["Enable", async () => {
        try {
          await this.plugin.validateNotesWorkflowSetup(false);
          this.plugin.settings.notesAutoSync = true;
          await this.plugin.saveSettings();
          this.display();
        } catch (error) {
          new Notice(`Notes-To-Todoist setup is incomplete: ${error.message || error}`);
        }
      }],
      ["Validate", async () => {
        try {
          await this.plugin.validateNotesWorkflowSetup(true);
          this.display();
        } catch (error) {
          new Notice(`Notes-To-Todoist setup check failed: ${error.message || error}`);
        }
      }],
      ["Sync now", () => this.plugin.syncNoteTasks(true)]
    ]);
    settingsHeading(containerEl, "Existing Note Tasks", "Choose how Semantic Todoist Sync should handle tasks that already contain Todoist IDs from another plugin or an older workflow.");
    setupStatusSetting(containerEl, "Todoist ID migration", legacyTodoistIdModeSummary(this.plugin.settings), [
      ["Start with OIDs now", async () => {
        await this.plugin.setLegacyTodoistIdMode("preserve");
        new Notice("Existing Todoist ID task lines will be left alone. New Semantic Todoist Sync tasks will use OIDs.");
        this.display();
      }],
      ["Convert existing IDs", async () => {
        try {
          await this.plugin.setLegacyTodoistIdMode("convert");
          await this.plugin.rebuildTodoistReferenceTable(true);
          this.display();
        } catch (error) {
          new Notice(`Could not convert existing Todoist IDs: ${error.message || error}`);
        }
      }],
      ["Recover Todoist IDs", async () => {
        try {
          await this.plugin.recoverTodoistIdsFromTaskNames(true);
          this.display();
        } catch (error) {
          new Notice(`Could not recover Todoist IDs: ${error.message || error}`);
        }
      }]
    ]);
    settingsHeading(containerEl, "Step 4 - Email-To-Todoist Optional", "Use this only if you want forwarded emails processed through your own Cloudflare Worker. The compatible Worker keeps a small KV queue state key so empty pending checks avoid KV list usage. The Worker token below is a local shared secret generated by this plugin, not a Cloudflare account API token.");
    setupStatusSetting(containerEl, "Open Cloudflare setup pages", `${emailSetupSummary(this.plugin.settings)} Use Email Routing for inbound email. Automatic polling is clamped to at least 420 seconds to protect Cloudflare KV Free limits. Use Cloudflare API Tokens only for advanced deployment tooling; this plugin does not need your Cloudflare account API token during normal use.`, [
      ["Email Routing", () => this.plugin.openSetupUrl("https://dash.cloudflare.com/?to=/:account/:zone/email/routing")],
      ["API tokens advanced", () => this.plugin.openSetupUrl("https://dash.cloudflare.com/profile/api-tokens")],
      ["Email Routing docs", () => this.plugin.openSetupUrl("https://developers.cloudflare.com/email-routing/")],
      ["Workers docs", () => this.plugin.openSetupUrl("https://developers.cloudflare.com/workers/")]
    ]);
    textSetting(containerEl, "Cloudflare Worker URL", "Paste the HTTPS URL for your deployed email queue Worker.", this.plugin, "workerUrl");
    secretSetting(containerEl, "Cloudflare Worker token", this.plugin, "workerToken");
    setupStatusSetting(containerEl, "Worker shared secret", "Click Generate token, then copy this token into your Cloudflare Worker as the shared authorization secret expected by the Worker. This is separate from Cloudflare API tokens.", [
      ["Generate token", async () => {
        try {
          await this.plugin.generateWorkerToken(true);
          this.display();
        } catch (error) {
          new Notice(`Could not generate Worker token: ${error.message || error}`);
        }
      }],
      ["Copy token", async () => {
        try {
          if (!this.plugin.settings.workerToken) await this.plugin.generateWorkerToken(false);
          await navigator.clipboard.writeText(this.plugin.settings.workerToken);
          new Notice("Worker token copied.");
        } catch (error) {
          new Notice(`Could not copy Worker token: ${error.message || error}`);
        }
      }],
      ["Setup note", async () => {
        try {
          await this.plugin.createCloudflareSetupNote(true);
        } catch (error) {
          new Notice(`Could not create setup note: ${error.message || error}`);
        }
      }],
      ["Enable email", async () => {
        try {
          this.plugin.requireAiAccess();
          this.plugin.requireTodoistAccess();
          this.plugin.requireEmailWorkerAccess();
          this.plugin.settings.autoProcessEmails = true;
          await this.plugin.saveSettings();
          this.display();
        } catch (error) {
          new Notice(`Email setup is incomplete: ${error.message || error}`);
        }
      }],
      ["Validate", async () => {
        try {
          await this.plugin.validateEmailSetup(true);
          this.display();
        } catch (error) {
          new Notice(`Email setup check failed: ${error.message || error}`);
        }
      }]
    ]);
    new Setting(containerEl).setName("Validate configured setup").setDesc("Checks only the services with credentials saved in settings. It does not send vault notes unless you rebuild the semantic index or run task creation.").addButton((button) => button.setButtonText("Check setup").setCta().onClick(async () => {
      await this.plugin.validateConfiguredSetup(true);
      this.display();
    }));
    settingsHeading(containerEl, "Privacy Basics", "API keys stay in this plugin's local Obsidian settings. Vault note content is sent to the selected AI provider only for chat, semantic indexing, task extraction, and task description generation. Todoist receives only task data. Cloudflare receives forwarded email content only when Email-To-Todoist is configured and used.");
  }

  renderBasic(containerEl) {
    settingsHeading(containerEl, "Sidebar And Prompts", "Controls how the sidebar behaves and where prompt templates are loaded from. AI model selection now lives in Setup.");
    dropdownSettingWithDesc(containerEl, "Default sidebar mode", "Vault QA uses semantic vault search and active-note context for sourced answers. Chat is a lighter general conversation mode. Task Creation is for prompts that generate Todoist-ready tasks.", this.plugin, "chatMode", ["Vault QA", "Chat", "Task Creation"]);
    dropdownSetting(containerEl, "Open plugin in", this.plugin, "defaultOpenArea", ["view", "left", "right"]);
    numberSetting(containerEl, "Chat font size px", this.plugin, "chatFontSizePx");
    toggleSetting(containerEl, "Auto-add active content to context", "Include active note content in sidebar chat.", this.plugin, "autoAddActiveContentToContext");
    toggleSetting(containerEl, "Include active note in sidebar search by default", "The sidebar switch can still be changed per session.", this.plugin, "searchIncludeActiveNote");
    numberSetting(containerEl, "Max chat context chunks", this.plugin, "maxChatContextChunks");
    numberSetting(containerEl, "Max active-note context characters", this.plugin, "maxActiveNoteContextChars");
    settingsHeading(containerEl, "Prompts");
    textSetting(containerEl, "Prompts folder", "Markdown files in this folder appear as prompt actions. Use action: schedule-today for the scheduler prompt; scheduler settings still control the actual rules.", this.plugin, "promptTemplatesFolder");
    taskGenerationPromptTemplateSetting(containerEl, this.plugin);
    new Setting(containerEl).setName("Open sidebar").addButton((button) => button.setButtonText("Open").onClick(() => this.plugin.openSidebar()));
    new Setting(containerEl).setName("Run prompts").setDesc("Runs custom prompts. Prompts can insert plain AI responses or create task lists when createTasks is true.").addButton((button) => button.setButtonText("Run").onClick(() => this.plugin.runTaskTemplateFromCommandPalette()));
  }

  renderApi(containerEl) {
    settingsHeading(containerEl, "API Keys");
    secretSetting(containerEl, "OpenAI API key", this.plugin, "openaiApiKey");
    secretSetting(containerEl, "Google API key", this.plugin, "googleApiKey");
    secretSetting(containerEl, "Todoist API token", this.plugin, "todoistToken");
    todoistProjectSetting(containerEl, this.plugin, () => this.display());
    settingsHeading(containerEl, "Cloudflare");
    textSetting(containerEl, "Cloudflare Worker URL", "Email queue endpoint.", this.plugin, "workerUrl");
    secretSetting(containerEl, "Cloudflare Worker token", this.plugin, "workerToken");
    new Setting(containerEl).setName("Cloudflare email setup").setDesc("Create or refresh a plain-language setup checklist for a new Cloudflare account, domain, worker, or forwarding address. This does not change the working email processor.").addButton((button) => button.setButtonText("Create setup note").onClick(async () => {
      try {
        await this.plugin.createCloudflareSetupNote(true);
      } catch (error) {
        new Notice(`Could not create setup note: ${error.message || error}`);
      }
    }));
    settingsHeading(containerEl, "Semantic Index");
    textSetting(containerEl, "Indexed folders", "Comma-separated. Leave blank for whole vault.", this.plugin, "indexedFolders");
    folderListSetting(containerEl, "Excluded folders", "Folders ignored by search and semantic indexing. Note sync also skips these folders except for the Email-To-Todoist log folder, which remains syncable so generated email task notes can update from Todoist.", this.plugin, "excludedFolders");
    textSetting(containerEl, "Excluded link domains", "Comma-separated domains omitted from AI task prompts and Todoist descriptions. Subdomains are included. Example: internal.example.com.", this.plugin, "excludedLinkDomains");
    numberSetting(containerEl, "Embedding batch size", this.plugin, "embeddingBatchSize");
    numberSetting(containerEl, "Index chunk size characters", this.plugin, "semanticIndexMaxChunkChars");
    numberSetting(containerEl, "Max index chunks per note", this.plugin, "semanticIndexMaxChunksPerNote");
    numberSetting(containerEl, "Index embedding precision", this.plugin, "semanticIndexEmbeddingPrecision");
    toggleSetting(containerEl, "Use note created time in semantic ranking", "Recommended. Add frontmatter such as created: [\"2026-05-20 13:43\"] to each Markdown note so semantic search can prefer the most current meeting guidance. This value is stored in the semantic index and used for context ranking. If this is off, or if the note has no created value, the plugin uses file metadata instead: created time for freshness and modified time for note updates.", this.plugin, "useNoteCreatedTimeForSemanticIndex");
    toggleSetting(containerEl, "Automatically update semantic index", "Re-index created or modified notes after a short delay.", this.plugin, "autoUpdateSemanticIndex");
    numberSetting(containerEl, "Semantic index delay seconds", this.plugin, "semanticIndexDelaySeconds");
    new Setting(containerEl).setName("Semantic vault index").setDesc(indexSummary(this.plugin))
      .addButton((button) => button.setButtonText("Rebuild").onClick(() => this.plugin.rebuildSemanticIndex(true)))
      .addButton((button) => button.setButtonText("Purge current").onClick(() => this.plugin.purgeSemanticIndex(true)));
  }

  renderEmail(containerEl) {
    settingsHeading(containerEl, "Automation");
    toggleSetting(containerEl, "Automatically process new emails", "Poll Cloudflare for pending email tasks while Obsidian is open. Compatible Workers use a KV queue state key so empty checks avoid KV list operations.", this.plugin, "autoProcessEmails");
    numberSetting(containerEl, "Email polling interval seconds", this.plugin, "emailPollIntervalSeconds");
    new Setting(containerEl).setName("Last email poll").setDesc(this.plugin.settings.lastEmailPollAt || "Not yet polled.");
    new Setting(containerEl).setName("Process pending email tasks").addButton((button) => button.setButtonText("Process").setCta().onClick(() => this.plugin.processPendingEmails()));
    settingsHeading(containerEl, "Email Content");
    numberSetting(containerEl, "Maximum email characters", this.plugin, "maxEmailChars");
    textSetting(containerEl, "Email log folder", "Plain-language processing log folder.", this.plugin, "emailLogFolder");
    toggleSetting(containerEl, "Add source list and citations to Todoist descriptions", "Append source references and add context note numbers like (1) beside email description sentences primarily supported by context notes.", this.plugin, "emailIncludeSourceListInDescriptions");
    settingsHeading(containerEl, "Task Generation Limits", "Hard caps applied to AI-created tasks before anything is inserted or synced.");
    numberSetting(containerEl, "Maximum main tasks per email or note", this.plugin, "maxGeneratedMainTasks");
    numberSetting(containerEl, "Maximum subtasks per main task", this.plugin, "maxGeneratedSubtasksPerMainTask");
    subtaskCriteriaSettings(containerEl, this.plugin);
    taskInstructionSettings(containerEl, this.plugin, "Email task instructions", "email");
  }

  renderNotes(containerEl) {
    settingsHeading(containerEl, "Marker Tags", "Tags used in note task lines to mark main tasks and subtasks for Todoist sync.");
    textSetting(containerEl, "Main sync tag", "Semantic Todoist Sync main task marker. Default: #STsync.", this.plugin, "syncTag");
    textSetting(containerEl, "Subtask sync tag", "Indented subtask marker. Default: #STSubSync.", this.plugin, "subtaskSyncTag");
    toggleSetting(containerEl, "Do not sync marker tags as Todoist labels", "", this.plugin, "excludeSyncTagsFromLabels");
    settingsHeading(containerEl, "Automatic Sync");
    toggleSetting(containerEl, "Automatic note sync", "Sync changed note task lines automatically.", this.plugin, "notesAutoSync");
    numberSetting(containerEl, "Automatic sync interval seconds", this.plugin, "syncIntervalSeconds");
    numberSetting(containerEl, "Sync worker count", this.plugin, "syncWorkerCount");
    settingsHeading(containerEl, "Note Task Formatting");
    toggleSetting(containerEl, "Use Todoist app links", "Use todoist:// task links instead of web links when the AI references tasks from the local OID table.", this.plugin, "linksAppURI");
    numberSetting(containerEl, "Subtask indent spaces", this.plugin, "subtaskIndentSpaces");
    subtaskCriteriaSettings(containerEl, this.plugin);
    settingsHeading(containerEl, "Task Generation Limits", "Hard caps applied to AI-created tasks before anything is inserted or synced.");
    numberSetting(containerEl, "Maximum main tasks per email or note", this.plugin, "maxGeneratedMainTasks");
    numberSetting(containerEl, "Maximum subtasks per main task", this.plugin, "maxGeneratedSubtasksPerMainTask");
    numberSetting(containerEl, "Maximum note characters for task extraction", this.plugin, "maxNoteChars");
    numberSetting(containerEl, "Maximum Todoist description characters", this.plugin, "todoistDescriptionMaxChars");
    toggleSetting(containerEl, "Add source list and citations to Todoist descriptions", "Append source references and add context note numbers like (1) beside note description sentences primarily supported by context notes.", this.plugin, "noteIncludeSourceListInDescriptions");
    new Setting(containerEl).setName("Sync note tasks").addButton((button) => button.setButtonText("Sync").setCta().onClick(() => this.plugin.syncNoteTasks()));
    taskInstructionSettings(containerEl, this.plugin, "Note task instructions", "note");
  }

  renderActivity(containerEl) {
    containerEl.createEl("h3", { text: "Plugin Activity" });
    settingsHeading(containerEl, "AI And Semantic Index", "Current model and local semantic index status. Available model counts are shown as supporting detail.");
    activitySetting(containerEl, "Active AI models", activeModelSummary(this.plugin.settings));
    activitySetting(containerEl, "Semantic index", indexSummary(this.plugin));
    activitySetting(containerEl, "Index files", indexFilesSummary(this.plugin));
    activitySetting(containerEl, "Available models", availableModelSummary(this.plugin.settings));
    settingsHeading(containerEl, "Workflow Activity");
    activitySetting(containerEl, "Tracking timezone", `${deviceTimeZone()} using device-local timestamps.`);
    activitySetting(containerEl, "Todoist", `${this.plugin.settings.availableTodoistProjects?.length || 0} projects loaded. ${Object.keys(this.plugin.settings.taskCache || {}).length} synced task references.`);
    activitySetting(containerEl, "Task deduplication", `${this.plugin.settings.enableTaskDeduplication === false ? "Off" : "On"}. Last run: ${this.plugin.settings.taskDeduplicationLastRunSummary || "not yet checked"}.`);
    activitySetting(containerEl, "Reference rebuild", `Last rebuild: ${this.plugin.settings.lastReferenceRebuildAt || "Not yet rebuilt"}. Auto-rebuild: ${this.plugin.settings.autoRebuildReferences ? "on" : "off"}. Workers: ${referenceRebuildWorkerCount(this.plugin.settings)}. Last local candidates: ${this.plugin.settings.lastReferenceRebuildCandidateCount || 0}. OID-only tasks can recover Todoist IDs by exact task-name matching.`);
    activitySetting(containerEl, "Cloudflare email", `Last poll: ${this.plugin.settings.lastEmailPollAt || "Not yet polled"}. Auto-processing: ${this.plugin.settings.autoProcessEmails ? "on" : "off"}.`);
    activitySetting(containerEl, "Notes sync", `Last sync: ${this.plugin.settings.lastNoteAutoSyncAt || "Not yet synced"}. Auto-sync: ${this.plugin.settings.notesAutoSync ? "on" : "off"}. Workers: ${syncWorkerCount(this.plugin.settings)}.`);
    new Setting(containerEl).setName("Refresh").addButton((button) => button.setButtonText("Refresh").onClick(() => this.display()));
    settingsHeading(containerEl, "Activity Log Console", "Selectable local workflow log. Progress ticks stay in the status bar; starts, completions, failures, and notable skips are kept here.");
    const log = containerEl.createEl("pre", { cls: "semantic-todoist-activity-log" });
    log.setAttribute("tabindex", "0");
    log.setAttribute("aria-label", "Semantic Todoist Sync activity log");
    log.setText(activityLogText(this.plugin.settings));
  }

  renderScheduleToday(containerEl) {
    settingsHeading(containerEl, "Schedule Today's Tasks", "Plan today's highest-priority Todoist work into compact time blocks. Todoist remains the source of scheduled task times and durations.");
    toggleSetting(containerEl, "Enable scheduler", "Shows the Schedule Today's Tasks prompt action in the sidebar chooser and command palette.", this.plugin, "scheduleTodayEnabled");
    new Setting(containerEl).setName("Run scheduler preview").setDesc("Builds a preview only. Todoist is not updated until Apply is selected.").addButton((button) => button.setButtonText("Preview").setCta().onClick(() => this.plugin.openScheduleTodayPreview()));

    settingsHeading(containerEl, "Workday", "Controls the default time window and protected lunch block used for today's schedule.");
    timeSetting(containerEl, "Start time", "Start of the schedulable workday.", this.plugin, "scheduleTodayStartTime");
    timeSetting(containerEl, "End time", "End of the schedulable workday.", this.plugin, "scheduleTodayEndTime");
    timeSetting(containerEl, "Lunch starts", "Default lunch block start. The preview can manually override it.", this.plugin, "scheduleTodayLunchStartTime");
    numberSetting(containerEl, "Lunch length minutes", this.plugin, "scheduleTodayLunchMinutes");
    numberSetting(containerEl, "Minimum task block minutes", this.plugin, "scheduleTodayMinBlockMinutes");
    numberSetting(containerEl, "Maximum task block minutes", this.plugin, "scheduleTodayMaxBlockMinutes");
    numberSetting(containerEl, "Add-in flex minutes", this.plugin, "scheduleTodayAddWindowMinutes");

    settingsHeading(containerEl, "Task Selection", "Chooses which open Todoist tasks are considered before the deterministic scheduler picks what fits today.");
    toggleSetting(containerEl, "Include overdue tasks", "Include open tasks due before today.", this.plugin, "scheduleTodayIncludeOverdue");
    numberSetting(containerEl, "Due window days", this.plugin, "scheduleTodayDueWindowDays");
    toggleSetting(containerEl, "Include subtasks", "Allow subtasks to be scheduled directly.", this.plugin, "scheduleTodayIncludeSubtasks");
    toggleSetting(containerEl, "Independent subtasks", "Allow subtasks such as reviews and follow-ups to move independently from the parent.", this.plugin, "scheduleTodayAllowIndependentSubtasks");
    textSetting(containerEl, "Excluded labels", "Comma-separated Todoist labels skipped by the scheduler.", this.plugin, "scheduleTodayExcludedLabels");

    settingsHeading(containerEl, "Scheduling Weights", "Simple importance controls for how the deterministic scheduler ranks eligible tasks.");
    scheduleWeightSetting(containerEl, "Todoist priority", this.plugin, "scheduleTodayWeightTodoistPriority");
    scheduleWeightSetting(containerEl, "Deadline proximity", this.plugin, "scheduleTodayWeightDeadlineProximity");
    scheduleWeightSetting(containerEl, "Overdue status", this.plugin, "scheduleTodayWeightOverdue");
    scheduleWeightSetting(containerEl, "Due date proximity", this.plugin, "scheduleTodayWeightDueDateProximity");
    scheduleWeightSetting(containerEl, "Semantic urgency", this.plugin, "scheduleTodayWeightSemanticUrgency");
    scheduleWeightSetting(containerEl, "Note recency", this.plugin, "scheduleTodayWeightNoteRecency");
    scheduleWeightSetting(containerEl, "Parent/subtask dependency", this.plugin, "scheduleTodayWeightParentDependency");

    settingsHeading(containerEl, "Safety", "Existing timed tasks stay fixed by default. Deadlines are preserved. The last applied schedule can be undone.");
    new Setting(containerEl).setName("Undo last applied schedule").setDesc(this.plugin.settings.scheduleTodayLastUndo?.at ? `Last applied: ${this.plugin.settings.scheduleTodayLastUndo.at}` : "No applied schedule to undo.").addButton((button) => button.setButtonText("Undo").onClick(() => this.plugin.undoLastScheduleToday(true)));
  }

  renderTaskDeduplication(containerEl) {
    settingsHeading(containerEl, "Task Deduplication", "Checks generated note and email tasks against the local Todoist reference table before creating anything new.");
    toggleSetting(containerEl, "Enable task deduplication", "Enabled by default. Local scoring identifies likely duplicate candidates; AI-mediated deduplication must be enabled to merge or update tasks.", this.plugin, "enableTaskDeduplication");
    taskDeduplicationStrictnessSetting(containerEl, this.plugin);
    toggleSetting(containerEl, "Merge labels additively", "Keep existing Todoist labels and add newly generated labels. Turn off only if newer generated task labels should replace the existing label set.", this.plugin, "taskDeduplicationMergeLabelsAdditive");
    toggleSetting(containerEl, "Allow explicit obsolete subtask removal", "Only omit a previously linked subtask when newer source text clearly says it is obsolete, no longer needed, or should be removed.", this.plugin, "taskDeduplicationAllowExplicitSubtaskRemoval");

    settingsHeading(containerEl, "AI-Mediated Deduplication", "Local matching nominates duplicate candidates first. The selected AI model must confirm and merge task details before any existing or same-batch task is updated.");
    toggleSetting(containerEl, "Enable AI-mediated deduplication", "Enabled by default. When off, dedupe runs local-only candidate detection, posts possible duplicates to chat for manual review, and leaves tasks unmerged because local-only dedupe may be less accurate and less efficient than AI-mediated merge review.", this.plugin, "enableAiAmbiguousTaskDeduplication");
    taskDeduplicationAiReviewSensitivitySetting(containerEl, this.plugin);
    taskDeduplicationAiModelSetting(containerEl, this.plugin);

    settingsHeading(containerEl, "Deduplication Merge Policy", "Plain-language rules used by local candidate matching and AI-mediated merge confirmation. You can also update this from the chat sidebar with an explicit dedupe policy request.");
    textAreaSetting(containerEl, "Deduplication policy", this.plugin, "taskDeduplicationPolicy", { compact: true });
    activitySetting(containerEl, "Policy impact", taskDeduplicationPolicyImpactText(this.plugin.settings));
    const updates = this.plugin.settings.taskDeduplicationPolicyUpdates || [];
    activitySetting(containerEl, "Recent chat policy updates", updates.length ? updates.map((entry) => `${entry.at}: ${entry.instruction}`).join("\n") : "No chat policy updates yet.");
    activitySetting(containerEl, "Last task deduplication run", this.plugin.settings.taskDeduplicationLastRunSummary || "No task generation run has checked duplicates yet.");
    new Setting(containerEl).setName("Reset policy").setDesc("Restores the default conservative merge policy.").addButton((button) => button.setButtonText("Reset").onClick(async () => {
      this.plugin.settings.taskDeduplicationPolicy = DEFAULT_TASK_DEDUPLICATION_POLICY;
      this.plugin.recordTaskDeduplicationPolicyUpdate("Reset from settings.");
      await this.plugin.saveSettings();
      this.display();
    }));
  }

  renderReferences(containerEl) {
    containerEl.createEl("h3", { text: "Todoist References" });
    containerEl.createDiv({ text: "Local OID table used to connect Obsidian task lines to Todoist tasks. Todoist IDs are stored here only, not in note text." });
    settingsHeading(containerEl, "Automatic Rebuild", "Low-frequency read-only reconciliation for the local OID table. The local vault is scanned first, and Todoist is only read when references changed or a manual rebuild is run.");
    toggleSetting(containerEl, "Automatically rebuild reference table", "Runs separately from note task syncing while Obsidian is open.", this.plugin, "autoRebuildReferences");
    numberSetting(containerEl, "Reference rebuild interval minutes", this.plugin, "referenceRebuildIntervalMinutes");
    numberSetting(containerEl, "Reference rebuild worker count", this.plugin, "referenceRebuildWorkerCount");
    numberSetting(containerEl, "Todoist snapshot cache minutes", this.plugin, "todoistSnapshotCacheMinutes");
    new Setting(containerEl).setName("Last automatic rebuild").setDesc(this.plugin.settings.lastReferenceRebuildAt || "Not yet rebuilt.");
    const rebuildSetting = new Setting(containerEl).setName("Rebuild local reference table").setDesc("Read-only Todoist reconciliation. Scans vault task references, rebuilds the local OID table from Todoist, and recovers missing Todoist IDs for OID-only note tasks by exact task-name matching. It does not create, update, complete, or delete Todoist tasks.").addButton((button) => button.setButtonText("Rebuild").setCta().onClick(async () => {
      try {
        await this.plugin.rebuildTodoistReferenceTable(true);
        this.display();
      } catch {}
    })).addButton((button) => button.setButtonText("Recover IDs").onClick(async () => {
      try {
        await this.plugin.recoverTodoistIdsFromTaskNames(true);
        this.display();
      } catch {}
    }));
    rebuildSetting.settingEl.addClass("semantic-todoist-reference-action-setting");
    new Setting(containerEl).setName("Refresh").addButton((button) => button.setButtonText("Refresh").onClick(() => this.display()));
    const rows = referenceRows(this.plugin.settings);
    containerEl.createDiv({ text: `${rows.length} local reference${rows.length === 1 ? "" : "s"}.` });
    const wrapper = containerEl.createDiv({ cls: "semantic-todoist-reference-table-wrap" });
    const table = wrapper.createEl("table", { cls: "semantic-todoist-reference-table" });
    const thead = table.createEl("thead");
    const header = thead.createEl("tr");
    for (const label of ["OID", "Todoist ID", "Task", "Priority", "Date", "Scheduled", "Duration", "Deadline", "Project", "Project ID", "Section", "Section ID", "Parent OID", "Parent Todoist ID", "Parent Task", "Note References", "Description", "Path", "Status"]) {
      header.createEl("th", { text: label });
    }
    const tbody = table.createEl("tbody");
    for (const row of rows) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: row.oid });
      tr.createEl("td", { text: row.todoistId });
      tr.createEl("td", { text: row.task });
      tr.createEl("td", { text: row.priority });
      tr.createEl("td", { text: row.date });
      tr.createEl("td", { text: row.scheduled });
      tr.createEl("td", { text: row.duration });
      tr.createEl("td", { text: row.deadline });
      tr.createEl("td", { text: row.project });
      tr.createEl("td", { text: row.projectId });
      tr.createEl("td", { text: row.section });
      tr.createEl("td", { text: row.sectionId });
      tr.createEl("td", { text: row.parentOid });
      tr.createEl("td", { text: row.parentTodoistId });
      tr.createEl("td", { text: row.parentTask });
      tr.createEl("td", { text: row.noteRefs });
      tr.createEl("td", { text: row.description });
      tr.createEl("td", { text: row.path });
      tr.createEl("td", { text: row.status });
    }
  }
}

class ScheduleTodayModal extends Modal {
  constructor(app, plugin, preview) {
    super(app);
    this.plugin = plugin;
    this.preview = preview || emptyScheduleTodayPreview(scheduleTodayConfig(plugin.settings));
    this.draggedId = "";
    this.draggedPayload = null;
    this.slotHeight = 28;
  }

  onOpen() {
    this.modalEl.addClass("semantic-todoist-modal");
    this.modalEl.addClass("semantic-todoist-schedule-modal");
    this.contentEl.addClass("semantic-todoist-modal-content");
    this.render();
  }

  onClose() {
    this.contentEl.empty();
  }

  scheduleItems() {
    return (this.preview.fixed || []).concat(this.preview.scheduled || [])
      .sort((a, b) => a.startMinutes - b.startMinutes || String(a.content).localeCompare(String(b.content)));
  }

  render(options = {}) {
    const { contentEl } = this;
    const scrollState = options.preserveScroll === false ? null : this.captureScrollState(options.anchorItemId || "");
    contentEl.empty();
    const config = this.preview.config || scheduleTodayConfig(this.plugin.settings);
    refreshScheduleSuggestions(this.preview);
    const header = contentEl.createDiv({ cls: "semantic-todoist-schedule-header" });
    header.createEl("h2", { text: "Schedule Today's Tasks" });
    header.createDiv({ text: `${config.today} | ${minutesToClock(config.startMinutes)}-${minutesToClock(config.endMinutes)} | ${config.chunkMinutes} min chunks` });
    if (this.preview.message) contentEl.createDiv({ cls: "semantic-todoist-schedule-empty", text: this.preview.message });
    const summary = contentEl.createDiv({ cls: "semantic-todoist-schedule-summary" });
    const removedItems = removedScheduleItems(this.preview);
    const notScheduledCount = (this.preview.unscheduled?.length || 0) + removedItems.length;
    summary.createSpan({ text: `${this.preview.scheduled.length} scheduled` });
    summary.createSpan({ text: `${this.preview.fixed.length} fixed` });
    summary.createSpan({ text: `${notScheduledCount} not scheduled` });
    summary.createSpan({ text: `${this.preview.splitSubtasks.length} continuation${this.preview.splitSubtasks.length === 1 ? "" : "s"}` });

    const timeline = contentEl.createDiv({ cls: "semantic-todoist-schedule-timeline" });
    timeline.style.setProperty("--schedule-slot-height", `${this.slotHeight}px`);
    const totalSlots = Math.max(1, Math.ceil((config.endMinutes - config.startMinutes) / config.chunkMinutes));
    timeline.style.height = `${totalSlots * this.slotHeight}px`;
    for (let slot = 0; slot < totalSlots; slot += 1) {
      const slotStart = config.startMinutes + slot * config.chunkMinutes;
      const row = timeline.createDiv({ cls: "semantic-todoist-schedule-slot" });
      row.style.top = `${slot * this.slotHeight}px`;
      row.dataset.minutes = String(slotStart);
      row.createSpan({ cls: "semantic-todoist-schedule-time", text: minutesToClock(slotStart) });
      if (rangesOverlap(slotStart, slotStart + config.chunkMinutes, config.lunchStartMinutes, config.lunchEndMinutes)) row.addClass("is-lunch");
      row.addEventListener("dragover", (event) => {
        if (this.readDragPayload(event).id) event.preventDefault();
      });
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        this.dropOnTimeline(slotStart, event);
      });
    }
    for (const item of this.scheduleItems()) this.renderScheduleBlock(timeline, item, config);

    if (this.preview.suggestions?.length || this.preview.unscheduled?.length) {
      const unscheduled = contentEl.createDiv({ cls: "semantic-todoist-schedule-list semantic-todoist-schedule-suggestions" });
      unscheduled.createEl("h3", { text: "Suggested swaps" });
      if (this.preview.suggestions?.length) {
        for (const item of this.preview.suggestions) this.renderSuggestionRow(unscheduled, item);
      } else if (this.preview.unscheduled?.length) {
        unscheduled.createDiv({ cls: "semantic-todoist-schedule-list-empty", text: "No unscheduled task currently fits by swapping one scheduled block." });
      }
    }
    if (removedItems.length) {
      const removed = contentEl.createDiv({ cls: "semantic-todoist-schedule-list semantic-todoist-schedule-removed" });
      removed.createEl("h3", { text: "Removed from today" });
      for (const item of removedItems.slice(-8)) this.renderRemovedRow(removed, item);
    }
    if (this.preview.splitSubtasks.length) {
      const split = contentEl.createDiv({ cls: "semantic-todoist-schedule-list" });
      split.createEl("h3", { text: "Next-workday continuations" });
      for (const item of this.preview.splitSubtasks) {
        split.createDiv({ text: `${item.content} - ${item.durationMinutes} min on ${datePart(item.scheduledDateTime)}` });
      }
    }
    const actions = contentEl.createDiv({ cls: "semantic-todoist-schedule-actions" });
    actions.createEl("button", { text: "Apply" }).onclick = async () => {
      await this.plugin.applyScheduleToday(this.preview);
      this.close();
    };
    actions.createEl("button", { text: "Undo last" }).onclick = async () => {
      await this.plugin.undoLastScheduleToday(true);
      this.close();
    };
    actions.createEl("button", { text: "Close" }).onclick = () => this.close();
    this.restoreScrollState(scrollState);
  }

  captureScrollState(anchorItemId = "") {
    if (!this.contentEl?.hasChildNodes?.()) return null;
    const timeline = this.contentEl.querySelector?.(".semantic-todoist-schedule-timeline") || null;
    const anchor = anchorItemId && timeline ? this.findRenderedScheduleBlock(timeline, anchorItemId) : null;
    return {
      contentScrollTop: Number(this.contentEl.scrollTop || 0),
      contentScrollLeft: Number(this.contentEl.scrollLeft || 0),
      timelineScrollTop: Number(timeline?.scrollTop || 0),
      timelineScrollLeft: Number(timeline?.scrollLeft || 0),
      anchorItemId: String(anchorItemId || ""),
      anchorOffsetTop: anchor && timeline ? anchor.getBoundingClientRect().top - timeline.getBoundingClientRect().top : null
    };
  }

  restoreScrollState(state) {
    if (!state) return;
    const restore = () => {
      if (!this.contentEl) return;
      const timeline = this.contentEl.querySelector?.(".semantic-todoist-schedule-timeline") || null;
      this.contentEl.scrollTop = state.contentScrollTop;
      this.contentEl.scrollLeft = state.contentScrollLeft;
      if (timeline) {
        timeline.scrollTop = state.timelineScrollTop;
        timeline.scrollLeft = state.timelineScrollLeft;
        const anchor = state.anchorItemId ? this.findRenderedScheduleBlock(timeline, state.anchorItemId) : null;
        if (anchor && Number.isFinite(state.anchorOffsetTop)) {
          const nextOffset = anchor.getBoundingClientRect().top - timeline.getBoundingClientRect().top;
          timeline.scrollTop += nextOffset - state.anchorOffsetTop;
        }
      }
    };
    restore();
    const schedule = typeof window !== "undefined" && window.requestAnimationFrame
      ? (callback) => window.requestAnimationFrame(callback)
      : typeof window !== "undefined" && window.setTimeout
        ? (callback) => window.setTimeout(callback, 0)
        : (callback) => setTimeout(callback, 0);
    schedule(restore);
  }

  findRenderedScheduleBlock(timeline, id) {
    const target = String(id || "");
    if (!target || !timeline?.querySelectorAll) return null;
    return Array.from(timeline.querySelectorAll(".semantic-todoist-schedule-block"))
      .find((block) => String(block.dataset?.id || "") === target) || null;
  }

  renderSuggestionRow(container, item) {
    const row = container.createDiv({ cls: "semantic-todoist-schedule-suggestion" });
    row.draggable = true;
    row.dataset.id = item.id;
    row.addEventListener("dragstart", (event) => this.startDrag(event, "suggestion", item.id));
    row.addEventListener("dragend", () => this.clearDrag());
    const text = row.createDiv({ cls: "semantic-todoist-schedule-suggestion-text" });
    text.createDiv({ cls: "semantic-todoist-schedule-suggestion-title", text: shortTitle(item.content || "Task", 82) });
    text.createDiv({ cls: "semantic-todoist-schedule-suggestion-reason", text: item.rationale || item.reason || "Could fit by moving another scheduled block." });
    const button = row.createEl("button", { text: item.suggestionAction === "add" ? "Add in" : "Swap in" });
    button.onclick = (event) => {
      event.preventDefault();
      this.swapInSuggestion(item.id);
    };
  }

  renderRemovedRow(container, item) {
    const row = container.createDiv({ cls: "semantic-todoist-schedule-suggestion is-removed" });
    row.dataset.id = item.id;
    const text = row.createDiv({ cls: "semantic-todoist-schedule-suggestion-text" });
    text.createDiv({ cls: "semantic-todoist-schedule-suggestion-title", text: shortTitle(item.content || "Task", 82) });
    text.createDiv({ cls: "semantic-todoist-schedule-suggestion-reason", text: item.rationale || item.reason || "Removed manually from today's preview." });
    const button = row.createEl("button", { text: "Restore" });
    button.onclick = (event) => {
      event.preventDefault();
      this.restoreRemovedItem(item.id);
    };
  }

  startDrag(event, type, id) {
    const payload = { type, id: String(id || "") };
    this.draggedPayload = payload;
    this.draggedId = payload.id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-semantic-todoist-schedule", JSON.stringify(payload));
      event.dataTransfer.setData("text/plain", `${type}:${payload.id}`);
    }
  }

  clearDrag() {
    this.draggedId = "";
    this.draggedPayload = null;
  }

  readDragPayload(event) {
    if (this.draggedPayload?.id) return this.draggedPayload;
    const fallback = { type: "scheduled", id: "" };
    const transfer = event?.dataTransfer;
    if (!transfer) return fallback;
    const typed = transfer.getData("application/x-semantic-todoist-schedule");
    if (typed) {
      try {
        const parsed = JSON.parse(typed);
        if (parsed?.id) return { type: parsed.type || "scheduled", id: String(parsed.id) };
      } catch (error) {
        console.debug("Schedule drag payload parse failed", error);
      }
    }
    const text = transfer.getData("text/plain") || "";
    const match = /^(suggestion|scheduled):(.+)$/.exec(text);
    if (match) return { type: match[1], id: match[2] };
    if (text) return { type: "scheduled", id: text };
    return fallback;
  }

  dropOnTimeline(startMinutes, event) {
    const payload = this.readDragPayload(event);
    if (!payload.id) return;
    if (payload.type === "suggestion") this.swapInSuggestion(payload.id, "", startMinutes);
    else this.dropScheduledAt(payload.id, startMinutes);
  }

  dropOnScheduleItem(target, event) {
    const payload = this.readDragPayload(event);
    if (!payload.id) return;
    if (payload.type === "suggestion") {
      this.swapInSuggestion(payload.id, target.id, target.startMinutes);
      return;
    }
    if (String(payload.id) === String(target.id)) return;
    this.dropScheduledAt(payload.id, target.startMinutes);
  }

  findSuggestion(id) {
    const target = String(id || "");
    return [
      ...(this.preview.suggestions || []),
      ...(this.preview.unscheduled || []),
      ...(this.preview.bumped || [])
    ].find((item) => String(item.id) === target);
  }

  swapInSuggestion(id, targetId = "", preferredStartMinutes = null) {
    const config = this.preview.config || scheduleTodayConfig(this.plugin.settings);
    this.preview.config = config;
    refreshScheduleSuggestions(this.preview);
    const suggestion = this.findSuggestion(id);
    if (!suggestion) return;
    const target = targetId ? this.movableItem(targetId) : null;
    if (targetId && !target) {
      new Notice("Fixed tasks cannot be swapped out from this preview.");
      return;
    }
    if (!targetId) {
      const addPlan = bestScheduleAddSlot(suggestion, this.preview, config, preferredStartMinutes);
      if (addPlan) {
        this.addSuggestionToSchedule(suggestion, addPlan);
        return;
      }
    }
    const bumped = target || bestScheduleSwapCandidate(suggestion, this.preview, config);
    if (!bumped) {
      new Notice("That task no longer fits by swapping one scheduled block.");
      return;
    }
    const blockDuration = suggestionScheduleBlockMinutes(suggestion, config, target);
    const desiredStart = Number.isFinite(Number(preferredStartMinutes)) ? Number(preferredStartMinutes) : bumped.startMinutes;
    const boundedStart = this.boundedStart(desiredStart, blockDuration);
    const blocksWithoutBumped = scheduleBlocksForPreview(this.preview, config, { excludeId: bumped.id });
    const start = target
      ? boundedStart
      : this.canPlaceScheduleBlock(bumped.id, boundedStart, blockDuration)
        ? boundedStart
        : findNearestOpenScheduleSlot(blocksWithoutBumped, blockDuration, config, boundedStart);
    if (start == null) {
      new Notice("That task no longer fits in today's open slots.");
      return;
    }
    this.preview.scheduled = (this.preview.scheduled || []).filter((item) => String(item.id) !== String(bumped.id));
    this.preview.unscheduled = (this.preview.unscheduled || []).filter((item) => String(item.id) !== String(suggestion.id));
    this.preview.bumped = (this.preview.bumped || []).filter((item) => String(item.id) !== String(suggestion.id));
    this.preview.removed = (this.preview.removed || []).filter((item) => String(item.id) !== String(suggestion.id));
    this.preview.splitSubtasks = (this.preview.splitSubtasks || []).filter((item) => {
      const sourceId = String(item.sourceTaskId || "");
      return sourceId !== String(bumped.id) && sourceId !== String(suggestion.id);
    });
    const scheduledSuggestion = schedulePreviewItem(suggestion, start, blockDuration, config, {
      promotedFromSuggestion: true,
      previewOrderChanged: true,
      scheduleBlockMinutes: blockDuration,
      totalDurationMinutes: suggestion.totalDurationMinutes || suggestion.durationMinutes || blockDuration
    });
    this.preview.scheduled.push(scheduledSuggestion);
    this.preview.scheduled.sort((a, b) => a.startMinutes - b.startMinutes || String(a.content).localeCompare(String(b.content)));
    const remainder = Math.max(0, Number(suggestion.totalDurationMinutes || suggestion.durationMinutes || 0) - blockDuration);
    if (remainder > 0) this.preview.splitSubtasks.push(scheduleContinuationSubtask(suggestion, remainder, config, this.plugin.settings));
    const bumpedItem = scheduleUnscheduledItem(bumped, bumped.durationMinutes, `Swapped out for ${shortTitle(suggestion.content || "task", 32)}`, config, {
      wasBumped: true,
      bumpedById: suggestion.id,
      removedAtMinutes: bumped.startMinutes,
      originalStartMinutes: bumped.originalStartMinutes ?? bumped.startMinutes,
      scheduleBlockMinutes: bumped.durationMinutes,
      totalDurationMinutes: bumped.totalDurationMinutes || bumped.durationMinutes,
      startMinutes: null,
      endMinutes: null,
      scheduledDateTime: "",
      rationale: `Swapped out from ${minutesToClock(bumped.startMinutes)}-${minutesToClock(bumped.endMinutes)} for ${shortTitle(suggestion.content || "task", 42)}.`
    });
    this.preview.bumped = (this.preview.bumped || []).filter((item) => String(item.id) !== String(bumped.id));
    this.preview.removed = (this.preview.removed || []).filter((item) => String(item.id) !== String(bumped.id));
    this.preview.removed.push(bumpedItem);
    refreshScheduleSuggestions(this.preview);
    this.render();
  }

  addSuggestionToSchedule(suggestion, addPlan) {
    const config = this.preview.config || scheduleTodayConfig(this.plugin.settings);
    const blockDuration = addPlan.durationMinutes || suggestionScheduleBlockMinutes(suggestion, config);
    this.preview.unscheduled = (this.preview.unscheduled || []).filter((item) => String(item.id) !== String(suggestion.id));
    this.preview.bumped = (this.preview.bumped || []).filter((item) => String(item.id) !== String(suggestion.id));
    this.preview.removed = (this.preview.removed || []).filter((item) => String(item.id) !== String(suggestion.id));
    this.preview.splitSubtasks = (this.preview.splitSubtasks || []).filter((item) => String(item.sourceTaskId || "") !== String(suggestion.id));
    const scheduledSuggestion = schedulePreviewItem(suggestion, addPlan.startMinutes, blockDuration, config, {
      promotedFromSuggestion: true,
      previewOrderChanged: true,
      addedFromOpenWindow: true,
      scheduleBlockMinutes: blockDuration,
      totalDurationMinutes: suggestion.totalDurationMinutes || suggestion.durationMinutes || blockDuration
    });
    this.preview.scheduled.push(scheduledSuggestion);
    this.preview.scheduled.sort((a, b) => a.startMinutes - b.startMinutes || String(a.content).localeCompare(String(b.content)));
    const remainder = Math.max(0, Number(suggestion.totalDurationMinutes || suggestion.durationMinutes || 0) - blockDuration);
    if (remainder > 0) this.preview.splitSubtasks.push(scheduleContinuationSubtask(suggestion, remainder, config, this.plugin.settings));
    refreshScheduleSuggestions(this.preview);
    this.render();
  }

  restoreBumpedItem(id) {
    this.restoreRemovedItem(id);
  }

  removeScheduledItem(id) {
    const config = this.preview.config || scheduleTodayConfig(this.plugin.settings);
    this.preview.config = config;
    const item = this.movableItem(id);
    if (!item) return;
    this.preview.scheduled = (this.preview.scheduled || []).filter((scheduled) => String(scheduled.id) !== String(item.id));
    this.preview.splitSubtasks = (this.preview.splitSubtasks || []).filter((split) => String(split.sourceTaskId || "") !== String(item.id));
    const totalDuration = Number(item.totalDurationMinutes || item.durationMinutes || 0);
    const removedItem = scheduleUnscheduledItem(item, totalDuration, "Removed from today's preview", config, {
      wasRemoved: true,
      removedByUser: true,
      removedAtMinutes: item.startMinutes,
      originalStartMinutes: item.originalStartMinutes ?? item.startMinutes,
      scheduleBlockMinutes: item.durationMinutes,
      totalDurationMinutes: totalDuration,
      startMinutes: null,
      endMinutes: null,
      scheduledDateTime: "",
      rationale: `Removed from ${minutesToClock(item.startMinutes)}-${minutesToClock(item.endMinutes)}. This leaves that time open unless you restore or move another task there.`
    });
    this.preview.removed = (this.preview.removed || []).filter((removed) => String(removed.id) !== String(item.id));
    this.preview.removed.push(removedItem);
    refreshScheduleSuggestions(this.preview);
    this.render();
  }

  restoreRemovedItem(id) {
    const config = this.preview.config || scheduleTodayConfig(this.plugin.settings);
    this.preview.config = config;
    const target = String(id || "");
    const item = removedScheduleItems(this.preview).find((removed) => String(removed.id) === target);
    if (!item) return;
    const duration = suggestionScheduleBlockMinutes(item, config);
    const preferredStart = Number.isFinite(Number(item.removedAtMinutes)) ? Number(item.removedAtMinutes) : Number(item.originalStartMinutes);
    const boundedStart = this.boundedStart(Number.isFinite(preferredStart) ? preferredStart : config.startMinutes, duration);
    const start = this.canPlaceScheduleBlock(item.id, boundedStart, duration)
      ? boundedStart
      : findNearestOpenScheduleSlot(scheduleBlocksForPreview(this.preview, config, { excludeId: item.id }), duration, config, boundedStart);
    if (start == null) {
      new Notice("No open slot fits that removed task.");
      return;
    }
    this.preview.removed = (this.preview.removed || []).filter((removed) => String(removed.id) !== target);
    this.preview.bumped = (this.preview.bumped || []).filter((removed) => String(removed.id) !== target);
    const restored = schedulePreviewItem(item, start, duration, config, {
      restoredFromRemoved: true,
      previewOrderChanged: true,
      scheduleBlockMinutes: duration,
      totalDurationMinutes: item.totalDurationMinutes || item.durationMinutes || duration
    });
    this.preview.scheduled.push(restored);
    const remainder = Math.max(0, Number(restored.totalDurationMinutes || restored.durationMinutes || 0) - restored.durationMinutes);
    if (remainder > 0) {
      this.preview.splitSubtasks = (this.preview.splitSubtasks || []).filter((split) => String(split.sourceTaskId || "") !== String(restored.id));
      this.preview.splitSubtasks.push(scheduleContinuationSubtask(restored, remainder, config, this.plugin.settings));
    }
    this.preview.scheduled.sort((a, b) => a.startMinutes - b.startMinutes || String(a.content).localeCompare(String(b.content)));
    refreshScheduleSuggestions(this.preview);
    this.render();
  }

  renderScheduleBlock(timeline, item, config) {
    const block = timeline.createDiv({ cls: "semantic-todoist-schedule-block" });
    if (item.fixed) block.addClass("is-fixed");
    if (item.overlapsLunch) block.addClass("has-lunch-overlap");
    if (item.durationMinutes <= config.chunkMinutes) block.addClass("is-short");
    block.style.top = `${((item.startMinutes - config.startMinutes) / config.chunkMinutes) * this.slotHeight}px`;
    block.style.height = `${Math.max(this.slotHeight, (item.durationMinutes / config.chunkMinutes) * this.slotHeight)}px`;
    block.draggable = !item.fixed;
    block.dataset.id = item.id;
    block.addEventListener("dragstart", (event) => {
      if (item.fixed) return;
      this.startDrag(event, "scheduled", item.id);
    });
    block.addEventListener("dragend", () => this.clearDrag());
    block.addEventListener("dragover", (event) => {
      const payload = this.readDragPayload(event);
      if (!payload.id || (payload.type === "scheduled" && String(payload.id) === String(item.id))) return;
      event.preventDefault();
    });
    block.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.dropOnScheduleItem(item, event);
    });
    const main = block.createDiv({ cls: "semantic-todoist-schedule-block-main" });
    const dependentText = item.dependentSubtasks?.length ? ` | +${item.dependentSubtasks.length} subtask${item.dependentSubtasks.length === 1 ? "" : "s"}` : "";
    const metaText = `${minutesToClock(item.startMinutes)}-${minutesToClock(item.endMinutes)} | ${item.durationMinutes} min${item.fixed ? " | fixed" : ""}${dependentText}`;
    const title = main.createDiv({ cls: "semantic-todoist-schedule-block-title", text: item.content });
    title.title = `${item.content} | ${metaText}`;
    main.createDiv({ cls: "semantic-todoist-schedule-block-meta", text: metaText });
    const controls = block.createDiv({ cls: "semantic-todoist-schedule-block-controls" });
    const moveControls = controls.createDiv({ cls: "semantic-todoist-schedule-control-group semantic-todoist-schedule-move-controls" });
    moveControls.createEl("button", { text: "↑", attr: { "aria-label": "Move earlier", title: "Move earlier" } }).onclick = (event) => {
      event.preventDefault();
      this.moveItem(item.id, -config.chunkMinutes);
    };
    moveControls.createEl("button", { text: "↓", attr: { "aria-label": "Move later", title: "Move later" } }).onclick = (event) => {
      event.preventDefault();
      this.moveItem(item.id, config.chunkMinutes);
    };
    const durationControls = controls.createDiv({ cls: "semantic-todoist-schedule-control-group semantic-todoist-schedule-duration-controls" });
    durationControls.createEl("button", { text: "-", attr: { "aria-label": "Shorten task", title: "Shorten task" } }).onclick = (event) => {
      event.preventDefault();
      this.adjustDuration(item.id, -scheduleDurationStepMinutes(config));
    };
    durationControls.createEl("button", { text: "+", attr: { "aria-label": "Lengthen task", title: "Lengthen task" } }).onclick = (event) => {
      event.preventDefault();
      this.adjustDuration(item.id, scheduleDurationStepMinutes(config));
    };
    if (!item.fixed) {
      const removeControls = controls.createDiv({ cls: "semantic-todoist-schedule-remove-controls" });
      removeControls.createEl("button", { cls: "semantic-todoist-schedule-remove-button", text: "×", attr: { "aria-label": "Remove from today", title: "Remove from today" } }).onclick = (event) => {
        event.preventDefault();
        this.removeScheduledItem(item.id);
      };
    }
    if (!item.fixed) {
      const resize = block.createDiv({ cls: "semantic-todoist-schedule-resize", text: "resize" });
      resize.addEventListener("pointerdown", (event) => this.startResize(event, item.id));
    }
  }

  movableItem(id) {
    return (this.preview.scheduled || []).find((item) => String(item.id) === String(id) && !item.fixed);
  }

  setItemStart(id, startMinutes) {
    const item = this.movableItem(id);
    if (!item) return;
    this.dropScheduledAt(item.id, startMinutes);
  }

  boundedStart(startMinutes, durationMinutesValue) {
    const config = this.preview.config;
    const duration = roundToScheduleChunk(durationMinutesValue, config) || config.minBlockMinutes;
    const raw = Number(startMinutes);
    const start = snapScheduleStart(Number.isFinite(raw) ? raw : config.startMinutes, config);
    return Math.max(config.startMinutes, Math.min(config.endMinutes - duration, start));
  }

  canPlaceScheduleBlock(excludeId, startMinutes, durationMinutesValue) {
    const config = this.preview.config;
    const duration = roundToScheduleChunk(durationMinutesValue, config) || config.minBlockMinutes;
    if (!Number.isFinite(startMinutes) || startMinutes < config.startMinutes || startMinutes + duration > config.endMinutes) return false;
    return !scheduleBlocksForPreview(this.preview, config, { excludeId }).some((block) => rangesOverlap(startMinutes, startMinutes + duration, block.startMinutes, block.endMinutes));
  }

  fitDurationAtStart(item, desiredMinutes) {
    const config = this.preview.config;
    const step = scheduleDurationStepMinutes(config);
    let duration = Math.max(config.minBlockMinutes, Math.min(config.maxBlockMinutes, roundToScheduleChunk(desiredMinutes, config)));
    while (duration >= config.minBlockMinutes) {
      if (this.canPlaceScheduleBlock(item.id, item.startMinutes, duration)) return duration;
      duration -= step;
    }
    return item.durationMinutes;
  }

  placeScheduleItem(item, startMinutes) {
    const config = this.preview.config;
    const bounded = this.boundedStart(startMinutes, item.durationMinutes);
    item.startMinutes = bounded;
    item.endMinutes = bounded + item.durationMinutes;
    item.scheduledDateTime = localDateTimeString(config.today, bounded);
    item.overlapsLunch = rangesOverlap(item.startMinutes, item.endMinutes, config.lunchStartMinutes, config.lunchEndMinutes);
    item.previewOrderChanged = item.startMinutes !== item.originalStartMinutes;
  }

  dropScheduledAt(id, startMinutes) {
    const item = this.movableItem(id);
    if (!item) return false;
    const bounded = this.boundedStart(startMinutes, item.durationMinutes);
    const direction = bounded >= item.startMinutes ? 1 : -1;
    if (this.placeScheduledWithDisplacement(item.id, bounded, direction)) {
      return true;
    }
    new Notice("No open slot fits that task block.");
    return false;
  }

  placeScheduledWithDisplacement(id, startMinutes, direction = 1) {
    const config = this.preview.config;
    const item = this.movableItem(id);
    if (!item) return false;
    const snapshot = this.snapshotScheduledItems();
    const anchorStart = this.boundedStart(startMinutes, item.durationMinutes);
    const anchorDuration = roundToScheduleChunk(item.durationMinutes, config) || config.minBlockMinutes;
    const anchorEnd = anchorStart + anchorDuration;
    const immovableBlocks = scheduleImmovableBlocks(this.preview, config);
    if (immovableBlocks.some((block) => rangesOverlap(anchorStart, anchorEnd, block.startMinutes, block.endMinutes))) return false;
    const ordered = (this.preview.scheduled || []).slice()
      .sort((a, b) => a.startMinutes - b.startMinutes || String(a.content).localeCompare(String(b.content)));
    const source = ordered.find((scheduled) => String(scheduled.id) === String(item.id));
    if (!source) return false;
    const withoutSource = ordered.filter((scheduled) => String(scheduled.id) !== String(item.id));
    const sign = direction >= 0 ? 1 : -1;
    let insertIndex;
    if (sign >= 0) {
      insertIndex = withoutSource.findIndex((scheduled) => scheduled.startMinutes > anchorStart);
    } else {
      insertIndex = withoutSource.findIndex((scheduled) => scheduled.startMinutes >= anchorStart);
    }
    if (insertIndex < 0) insertIndex = withoutSource.length;
    const sequence = withoutSource.slice();
    sequence.splice(insertIndex, 0, source);
    const anchorIndex = sequence.findIndex((scheduled) => String(scheduled.id) === String(source.id));
    this.placeScheduleItem(source, anchorStart);
    const ok = this.packScheduledSequenceAroundAnchor(sequence, anchorIndex);
    if (!ok) {
      this.restoreScheduledSnapshot(snapshot);
      return false;
    }
    this.preview.scheduled = sequence
      .slice()
      .sort((a, b) => a.startMinutes - b.startMinutes || String(a.content).localeCompare(String(b.content)));
    this.render();
    return true;
  }

  packScheduledSequenceAroundAnchor(sequence, anchorIndex) {
    const config = this.preview.config;
    const anchor = sequence?.[anchorIndex];
    if (!anchor) return false;
    const immovableBlocks = scheduleImmovableBlocks(this.preview, config);
    const anchorBlock = { startMinutes: anchor.startMinutes, endMinutes: anchor.endMinutes, id: anchor.id, type: "scheduled" };
    if (immovableBlocks.some((block) => rangesOverlap(anchorBlock.startMinutes, anchorBlock.endMinutes, block.startMinutes, block.endMinutes))) return false;
    const beforeBlocks = immovableBlocks.concat(anchorBlock);
    let beforeCursor = anchor.startMinutes;
    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
      const item = sequence[index];
      const duration = roundToScheduleChunk(item.durationMinutes, config) || config.minBlockMinutes;
      const desired = Math.min(Number(item.startMinutes || config.startMinutes), beforeCursor - duration);
      const start = latestOpenScheduleStartBefore(beforeBlocks, duration, config, desired, beforeCursor);
      if (start == null) return false;
      this.placeScheduleItem(item, start);
      beforeBlocks.push({ startMinutes: item.startMinutes, endMinutes: item.endMinutes, id: item.id, type: "scheduled" });
      beforeCursor = item.startMinutes;
    }
    const afterBlocks = immovableBlocks.concat(anchorBlock);
    let afterCursor = anchor.endMinutes;
    for (let index = anchorIndex + 1; index < sequence.length; index += 1) {
      const item = sequence[index];
      const duration = roundToScheduleChunk(item.durationMinutes, config) || config.minBlockMinutes;
      const desired = Math.max(Number(item.startMinutes || config.startMinutes), afterCursor);
      const start = earliestOpenScheduleStartAfter(afterBlocks, duration, config, desired, afterCursor);
      if (start == null) return false;
      this.placeScheduleItem(item, start);
      afterBlocks.push({ startMinutes: item.startMinutes, endMinutes: item.endMinutes, id: item.id, type: "scheduled" });
      afterCursor = item.endMinutes;
    }
    return true;
  }

  snapshotScheduledItems() {
    return (this.preview.scheduled || []).map((item) => ({
      item,
      startMinutes: item.startMinutes,
      endMinutes: item.endMinutes,
      scheduledDateTime: item.scheduledDateTime,
      overlapsLunch: item.overlapsLunch,
      previewOrderChanged: item.previewOrderChanged
    }));
  }

  restoreScheduledSnapshot(snapshot) {
    for (const state of snapshot || []) {
      state.item.startMinutes = state.startMinutes;
      state.item.endMinutes = state.endMinutes;
      state.item.scheduledDateTime = state.scheduledDateTime;
      state.item.overlapsLunch = state.overlapsLunch;
      state.item.previewOrderChanged = state.previewOrderChanged;
    }
  }

  moveItem(id, deltaMinutes) {
    const item = this.movableItem(id);
    if (!item) return;
    const config = this.preview.config;
    const step = deltaMinutes >= 0 ? config.chunkMinutes : -config.chunkMinutes;
    const minStart = config.startMinutes;
    const maxStart = config.endMinutes - item.durationMinutes;
    for (let start = item.startMinutes + step; step > 0 ? start <= maxStart : start >= minStart; start += step) {
      if (this.placeScheduledWithDisplacement(item.id, start, step >= 0 ? 1 : -1)) return;
    }
    new Notice(step > 0 ? "No later open slot fits that task block." : "No earlier open slot fits that task block.");
  }

  adjustDuration(id, deltaMinutes) {
    const config = this.preview.config;
    const item = this.movableItem(id);
    if (!item) return;
    const requested = Math.max(config.minBlockMinutes, Math.min(config.maxBlockMinutes, roundToScheduleChunk(item.durationMinutes + deltaMinutes, config)));
    const next = this.fitDurationAtStart(item, requested);
    if (next === item.durationMinutes && requested !== next) {
      new Notice("No open room to extend that task block.");
      return;
    }
    item.durationMinutes = next;
    item.endMinutes = item.startMinutes + next;
    item.scheduledDateTime = localDateTimeString(config.today, item.startMinutes);
    item.overlapsLunch = rangesOverlap(item.startMinutes, item.endMinutes, config.lunchStartMinutes, config.lunchEndMinutes);
    item.previewDurationChanged = item.durationMinutes !== item.originalDurationMinutes;
    this.render({ anchorItemId: item.id });
  }

  startResize(event, id) {
    event.preventDefault();
    const item = this.movableItem(id);
    if (!item) return;
    const startY = event.clientY;
    const startDuration = item.durationMinutes;
    const config = this.preview.config;
    let changed = false;
    const move = (moveEvent) => {
      const step = scheduleDurationStepMinutes(config);
      const pixelsPerStep = this.slotHeight * (step / Math.max(1, config.chunkMinutes || step));
      const deltaSteps = Math.round((moveEvent.clientY - startY) / Math.max(1, pixelsPerStep));
      const next = startDuration + deltaSteps * step;
      const requested = Math.max(config.minBlockMinutes, Math.min(config.maxBlockMinutes, roundToScheduleChunk(next, config)));
      const bounded = this.fitDurationAtStart(item, requested);
      if (bounded === item.durationMinutes) return;
      item.durationMinutes = bounded;
      item.endMinutes = item.startMinutes + bounded;
      item.overlapsLunch = rangesOverlap(item.startMinutes, item.endMinutes, config.lunchStartMinutes, config.lunchEndMinutes);
      item.previewDurationChanged = item.durationMinutes !== item.originalDurationMinutes;
      changed = true;
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      if (changed) this.render({ anchorItemId: item.id });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }
}

class PromptModal extends Modal {
  constructor(app, title, onSubmit) {
    super(app);
    this.title = title;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("semantic-todoist-modal");
    this.modalEl.addClass("semantic-todoist-prompt-modal");
    contentEl.addClass("semantic-todoist-modal-content");
    contentEl.empty();
    contentEl.createEl("h2", { text: this.title });
    const input = contentEl.createEl("textarea", { placeholder: "Ask AI..." });
    input.addClass("semantic-todoist-prompt-textarea");
    new Setting(contentEl).addButton((button) => button.setButtonText("Send").setCta().onClick(async () => {
      const value = input.value.trim();
      if (!value) return;
      this.close();
      await this.onSubmit(value);
    }));
    input.focus();
  }

  onClose() {
    this.contentEl.empty();
  }
}

class TaskTemplateModal extends Modal {
  constructor(app, templates, onSubmit, defaults = {}) {
    super(app);
    this.templates = templates;
    this.onSubmit = onSubmit;
    this.selectedIndex = 0;
  }

  selectedTemplate() {
    return this.templates[this.selectedIndex] || {};
  }

  selectedTemplateCreatesTasks() {
    return this.selectedTemplate().createTasks !== false;
  }

  selectedTemplateChoices(template = this.selectedTemplate()) {
    if (isScheduleTodayTemplate(template)) {
      return { action: "schedule-today", createsTasks: false, insertIntoNote: false, syncAfterInsert: false };
    }
    const createsTasks = template.createTasks !== false;
    const insertIntoNote = template.insertResponse !== false;
    const syncAfterInsert = createsTasks && insertIntoNote && template.syncAfterInsert === true;
    return { createsTasks, insertIntoNote, syncAfterInsert };
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("semantic-todoist-modal");
    this.modalEl.addClass("semantic-todoist-template-modal");
    contentEl.addClass("semantic-todoist-modal-content");
    contentEl.empty();
    contentEl.createEl("h2", { text: "Run Prompts" });
    if (!this.templates.length) {
      contentEl.createDiv({ text: "No prompts found." });
      return;
    }
    const preview = contentEl.createEl("textarea");
    preview.addClass("semantic-todoist-template-preview");
    preview.value = this.templates[0].prompt;
    const modeEl = contentEl.createDiv({ cls: "semantic-todoist-template-mode" });
    const choicesEl = contentEl.createDiv({ cls: "semantic-todoist-template-choices" });
    const updateMode = () => {
      const template = this.selectedTemplate();
      const choices = this.selectedTemplateChoices(template);
      if (choices.action === "schedule-today") {
        modeEl.setText("Prompt: schedule today");
        choicesEl.setText("Opens scheduler preview. Settings stay authoritative; this prompt coordinates duration estimates and split suggestions.");
        return;
      }
      modeEl.setText(choices.createsTasks ? "Prompt: generates tasks" : "Prompt: response");
      choicesEl.setText(`Generate tasks: ${yesNo(choices.createsTasks)} | Insert: ${yesNo(choices.insertIntoNote)} | Sync to Todoist: ${yesNo(choices.syncAfterInsert)}`);
    };
    new Setting(contentEl).setName("Prompt").addDropdown((dropdown) => {
      this.templates.forEach((template, index) => dropdown.addOption(String(index), `${template.name} (${template.source || "prompt"})`));
      dropdown.onChange((value) => {
        this.selectedIndex = Number(value);
        preview.value = this.templates[this.selectedIndex].prompt;
        updateMode();
      });
    });
    updateMode();
    new Setting(contentEl).addButton((button) => button.setButtonText("Run").setCta().onClick(async () => {
      this.close();
      const template = Object.assign({}, this.templates[this.selectedIndex], { prompt: preview.value });
      const choices = this.selectedTemplateChoices(template);
      await this.onSubmit({ template, insertIntoNote: choices.insertIntoNote, syncAfterInsert: choices.syncAfterInsert });
    }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

function settingsHeading(containerEl, name, desc = "") {
  const heading = containerEl.createDiv({ cls: "semantic-todoist-settings-heading" });
  heading.createEl("h3", { text: name });
  if (desc) heading.createDiv({ text: desc });
}

function taskInstructionSettings(containerEl, plugin, heading, prefix) {
  const desc = prefix === "email"
    ? "Plain-language instructions used only when creating tasks from Cloudflare email content."
    : "Plain-language instructions used only when creating tasks from notes, selected text, or note prompts.";
  settingsHeading(containerEl, heading, desc);
  const compact = { compact: true };
  textAreaSetting(containerEl, "Main Task", plugin, `${prefix}MainTaskInstructions`, compact);
  textAreaSetting(containerEl, "Subtasks", plugin, `${prefix}SubtaskInstructions`, compact);
  textAreaSetting(containerEl, "Section Titles", plugin, `${prefix}SectionTitleInstructions`, compact);
  textAreaSetting(containerEl, "Dates and Deadlines", plugin, `${prefix}DateInstructions`, compact);
  textAreaSetting(containerEl, "Tags", plugin, `${prefix}TagInstructions`, compact);
  textAreaSetting(containerEl, "Priorities", plugin, `${prefix}PriorityInstructions`, compact);
  textAreaSetting(containerEl, "Descriptions and links", plugin, `${prefix}DescriptionInstructions`, compact);
}

function subtaskCriteriaSettings(containerEl, plugin) {
  settingsHeading(containerEl, "Subtask Criteria", "Choose which metadata is allowed on generated or synced subtasks. Disabled criteria are omitted from note syntax and Todoist subtask payloads.");
  toggleSetting(containerEl, "Subtask labels", "Allow configured labels on subtasks.", plugin, "subtaskIncludeLabels");
  toggleSetting(containerEl, "Subtask priority", "Allow priority markers and Todoist priority on subtasks.", plugin, "subtaskIncludePriority");
  toggleSetting(containerEl, "Subtask due date", "Allow due dates on subtasks.", plugin, "subtaskIncludeDueDate");
  toggleSetting(containerEl, "Subtask deadline", "Allow deadline markers on subtasks.", plugin, "subtaskIncludeDeadline");
}

const SETTING_DESCRIPTIONS = {
  defaultOpenArea: "Choose where the sidebar opens in Obsidian.",
  chatFontSizePx: "Controls only the sidebar chat text size.",
  searchIncludeActiveNote: "Default for whether sidebar chat queries include the active note alongside semantic vault search.",
  maxChatContextChunks: "Maximum number of semantic search results sent to the AI for vault Q&A.",
  maxActiveNoteContextChars: "Maximum active-note characters sent to the AI for normal chat. Task creation can use a separate note limit.",
  promptTemplatesFolder: "Markdown files in this folder become reusable prompt actions. Frontmatter can set createTasks, insertResponse, syncTasks, and action: schedule-today.",
  taskGenerationPromptTemplate: "Default task-generation prompt used by the Create Todoist tasks command.",
  openaiApiKey: "Required for the default OpenAI setup. Create this in OpenAI Platform and paste it here.",
  googleApiKey: "Optional. Required only when you choose a Gemini chat or embedding model.",
  aiModelProvider: "Choose which provider to prefer when both OpenAI and Gemini API keys are saved. Model dropdowns follow this provider.",
  chatFallbackModel: "Choose one same-provider fallback model for temporary overload/rate-limit retries.",
  enableAiModelFallback: "Retries transient same-provider model failures, such as temporary overload, 429, 503, and other 5xx capacity errors, with another available chat model from that provider.",
  showAiFallbackNotice: "Appends a short note to sidebar chat answers when the fallback model answered the question.",
  embeddingModel: "Used to build and search the local semantic index. It follows the selected provider by default.",
  todoistToken: "Required for Todoist project loading, task creation, and two-way sync.",
  workerUrl: "Required only for Email-To-Todoist. This is the HTTPS URL of your Cloudflare Worker queue.",
  workerToken: "Required only for Email-To-Todoist. This shared secret authorizes Obsidian to read queued emails from your Worker.",
  indexedFolders: "Optional comma-separated folder list. Leave blank to index the whole vault except excluded folders.",
  excludedFolders: "Folders ignored by semantic indexing and vault search. Note task sync also skips these folders except for the Email-To-Todoist log folder, which remains syncable so generated email task notes can update from Todoist.",
  excludedLinkDomains: "Comma-separated web domains omitted from AI prompts and Todoist descriptions.",
  embeddingBatchSize: "How many note chunks are embedded per API batch. Larger values can be faster but heavier.",
  semanticIndexMaxChunkChars: "Approximate size of each note chunk before embedding.",
  semanticIndexMaxChunksPerNote: "Caps how much of a single note can enter the semantic index.",
  semanticIndexEmbeddingPrecision: "Number of decimal places retained in stored embeddings. Lower is smaller; higher is more precise.",
  useNoteCreatedTimeForSemanticIndex: "Uses a note frontmatter created value, for example created: [\"2026-05-20 13:43\"], as the meeting/date signal in semantic ranking. When disabled, only file metadata is used.",
  autoUpdateSemanticIndex: "When enabled, edited notes are re-indexed after a delay while Obsidian is open.",
  semanticIndexDelaySeconds: "Wait time before re-indexing changed notes, so rapid edits collapse into one update.",
  autoProcessEmails: "When enabled, Obsidian polls your Cloudflare Worker for forwarded emails while the app is open.",
  emailPollIntervalSeconds: "How often Email-To-Todoist checks Cloudflare while automatic processing is enabled. To protect the Cloudflare KV Free list limit, automatic polling is clamped to at least 420 seconds.",
  maxEmailChars: "Maximum email text sent to the AI for task extraction.",
  emailLogFolder: "Folder where plain-language email processing logs are stored.",
  maxGeneratedMainTasks: "Hard cap on main tasks the AI may create from one note or email.",
  maxGeneratedSubtasksPerMainTask: "Hard cap on subtasks below each AI-created main task.",
  syncTag: "Marker tag used in notes for main tasks that sync with Todoist.",
  subtaskSyncTag: "Marker tag used in notes for subtasks that sync with Todoist.",
  excludeSyncTagsFromLabels: "Prevents internal sync marker tags from becoming Todoist labels.",
  notesAutoSync: "When enabled, changed note task lines sync with Todoist while Obsidian is open.",
  syncIntervalSeconds: "How often automatic Notes-To-Todoist checks run while Obsidian is open.",
  syncWorkerCount: "Number of local note files processed in parallel during note sync.",
  linksAppURI: "Use Todoist app links instead of Todoist web links when sidebar answers reference tasks from the local OID table.",
  subtaskIndentSpaces: "Number of leading spaces used when inserting generated subtasks.",
  subtaskIncludeLabels: "Allow Todoist labels on subtasks.",
  subtaskIncludePriority: "Allow priority markers and Todoist priority on subtasks.",
  subtaskIncludeDueDate: "Allow due dates on subtasks.",
  subtaskIncludeDeadline: "Allow deadline dates on subtasks.",
  maxNoteChars: "Maximum note text sent to the AI for task extraction.",
  todoistDescriptionMaxChars: "Maximum generated description characters before the source list is added.",
  emailIncludeSourceListInDescriptions: "When enabled, email-created Todoist descriptions include plugin-generated source references and context-note citations like (1).",
  noteIncludeSourceListInDescriptions: "When enabled, note-created Todoist descriptions include plugin-generated source references and context-note citations like (1).",
  autoRebuildReferences: "Low-frequency reconciliation of the local OID reference table against Todoist.",
  referenceRebuildIntervalMinutes: "How often automatic reference reconciliation may run while Obsidian is open.",
  referenceRebuildWorkerCount: "Number of local note files processed in parallel during reference reconciliation.",
  todoistSnapshotCacheMinutes: "How long Todoist snapshots can be reused to reduce API calls.",
  scheduleTodayEnabled: "Adds the Schedule Today's Tasks prompt action to the sidebar chooser and command palette.",
  scheduleTodayStartTime: "Start of the schedulable workday.",
  scheduleTodayEndTime: "End of the schedulable workday.",
  scheduleTodayLunchStartTime: "Start of the protected lunch block.",
  scheduleTodayLunchMinutes: "Length of the lunch block avoided by automatic scheduling. Use 0 to disable lunch blocking.",
  scheduleTodayMinBlockMinutes: "Smallest duration block a task can receive. The preview timeline also uses this interval.",
  scheduleTodayMaxBlockMinutes: "Largest same-day block a task can receive before overflow is split to the next workday.",
  scheduleTodayAddWindowMinutes: "How much shorter an open preview window may be than a suggested task block when showing Add in instead of Swap in.",
  scheduleTodayChunkMinutes: "Legacy setting kept for older saved data. The scheduler now uses Minimum task block minutes as its timeline interval.",
  scheduleTodayDueWindowDays: "Include tasks due today through this many days ahead.",
  scheduleTodayIncludeOverdue: "Include open overdue tasks in today's candidate list.",
  scheduleTodayIncludeSubtasks: "Allow open subtasks to be scheduled directly.",
  scheduleTodayAllowIndependentSubtasks: "Allow follow-up, review, waiting, or dependency subtasks to move independently from their parent task.",
  scheduleTodayExcludedLabels: "Comma-separated Todoist labels skipped by the scheduler.",
  scheduleTodayWeightTodoistPriority: "How much Todoist priority affects the schedule order.",
  scheduleTodayWeightDeadlineProximity: "How much deadline proximity affects the schedule order. Deadlines are read only and are not changed.",
  scheduleTodayWeightOverdue: "How much overdue status affects the schedule order.",
  scheduleTodayWeightDueDateProximity: "How much due-date proximity affects the schedule order.",
  scheduleTodayWeightSemanticUrgency: "How much urgent wording in the task and local context affects the schedule order.",
  scheduleTodayWeightNoteRecency: "How much recent note/task context affects the schedule order.",
  scheduleTodayWeightParentDependency: "How much parent/subtask dependency context affects the schedule order.",
  enableTaskDeduplication: "Checks generated tasks against open tasks in the local reference table. Local scoring identifies candidates; AI-mediated deduplication must be enabled to merge or update tasks.",
  taskDeduplicationStrictness: "Controls how much local evidence is required before a generated task is nominated as a duplicate candidate.",
  taskDeduplicationMergeLabelsAdditive: "When enabled, existing Todoist labels are kept and new generated labels are added.",
  taskDeduplicationAllowExplicitSubtaskRemoval: "When enabled, an existing linked subtask is omitted from the merge only when newer source text clearly says it is obsolete or should be removed.",
  enableAiAmbiguousTaskDeduplication: "When enabled, all duplicate task updates and same-batch merges require AI confirmation and AI-synthesized merged task details. When disabled, dedupe is local-only candidate detection: possible duplicates are posted to chat for manual review and left unmerged because local-only dedupe may be less accurate and less efficient.",
  taskDeduplicationAiReviewSensitivity: "Controls how broadly local candidates are sent to the AI deduplication step. Matching strictness still controls how much local evidence is needed to nominate a candidate.",
  taskDeduplicationAiModel: "Model used to confirm duplicate candidates and synthesize merged task details. Automatic uses the configured chat fallback model unless you choose a specific deduplication model.",
  taskDeduplicationPolicy: "Editable merge policy used by local duplicate candidate matching and AI-mediated merge confirmation.",
  emailMainTaskInstructions: "Plain-language rules for deciding which email items become main tasks.",
  emailSubtaskInstructions: "Plain-language rules for creating email-derived subtasks.",
  emailSectionTitleInstructions: "Plain-language rules for naming Todoist sections for email tasks.",
  emailDateInstructions: "Plain-language rules for choosing email task due dates and deadlines.",
  emailTagInstructions: "Plain-language rules for allowed Todoist labels from email tasks.",
  emailPriorityInstructions: "Plain-language rules for email task priority 1 to 4.",
  emailDescriptionInstructions: "Plain-language rules for email task descriptions.",
  noteMainTaskInstructions: "Plain-language rules for deciding which note items become main tasks.",
  noteSubtaskInstructions: "Plain-language rules for creating note-derived subtasks.",
  noteSectionTitleInstructions: "Plain-language rules for naming Todoist sections for note tasks.",
  noteDateInstructions: "Plain-language rules for choosing note task due dates and deadlines.",
  noteTagInstructions: "Plain-language rules for allowed Todoist labels from note tasks.",
  notePriorityInstructions: "Plain-language rules for note task priority 1 to 4.",
  noteDescriptionInstructions: "Plain-language rules for note task descriptions."
};

function settingDescription(name, key, fallback = "") {
  return fallback || SETTING_DESCRIPTIONS[key] || SETTING_DESCRIPTIONS[name] || "";
}

function sanitizeLogData(value) {
  if (value == null) return value;
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizeLogData);
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/key|token|authorization|secret|password/i.test(key)) out[key] = "[redacted]";
      else out[key] = sanitizeLogData(item);
    }
    return out;
  }
  return String(value);
}

function redactSecrets(value) {
  return String(value || "")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-google-key]")
    .replace(/sk-(proj-)?[0-9A-Za-z_-]{20,}/g, "[redacted-openai-key]")
    .replace(/Bearer\s+[0-9A-Za-z._-]+/gi, "Bearer [redacted]");
}

function randomSetupToken() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(32);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function isHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeHttpsUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text.replace(/^http:\/\//i, "https://");
  return `https://${text}`;
}

function textSetting(containerEl, name, desc, plugin, key) {
  new Setting(containerEl).setName(name).setDesc(settingDescription(name, key, desc)).addText((text) => text.setValue(String(plugin.settings[key] || "")).onChange(async (value) => {
    plugin.settings[key] = key === "workerUrl" ? normalizeHttpsUrl(value) : value;
    await plugin.saveSettings();
  }));
}

function aiProviderSetting(containerEl, plugin, refreshDisplay) {
  const current = normalizeAiProvider(plugin.settings.aiModelProvider, aiProviderForModel(plugin.settings.chatModel));
  new Setting(containerEl)
    .setName("Preferred AI provider")
    .setDesc(settingDescription("Preferred AI provider", "aiModelProvider"))
    .addDropdown((dropdown) => {
      dropdown.addOption("openai", "OpenAI");
      dropdown.addOption("gemini", "Google Gemini");
      dropdown.setValue(current).onChange(async (value) => {
        await plugin.setAiModelProvider(value);
        if (refreshDisplay) refreshDisplay();
      });
    });
}

function modelDropdownSetting(containerEl, name, desc, plugin, key, listKey) {
  const options = aiModelOptions(plugin.settings, key, listKey);
  new Setting(containerEl).setName(name).setDesc(options.length ? desc : `${desc} Refresh available AI models in API Access to populate this list.`).addDropdown((dropdown) => {
    const current = plugin.settings[key] || DEFAULT_SETTINGS[key];
    if (!options.some((option) => option.value === current)) dropdown.addOption(current, modelDisplayName(current));
    for (const option of options) dropdown.addOption(option.value, option.label);
    dropdown.setValue(current).onChange(async (value) => {
      if (key === "chatModel") {
        await plugin.setChatModel(value);
        return;
      }
      if (key === "embeddingModel") {
        await plugin.setEmbeddingModel(value);
        return;
      }
      plugin.settings[key] = value;
      await plugin.saveSettings();
    });
  });
}

function aiFallbackModelSetting(containerEl, plugin) {
  const primary = plugin.settings.chatModel || DEFAULT_SETTINGS.chatModel;
  const automaticFallback = plugin.sameProviderFallbackModels(primary)[0] || "";
  const options = [{ value: "", label: automaticFallback ? `Automatic: ${modelDisplayName(automaticFallback)}` : "Automatic same provider" }];
  if (usesGeminiChatModel(primary)) {
    const primaryId = normalizeGeminiModelId(primary);
    const models = plugin.settings.availableGeminiModels?.length ? plugin.settings.availableGeminiModels : DEFAULT_SETTINGS.availableGeminiModels;
    for (const model of rankGeminiFallbackModels(models)) {
      const id = normalizeGeminiModelId(model);
      if (id && id !== primaryId && isUsableGeminiChatModel(id)) options.push({ value: `gemini/${id}`, label: `Manual: Gemini: ${id}` });
    }
  } else {
    const primaryId = normalizeOpenAIModelId(primary);
    const openAiFallbackOptions = uniqueValues([plugin.settings.chatFallbackModel, DEFAULT_SETTINGS.chatFallbackModel].concat(plugin.settings.availableChatModels || []));
    for (const model of openAiFallbackOptions) {
      const id = normalizeOpenAIModelId(model);
      if (id && id !== primaryId) options.push({ value: id, label: `Manual: OpenAI: ${id}` });
    }
  }
  const selected = options.some((option) => option.value === plugin.settings.chatFallbackModel) ? plugin.settings.chatFallbackModel : "";
  new Setting(containerEl)
    .setName("Fallback AI model")
    .setDesc(settingDescription("Fallback AI model", "chatFallbackModel"))
    .addDropdown((dropdown) => {
      for (const option of uniqueModelOptions(options)) dropdown.addOption(option.value, option.label);
      dropdown.setValue(selected || "").onChange(async (value) => {
        plugin.settings.chatFallbackModel = value;
        await plugin.saveSettings();
      });
    });
}

function taskGenerationPromptTemplateSetting(containerEl, plugin) {
  const current = plugin.settings.taskGenerationPromptTemplate || DEFAULT_SETTINGS.taskGenerationPromptTemplate;
  new Setting(containerEl)
    .setName("Task generation prompt")
    .setDesc("Default task-generation prompt used by the Create Todoist tasks command. Prompt templates with createTasks enabled use their own prompt text directly.")
    .addDropdown((dropdown) => {
      dropdown.addOption(current, current);
      dropdown.setValue(current);
      dropdown.onChange(async (value) => {
        plugin.settings.taskGenerationPromptTemplate = value;
        await plugin.saveSettings();
      });
      plugin.getPromptTemplates().then((templates) => {
        const candidates = templates.filter((template) => isTaskGenerationTemplate(template));
        if (dropdown.selectEl) dropdown.selectEl.empty();
        const values = new Set();
        for (const template of candidates) {
          const value = template.source || template.name;
          if (!value || values.has(value)) continue;
          values.add(value);
          dropdown.addOption(value, template.name || value);
        }
        if (!values.has(current)) dropdown.addOption(current, current);
        dropdown.setValue(values.has(current) ? current : (candidates[0]?.source || candidates[0]?.name || current));
      }).catch((error) => {
        console.error("Could not load task generation templates", error);
      });
    });
}

function todoistProjectSetting(containerEl, plugin, refreshDisplay) {
  const projects = plugin.settings.availableTodoistProjects || [];
  const currentId = plugin.settings.todoistTaskProjectId || plugin.settings.todoistInboxProjectId || "";
  const currentName = plugin.settings.todoistTaskProjectName || "Inbox";
  const desc = projects.length
    ? `New email and note tasks are created in this Todoist project. Projects loaded: ${projects.length}. Last refreshed: ${plugin.settings.todoistProjectsFetchedAt || "unknown"}.`
    : "Defaults to Todoist Inbox. Refresh after adding your Todoist token to choose another project.";
  const setting = new Setting(containerEl).setName("Todoist task project").setDesc(desc)
    .addDropdown((dropdown) => {
      if (currentId && !projects.some((project) => project.id === currentId)) dropdown.addOption(currentId, currentName);
      if (!projects.length && !currentId) dropdown.addOption("", "Inbox");
      for (const project of projects) dropdown.addOption(project.id, project.isInbox ? `${project.name} (Inbox)` : project.name);
      dropdown.setValue(currentId || "");
      dropdown.onChange(async (value) => {
        const selected = projects.find((project) => project.id === value);
        plugin.settings.todoistTaskProjectId = value;
        plugin.settings.todoistTaskProjectName = selected?.name || currentName || "Inbox";
        await plugin.saveSettings();
      });
    })
    .addButton((button) => button.setButtonText("Refresh").onClick(async () => {
      try {
        await plugin.refreshTodoistProjects(true);
        if (refreshDisplay) refreshDisplay();
      } catch (error) {
        new Notice(`Could not load Todoist projects: ${error.message || error}`);
      }
    }));
  setting.settingEl.addClass("semantic-todoist-project-setting");
}

function secretSetting(containerEl, name, plugin, key) {
  new Setting(containerEl).setName(name).setDesc(settingDescription(name, key)).addText((text) => {
    text.inputEl.type = "password";
    text.setValue(String(plugin.settings[key] || "")).onChange(async (value) => {
      plugin.settings[key] = value.trim();
      await plugin.saveSettings();
    });
  });
}

function numberSetting(containerEl, name, plugin, key) {
  new Setting(containerEl).setName(name).setDesc(settingDescription(name, key)).addText((text) => {
    text.inputEl.type = "number";
    text.setValue(String(plugin.settings[key] ?? DEFAULT_SETTINGS[key])).onChange(async (value) => {
      const minimum = key === "emailPollIntervalSeconds" ? MIN_EMAIL_AUTO_POLL_INTERVAL_SECONDS : ["scheduleTodayLunchMinutes", "scheduleTodayAddWindowMinutes"].includes(key) ? 0 : 1;
      const parsed = parseInt(value, 10);
      plugin.settings[key] = Math.max(minimum, Number.isFinite(parsed) ? parsed : DEFAULT_SETTINGS[key]);
      await plugin.saveSettings();
    });
  });
}

function timeSetting(containerEl, name, desc, plugin, key) {
  const setting = new Setting(containerEl).setName(name).setDesc(settingDescription(name, key, desc));
  const input = setting.controlEl.createEl("input", { type: "time" });
  input.value = String(plugin.settings[key] || DEFAULT_SETTINGS[key] || "");
  input.onchange = async () => {
    plugin.settings[key] = input.value || DEFAULT_SETTINGS[key];
    await plugin.saveSettings();
  };
}

function scheduleWeightSetting(containerEl, name, plugin, key) {
  const options = ["less", "moderate", "more"];
  const labels = { less: "Less", moderate: "Moderate", more: "More" };
  const current = options.includes(plugin.settings[key]) ? plugin.settings[key] : "moderate";
  const setting = new Setting(containerEl).setName(name).setDesc(settingDescription(name, key));
  setting.settingEl.addClass("semantic-todoist-weight-setting");
  const wrapper = setting.controlEl.createDiv({ cls: "semantic-todoist-weight-control" });
  const range = wrapper.createEl("input", { type: "range", attr: { min: "0", max: "2", step: "1", "aria-label": name } });
  const label = wrapper.createSpan({ cls: "semantic-todoist-weight-label", text: labels[current] });
  range.value = String(Math.max(0, options.indexOf(current)));
  range.oninput = () => {
    label.setText(labels[options[Number(range.value)] || "moderate"]);
  };
  range.onchange = async () => {
    plugin.settings[key] = options[Number(range.value)] || "moderate";
    await plugin.saveSettings();
  };
}

function taskDeduplicationStrictnessSetting(containerEl, plugin) {
  const options = ["permissive", "conservative", "strict"];
  const labels = { permissive: "More flexible", conservative: "Conservative", strict: "Strict" };
  const current = options.includes(plugin.settings.taskDeduplicationStrictness) ? plugin.settings.taskDeduplicationStrictness : "conservative";
  const setting = new Setting(containerEl).setName("Matching strictness").setDesc(settingDescription("Matching strictness", "taskDeduplicationStrictness"));
  setting.settingEl.addClass("semantic-todoist-weight-setting");
  const wrapper = setting.controlEl.createDiv({ cls: "semantic-todoist-weight-control" });
  const range = wrapper.createEl("input", { type: "range", attr: { min: "0", max: "2", step: "1", "aria-label": "Task deduplication matching strictness" } });
  const label = wrapper.createSpan({ cls: "semantic-todoist-weight-label", text: labels[current] });
  range.value = String(Math.max(0, options.indexOf(current)));
  range.oninput = () => {
    label.setText(labels[options[Number(range.value)] || "conservative"]);
  };
  range.onchange = async () => {
    plugin.settings.taskDeduplicationStrictness = options[Number(range.value)] || "conservative";
    await plugin.saveSettings();
  };
}

function taskDeduplicationAiReviewSensitivitySetting(containerEl, plugin) {
  const options = ["narrow", "balanced", "broad"];
  const labels = { narrow: "Narrow", balanced: "Balanced", broad: "Broad" };
  const current = options.includes(plugin.settings.taskDeduplicationAiReviewSensitivity) ? plugin.settings.taskDeduplicationAiReviewSensitivity : DEFAULT_SETTINGS.taskDeduplicationAiReviewSensitivity;
  new Setting(containerEl)
    .setName("AI review sensitivity")
    .setDesc(settingDescription("AI review sensitivity", "taskDeduplicationAiReviewSensitivity"))
    .addDropdown((dropdown) => {
      for (const option of options) dropdown.addOption(option, labels[option]);
      dropdown.setValue(current);
      dropdown.onChange(async (value) => {
        plugin.settings.taskDeduplicationAiReviewSensitivity = options.includes(value) ? value : DEFAULT_SETTINGS.taskDeduplicationAiReviewSensitivity;
        await plugin.saveSettings();
      });
    });
}

function taskDeduplicationAiModelSetting(containerEl, plugin) {
  const current = plugin.settings.taskDeduplicationAiModel || "";
  const automatic = taskDeduplicationAiModel(plugin.settings);
  const options = [{ value: "", label: `Automatic chat fallback: ${modelDisplayName(automatic)}` }];
  const provider = normalizeAiProvider(plugin.settings.aiModelProvider, aiProviderForModel(plugin.settings.chatModel));
  if (provider === "gemini") {
    const geminiModels = plugin.settings.availableGeminiModels?.length ? plugin.settings.availableGeminiModels : DEFAULT_SETTINGS.availableGeminiModels;
    for (const model of rankGeminiFallbackModels(geminiModels)) {
      const id = normalizeGeminiModelId(model);
      if (id && isUsableGeminiChatModel(id)) options.push({ value: `gemini/${id}`, label: `Gemini: ${id}` });
    }
  } else {
    for (const model of plugin.settings.availableChatModels || DEFAULT_SETTINGS.availableChatModels) {
      const id = normalizeOpenAIModelId(model);
      if (id) options.push({ value: id, label: `OpenAI: ${id}` });
    }
  }
  const selected = options.some((option) => option.value === current) ? current : "";
  new Setting(containerEl)
    .setName("AI deduplication and merge model")
    .setDesc(settingDescription("AI deduplication and merge model", "taskDeduplicationAiModel"))
    .addDropdown((dropdown) => {
      for (const option of uniqueModelOptions(options)) dropdown.addOption(option.value, option.label);
      dropdown.setValue(selected);
      dropdown.onChange(async (value) => {
        plugin.settings.taskDeduplicationAiModel = value;
        await plugin.saveSettings();
      });
    });
}

function toggleSetting(containerEl, name, desc, plugin, key) {
  new Setting(containerEl).setName(name).setDesc(settingDescription(name, key, desc)).addToggle((toggle) => toggle.setValue(Boolean(plugin.settings[key])).onChange(async (value) => {
    plugin.settings[key] = value;
    await plugin.saveSettings();
  }));
}

function dropdownSetting(containerEl, name, plugin, key, options) {
  new Setting(containerEl).setName(name).setDesc(settingDescription(name, key)).addDropdown((dropdown) => {
    for (const option of options) dropdown.addOption(option, option);
    dropdown.setValue(plugin.settings[key] || options[0]).onChange(async (value) => {
      plugin.settings[key] = value;
      await plugin.saveSettings();
    });
  });
}

function dropdownSettingWithDesc(containerEl, name, desc, plugin, key, options) {
  new Setting(containerEl).setName(name).setDesc(desc || "").addDropdown((dropdown) => {
    for (const option of options) dropdown.addOption(option, option);
    dropdown.setValue(plugin.settings[key] || options[0]).onChange(async (value) => {
      plugin.settings[key] = value;
      await plugin.saveSettings();
    });
  });
}

function folderListSetting(containerEl, name, desc, plugin, key) {
  const selected = splitList(plugin.settings[key]).map(trimSlashes);
  const folders = plugin.app.vault.getAllLoadedFiles()
    .filter((file) => file.children)
    .map((folder) => folder.path)
    .filter((path) => path && path !== "/")
    .sort((a, b) => a.localeCompare(b));
  let choice = folders.find((folder) => !selected.includes(folder)) || folders[0] || "";
  const listId = `semantic-todoist-folder-options-${key}`;
  const dataList = containerEl.createEl("datalist", { attr: { id: listId } });
  for (const folder of folders) dataList.createEl("option", { attr: { value: folder } });
  new Setting(containerEl).setName(name).setDesc(desc)
    .addText((text) => {
      text.inputEl.setAttr("list", listId);
      text.inputEl.setAttr("placeholder", folders.length ? "Type to search vault folders" : "No folders found");
      text.setValue(choice);
      text.onChange((value) => { choice = trimSlashes(value); });
    })
    .addButton((button) => button.setButtonText("Add").onClick(async () => {
      if (!choice) return;
      const values = new Set(splitList(plugin.settings[key]).map(trimSlashes));
      values.add(choice);
      plugin.settings[key] = Array.from(values).join(", ");
      plugin.semanticIndex = [];
      plugin.settings.semanticIndexMeta = {};
      await plugin.saveSemanticIndex();
      await plugin.saveSettings();
      new Notice("Folder added. Reopen this settings tab to refresh the folder list.");
    }));
  const selectedEl = containerEl.createDiv({ cls: "semantic-todoist-folder-list" });
  selectedEl.createDiv({ cls: "semantic-todoist-folder-list-title", text: selected.length ? "Excluded folders" : "No excluded folders selected." });
  for (const folder of selected) {
    new Setting(selectedEl).setName(folder).setDesc("Excluded folder").addButton((button) => button.setButtonText("Remove").onClick(async () => {
      plugin.settings[key] = selected.filter((item) => item !== folder).join(", ");
      plugin.semanticIndex = [];
      plugin.settings.semanticIndexMeta = {};
      await plugin.saveSemanticIndex();
      await plugin.saveSettings();
      new Notice("Folder removed. Reopen this settings tab to refresh the folder list.");
    }));
  }
}

function textAreaSetting(containerEl, name, plugin, key, options = {}) {
  const setting = new Setting(containerEl).setName(name).setDesc(settingDescription(name, key)).addTextArea((text) => text.setValue(plugin.settings[key] || "").onChange(async (value) => {
    plugin.settings[key] = value;
    await plugin.saveSettings();
  }));
  setting.settingEl.addClass("semantic-todoist-setting");
  if (options.compact) setting.settingEl.addClass("semantic-todoist-setting-compact");
}

function activitySetting(containerEl, name, desc) {
  new Setting(containerEl).setName(name).setDesc(desc || "");
}

function setupStatusSetting(containerEl, name, desc, buttons = []) {
  const setting = new Setting(containerEl).setName(name).setDesc(desc || "");
  setting.settingEl.addClass("semantic-todoist-setup-step");
  for (const [label, onClick] of buttons) {
    setting.addButton((button) => button.setButtonText(label).onClick(onClick));
  }
}

function parsePromptTemplateFile(file, text) {
  const parsed = parseSimpleFrontmatter(text);
    return {
      name: parsed.meta.name || file.basename,
      prompt: parsed.body.trim(),
      source: file.path,
      action: normalizePromptTemplateAction(parsed.meta.action ?? parsed.meta.actionType ?? parsed.meta.action_type ?? parsed.meta.templateAction ?? parsed.meta.template_action),
      createTasks: parseTemplateBoolean(parsed.meta.createTasks ?? parsed.meta.create_tasks ?? parsed.meta.makeTasks ?? parsed.meta.make_tasks, false),
      insertResponse: parseTemplateBoolean(parsed.meta.insertResponse ?? parsed.meta.insert_response, true),
      syncAfterInsert: parseTemplateBoolean(parsed.meta.syncTasks ?? parsed.meta.sync_tasks ?? parsed.meta.syncAfterInsert ?? parsed.meta.sync_after_insert, false),
      taskHeading: parsed.meta.taskHeading || parsed.meta.task_heading || parsed.meta.heading || "",
      taskGenerationTemplate: parseOptionalTemplateBoolean(parsed.meta.taskGenerationTemplate ?? parsed.meta.task_generation_template ?? parsed.meta.taskTemplate ?? parsed.meta.task_template ?? parsed.meta.taskOnly ?? parsed.meta.task_only)
    };
}

function parseSimpleFrontmatter(text) {
  const value = String(text || "");
  if (!value.startsWith("---")) return { meta: {}, body: value };
  const end = value.indexOf("\n---", 3);
  if (end < 0) return { meta: {}, body: value };
  const raw = value.slice(3, end).trim();
  const body = value.slice(end + 4).replace(/^\s*\n/, "");
  const meta = {};
  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    meta[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return { meta, body };
}

function parseTemplateBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return /^(true|yes|1|on)$/i.test(String(value).trim());
}

function parseOptionalTemplateBoolean(value) {
  if (value == null || value === "") return null;
  return /^(true|yes|1|on)$/i.test(String(value).trim());
}

function isTaskGenerationTemplate(template = {}) {
  if (template.taskGenerationTemplate != null) return Boolean(template.taskGenerationTemplate);
  const text = `${template.name || ""}\n${template.prompt || ""}`;
  if (!template.createTasks) return false;
  return /\b(todoist-ready task list|generate(?: only)? .*tasks?|follow-up tasks|task extraction)\b/i.test(text) &&
    !/\bsummary\b/i.test(template.name || "");
}

function normalizePromptTemplateAction(value) {
  const action = String(value || "").trim().toLowerCase().replace(/['’]/g, "").replace(/[\s_]+/g, "-");
  if (/^(schedule|schedule-today|schedule-todays-tasks|schedule-today-tasks|schedule-day|plan-today)$/.test(action)) return "schedule-today";
  return action;
}

function isScheduleTodayTemplate(template = {}) {
  return normalizePromptTemplateAction(template.action) === "schedule-today";
}

function promptTemplateFileText(template) {
  return [
    "---",
    ...(template.action ? [`action: ${normalizePromptTemplateAction(template.action)}`] : []),
    `createTasks: ${Boolean(template.createTasks)}`,
    `insertResponse: ${template.insertResponse !== false}`,
    `syncTasks: ${Boolean(template.syncTasks ?? template.syncAfterInsert)}`,
    ...(template.taskGenerationTemplate != null ? [`taskGenerationTemplate: ${Boolean(template.taskGenerationTemplate)}`] : []),
    ...(template.createTasks ? [`taskHeading: '${template.taskHeading || DEFAULT_TASK_HEADING}'`] : []),
    "---",
    "",
    template.prompt || ""
  ].join("\n");
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function aiSetupSummary(settings) {
  const provider = normalizeAiProvider(settings.aiModelProvider, aiProviderForModel(settings.chatModel));
  const keyReady = provider === "gemini" ? Boolean(settings.googleApiKey) : Boolean(settings.openaiApiKey);
  const embeddingReady = usesGeminiEmbeddingModel(settings.embeddingModel) ? Boolean(settings.googleApiKey) : Boolean(settings.openaiApiKey);
  return `${providerDisplayName(provider)} is preferred. Chat key: ${keyReady ? "set" : "missing"}. Embedding key: ${embeddingReady ? "set" : "missing"}. Model list: ${settings.modelsFetchedAt || settings.geminiModelsFetchedAt ? "loaded" : "not loaded"}.`;
}

function aiAccessConfigured(settings) {
  const chatReady = usesGeminiChatModel(settings.chatModel) ? Boolean(settings.googleApiKey) : Boolean(settings.openaiApiKey);
  const embeddingReady = usesGeminiEmbeddingModel(settings.embeddingModel) ? Boolean(settings.googleApiKey) : Boolean(settings.openaiApiKey);
  return chatReady && embeddingReady;
}

function todoistSetupSummary(settings) {
  return `Token: ${settings.todoistToken ? "set" : "missing"}. Project: ${settings.todoistTaskProjectName || "Inbox"}. Loaded projects: ${settings.availableTodoistProjects?.length || 0}.`;
}

function emailSetupSummary(settings) {
  return `Requires AI + Todoist first. Optional Cloudflare Worker URL: ${settings.workerUrl ? "set" : "missing"}. Worker token: ${settings.workerToken ? "set" : "missing"}. Automatic processing: ${settings.autoProcessEmails ? "on" : "off"}. Poll floor: ${MIN_EMAIL_AUTO_POLL_INTERVAL_SECONDS} seconds.`;
}

function notesSetupSummary(settings) {
  return `Requires AI + Todoist. Automatic note sync: ${settings.notesAutoSync ? "on" : "off"}. Main tag: ${settings.syncTag}. Subtask tag: ${settings.subtaskSyncTag}. Interval: ${settings.syncIntervalSeconds} seconds.`;
}

function legacyTodoistIdModeSummary(settings) {
  if (shouldConvertLegacyTodoistIds(settings)) {
    return "Convert mode is on. Reference rebuild can replace compatible legacy Todoist ID markers and #tdsync tags with Semantic Todoist Sync OIDs.";
  }
  return "Preserve mode is on. Existing Todoist ID markers from other plugins are ignored. OID-only Semantic Todoist Sync tasks can still recover missing Todoist IDs by exact task-name matching.";
}

function indexSummary(pluginOrSettings) {
  const settings = pluginOrSettings.settings || pluginOrSettings;
  const meta = settings.semanticIndexMeta || {};
  const stats = pluginOrSettings.semanticIndexStats || {};
  const bytes = stats.bytes ? ` Largest file: ${formatBytes(stats.bytes)}.` : "";
  const total = stats.totalBytes && stats.totalBytes !== stats.bytes ? ` Total: ${formatBytes(stats.totalBytes)} across ${stats.files || 1} files.` : "";
  const chunks = Number(meta.chunks || pluginOrSettings.semanticIndex?.length || 0);
  if (chunks && meta.rebuiltAt) return `${chunks} chunks. Model: ${meta.model}. Rebuilt: ${meta.rebuiltAt}.${bytes}${total}`;
  if (chunks) return `${chunks} partial chunks are available, but no completed rebuild is recorded.${bytes}${total} Rebuild the semantic vault index.`;
  if (stats.bytes) return `No semantic index chunks are available. ${bytes}${total} Rebuild the semantic vault index.`;
  return "No semantic index has been built yet.";
}

function indexFilesSummary(pluginOrSettings) {
  const stats = pluginOrSettings.semanticIndexStats || {};
  const path = stats.path || pluginOrSettings.settings?.semanticIndexMeta?.file || SEMANTIC_INDEX_FILE;
  if (!stats.bytes && !stats.totalBytes) return `${path}. No index file loaded.`;
  if (stats.shards) {
    return `Manifest: ${path}. Shards: ${stats.shards}. Largest file: ${formatBytes(stats.bytes || 0)}. Total: ${formatBytes(stats.totalBytes || stats.bytes || 0)} across ${stats.files || stats.shards + 1} files.`;
  }
  return `${path}. Single index file: ${formatBytes(stats.bytes || 0)}.`;
}

function modelSummary(settings) {
  const active = `Active: ${modelDisplayName(settings.chatModel)}. Embeddings: ${modelDisplayName(settings.embeddingModel)}.`;
  const openai = settings.modelsFetchedAt
    ? `${settings.availableChatModels?.length || 0} OpenAI chat and ${settings.availableEmbeddingModels?.length || 0} OpenAI embedding models loaded at ${settings.modelsFetchedAt}`
    : "OpenAI models not loaded";
  const gemini = settings.geminiModelsFetchedAt
    ? `${settings.availableGeminiModels?.length || 0} Gemini chat and ${settings.availableGeminiEmbeddingModels?.length || 0} Gemini embedding models loaded at ${settings.geminiModelsFetchedAt}`
    : `${settings.availableGeminiModels?.length || 0} default Gemini chat model(s) available`;
  return `${active} ${openai}. ${gemini}.`;
}

function configuredAiModelSummary(plugin) {
  const settings = plugin.settings || DEFAULT_SETTINGS;
  const primary = settings.chatModel || DEFAULT_SETTINGS.chatModel;
  const primaryText = `Provider: ${providerDisplayName(settings.aiModelProvider || aiProviderForModel(primary))}. Primary: ${modelDisplayName(primary)}`;
  if (!settings.enableAiModelFallback) return `${primaryText}. Fallback: off.`;
  const fallback = plugin.sameProviderFallbackModels(primary)[0] || "";
  const mode = settings.chatFallbackModel ? "Manual" : "Automatic";
  return fallback
    ? `${primaryText}. Fallback: ${mode}: ${modelDisplayName(fallback)}.`
    : `${primaryText}. Fallback: ${mode}, but no compatible same-provider model is available.`;
}

function modelProviderSummaries(settings) {
  return [
    {
      name: "Active AI models",
      desc: `Chat: ${modelDisplayName(settings.chatModel)}. Embeddings: ${modelDisplayName(settings.embeddingModel)}.`
    },
    {
      name: "Gemini models",
      desc: settings.geminiModelsFetchedAt
        ? `${settings.availableGeminiModels?.length || 0} chat and ${settings.availableGeminiEmbeddingModels?.length || 0} embedding models loaded at ${settings.geminiModelsFetchedAt}.`
        : `${settings.availableGeminiModels?.length || 0} default chat model(s) and ${settings.availableGeminiEmbeddingModels?.length || 0} default embedding model(s) available.`
    },
    {
      name: "OpenAI models",
      desc: settings.modelsFetchedAt
        ? `${settings.availableChatModels?.length || 0} chat and ${settings.availableEmbeddingModels?.length || 0} embedding models loaded at ${settings.modelsFetchedAt}.`
        : "OpenAI models not loaded."
    }
  ];
}

function activeModelSummary(settings) {
  return `Chat: ${modelDisplayName(settings.chatModel)}. Embeddings: ${modelDisplayName(settings.embeddingModel)}.`;
}

function availableModelSummary(settings) {
  const gemini = settings.geminiModelsFetchedAt
    ? `Gemini: ${settings.availableGeminiModels?.length || 0} chat, ${settings.availableGeminiEmbeddingModels?.length || 0} embedding; loaded ${settings.geminiModelsFetchedAt}.`
    : `Gemini: ${settings.availableGeminiModels?.length || 0} default chat, ${settings.availableGeminiEmbeddingModels?.length || 0} default embedding.`;
  const openai = settings.modelsFetchedAt
    ? `OpenAI: ${settings.availableChatModels?.length || 0} chat, ${settings.availableEmbeddingModels?.length || 0} embedding; loaded ${settings.modelsFetchedAt}.`
    : "OpenAI: not loaded.";
  return `${gemini} ${openai}`;
}

function activityLogText(settings) {
  const entries = settings.localLog || [];
  if (!entries.length) return "No local activity logged yet.";
  return entries.map((entry) => `${entry.at}  ${entry.message}  ${JSON.stringify(entry.data || {})}`).join("\n");
}

function settingsWithoutTaskReferenceTables(settings = DEFAULT_SETTINGS) {
  const data = Object.assign({}, settings);
  delete data.taskCache;
  delete data.pendingTaskReferences;
  delete data.pendingTaskDescriptions;
  return data;
}

function taskReferencePayloadFingerprint(settings = DEFAULT_SETTINGS) {
  return shortHash(JSON.stringify({
    taskCache: settings.taskCache || {},
    pendingTaskReferences: settings.pendingTaskReferences || {},
    pendingTaskDescriptions: settings.pendingTaskDescriptions || {}
  }));
}

function emptyTaskReferenceIndex() {
  return {
    fingerprint: "",
    entries: [],
    pendingReferences: [],
    byId: new Map(),
    byOid: new Map(),
    byPath: new Map(),
    bySectionId: new Map(),
    cachedTaskPaths: new Set(),
    pathsForIndentRepair: new Set(),
    usedOids: new Set(),
    childTextByParentOid: new Map(),
    taskCount: 0,
    pendingReferenceCount: 0
  };
}

function buildTaskReferenceIndex(settings = DEFAULT_SETTINGS) {
  const index = emptyTaskReferenceIndex();
  index.entries = Object.entries(settings.taskCache || {});
  index.pendingReferences = Object.values(settings.pendingTaskReferences || {});
  index.taskCount = index.entries.length;
  index.pendingReferenceCount = index.pendingReferences.length;
  for (const [id, task] of index.entries) {
    if (task && typeof task === "object" && !task.knowledge?.intent) task.knowledge = taskKnowledgeSnapshot(task, settings, "", task.knowledge || null);
    index.byId.set(String(id), task);
    const oid = String(task?.oid || "").toUpperCase();
    if (oid) {
      index.usedOids.add(oid);
      if (!index.byOid.has(oid)) index.byOid.set(oid, String(id));
    }
    for (const ref of task?.noteRefs || []) {
      const refOid = String(ref?.oid || "").toUpperCase();
      if (!refOid) continue;
      index.usedOids.add(refOid);
      if (!index.byOid.has(refOid)) index.byOid.set(refOid, String(id));
    }
    const path = vaultRelativePath(task?.path || "");
    if (path) {
      index.cachedTaskPaths.add(path);
      if (task?.oid || task?.isSubtask || task?.parentOid || task?.parentId) index.pathsForIndentRepair.add(path);
      const pathEntries = index.byPath.get(path) || [];
      pathEntries.push([String(id), task]);
      index.byPath.set(path, pathEntries);
    }
    const sectionId = String(task?.sectionId || "");
    if (sectionId) {
      const sectionEntries = index.bySectionId.get(sectionId) || [];
      sectionEntries.push([String(id), task]);
      index.bySectionId.set(sectionId, sectionEntries);
    }
  }
  index.childTextByParentOid = taskChildTextByParentOid(index.entries);
  for (const reference of index.pendingReferences) {
    if (reference && typeof reference === "object" && !reference.knowledge?.intent) reference.knowledge = taskKnowledgeSnapshot(reference, settings, "", reference.knowledge || null);
    const oid = String(reference?.oid || "").toUpperCase();
    if (oid) {
      index.usedOids.add(oid);
      if (reference?.id && !index.byOid.has(oid)) index.byOid.set(oid, String(reference.id));
    }
  }
  index.fingerprint = taskReferencePayloadFingerprint(settings);
  return index;
}

function persistentTaskReferenceIndex(index = emptyTaskReferenceIndex()) {
  return {
    fingerprint: index.fingerprint || "",
    taskCount: index.taskCount || 0,
    pendingReferenceCount: index.pendingReferenceCount || 0,
    oidCount: index.usedOids?.size || 0,
    usedOids: Array.from(index.usedOids || []).sort(),
    byOid: Array.from(index.byOid.entries()),
    bySectionId: Array.from(index.bySectionId.entries()).map(([sectionId, entries]) => [sectionId, entries.map(([id, task]) => ({
      id,
      oid: task?.oid || "",
      path: vaultRelativePath(task?.path || ""),
      content: task?.content || "",
      isSubtask: Boolean(task?.isSubtask),
      parentOid: task?.parentOid || "",
      section: task?.section || "",
      scheduledDueDateTime: task?.scheduledDueDateTime || "",
      duration: normalizeTodoistDuration(task?.duration),
      knowledge: compactTaskKnowledge(task?.knowledge),
      cachedAt: task?.cachedAt || ""
    }))]),
    paths: Array.from(index.cachedTaskPaths.values()).sort(),
    pathsForIndentRepair: Array.from(index.pathsForIndentRepair.values()).sort(),
    byPath: Array.from(index.byPath.entries()).map(([path, entries]) => [path, entries.map(([id, task]) => ({
      id,
      oid: task?.oid || "",
      path,
      content: task?.content || "",
      isSubtask: Boolean(task?.isSubtask),
      parentOid: task?.parentOid || "",
      section: task?.section || "",
      sectionId: task?.sectionId || "",
      projectId: task?.projectId || "",
      projectName: task?.projectName || "",
      scheduledDueDateTime: task?.scheduledDueDateTime || "",
      duration: normalizeTodoistDuration(task?.duration),
      knowledge: compactTaskKnowledge(task?.knowledge),
      cachedAt: task?.cachedAt || ""
    }))])
  };
}

function hydrateTaskReferenceIndex(payload = {}, settings = DEFAULT_SETTINGS) {
  const index = emptyTaskReferenceIndex();
  index.fingerprint = payload.fingerprint || "";
  index.taskCount = payload.taskCount || 0;
  index.pendingReferenceCount = payload.pendingReferenceCount || 0;
  const compactById = compactTaskReferencesById(payload, settings);
  index.entries = taskReferenceEntriesForHydration(settings, compactById);
  index.pendingReferences = Object.values(settings.pendingTaskReferences || {});
  index.byId = new Map(index.entries.map(([id, task]) => [String(id), task]));
  index.byOid = compactOidMap(payload);
  index.cachedTaskPaths = new Set((payload.paths || []).map((path) => vaultRelativePath(path)).filter(Boolean));
  index.pathsForIndentRepair = new Set((payload.pathsForIndentRepair || []).map((path) => vaultRelativePath(path)).filter(Boolean));
  index.usedOids = compactUsedOidSet(payload, index.pendingReferences);
  index.byPath = compactGroupedReferenceMap(payload.byPath, settings);
  if (!index.byPath.size && index.entries.length) populatePathReferenceIndexes(index);
  index.bySectionId = compactGroupedReferenceMap(payload.bySectionId, settings, { useGroupPath: false });
  if (!index.bySectionId.size && index.entries.length) populateSectionReferenceIndex(index);
  for (const oid of index.byOid.keys()) index.usedOids.add(oid);
  index.childTextByParentOid = taskChildTextByParentOid(index.entries);
  return index;
}

function compactTaskReferencesById(payload = {}, settings = DEFAULT_SETTINGS) {
  const compactById = new Map();
  for (const group of [payload.byPath || [], payload.bySectionId || []]) {
    for (const [, entries] of group) {
      for (const entry of entries || []) {
        const id = String(entry?.id || "");
        if (id && !compactById.has(id)) compactById.set(id, hydrateCompactTaskReference(entry, settings));
      }
    }
  }
  return compactById;
}

function taskReferenceEntriesForHydration(settings = DEFAULT_SETTINGS, compactById = new Map()) {
  const entries = Object.entries(settings.taskCache || {});
  return entries.length ? entries : Array.from(compactById.entries());
}

function compactOidMap(payload = {}) {
  return new Map((payload.byOid || [])
    .map(([oid, id]) => [String(oid || "").toUpperCase(), String(id || "")])
    .filter(([oid, id]) => oid && id));
}

function compactUsedOidSet(payload = {}, pendingReferences = []) {
  const used = new Set((payload.usedOids || []).map((oid) => String(oid || "").toUpperCase()).filter(Boolean));
  for (const reference of pendingReferences) {
    const oid = String(reference?.oid || "").toUpperCase();
    if (oid) used.add(oid);
  }
  return used;
}

function compactGroupedReferenceMap(groups = [], settings = DEFAULT_SETTINGS, options = {}) {
  const useGroupPath = options.useGroupPath !== false;
  return new Map((groups || []).map(([groupKey, entries]) => {
    const key = useGroupPath ? vaultRelativePath(groupKey) : String(groupKey || "");
    return [key, (entries || [])
      .map((entry) => [String(entry.id || ""), hydrateCompactTaskReference(entry, settings)])
      .filter(([id]) => id)];
  }).filter(([key]) => key));
}

function populatePathReferenceIndexes(index) {
  for (const [id, task] of index.entries) {
    const path = vaultRelativePath(task?.path || "");
    if (!path) continue;
    const pathEntries = index.byPath.get(path) || [];
    pathEntries.push([String(id), task]);
    index.byPath.set(path, pathEntries);
    index.cachedTaskPaths.add(path);
    if (task?.oid || task?.isSubtask || task?.parentOid || task?.parentId) index.pathsForIndentRepair.add(path);
  }
}

function populateSectionReferenceIndex(index) {
  for (const [id, task] of index.entries) {
    const sectionId = String(task?.sectionId || "");
    if (!sectionId) continue;
    const sectionEntries = index.bySectionId.get(sectionId) || [];
    sectionEntries.push([String(id), task]);
    index.bySectionId.set(sectionId, sectionEntries);
  }
}

function hydrateCompactTaskReference(entry = {}, settings = DEFAULT_SETTINGS) {
  const cached = settings.taskCache?.[String(entry.id || "")];
  if (cached) return cached;
  return {
    oid: entry.oid || "",
    path: vaultRelativePath(entry.path || ""),
    content: entry.content || "",
    isSubtask: Boolean(entry.isSubtask),
    parentOid: entry.parentOid || "",
    section: entry.section || "",
    sectionId: entry.sectionId || "",
    projectId: entry.projectId || "",
    projectName: entry.projectName || "",
    scheduledDueDateTime: entry.scheduledDueDateTime || "",
    duration: normalizeTodoistDuration(entry.duration),
    knowledge: compactTaskKnowledge(entry.knowledge),
    cachedAt: entry.cachedAt || ""
  };
}

function dedupeTaskReferenceState(settings = DEFAULT_SETTINGS) {
  let changed = false;
  const nextCache = {};
  const seenDuplicateOids = new Map();
  for (const [id, task] of Object.entries(settings.taskCache || {})) {
    if (!task || typeof task !== "object") {
      changed = true;
      continue;
    }
    const normalized = Object.assign({}, task, {
      labels: uniqueValues((task.labels || []).map(cleanLabel).filter(Boolean)),
      noteRefs: mergeNoteReferences([], task.noteRefs || [])
    });
    normalized.knowledge = taskKnowledgeSnapshot(normalized, settings, "", task.knowledge || null);
    const oid = String(normalized.oid || "").toUpperCase();
    const duplicateId = oid ? seenDuplicateOids.get(oid) : "";
    if (duplicateId) {
      const existing = nextCache[duplicateId];
      if (existing && taskReferenceDuplicateKey(existing) === taskReferenceDuplicateKey(normalized)) {
        nextCache[duplicateId] = mergeReferenceCacheEntry(existing, normalized);
        changed = true;
        continue;
      }
    }
    if (oid) seenDuplicateOids.set(oid, id);
    if (JSON.stringify(normalized) !== JSON.stringify(task)) changed = true;
    nextCache[id] = normalized;
  }
  const nextPending = {};
  for (const reference of Object.values(settings.pendingTaskReferences || {})) {
    if (!reference?.oid) {
      changed = true;
      continue;
    }
    const normalized = Object.assign({}, reference, {
      labels: reference.labels ? uniqueValues((reference.labels || []).map(cleanLabel).filter(Boolean)) : reference.labels
    });
    normalized.knowledge = taskKnowledgeSnapshot(normalized, settings, "", reference.knowledge || null);
    const key = pendingTaskOidKey(normalized.path || reference.path || "", normalized.oid);
    if (nextPending[key]) {
      nextPending[key] = Object.assign({}, nextPending[key], normalized);
      changed = true;
    } else nextPending[key] = normalized;
  }
  if (JSON.stringify(nextCache) !== JSON.stringify(settings.taskCache || {})) changed = true;
  if (JSON.stringify(nextPending) !== JSON.stringify(settings.pendingTaskReferences || {})) changed = true;
  settings.taskCache = nextCache;
  settings.pendingTaskReferences = nextPending;
  settings.pendingTaskDescriptions = settings.pendingTaskDescriptions || {};
  return changed;
}

function taskReferenceDuplicateKey(task) {
  return [
    vaultRelativePath(task?.path || ""),
    String(task?.lineNumber ?? ""),
    singleLine(task?.content || "").toLowerCase()
  ].join("::");
}

function referenceRows(settings) {
  const rows = [];
  const seenOids = new Set();
  for (const [todoistId, task] of Object.entries(settings.taskCache || {})) {
    const oid = String(task.oid || "").trim();
    if (!oid) continue;
    seenOids.add(oid.toUpperCase());
    rows.push({
      oid,
      todoistId,
      task: task.content || "",
      priority: String(task.priority || ""),
      date: task.due_date || "",
      scheduled: task.scheduledDueDateTime || "",
      duration: durationMinutes(task.duration) ? `${durationMinutes(task.duration)} min` : "",
      deadline: task.deadline_date || "",
      project: task.projectName || "",
      projectId: task.projectId || "",
      section: task.section || "",
      sectionId: task.sectionId || "",
      parentOid: task.parentOid || "",
      parentTodoistId: task.parentId || "",
      parentTask: task.parentContent || "",
      noteRefs: referenceNoteRefsText(task),
      description: task.description ? truncateAtWord(task.description.replace(/\n/g, " "), 160) : "",
      path: task.path || "",
      status: task.isCompleted ? "Completed" : task.isSubtask ? "Subtask" : "Main"
    });
  }
  for (const pending of Object.values(settings.pendingTaskReferences || {})) {
    const oid = String(pending.oid || "").trim();
    if (!oid || seenOids.has(oid.toUpperCase())) continue;
    rows.push({
      oid,
      todoistId: "",
      task: pending.content || "",
      priority: "",
      date: "",
      scheduled: "",
      duration: "",
      deadline: "",
      project: pending.projectName || "",
      projectId: pending.projectId || "",
      section: pending.section || "",
      sectionId: pending.sectionId || "",
      parentOid: pending.parentOid || "",
      parentTodoistId: pending.parentId || "",
      parentTask: pending.parentContent || "",
      noteRefs: pending.path || "",
      description: "",
      path: pending.path || "",
      status: pending.isSubtask ? "Pending subtask" : "Pending main"
    });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path) || a.task.localeCompare(b.task));
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function taskSchema() {
  const task = {
    type: "object",
    additionalProperties: false,
    properties: {
      content: { type: "string" },
      description: { type: "string" },
      due_date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      deadline_date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      priority: { type: "integer", minimum: 1, maximum: 4 },
      labels: { type: "array", items: { type: "string" } }
    },
    required: ["content", "description", "due_date", "deadline_date", "priority", "labels"]
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      tasks: {
        type: "array",
        maxItems: 30,
        items: Object.assign({}, task, {
          properties: Object.assign({}, task.properties, {
            subtasks: { type: "array", maxItems: 15, items: task }
          }),
          required: task.required.concat(["subtasks"])
        })
      }
    },
    required: ["tasks"]
  };
}

function taskCreationSchema(maxMainTasks = DEFAULT_SETTINGS.maxGeneratedMainTasks, maxSubtasks = DEFAULT_SETTINGS.maxGeneratedSubtasksPerMainTask) {
  const mainLimit = generationMainTaskLimit({ maxGeneratedMainTasks: maxMainTasks });
  const subtaskLimit = generationSubtaskLimit({ maxGeneratedSubtasksPerMainTask: maxSubtasks });
  const task = {
    type: "object",
    additionalProperties: false,
    properties: {
      content: { type: "string" },
      due_date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      deadline_date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      priority: { type: "integer", minimum: 1, maximum: 4 },
      labels: { type: "array", items: { type: "string" } }
    },
    required: ["content", "due_date", "deadline_date", "priority", "labels"]
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      section_name: { type: "string" },
      tasks: {
        type: "array",
        maxItems: mainLimit,
        items: Object.assign({}, task, {
          properties: Object.assign({}, task.properties, {
            subtasks: { type: "array", maxItems: subtaskLimit, items: task }
          }),
          required: task.required.concat(["subtasks"])
        })
      }
    },
    required: ["section_name", "tasks"]
  };
}

function generationMainTaskLimit(settings = DEFAULT_SETTINGS) {
  return Math.max(1, Math.min(30, parseInt(settings.maxGeneratedMainTasks, 10) || DEFAULT_SETTINGS.maxGeneratedMainTasks));
}

function generationSubtaskLimit(settings = DEFAULT_SETTINGS) {
  return Math.max(0, Math.min(15, parseInt(settings.maxGeneratedSubtasksPerMainTask, 10) || DEFAULT_SETTINGS.maxGeneratedSubtasksPerMainTask));
}

function limitGeneratedTasks(tasks, maxMainTasks, maxSubtasks) {
  return (tasks || []).slice(0, generationMainTaskLimit({ maxGeneratedMainTasks: maxMainTasks })).map((task) => {
    return Object.assign({}, task, {
      subtasks: (task.subtasks || []).slice(0, generationSubtaskLimit({ maxGeneratedSubtasksPerMainTask: maxSubtasks }))
    });
  });
}

function enforceGeneratedTaskLimits(tasks, settings = DEFAULT_SETTINGS) {
  const maxMain = generationMainTaskLimit(settings);
  const maxSubtasks = generationSubtaskLimit(settings);
  if (Array.isArray(tasks) && tasks.length > maxMain) tasks.splice(maxMain);
  for (const task of tasks || []) {
    if (Array.isArray(task.subtasks) && task.subtasks.length > maxSubtasks) task.subtasks.splice(maxSubtasks);
  }
  return tasks;
}

function taskDescriptionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      descriptions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: { type: "integer", minimum: 0 },
            description: { type: "string", minLength: 80, maxLength: 1200 }
          },
          required: ["index", "description"]
        }
      }
    },
    required: ["descriptions"]
  };
}

function scheduleDurationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      estimates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            minutes: { type: "integer", minimum: 1, maximum: 1440 },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            independent_subtask: { type: "boolean" },
            split_title: { type: "string" }
          },
          required: ["id", "minutes", "confidence", "independent_subtask", "split_title"]
        }
      }
    },
    required: ["estimates"]
  };
}

function emptySchedulerMemory() {
  return { version: 2, updatedAt: "", durationPolicies: defaultSchedulerDurationPolicies(), entries: {} };
}

function normalizeSchedulerMemory(payload) {
  const normalized = emptySchedulerMemory();
  normalized.updatedAt = String(payload?.updatedAt || "");
  normalized.durationPolicies = normalizeSchedulerDurationPolicies(payload?.durationPolicies);
  const entries = payload?.entries && typeof payload.entries === "object" ? payload.entries : {};
  for (const [key, value] of Object.entries(entries)) {
    const entry = normalizeSchedulerMemoryEntry(value, key);
    if (entry?.key) normalized.entries[entry.key] = entry;
  }
  return compactSchedulerMemory(normalized);
}

function normalizeSchedulerMemoryEntry(value, fallbackKey = "") {
  if (!value || typeof value !== "object") return null;
  const key = String(value.key || fallbackKey || "").trim();
  if (!key) return null;
  const entry = {
    key,
    title: singleLine(value.title || ""),
    contentHash: String(value.contentHash || ""),
    parentContent: singleLine(value.parentContent || ""),
    isSubtask: Boolean(value.isSubtask),
    ids: uniqueValues(value.ids || []).slice(0, 8),
    oids: uniqueValues(value.oids || []).slice(0, 8),
    paths: uniqueValues(value.paths || []).slice(-SCHEDULER_MEMORY_MAX_CONTEXT_PATHS),
    projectIds: uniqueValues(value.projectIds || []).slice(0, 8),
    projectNames: uniqueValues(value.projectNames || []).slice(0, 8),
    sections: uniqueValues(value.sections || []).slice(0, 8),
    labels: uniqueValues(value.labels || []).slice(0, 16),
    contextPaths: uniqueValues(value.contextPaths || []).slice(-SCHEDULER_MEMORY_MAX_CONTEXT_PATHS),
    contextTerms: uniqueValues(value.contextTerms || []).slice(0, SCHEDULER_MEMORY_MAX_CONTEXT_TERMS),
    priority: Object.assign({ last: 1, max: 1, samples: 0 }, value.priority || {}),
    duration: Object.assign({ last: 0, average: 0, samples: 0, source: "" }, value.duration || {}),
    order: Object.assign({
      samples: 0,
      avgPosition: 0,
      lastStartMinutes: null,
      lastOrderIndex: null,
      lastOrderTotal: null,
      scheduledCount: 0,
      promotedCount: 0,
      bumpedCount: 0,
      manualDurationCount: 0,
      manualOrderCount: 0
    }, value.order || {}),
    outcomes: Object.assign({}, value.outcomes || {}),
    lastScheduledDate: String(value.lastScheduledDate || ""),
    lastScheduledDateTime: String(value.lastScheduledDateTime || ""),
    lastObservedAt: String(value.lastObservedAt || ""),
    lastAppliedAt: String(value.lastAppliedAt || ""),
    updatedAt: String(value.updatedAt || "")
  };
  entry.priority.last = normalizePriority(entry.priority.last);
  entry.priority.max = normalizePriority(entry.priority.max);
  entry.priority.samples = Math.max(0, Number(entry.priority.samples || 0));
  entry.duration.last = Math.max(0, Math.round(Number(entry.duration.last || 0)));
  entry.duration.average = Math.max(0, Math.round(Number(entry.duration.average || 0)));
  entry.duration.samples = Math.max(0, Number(entry.duration.samples || 0));
  entry.order.samples = Math.max(0, Number(entry.order.samples || 0));
  entry.order.avgPosition = Math.max(0, Math.min(1, Number(entry.order.avgPosition || 0)));
  return entry;
}

function compactSchedulerMemory(memory) {
  const compact = emptySchedulerMemory();
  compact.updatedAt = String(memory?.updatedAt || "");
  compact.durationPolicies = normalizeSchedulerDurationPolicies(memory?.durationPolicies);
  const entries = Object.values(memory?.entries || {})
    .map((entry) => normalizeSchedulerMemoryEntry(entry))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.updatedAt || b.lastAppliedAt || b.lastObservedAt || "") - Date.parse(a.updatedAt || a.lastAppliedAt || a.lastObservedAt || ""));
  for (const entry of entries.slice(0, SCHEDULER_MEMORY_MAX_ENTRIES)) compact.entries[entry.key] = entry;
  return compact;
}

function defaultSchedulerDurationPolicies() {
  return [
    {
      id: SCHEDULER_PEOPLE_FOLLOWUP_POLICY_ID,
      enabled: true,
      maxMinutes: 30,
      maxMinutesSetting: "scheduleTodayMinBlockMinutes",
      appliesTo: "Tasks whose main action is to follow up, discuss, check in, call, email, ask, confirm, coordinate, collaborate, or schedule with another person.",
      rationale: DEFAULT_SCHEDULER_POLICY_TEXT.peopleFollowupRationale,
      excludeWhen: "Do not apply when the task clearly requires preparing, reviewing, writing, analyzing, creating, or finalizing material during the block."
    },
    {
      id: SCHEDULER_DEFAULT_FOCUS_POLICY_ID,
      enabled: true,
      targetMinutes: 60,
      appliesTo: "Ordinary focused-work tasks without clear complexity or quick-outreach signals.",
      rationale: DEFAULT_SCHEDULER_POLICY_TEXT.defaultFocusRationale,
      excludeWhen: "Do not apply to people-follow-up tasks, explicitly short tasks, or clearly complex document/review/strategy work."
    },
    {
      id: SCHEDULER_RELATED_GROUPING_POLICY_ID,
      enabled: true,
      boost: 0.45,
      appliesTo: "Tasks sharing the same parent, project, section, note path, or meaningful labels/context terms.",
      rationale: DEFAULT_SCHEDULER_POLICY_TEXT.relatedGroupingRationale,
      excludeWhen: "Do not group tasks when priority, deadline proximity, fixed schedule blocks, lunch, or available time make grouping impractical."
    }
  ];
}

function normalizeSchedulerDurationPolicies(policies) {
  const byId = new Map();
  for (const policy of defaultSchedulerDurationPolicies()) byId.set(policy.id, policy);
  const list = Array.isArray(policies) ? policies : [];
  for (const value of list) {
    if (!value || typeof value !== "object") continue;
    const rawId = singleLine(value.id || "");
    const id = isSchedulerPeopleFollowupPolicyId(rawId) ? SCHEDULER_PEOPLE_FOLLOWUP_POLICY_ID : rawId;
    if (!id) continue;
    const base = byId.get(id) || {};
    byId.set(id, {
      id,
      enabled: value.enabled !== false,
      maxMinutes: Math.max(30, Math.min(8 * 60, Math.round(Number(value.maxMinutes || base.maxMinutes || 30)))),
      maxMinutesSetting: singleLine(value.maxMinutesSetting || base.maxMinutesSetting || ""),
      targetMinutes: Math.max(0, Math.min(8 * 60, Math.round(Number(value.targetMinutes || base.targetMinutes || 0)))),
      boost: Math.max(0, Math.min(2, Number(value.boost ?? base.boost ?? 0))),
      appliesTo: singleLine(value.appliesTo || base.appliesTo || ""),
      rationale: singleLine(value.rationale || base.rationale || ""),
      excludeWhen: singleLine(value.excludeWhen || base.excludeWhen || "")
    });
  }
  return Array.from(byId.values()).filter((policy) => policy.id);
}

function schedulerMemoryDurationPolicies(memory) {
  return normalizeSchedulerDurationPolicies(memory?.durationPolicies);
}

function schedulerPeopleFollowupPolicy(policies = null) {
  return normalizeSchedulerDurationPolicies(policies).find((policy) => isSchedulerPeopleFollowupPolicyId(policy.id) && policy.enabled !== false) || null;
}

function schedulerDefaultFocusPolicy(policies = null) {
  return normalizeSchedulerDurationPolicies(policies).find((policy) => policy.id === SCHEDULER_DEFAULT_FOCUS_POLICY_ID && policy.enabled !== false) || null;
}

function schedulerRelatedGroupingPolicy(policies = null) {
  return normalizeSchedulerDurationPolicies(policies).find((policy) => policy.id === SCHEDULER_RELATED_GROUPING_POLICY_ID && policy.enabled !== false) || null;
}

function isSchedulerPeopleFollowupPolicyId(id) {
  const value = singleLine(id || "");
  return value === SCHEDULER_PEOPLE_FOLLOWUP_POLICY_ID || SCHEDULER_PEOPLE_FOLLOWUP_POLICY_ALIASES.includes(value);
}

function schedulerDurationPolicyMaxMinutes(policy, config = {}) {
  if (policy?.maxMinutesSetting === "scheduleTodayMinBlockMinutes") {
    return Math.max(1, Math.round(Number(config.minBlockMinutes || policy.maxMinutes || 30)));
  }
  return Math.max(30, Math.round(Number(policy?.maxMinutes || 30)));
}

function schedulerDefaultFocusMinutes(config = {}, policies = null) {
  const policy = schedulerDefaultFocusPolicy(policies);
  const target = policy?.targetMinutes || 60;
  return Math.max(config.minBlockMinutes || 30, roundToScheduleChunk(target, config) || target);
}

function formatSchedulerDurationPolicies(policies = null, config = {}) {
  return normalizeSchedulerDurationPolicies(policies)
    .filter((policy) => policy.enabled !== false)
    .map((policy) => {
      const source = policy.maxMinutesSetting === "scheduleTodayMinBlockMinutes" ? " (current scheduler minimum duration setting)" : "";
      const duration = policy.id === SCHEDULER_DEFAULT_FOCUS_POLICY_ID
        ? `target ${schedulerDefaultFocusMinutes(config, [policy])} min`
        : policy.id === SCHEDULER_RELATED_GROUPING_POLICY_ID
          ? `grouping boost ${Number(policy.boost || 0).toFixed(2)}`
          : `max ${schedulerDurationPolicyMaxMinutes(policy, config)} min${source}`;
      return `- ${policy.id}: ${duration}. Applies to: ${policy.appliesTo} Rationale: ${policy.rationale} Exclude when: ${policy.excludeWhen}`;
    })
    .join("\n");
}

function schedulerMemoryPolicySummary(policies = null, config = {}) {
  return `Scheduler memory policies:\n${formatSchedulerDurationPolicies(policies, config) || "- No active scheduler memory policies."}`;
}

function parseSchedulerMemoryChatCommand(prompt, settings = DEFAULT_SETTINGS) {
  const text = String(prompt || "").trim();
  const lower = text.toLowerCase();
  if (!/(scheduler|scheduling).{0,30}memory|memory.{0,30}(scheduler|scheduling)|duration polic|scheduling logic|schedule logic/.test(lower)) return null;
  const wantsUpdate = /\b(update|set|change|make|remember|prefer|cap|use|enable|disable|adjust|tune|teach|learn|policy|policies)\b/.test(lower);
  const wantsShow = /\b(show|list|what|current|view|display)\b/.test(lower) && !wantsUpdate;
  const command = { showOnly: wantsShow };
  const minuteMatch = /(\d{1,3})\s*(?:min|mins|minute|minutes)\b/.exec(lower);
  const minutes = minuteMatch ? Math.max(1, Math.min(8 * 60, Number(minuteMatch[1]))) : 0;
  if (/\b(follow[- ]?up|discuss|discussion|check[- ]?in|call|email|ask|confirm|coordinate|collaborate|person|individual)\b/.test(lower)) {
    if (/\b(minimum|min block|smallest|setting|settings)\b/.test(lower) || !minutes) command.peopleFollowupMinimum = true;
    else command.peopleFollowupMaxMinutes = minutes;
  }
  if (/\b(default|ordinary|normal|general|focused[- ]?work|focus work|about an hour|one hour|1 hour)\b/.test(lower)) {
    command.defaultFocusMinutes = minutes || (/about an hour|one hour|1 hour/.test(lower) ? 60 : 0);
  }
  if (/\b(group|cluster|together|related|same project|same note|same parent|build off|builds off)\b/.test(lower)) {
    command.relatedGrouping = !/\b(disable|turn off|stop|do not|don't)\b/.test(lower);
    if (/\b(more|stronger|increase|high)\b/.test(lower)) command.relatedGroupingBoost = 0.65;
    else if (/\b(less|weaker|decrease|low)\b/.test(lower)) command.relatedGroupingBoost = 0.25;
    else command.relatedGroupingBoost = 0.45;
  }
  if (command.showOnly || command.peopleFollowupMinimum || command.peopleFollowupMaxMinutes || command.defaultFocusMinutes || command.relatedGrouping != null || wantsUpdate) return command;
  return null;
}

function schedulerMemoryPolicyCommandSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      show_only: { type: "boolean" },
      people_followup_mode: { type: ["string", "null"], enum: ["minimum", "fixed", "unchanged", null] },
      people_followup_max_minutes: { type: ["integer", "null"], minimum: 1, maximum: 480 },
      default_focus_minutes: { type: ["integer", "null"], minimum: 1, maximum: 480 },
      related_grouping: { type: ["string", "null"], enum: ["enable", "disable", "unchanged", null] },
      related_grouping_strength: { type: ["string", "null"], enum: ["less", "moderate", "more", "unchanged", null] },
      rationale: { type: "string" }
    },
    required: [
      "show_only",
      "people_followup_mode",
      "people_followup_max_minutes",
      "default_focus_minutes",
      "related_grouping",
      "related_grouping_strength",
      "rationale"
    ]
  };
}

function schedulerMemoryPolicyCommandFromAi(value = {}) {
  const command = {};
  if (value.show_only === true) command.showOnly = true;
  const peopleMode = String(value.people_followup_mode || "unchanged").toLowerCase();
  const peopleMinutes = Math.max(1, Math.min(8 * 60, Math.round(Number(value.people_followup_max_minutes || 0))));
  if (peopleMode === "minimum") command.peopleFollowupMinimum = true;
  else if (peopleMode === "fixed" && peopleMinutes) command.peopleFollowupMaxMinutes = peopleMinutes;
  const focusMinutes = Math.max(1, Math.min(8 * 60, Math.round(Number(value.default_focus_minutes || 0))));
  if (focusMinutes) command.defaultFocusMinutes = focusMinutes;
  const grouping = String(value.related_grouping || "unchanged").toLowerCase();
  if (grouping === "enable") command.relatedGrouping = true;
  else if (grouping === "disable") command.relatedGrouping = false;
  const strength = String(value.related_grouping_strength || "unchanged").toLowerCase();
  if (strength === "less") command.relatedGroupingBoost = 0.25;
  else if (strength === "moderate") command.relatedGroupingBoost = 0.45;
  else if (strength === "more") command.relatedGroupingBoost = 0.65;
  return command;
}

function parseTaskDeduplicationPolicyChatCommand(prompt) {
  const text = String(prompt || "").trim();
  const lower = text.toLowerCase();
  if (!/\b(dedupe|deduplication|duplicate task|duplicate tasks|task matching|match tasks|merge logic|merge policy|task merge)\b/.test(lower)) return null;
  const wantsUpdate = /\b(update|set|change|make|remember|prefer|enable|disable|adjust|tune|teach|learn|reset)\b/.test(lower);
  const wantsShow = /\b(show|list|what|current|view|display|summari[sz]e)\b/.test(lower) && !wantsUpdate;
  if (wantsShow) return { showOnly: true };
  if (/\b(reset|restore default|default policy)\b/.test(lower)) return { reset: true };
  if (!wantsUpdate) return null;
  const updateMatch = text.match(/(?:dedupe|deduplication|duplicate tasks?|task matching|merge logic|merge policy|task merge)[^:]*:\s*([\s\S]+)/i);
  return {
    updateText: singleLine(updateMatch?.[1] || text)
  };
}

function taskDeduplicationPolicyCommandSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      policy_text: { type: "string" },
      impact_summary: { type: "string" }
    },
    required: ["policy_text", "impact_summary"]
  };
}

function taskDeduplicationAiDecisionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      match: { type: "boolean" },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      reason: { type: "string" }
    },
    required: ["match", "confidence", "reason"]
  };
}

function taskDeduplicationAiMergeSchema(settings = DEFAULT_SETTINGS) {
  const task = taskSchema().properties.tasks.items;
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      match: { type: "boolean" },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      reason: { type: "string" },
      task
    },
    required: ["match", "confidence", "reason", "task"]
  };
}

function taskDeduplicationPolicyCommandFromAi(value = {}, currentPolicy = "") {
  const policyText = normalizeTaskDeduplicationPolicyText(value?.policy_text || currentPolicy || DEFAULT_TASK_DEDUPLICATION_POLICY);
  return {
    policyText,
    impactSummary: truncateAtWord(singleLine(value?.impact_summary || taskDeduplicationPolicyImpactText(DEFAULT_SETTINGS, policyText)), 220)
  };
}

function normalizeTaskDeduplicationPolicyText(value = "") {
  const text = String(value || "").replace(/\r/g, "").trim();
  return text || DEFAULT_TASK_DEDUPLICATION_POLICY;
}

function calibratedTaskDeduplicationPolicyText(value = "") {
  let text = normalizeTaskDeduplicationPolicyText(value || DEFAULT_TASK_DEDUPLICATION_POLICY);
  const additions = [
    "Treat same-project tasks as duplicates when one is a richer, poorer, broader, or more concise expression of the same action and the existing task would be satisfied by merging the newer details.",
    "Treat parent and subtask records as duplicates when the subtask merely restates the parent action or the parent only adds context around the same single action; hierarchy alone is not a reason to keep duplicate task records.",
    "Treat identical or near-identical task titles as duplicate candidates even when they sit under different parent tasks, unless parent context clearly changes the object, person, deliverable, or next step.",
    "Do not merge similar tasks across different concrete Todoist projects. Treat Inbox as generic, but two named non-Inbox projects are separate work contexts unless the user explicitly moves or links the task across projects.",
    "Do not merge a distinct component subtask into a broader parent task when the parent contains multiple decisions, questions, recipients, documents, or steps and the subtask represents only one separable piece.",
    "Do not merge a newer specific progress task, such as reviewing a named person's edits, approvals, returned comments, or current status update, into an older broader project task unless both records require the same immediate next action."
  ];
  for (const addition of additions) {
    const marker = addition.slice(0, 72).toLowerCase();
    if (!text.toLowerCase().includes(marker)) text = `${text}\n- ${addition}`;
  }
  return normalizeTaskDeduplicationPolicyText(text);
}

function taskDeduplicationPolicyText(settings = DEFAULT_SETTINGS) {
  return calibratedTaskDeduplicationPolicyText(settings.taskDeduplicationPolicy || DEFAULT_TASK_DEDUPLICATION_POLICY);
}

function appendTaskDeduplicationPolicyInstruction(currentPolicy = "", instruction = "") {
  const cleanInstruction = singleLine(instruction || "");
  if (!cleanInstruction) return taskDeduplicationPolicyText({ taskDeduplicationPolicy: currentPolicy });
  return normalizeTaskDeduplicationPolicyText(`${currentPolicy || DEFAULT_TASK_DEDUPLICATION_POLICY}\n- ${cleanInstruction}`);
}

function taskDeduplicationPolicyImpactText(settings = DEFAULT_SETTINGS, policyText = "") {
  const strictness = settings.taskDeduplicationStrictness || DEFAULT_SETTINGS.taskDeduplicationStrictness;
  const ai = modelDisplayName(taskDeduplicationAiModel(settings));
  const labels = settings.taskDeduplicationMergeLabelsAdditive === false ? "replacement" : "additive";
  const removal = settings.taskDeduplicationAllowExplicitSubtaskRemoval === false ? "explicit subtask removal disabled" : "explicit obsolete subtasks can be omitted";
  const policy = policyText || taskDeduplicationPolicyText(settings);
  const sensitivity = settings.taskDeduplicationAiReviewSensitivity || DEFAULT_SETTINGS.taskDeduplicationAiReviewSensitivity;
  return `Strictness: ${strictness}. AI dedupe model: ${ai}. AI-mediated dedupe: ${settings.enableAiAmbiguousTaskDeduplication ? `on (${sensitivity})` : "off"}. Labels: ${labels}. Subtasks: ${removal}. Policy length: ${policy.split(/\n+/).filter(Boolean).length} lines.`;
}

function taskDeduplicationPolicySettingsSummary(settings = DEFAULT_SETTINGS) {
  return [
    "Task deduplication policy:",
    taskDeduplicationPolicyText(settings),
    "",
    "Current impact:",
    taskDeduplicationPolicyImpactText(settings)
  ].join("\n");
}

function taskDeduplicationAiModel(settings = DEFAULT_SETTINGS) {
  const selected = settings.taskDeduplicationAiModel || "";
  if (selected) return selected;
  const fallback = settings.chatFallbackModel || DEFAULT_SETTINGS.chatFallbackModel || "";
  if (usesGeminiChatModel(fallback)) return `gemini/${normalizeGeminiModelId(fallback)}`;
  if (usesOpenAIChatModel(fallback)) return normalizeOpenAIModelId(fallback);
  return fallback || DEFAULT_SETTINGS.chatModel;
}

function hasChatCredentialForModel(settings = DEFAULT_SETTINGS, model = "") {
  return usesGeminiChatModel(model) ? Boolean(settings.googleApiKey) : Boolean(settings.openaiApiKey);
}

function mergeSchedulerMemoryChatCommands(local = {}, ai = {}) {
  const merged = Object.assign({}, local || {});
  for (const [key, value] of Object.entries(ai || {})) {
    if (value !== undefined && value !== null && value !== "") merged[key] = value;
  }
  return merged;
}

function schedulerMemoryEntry(memory, task) {
  if (!memory || !task) return null;
  memory.entries = memory.entries || {};
  const match = schedulerMemoryExactMatch(memory, task);
  if (match?.entry) return match.entry;
  const key = schedulerMemoryKey(task);
  if (!key) return null;
  const entry = normalizeSchedulerMemoryEntry({ key }) || { key };
  memory.entries[key] = entry;
  return entry;
}

function schedulerMemoryForCandidate(memory, candidate) {
  if (!memory?.entries || !candidate) return null;
  const exact = schedulerMemoryExactMatch(memory, candidate);
  if (exact?.entry) return Object.assign({}, exact.entry, { exact: true });
  const candidateTerms = new Set(schedulerContextTokens(candidate));
  const candidatePaths = new Set(schedulerTaskPaths(candidate));
  const candidateLabels = new Set(cleanTodoistLabels(candidate.labels || []).map((label) => label.toLowerCase()));
  let best = null;
  for (const entry of Object.values(memory.entries || {})) {
    const score = schedulerMemorySimilarity(entry, candidate, candidateTerms, candidatePaths, candidateLabels);
    if (!best || score > best.score) best = { entry, score };
  }
  if (!best || best.score < 0.55) return null;
  return Object.assign({}, best.entry, { exact: false, similarity: best.score });
}

function schedulerMemoryExactMatch(memory, task) {
  const key = schedulerMemoryKey(task);
  if (key && memory.entries?.[key]) return { entry: memory.entries[key], key };
  const id = String(task?.id || "").trim();
  const oid = String(task?.oid || "").trim();
  const contentHash = schedulerTaskContentHash(task);
  for (const entry of Object.values(memory.entries || {})) {
    if (id && (entry.ids || []).includes(id)) return { entry, key: entry.key };
    if (oid && (entry.oids || []).includes(oid)) return { entry, key: entry.key };
    if (contentHash && entry.contentHash === contentHash && schedulerTaskPaths(task).some((path) => (entry.paths || []).includes(path))) return { entry, key: entry.key };
  }
  return null;
}

function schedulerMemoryKey(task) {
  const oid = String(task?.oid || "").trim();
  if (oid) return `oid:${oid}`;
  const id = String(task?.id || "").trim();
  if (id) return `todoist:${id}`;
  const contentHash = schedulerTaskContentHash(task);
  return contentHash ? `sig:${contentHash}` : "";
}

function schedulerTaskContentHash(task) {
  const text = [
    singleLine(task?.content || task?.title || ""),
    singleLine(task?.parentContent || ""),
    singleLine(task?.projectName || ""),
    singleLine(task?.section || ""),
    schedulerTaskPaths(task)[0] || ""
  ].join("|");
  return text.trim() ? shortHash(text.toLowerCase()) : "";
}

function schedulerTaskPaths(task, observation = {}) {
  const paths = [];
  if (task?.path) paths.push(task.path);
  if (Array.isArray(task?.noteRefs)) {
    for (const ref of task.noteRefs) {
      if (typeof ref === "string") paths.push(ref);
      else if (ref?.path) paths.push(ref.path);
    }
  }
  if (Array.isArray(observation.contextPaths)) paths.push(...observation.contextPaths);
  return uniqueValues(paths.map((path) => String(path || "").trim()).filter(Boolean));
}

function schedulerContextTokens(task) {
  const text = [
    task?.content,
    task?.description,
    task?.parentContent,
    task?.projectName,
    task?.section,
    task?.path,
    ...(task?.labels || [])
  ].filter(Boolean).join(" ");
  return Object.entries(termCounts(text))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SCHEDULER_MEMORY_MAX_CONTEXT_TERMS)
    .map(([term]) => term);
}

function schedulerMemorySimilarity(entry, candidate, candidateTerms, candidatePaths, candidateLabels) {
  let score = 0;
  const entryTerms = new Set(entry.contextTerms || []);
  const entryPaths = new Set([...(entry.paths || []), ...(entry.contextPaths || [])]);
  const entryLabels = new Set((entry.labels || []).map((label) => label.toLowerCase()));
  const termOverlap = [...candidateTerms].filter((term) => entryTerms.has(term)).length;
  const pathOverlap = [...candidatePaths].filter((path) => entryPaths.has(path)).length;
  const labelOverlap = [...candidateLabels].filter((label) => entryLabels.has(label)).length;
  if (entry.contentHash && entry.contentHash === schedulerTaskContentHash(candidate)) score += 0.35;
  if (pathOverlap) score += Math.min(0.35, 0.2 + pathOverlap * 0.08);
  if (String(candidate.projectId || "") && (entry.projectIds || []).includes(String(candidate.projectId))) score += 0.12;
  if (String(candidate.projectName || "") && (entry.projectNames || []).includes(String(candidate.projectName))) score += 0.08;
  if (labelOverlap) score += Math.min(0.15, labelOverlap * 0.05);
  if (termOverlap) score += Math.min(0.35, termOverlap / Math.max(8, candidateTerms.size || 1));
  return score;
}

function learnedSchedulerDurationMinutes(entry) {
  const duration = entry?.duration || {};
  if (duration.samples && duration.average) return Math.round(duration.average);
  return Math.round(Number(duration.last || 0));
}

function schedulerMemoryScoreAdjustment(entry) {
  if (!entry) return 0;
  const order = entry.order || {};
  const outcomes = entry.outcomes || {};
  let adjustment = 0;
  if (order.samples && order.avgPosition) {
    if (order.avgPosition <= 0.35) adjustment += 0.35;
    else if (order.avgPosition >= 0.75) adjustment -= 0.2;
  }
  adjustment += Math.min(0.5, (order.promotedCount || outcomes.promoted || 0) * 0.14);
  adjustment -= Math.min(0.5, (order.bumpedCount || outcomes.bumped || 0) * 0.14);
  if (order.manualOrderCount) adjustment += 0.1;
  if (entry.exact === false) adjustment *= 0.5;
  return Math.max(-0.75, Math.min(0.75, adjustment));
}

function schedulerMemoryContextText(entry) {
  if (!entry) return "";
  return [
    entry.title,
    entry.parentContent,
    ...(entry.labels || []),
    ...(entry.contextTerms || []).slice(0, 12),
    ...(entry.paths || []).slice(-3),
    ...(entry.contextPaths || []).slice(-3)
  ].filter(Boolean).join(" ");
}

function updateSchedulerMemoryEntry(entry, task, observation = {}) {
  if (!entry || !task) return entry;
  const timestamp = observation.observedAt || deviceTimestamp();
  const paths = schedulerTaskPaths(task, observation);
  const contextTerms = schedulerContextTokens(task);
  const labels = cleanTodoistLabels(task.labels || []);
  const priority = normalizePriority(task.priority);
  entry.title = singleLine(task.content || task.title || entry.title || "");
  entry.contentHash = schedulerTaskContentHash(task) || entry.contentHash || "";
  entry.parentContent = singleLine(task.parentContent || entry.parentContent || "");
  entry.isSubtask = Boolean(task.isSubtask || entry.isSubtask);
  entry.ids = schedulerAppendUnique(entry.ids, [task.id], 8);
  entry.oids = schedulerAppendUnique(entry.oids, [task.oid], 8);
  entry.paths = schedulerAppendUnique(entry.paths, paths, SCHEDULER_MEMORY_MAX_CONTEXT_PATHS);
  entry.projectIds = schedulerAppendUnique(entry.projectIds, [task.projectId], 8);
  entry.projectNames = schedulerAppendUnique(entry.projectNames, [task.projectName], 8);
  entry.sections = schedulerAppendUnique(entry.sections, [task.section], 8);
  entry.labels = schedulerAppendUnique(entry.labels, labels, 16);
  entry.contextPaths = schedulerAppendUnique(entry.contextPaths, observation.contextPaths || [], SCHEDULER_MEMORY_MAX_CONTEXT_PATHS);
  entry.contextTerms = schedulerAppendUnique(entry.contextTerms, contextTerms, SCHEDULER_MEMORY_MAX_CONTEXT_TERMS);
  entry.priority = entry.priority || { last: 1, max: 1, samples: 0 };
  entry.priority.last = priority;
  entry.priority.max = Math.max(normalizePriority(entry.priority.max), priority);
  entry.priority.samples = Math.min(1000, Number(entry.priority.samples || 0) + 1);
  updateSchedulerDurationMemory(entry, observation);
  updateSchedulerOrderMemory(entry, observation);
  const outcome = singleLine(observation.outcome || "observed");
  entry.outcomes = entry.outcomes || {};
  entry.outcomes[outcome] = Math.min(1000, Number(entry.outcomes[outcome] || 0) + 1);
  if (outcome === "scheduled") entry.order.scheduledCount = Math.min(1000, Number(entry.order.scheduledCount || 0) + 1);
  if (outcome === "promoted") entry.order.promotedCount = Math.min(1000, Number(entry.order.promotedCount || 0) + 1);
  if (outcome === "bumped") entry.order.bumpedCount = Math.min(1000, Number(entry.order.bumpedCount || 0) + 1);
  entry.lastScheduledDate = observation.scheduledDate || entry.lastScheduledDate || "";
  entry.lastScheduledDateTime = observation.scheduledDateTime || entry.lastScheduledDateTime || "";
  entry.lastObservedAt = timestamp;
  if (observation.source === "apply") entry.lastAppliedAt = timestamp;
  entry.updatedAt = timestamp;
  return entry;
}

function updateSchedulerDurationMemory(entry, observation = {}) {
  const minutes = Math.round(Number(observation.durationMinutes || 0));
  if (!minutes) return;
  entry.duration = entry.duration || { last: 0, average: 0, samples: 0, source: "" };
  const samples = Math.min(1000, Number(entry.duration.samples || 0) + 1);
  const priorWeight = Math.min(9, Math.max(0, samples - 1));
  entry.duration.average = Math.round(((Number(entry.duration.average || minutes) * priorWeight) + minutes) / (priorWeight + 1));
  entry.duration.last = minutes;
  entry.duration.samples = samples;
  entry.duration.source = observation.source || entry.duration.source || "";
  if (observation.manualDurationChange) {
    entry.order = entry.order || {};
    entry.order.manualDurationCount = Math.min(1000, Number(entry.order.manualDurationCount || 0) + 1);
  }
}

function updateSchedulerOrderMemory(entry, observation = {}) {
  const hasOrder = Number.isFinite(observation.orderIndex) && Number.isFinite(observation.orderTotal) && observation.orderTotal > 0;
  entry.order = entry.order || {};
  if (hasOrder) {
    const position = Math.max(0, Math.min(1, (Number(observation.orderIndex) + 1) / Number(observation.orderTotal)));
    const samples = Math.min(1000, Number(entry.order.samples || 0) + 1);
    const priorWeight = Math.min(9, Math.max(0, samples - 1));
    entry.order.avgPosition = ((Number(entry.order.avgPosition || position) * priorWeight) + position) / (priorWeight + 1);
    entry.order.samples = samples;
    entry.order.lastOrderIndex = Number(observation.orderIndex);
    entry.order.lastOrderTotal = Number(observation.orderTotal);
  }
  if (Number.isFinite(observation.startMinutes)) entry.order.lastStartMinutes = Number(observation.startMinutes);
  if (observation.manualOrderChange) entry.order.manualOrderCount = Math.min(1000, Number(entry.order.manualOrderCount || 0) + 1);
}

function schedulerAppendUnique(existing, incoming, limit) {
  const values = [];
  for (const value of [...(existing || []), ...(incoming || [])]) {
    const text = String(value || "").trim();
    if (!text) continue;
    const existingIndex = values.indexOf(text);
    if (existingIndex >= 0) values.splice(existingIndex, 1);
    values.push(text);
  }
  return values.slice(-limit);
}

function scheduleTodayConfig(settings = DEFAULT_SETTINGS) {
  const chunkMinutes = Math.round(clampNumber(settings.scheduleTodayMinBlockMinutes, DEFAULT_SETTINGS.scheduleTodayMinBlockMinutes || 30, 15, 480));
  const durationStepMinutes = 15;
  const startMinutes = parseClockMinutes(settings.scheduleTodayStartTime, 8 * 60);
  const endMinutes = parseClockMinutes(settings.scheduleTodayEndTime, 16 * 60);
  const safeEnd = endMinutes > startMinutes ? endMinutes : startMinutes + 8 * 60;
  const lunchStartMinutes = parseClockMinutes(settings.scheduleTodayLunchStartTime, 12 * 60);
  const lunchMinutes = roundToScheduleChunk(clampNumber(settings.scheduleTodayLunchMinutes, 0, 0, 240), { chunkMinutes }) || 0;
  const minBlockMinutes = chunkMinutes;
  const maxBlockMinutes = roundToScheduleChunk(clampNumber(settings.scheduleTodayMaxBlockMinutes, 180, minBlockMinutes, 8 * 60), { durationStepMinutes, chunkMinutes: durationStepMinutes }) || 180;
  const addWindowMinutes = roundToScheduleChunk(clampNumber(settings.scheduleTodayAddWindowMinutes, DEFAULT_SETTINGS.scheduleTodayAddWindowMinutes || 30, 0, 240), { durationStepMinutes, chunkMinutes: durationStepMinutes }) || 0;
  const todayDate = today();
  return {
    today: todayDate,
    nextWorkday: nextWorkdayDate(todayDate),
    startMinutes,
    endMinutes: safeEnd,
    lunchStartMinutes,
    lunchEndMinutes: lunchStartMinutes + lunchMinutes,
    lunchMinutes,
    minBlockMinutes,
    maxBlockMinutes,
    addWindowMinutes,
    chunkMinutes,
    durationStepMinutes,
    dueWindowDays: Math.max(0, parseInt(settings.scheduleTodayDueWindowDays, 10) || DEFAULT_SETTINGS.scheduleTodayDueWindowDays || 2),
    excludedLabels: new Set(splitList(settings.scheduleTodayExcludedLabels).map(cleanLabel).map((label) => label.toLowerCase()).filter(Boolean)),
    weights: scheduleTodayWeights(settings)
  };
}

function scheduleTodayWeights(settings = DEFAULT_SETTINGS) {
  return {
    todoistPriority: scheduleWeightValue(settings.scheduleTodayWeightTodoistPriority),
    deadlineProximity: scheduleWeightValue(settings.scheduleTodayWeightDeadlineProximity),
    overdue: scheduleWeightValue(settings.scheduleTodayWeightOverdue),
    dueDateProximity: scheduleWeightValue(settings.scheduleTodayWeightDueDateProximity),
    semanticUrgency: scheduleWeightValue(settings.scheduleTodayWeightSemanticUrgency),
    noteRecency: scheduleWeightValue(settings.scheduleTodayWeightNoteRecency),
    parentDependency: scheduleWeightValue(settings.scheduleTodayWeightParentDependency)
  };
}

function scheduleWeightValue(value) {
  const text = String(value || "moderate").toLowerCase();
  if (text === "less") return 0.65;
  if (text === "more") return 1.35;
  return 1;
}

function scheduleTodayCandidates(tasks, settings = DEFAULT_SETTINGS, config = scheduleTodayConfig(settings), schedulerMemory = null) {
  const cache = settings.taskCache || {};
  const byId = new Map((tasks || []).map((task) => [task.id, task]));
  const durationPolicies = schedulerMemoryDurationPolicies(schedulerMemory);
  return (tasks || [])
    .map((task) => {
      const cached = cache[task.id] || {};
      const labels = cleanTodoistLabels(task.labels || cached.labels || []);
      const lowerLabels = new Set(labels.map((label) => label.toLowerCase()));
      const dueDate = task.dueDate || cached.scheduledDueDateTime || cached.due_date || "";
      const deadlineDate = task.deadlineDate || cached.deadline_date || "";
      const dueDay = datePart(dueDate);
      const dueDays = dueDay ? daysBetweenLocalDates(config.today, dueDay) : Number.POSITIVE_INFINITY;
      const parent = task.parentId ? byId.get(task.parentId) || cache[task.parentId] || {} : {};
      const path = cached.path || "";
      const duration = normalizeTodoistDuration(task.duration || cached.duration);
      const knowledge = compactTaskKnowledge(cached.knowledge || task.knowledge);
      const candidate = {
        id: task.id,
        content: task.content || cached.content || "",
        description: task.description || cached.description || "",
        labels,
        priority: normalizePriority(task.priority || cached.priority),
        dueDate,
        dueDay,
        deadlineDate,
        deadlineDay: datePart(deadlineDate),
        isSubtask: Boolean(task.parentId || cached.isSubtask),
        parentId: task.parentId || cached.parentId || "",
        parentOid: cached.parentOid || "",
        parentContent: parent.content || cached.parentContent || "",
        parentLineNumber: cached.parentLineNumber ?? null,
        section: task.section || cached.section || "",
        sectionId: task.sectionId || cached.sectionId || "",
        projectId: task.projectId || cached.projectId || "",
        projectName: task.projectName || cached.projectName || "",
        path,
        lineNumber: cached.lineNumber,
        oid: cached.oid || "",
        knowledge,
        intent: knowledge?.intent || "",
        rationale: knowledge?.rationale || "",
        outcomeType: knowledge?.outcomeType || "",
        isCompleted: Boolean(task.isCompleted || cached.isCompleted),
        remoteDueDate: task.dueDate || "",
        remoteDuration: duration,
        durationMinutes: durationMinutes(duration),
        durationSource: duration ? "Todoist duration" : "",
        scheduledTimeFixed: isDateTimeString(dueDate),
        independentSubtask: false,
        searchText: [task.content, task.description, cached.description, knowledge?.intent, knowledge?.rationale, knowledge?.problem, knowledge?.outcome, knowledge?.dependency, parent.content || cached.parentContent, path].filter(Boolean).join("\n")
      };
      if (candidate.durationMinutes) {
        const adjustedDuration = scheduleDurationWithLocalPolicy(candidate, candidate.durationMinutes, config, durationPolicies);
        if (adjustedDuration < candidate.durationMinutes) {
          candidate.durationMinutes = adjustedDuration;
          candidate.durationSource = `${candidate.durationSource || "Todoist duration"}; capped for follow-up`;
        }
      }
      candidate.independentSubtask = scheduleIndependentSubtask(candidate, settings);
      candidate.semanticUrgency = scheduleSemanticUrgency(candidate);
      candidate.noteRecency = scheduleNoteRecency(cached);
      candidate.parentDependency = candidate.isSubtask || candidate.parentId ? 1 : 0.4;
      candidate.score = scheduleCandidateScore(candidate, config);
      return { candidate, lowerLabels, dueDays };
    })
    .filter(({ candidate, lowerLabels, dueDays }) => {
      if (!candidate.id || !candidate.content) return false;
      if (candidate.isCompleted) return false;
      if (!settings.scheduleTodayIncludeSubtasks && candidate.isSubtask) return false;
      for (const label of lowerLabels) if (config.excludedLabels.has(label)) return false;
      if (candidate.scheduledTimeFixed) return datePart(candidate.dueDate) === config.today;
      if (!candidate.dueDay) return false;
      if (dueDays < 0) return settings.scheduleTodayIncludeOverdue !== false;
      return dueDays <= config.dueWindowDays;
    })
    .map(({ candidate }) => candidate);
}

function applySemanticContextToScheduleCandidates(candidates, context = [], config = scheduleTodayConfig(DEFAULT_SETTINGS)) {
  let matches = 0;
  for (const candidate of candidates || []) {
    const semanticScore = scheduleSemanticContextScore(candidate, context);
    candidate.semanticContextScore = semanticScore;
    if (semanticScore > 0) {
      matches += 1;
      candidate.semanticUrgency = Math.max(Number(candidate.semanticUrgency || 0), semanticScore);
    }
    candidate.score = scheduleCandidateScore(candidate, config);
  }
  return matches;
}

function applyAdaptiveContextPackToScheduleCandidates(candidates, pack = {}, config = scheduleTodayConfig(DEFAULT_SETTINGS)) {
  let matches = 0;
  const taskCards = pack.taskCards || [];
  const projectCards = pack.projectCards || [];
  const noteCards = pack.noteCards || [];
  for (const candidate of candidates || []) {
    if (!candidate) continue;
    const candidateText = singleLine([
      candidate.id,
      candidate.oid,
      candidate.content,
      candidate.description,
      candidate.parentContent,
      candidate.projectName,
      candidate.section,
      candidate.path,
      ...(candidate.labels || [])
    ].filter(Boolean).join(" ")).toLowerCase();
    const taskMatch = taskCards.find((card) => {
      if (card.id && String(card.id) === String(candidate.id)) return true;
      if (card.path && candidate.path && card.path === candidate.path && card.title && candidate.content && singleLine(card.title).toLowerCase() === singleLine(candidate.content).toLowerCase()) return true;
      return false;
    });
    const projectMatch = projectCards.find((card) => {
      const name = singleLine(card.name || "").toLowerCase();
      return name && candidateText.includes(name.toLowerCase());
    });
    const noteMatch = noteCards.find((card) => card.path && candidate.path && card.path === candidate.path);
    const signal = (taskMatch ? 0.35 : 0) + (projectMatch ? 0.18 : 0) + (noteMatch ? 0.22 : 0);
    if (signal <= 0) continue;
    matches += 1;
    const knowledge = taskMatch?.knowledge || candidate.knowledge || {};
    candidate.semanticUrgency = Math.max(Number(candidate.semanticUrgency || 0), Math.min(1, Number(candidate.semanticUrgency || 0) + signal));
    if (knowledge.intent && !candidate.intent) candidate.intent = knowledge.intent;
    if (knowledge.rationale && !candidate.rationale) candidate.rationale = knowledge.rationale;
    if (knowledge.outcomeType && !candidate.outcomeType) candidate.outcomeType = knowledge.outcomeType;
    if (noteMatch?.recency) candidate.noteRecency = Math.max(Number(candidate.noteRecency || 0), recencyBoost(noteMatch.recency));
    candidate.score = scheduleCandidateScore(candidate, config);
  }
  return matches;
}

function scheduleSemanticContextScore(candidate, context = []) {
  if (!candidate || !Array.isArray(context) || !context.length) return 0;
  const candidateTerms = termCounts([
    candidate.content,
    candidate.description,
    candidate.parentContent,
    candidate.projectName,
    candidate.section,
    candidate.path,
    ...(candidate.labels || [])
  ].filter(Boolean).join(" "));
  const genericTerms = new Set(["project", "projects", "task", "tasks", "todoist", "note", "notes", "meeting", "meetings"]);
  const terms = Object.keys(candidateTerms).filter((term) => term.length > 2 && !genericTerms.has(term));
  if (!terms.length && !candidate.path) return 0;
  let best = 0;
  for (const chunk of context) {
    const chunkText = `${chunk.title || ""} ${chunk.path || ""} ${chunk.text || ""}`;
    const chunkCounts = termCounts(chunkText);
    const overlap = terms.filter((term) => chunkCounts[term]).length;
    const lexical = terms.length ? Math.min(1, overlap / Math.max(5, Math.min(terms.length, 18))) : 0;
    const pathBoost = candidate.path && chunk.path && candidate.path === chunk.path ? 0.55 : 0;
    const titleBoost = singleLine(candidate.content || "").toLowerCase() &&
      singleLine(chunkText).toLowerCase().includes(singleLine(candidate.content || "").toLowerCase().slice(0, 48)) ? 0.25 : 0;
    if (!pathBoost && !titleBoost && lexical <= 0.2) continue;
    const matchScore = Math.max(0, Math.min(1, Number(chunk.matchScore || 0)));
    const contextStrength = Math.max(pathBoost, Math.min(1, (matchScore * 0.45) + (lexical * 0.45) + titleBoost));
    best = Math.max(best, contextStrength);
  }
  return Math.max(0, Math.min(1, Math.round(best * 1000) / 1000));
}

function scheduleCandidateScore(candidate, config) {
  const weights = config.weights || {};
  const dueDays = candidate.dueDay ? daysBetweenLocalDates(config.today, candidate.dueDay) : 99;
  const deadlineDays = candidate.deadlineDay ? daysBetweenLocalDates(config.today, candidate.deadlineDay) : 99;
  const priorityScore = (normalizePriority(candidate.priority) - 1) / 3;
  const overdueScore = dueDays < 0 ? Math.min(1, Math.abs(dueDays) / 5 + 0.35) : 0;
  const dueScore = dueDays <= 0 ? 1 : dueDays === 1 ? 0.75 : dueDays === 2 ? 0.5 : 0;
  const deadlineScore = deadlineDays <= 0 ? 1 : deadlineDays === 1 ? 0.85 : deadlineDays === 2 ? 0.65 : deadlineDays <= 7 ? 0.35 : 0;
  return (priorityScore * (weights.todoistPriority || 1) * 3) +
    (deadlineScore * (weights.deadlineProximity || 1) * 3) +
    (overdueScore * (weights.overdue || 1) * 3) +
    (dueScore * (weights.dueDateProximity || 1) * 2.5) +
    ((candidate.semanticUrgency || 0) * (weights.semanticUrgency || 1) * 1.6) +
    ((candidate.noteRecency || 0) * (weights.noteRecency || 1) * 1.2) +
    ((candidate.parentDependency || 0) * (weights.parentDependency || 1));
}

function sortScheduleCandidatesForPlanning(candidates, config = {}) {
  const remaining = (candidates || []).slice();
  const ordered = [];
  while (remaining.length) {
    const previous = ordered[ordered.length - 1] || null;
    remaining.sort((a, b) => scheduleCandidatePlanningScore(b, previous, config) - scheduleCandidatePlanningScore(a, previous, config) ||
      normalizePriority(b.priority) - normalizePriority(a.priority) ||
      String(a.content || "").localeCompare(String(b.content || "")));
    ordered.push(remaining.shift());
  }
  return ordered;
}

function scheduleCandidatePlanningScore(candidate, previous, config = {}) {
  return Number(candidate?.score || 0) + scheduleRelatedGroupingBoost(previous, candidate, config);
}

function scheduleRelatedGroupingBoost(previous, candidate, config = {}) {
  if (!previous || !candidate) return 0;
  const policy = schedulerRelatedGroupingPolicy(config.durationPolicies);
  if (!policy) return 0;
  let score = 0;
  if (String(previous.parentId || previous.id || "") && String(previous.parentId || previous.id || "") === String(candidate.parentId || candidate.id || "")) score += 1.2;
  if (String(previous.parentContent || "") && String(previous.parentContent || "") === String(candidate.parentContent || "")) score += 0.8;
  if (String(previous.projectId || "") && String(previous.projectId || "") === String(candidate.projectId || "")) score += 0.9;
  if (String(previous.projectName || "") && String(previous.projectName || "") === String(candidate.projectName || "")) score += 0.7;
  if (String(previous.sectionId || "") && String(previous.sectionId || "") === String(candidate.sectionId || "")) score += 0.45;
  if (String(previous.path || "") && String(previous.path || "") === String(candidate.path || "")) score += 0.75;
  const previousLabels = new Set(cleanTodoistLabels(previous.labels || []).map((label) => label.toLowerCase()));
  const sharedLabels = cleanTodoistLabels(candidate.labels || []).filter((label) => previousLabels.has(label.toLowerCase()));
  if (sharedLabels.length) score += Math.min(0.55, sharedLabels.length * 0.18);
  const previousTerms = new Set(schedulerContextTokens(previous));
  const sharedTerms = schedulerContextTokens(candidate).filter((term) => previousTerms.has(term));
  if (sharedTerms.length) score += Math.min(0.5, sharedTerms.length * 0.08);
  const maxBoost = Math.max(0, Number(policy.boost || 0.45));
  return Math.min(maxBoost, score * 0.2);
}

function scheduleIndependentSubtask(candidate, settings = DEFAULT_SETTINGS) {
  if (!candidate?.isSubtask) return false;
  if (settings.scheduleTodayAllowIndependentSubtasks === false) return false;
  const text = `${candidate.content || ""} ${candidate.description || ""} ${(candidate.labels || []).join(" ")}`.toLowerCase();
  return /\b(review|follow[- ]?up|waiting|await|blocked|send|email|confirm|check|call|reply|feedback|approval)\b/.test(text);
}

function scheduleSemanticUrgency(candidate) {
  const text = `${candidate.content || ""} ${candidate.description || ""} ${(candidate.labels || []).join(" ")}`.toLowerCase();
  let score = 0;
  if (/\burgent|asap|critical|important|priority|deadline|due|overdue\b/.test(text)) score += 0.55;
  if (/\bfollow[- ]?up|send|review|complete|submit|prepare|schedule|confirm|decide|update\b/.test(text)) score += 0.35;
  if (/\bwaiting|blocked|depend|risk|approval|feedback\b/.test(text)) score += 0.2;
  return Math.min(1, score);
}

function scheduleNoteRecency(cached = {}) {
  const time = Date.parse(cached.cachedAt || cached.rebuiltAt || "") || 0;
  if (!time) return 0;
  return Math.min(1, recencyBoost(time) / 0.12);
}

function planScheduleToday(candidates, config, settings = DEFAULT_SETTINGS) {
  const scheduleCandidates = mergeDependentSubtasksForSchedule(candidates, config);
  const fixed = [];
  const scheduled = [];
  const unscheduled = [];
  const splitSubtasks = [];
  const blocked = [];
  if (config.lunchMinutes > 0) blocked.push({ startMinutes: config.lunchStartMinutes, endMinutes: config.lunchEndMinutes, type: "lunch" });
  for (const candidate of scheduleCandidates) {
    if (!candidate.scheduledTimeFixed || datePart(candidate.dueDate) !== config.today) continue;
    const start = minutesFromDateTime(candidate.dueDate);
    const duration = scheduleDurationWithLocalPolicy(candidate, candidate.durationMinutes || fallbackScheduleDuration(candidate, config), config);
    const item = schedulePreviewItem(candidate, start, duration, config, { fixed: true });
    fixed.push(item);
    blocked.push({ startMinutes: start, endMinutes: start + duration, type: "fixed", id: candidate.id });
  }
  const movable = sortScheduleCandidatesForPlanning(scheduleCandidates.filter((candidate) => !candidate.scheduledTimeFixed), config);
  for (const candidate of movable) {
    let duration = scheduleDurationWithLocalPolicy(candidate, candidate.durationMinutes || fallbackScheduleDuration(candidate, config), config);
    let remainder = 0;
    if (duration > config.maxBlockMinutes) {
      remainder = duration - config.maxBlockMinutes;
      duration = config.maxBlockMinutes;
    }
    const start = findOpenScheduleSlot(blocked, duration, config);
    if (start == null) {
      unscheduled.push(scheduleUnscheduledItem(candidate, duration + remainder, "No open block today", config));
      continue;
    }
    const item = schedulePreviewItem(candidate, start, duration, config, {
      totalDurationMinutes: duration + remainder
    });
    scheduled.push(item);
    blocked.push({ startMinutes: start, endMinutes: start + duration, type: "scheduled", id: candidate.id });
    if (remainder > 0) splitSubtasks.push(scheduleContinuationSubtask(candidate, remainder, config, settings));
  }
  const preview = {
    config,
    fixed: fixed.sort((a, b) => a.startMinutes - b.startMinutes),
    scheduled: scheduled.sort((a, b) => a.startMinutes - b.startMinutes),
    unscheduled,
    suggestions: [],
    bumped: [],
    removed: [],
    splitSubtasks,
    message: ""
  };
  refreshScheduleSuggestions(preview);
  return preview;
}

function mergeDependentSubtasksForSchedule(candidates, config) {
  const byId = new Map((candidates || []).map((candidate) => [String(candidate.id || ""), candidate]));
  const dependentMinutes = new Map();
  const dependentTitles = new Map();
  const filtered = [];
  for (const candidate of candidates || []) {
    const parentId = String(candidate.parentId || "");
    if (candidate.isSubtask && parentId && !candidate.independentSubtask && byId.has(parentId)) {
      const minutes = scheduleDurationWithLocalPolicy(candidate, candidate.durationMinutes || fallbackScheduleDuration(candidate, config), config);
      dependentMinutes.set(parentId, (dependentMinutes.get(parentId) || 0) + minutes);
      const titles = dependentTitles.get(parentId) || [];
      titles.push(candidate.content || "subtask");
      dependentTitles.set(parentId, titles);
      continue;
    }
    filtered.push(candidate);
  }
  return filtered.map((candidate) => {
    const extra = dependentMinutes.get(candidate.id) || 0;
    if (!extra) return candidate;
    return Object.assign({}, candidate, {
      durationMinutes: scheduleDurationWithLocalPolicy(candidate, (candidate.durationMinutes || fallbackScheduleDuration(candidate, config)) + extra, config),
      dependentSubtasks: dependentTitles.get(candidate.id) || []
    });
  });
}

function schedulePreviewItem(candidate, startMinutes, durationMinutesValue, config, extra = {}) {
  const duration = scheduleDurationWithLocalPolicy(candidate, durationMinutesValue, config) || config.minBlockMinutes;
  return Object.assign({}, candidate, extra, {
    startMinutes,
    originalStartMinutes: candidate.originalStartMinutes ?? startMinutes,
    durationMinutes: duration,
    originalDurationMinutes: candidate.originalDurationMinutes || duration,
    scheduledDateTime: localDateTimeString(config.today, startMinutes),
    endMinutes: startMinutes + duration,
    overlapsLunch: rangesOverlap(startMinutes, startMinutes + duration, config.lunchStartMinutes, config.lunchEndMinutes)
  });
}

function scheduleUnscheduledItem(candidate, durationMinutesValue, reason, config, extra = {}) {
  const duration = scheduleDurationWithLocalPolicy(candidate, durationMinutesValue, config) || config.minBlockMinutes;
  const scheduleBlockMinutes = Math.min(duration, config.maxBlockMinutes || duration);
  return Object.assign({}, candidate, extra, {
    durationMinutes: duration,
    scheduleBlockMinutes,
    reason,
    rationale: unscheduledRationale(candidate, reason, duration, config)
  });
}

function removedScheduleItems(preview = {}) {
  const combined = [];
  const seen = new Set();
  for (const item of [...(preview.removed || []), ...(preview.bumped || [])]) {
    if (!item?.id) continue;
    const key = String(item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(item);
  }
  return combined;
}

function refreshScheduleSuggestions(preview) {
  if (!preview) return [];
  const config = preview.config || {};
  const scheduledIds = new Set([...(preview.fixed || []), ...(preview.scheduled || [])].map((item) => String(item.id || "")).filter(Boolean));
  const suggestions = (preview.unscheduled || [])
    .filter((item) => item?.id && !item.wasBumped && !scheduledIds.has(String(item.id)))
    .map((item) => {
      const addPlan = bestScheduleAddSlot(item, preview, config);
      const swap = bestScheduleSwapCandidate(item, preview, config);
      if (!addPlan && !swap) return null;
      return Object.assign({}, item, {
        suggestionAction: addPlan ? "add" : "swap",
        addStartMinutes: addPlan?.startMinutes ?? null,
        addEndMinutes: addPlan ? addPlan.startMinutes + addPlan.durationMinutes : null,
        addDurationMinutes: addPlan?.durationMinutes ?? null,
        addWindowStartMinutes: addPlan?.windowStartMinutes ?? null,
        addWindowEndMinutes: addPlan?.windowEndMinutes ?? null,
        addRemainderMinutes: addPlan?.remainderMinutes ?? 0,
        swapCandidateId: swap?.id || "",
        swapCandidateTitle: swap?.content || "",
        rationale: addPlan ? suggestionAddRationale(item, addPlan, config) : suggestionSwapRationale(item, swap, config)
      });
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || normalizePriority(b.priority) - normalizePriority(a.priority) || String(a.content).localeCompare(String(b.content)))
    .slice(0, SCHEDULE_PREVIEW_SUGGESTION_LIMIT);
  preview.suggestions = suggestions;
  return suggestions;
}

function bestScheduleAddSlot(suggestion, preview, config = {}, preferredStartMinutes = null) {
  const desiredDuration = suggestionScheduleBlockMinutes(suggestion, config);
  if (!desiredDuration) return null;
  const blocked = scheduleBlocksForPreview(preview, config);
  const flexible = findFlexibleOpenScheduleSlot(blocked, desiredDuration, config, preferredStartMinutes);
  if (!flexible) return null;
  const totalDuration = Number(suggestion?.totalDurationMinutes || suggestion?.durationMinutes || desiredDuration);
  return Object.assign({}, flexible, {
    remainderMinutes: Math.max(0, totalDuration - flexible.durationMinutes)
  });
}

function bestScheduleSwapCandidate(suggestion, preview, config = {}) {
  const scheduled = (preview?.scheduled || []).filter((item) => item?.id && !item.fixed);
  const swapDuration = suggestionScheduleBlockMinutes(suggestion, config);
  if (!scheduled.length || !swapDuration) return null;
  const blocksWithout = (candidateId) => scheduleBlocksForPreview(preview, config, { excludeId: candidateId });
  const scored = scheduled.map((item) => {
    const canFit = findOpenScheduleSlot(blocksWithout(item.id), swapDuration, config) != null;
    const durationFit = Number(item.durationMinutes || 0) >= swapDuration;
    const scoreDelta = Number(suggestion.score || 0) - Number(item.score || 0);
    return { item, canFit, durationFit, scoreDelta };
  }).filter((entry) => entry.canFit);
  if (!scored.length) return null;
  scored.sort((a, b) => {
    if (a.scoreDelta >= 0 !== b.scoreDelta >= 0) return a.scoreDelta >= 0 ? -1 : 1;
    if (a.durationFit !== b.durationFit) return a.durationFit ? -1 : 1;
    return (a.item.score || 0) - (b.item.score || 0) || (b.item.startMinutes || 0) - (a.item.startMinutes || 0);
  });
  return scored[0]?.item || null;
}

function openScheduleWindows(blocked, config = {}) {
  const startDay = Number(config.startMinutes || 0);
  const endDay = Number(config.endMinutes || startDay);
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || endDay <= startDay) return [];
  const blocks = (blocked || [])
    .filter((block) => Number.isFinite(block?.startMinutes) && Number.isFinite(block?.endMinutes))
    .map((block) => ({
      startMinutes: Math.max(startDay, Number(block.startMinutes)),
      endMinutes: Math.min(endDay, Number(block.endMinutes))
    }))
    .filter((block) => block.endMinutes > block.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
  const windows = [];
  let cursor = startDay;
  for (const block of blocks) {
    if (block.startMinutes > cursor) windows.push({ startMinutes: cursor, endMinutes: block.startMinutes });
    cursor = Math.max(cursor, block.endMinutes);
  }
  if (cursor < endDay) windows.push({ startMinutes: cursor, endMinutes: endDay });
  return windows;
}

function findFlexibleOpenScheduleSlot(blocked, desiredDurationValue, config = {}, preferredStartMinutes = null) {
  const desiredDuration = roundToScheduleChunk(desiredDurationValue, config);
  if (!desiredDuration) return null;
  const flex = Math.max(0, Number(config.addWindowMinutes || 0));
  const minDuration = Math.max(config.minBlockMinutes || 0, desiredDuration - flex);
  const windows = openScheduleWindows(blocked, config)
    .map((window) => {
      const available = window.endMinutes - window.startMinutes;
      const duration = Math.min(desiredDuration, floorToScheduleStep(available, config));
      if (duration < minDuration) return null;
      const maxStart = window.endMinutes - duration;
      const preferred = Number.isFinite(Number(preferredStartMinutes))
        ? Math.max(window.startMinutes, Math.min(maxStart, Number(preferredStartMinutes)))
        : window.startMinutes;
      return {
        startMinutes: preferred,
        durationMinutes: duration,
        windowStartMinutes: window.startMinutes,
        windowEndMinutes: window.endMinutes,
        distance: Number.isFinite(Number(preferredStartMinutes)) ? Math.abs(preferred - Number(preferredStartMinutes)) : window.startMinutes - (config.startMinutes || 0),
        shortfall: Math.max(0, desiredDuration - duration)
      };
    })
    .filter(Boolean);
  windows.sort((a, b) => a.distance - b.distance || a.shortfall - b.shortfall || a.startMinutes - b.startMinutes);
  return windows[0] || null;
}

function scheduleBlocksForPreview(preview, config = {}, options = {}) {
  const excludeId = String(options.excludeId || "");
  const blocks = [];
  if (config.lunchMinutes > 0) blocks.push({ startMinutes: config.lunchStartMinutes, endMinutes: config.lunchEndMinutes, type: "lunch" });
  for (const item of [...(preview?.fixed || []), ...(preview?.scheduled || [])]) {
    if (!item?.id || String(item.id) === excludeId) continue;
    if (!Number.isFinite(item.startMinutes) || !Number.isFinite(item.endMinutes)) continue;
    blocks.push({ startMinutes: item.startMinutes, endMinutes: item.endMinutes, id: item.id, type: item.fixed ? "fixed" : "scheduled" });
  }
  return blocks;
}

function scheduleImmovableBlocks(preview, config = {}) {
  const blocks = [];
  if (config.lunchMinutes > 0) blocks.push({ startMinutes: config.lunchStartMinutes, endMinutes: config.lunchEndMinutes, type: "lunch" });
  for (const fixed of preview?.fixed || []) {
    if (!Number.isFinite(fixed.startMinutes) || !Number.isFinite(fixed.endMinutes)) continue;
    blocks.push({ startMinutes: fixed.startMinutes, endMinutes: fixed.endMinutes, id: fixed.id, type: "fixed" });
  }
  return blocks.sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
}

function scheduleGridMinutes(config = {}) {
  return Math.max(1, Math.round(Number(config.chunkMinutes || config.minBlockMinutes || scheduleDurationStepMinutes(config))));
}

function snapScheduleStart(startMinutes, config = {}) {
  const grid = scheduleGridMinutes(config);
  const origin = Number(config.startMinutes || 0);
  const value = Number(startMinutes);
  if (!Number.isFinite(value)) return origin;
  return origin + Math.round((value - origin) / grid) * grid;
}

function snapScheduleStartAtOrBefore(startMinutes, config = {}) {
  const grid = scheduleGridMinutes(config);
  const origin = Number(config.startMinutes || 0);
  const value = Number(startMinutes);
  if (!Number.isFinite(value)) return origin;
  return origin + Math.floor((value - origin) / grid) * grid;
}

function snapScheduleStartAtOrAfter(startMinutes, config = {}) {
  const grid = scheduleGridMinutes(config);
  const origin = Number(config.startMinutes || 0);
  const value = Number(startMinutes);
  if (!Number.isFinite(value)) return origin;
  return origin + Math.ceil((value - origin) / grid) * grid;
}

function latestOpenScheduleStartBefore(blocked, durationMinutesValue, config = {}, preferredStartMinutes, latestEndMinutes) {
  const duration = roundToScheduleChunk(durationMinutesValue, config) || config.minBlockMinutes;
  const latestEnd = Number.isFinite(Number(latestEndMinutes)) ? Number(latestEndMinutes) : config.endMinutes;
  let start = snapScheduleStartAtOrBefore(Math.min(Number(preferredStartMinutes), latestEnd - duration), config);
  let guard = 0;
  while (start >= config.startMinutes && guard < 500) {
    const end = start + duration;
    const conflict = (blocked || [])
      .filter((block) => Number.isFinite(block?.startMinutes) && Number.isFinite(block?.endMinutes))
      .find((block) => rangesOverlap(start, end, block.startMinutes, block.endMinutes));
    if (!conflict && end <= latestEnd) return start;
    const next = conflict ? Math.min(start - scheduleGridMinutes(config), conflict.startMinutes - duration) : start - scheduleGridMinutes(config);
    start = snapScheduleStartAtOrBefore(next, config);
    guard += 1;
  }
  return null;
}

function earliestOpenScheduleStartAfter(blocked, durationMinutesValue, config = {}, preferredStartMinutes, earliestStartMinutes) {
  const duration = roundToScheduleChunk(durationMinutesValue, config) || config.minBlockMinutes;
  const earliestStart = Number.isFinite(Number(earliestStartMinutes)) ? Number(earliestStartMinutes) : config.startMinutes;
  let start = snapScheduleStartAtOrAfter(Math.max(Number(preferredStartMinutes), earliestStart), config);
  let guard = 0;
  while (start + duration <= config.endMinutes && guard < 500) {
    const end = start + duration;
    const conflict = (blocked || [])
      .filter((block) => Number.isFinite(block?.startMinutes) && Number.isFinite(block?.endMinutes))
      .find((block) => rangesOverlap(start, end, block.startMinutes, block.endMinutes));
    if (!conflict) return start;
    start = snapScheduleStartAtOrAfter(conflict.endMinutes, config);
    guard += 1;
  }
  return null;
}

function unscheduledRationale(candidate, reason, duration, config) {
  const parts = [];
  if (reason) parts.push(reason);
  if (duration) parts.push(`needs ${duration} min`);
  if (candidate?.dueDay) {
    const dueDays = daysBetweenLocalDates(config.today, candidate.dueDay);
    if (dueDays < 0) parts.push(`${Math.abs(dueDays)}d overdue`);
    else if (dueDays === 0) parts.push("due today");
    else parts.push(`due in ${dueDays}d`);
  }
  if (normalizePriority(candidate?.priority) >= 4) parts.push("P4");
  return parts.slice(0, 3).join("; ");
}

function suggestionAddRationale(item, addPlan, config) {
  const base = unscheduledRationale(item, item.reason || "Open time available", item.durationMinutes, config);
  const continuation = addPlan.remainderMinutes > 0 ? ` ${addPlan.remainderMinutes} min continues next workday.` : "";
  return `${base}. Add at ${minutesToClock(addPlan.startMinutes)}-${minutesToClock(addPlan.startMinutes + addPlan.durationMinutes)}.${continuation}`;
}

function suggestionSwapRationale(item, swap, config) {
  const base = unscheduledRationale(item, item.reason || "Not enough open time", item.durationMinutes, config);
  const block = suggestionScheduleBlockMinutes(item, config);
  const continuation = item.durationMinutes > block ? ` ${item.durationMinutes - block} min continues next workday.` : "";
  return `${base}. Swap would move out ${shortTitle(swap?.content || "scheduled task", 28)} based on scheduler priority.${continuation}`;
}

function suggestionScheduleBlockMinutes(item, config = {}, target = null) {
  const duration = roundToScheduleChunk(item?.scheduleBlockMinutes || item?.durationMinutes || 0, config);
  if (!duration) return 0;
  const maxBlock = target?.durationMinutes ? Math.max(config.minBlockMinutes || 0, Number(target.durationMinutes || 0)) : config.maxBlockMinutes || duration;
  return Math.max(config.minBlockMinutes || duration, Math.min(duration, maxBlock));
}

function scheduleContinuationSubtask(candidate, remainderMinutes, config, settings = DEFAULT_SETTINGS) {
  const duration = Math.max(config.minBlockMinutes || 0, Math.min(roundToScheduleChunk(remainderMinutes, config) || config.minBlockMinutes, config.maxBlockMinutes));
  const parentId = candidate.isSubtask ? candidate.parentId || candidate.id : candidate.id;
  const parentOid = candidate.isSubtask ? candidate.parentOid || "" : candidate.oid || "";
  const title = singleLine(candidate.splitTitle || scheduleContinuationTitle(candidate));
  return {
    content: truncateAtWord(title, 220),
    parentId,
    parentOid,
    parentContent: candidate.isSubtask ? candidate.parentContent : candidate.content,
    parentLineNumber: candidate.isSubtask ? candidate.parentLineNumber : candidate.lineNumber,
    path: candidate.path || "",
    labels: settings.subtaskIncludeLabels ? candidate.labels || [] : [],
    priority: settings.subtaskIncludePriority ? normalizePriority(candidate.priority) : 1,
    durationMinutes: duration,
    scheduledDateTime: localDateTimeString(config.nextWorkday, config.startMinutes),
    sourceTaskId: candidate.id || "",
    due_date: config.nextWorkday,
    deadline_date: null,
    projectId: candidate.projectId || "",
    projectName: candidate.projectName || "",
    section: "",
    sectionId: "",
    isSubtask: true
  };
}

function findOpenScheduleSlot(blocked, durationMinutesValue, config) {
  const duration = roundToScheduleChunk(durationMinutesValue, config);
  for (let start = config.startMinutes; start + duration <= config.endMinutes; start += config.chunkMinutes) {
    const end = start + duration;
    if (rangesOverlap(start, end, config.lunchStartMinutes, config.lunchEndMinutes)) continue;
    if ((blocked || []).some((block) => rangesOverlap(start, end, block.startMinutes, block.endMinutes))) continue;
    return start;
  }
  return null;
}

function findNearestOpenScheduleSlot(blocked, durationMinutesValue, config, preferredStartMinutes = config.startMinutes) {
  const duration = roundToScheduleChunk(durationMinutesValue, config);
  if (!duration) return null;
  const minStart = config.startMinutes;
  const maxStart = config.endMinutes - duration;
  const preferred = Math.max(minStart, Math.min(maxStart, Number(preferredStartMinutes) || minStart));
  const candidates = [];
  for (let start = minStart; start <= maxStart; start += config.chunkMinutes) candidates.push(start);
  candidates.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
  for (const start of candidates) {
    const end = start + duration;
    if (rangesOverlap(start, end, config.lunchStartMinutes, config.lunchEndMinutes)) continue;
    if ((blocked || []).some((block) => rangesOverlap(start, end, block.startMinutes, block.endMinutes))) continue;
    return start;
  }
  return null;
}

function emptyScheduleTodayPreview(config, message = "") {
  return { config, fixed: [], scheduled: [], unscheduled: [], suggestions: [], bumped: [], removed: [], splitSubtasks: [], message };
}

function prepareScheduleDurationTriage(candidates, config, settings = DEFAULT_SETTINGS) {
  const missing = (candidates || []).filter((candidate) => !candidate.durationMinutes);
  const totalMissing = missing.length;
  for (const candidate of missing) {
    const minutes = scheduleDurationWithLocalPolicy(candidate, fallbackScheduleDuration(candidate, config), config, config.durationPolicies);
    candidate.durationMinutes = minutes;
    candidate.durationSource = "local triage estimate";
    candidate.durationConfidence = "low";
    candidate.splitTitle = candidate.splitTitle || scheduleContinuationTitle(candidate);
  }
  const firstPassPreview = planScheduleToday(candidates, config, settings);
  const aiCandidates = selectScheduleDurationAiCandidates(missing, firstPassPreview, config);
  return {
    totalMissing,
    aiCandidates,
    localOnlyCount: Math.max(0, totalMissing - aiCandidates.length),
    summary: {
      totalMissing,
      aiEstimated: aiCandidates.length,
      localOnly: Math.max(0, totalMissing - aiCandidates.length),
      firstPassScheduled: (firstPassPreview.fixed || []).length + (firstPassPreview.scheduled || []).length,
      firstPassSuggestions: (firstPassPreview.suggestions || []).length
    }
  };
}

function selectScheduleDurationAiCandidates(missingCandidates, preview, config = {}) {
  const missingById = new Map((missingCandidates || []).map((candidate) => [String(candidate.id || ""), candidate]).filter(([id]) => id));
  const selected = [];
  const seen = new Set();
  const add = (item) => {
    const id = String(item?.id || "");
    const candidate = missingById.get(id);
    if (!candidate || seen.has(id)) return;
    selected.push(candidate);
    seen.add(id);
  };
  for (const item of preview?.fixed || []) add(item);
  for (const item of preview?.scheduled || []) add(item);
  for (const item of preview?.suggestions || []) add(item);
  const cap = scheduleAiDurationCandidateLimit(preview, config);
  if (selected.length < cap) {
    const selectedIds = new Set(selected.map((item) => String(item.id || "")));
    const remaining = (missingCandidates || [])
      .filter((candidate) => candidate?.id && !selectedIds.has(String(candidate.id)))
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) ||
        normalizePriority(b.priority) - normalizePriority(a.priority) ||
        String(a.content || "").localeCompare(String(b.content || "")));
    for (const candidate of remaining) {
      add(candidate);
      if (selected.length >= cap) break;
    }
  }
  return selected.slice(0, cap);
}

function scheduleAiDurationCandidateLimit(preview, config = {}) {
  const planned = (preview?.fixed || []).length + (preview?.scheduled || []).length;
  const suggestions = Math.min(SCHEDULE_PREVIEW_SUGGESTION_LIMIT, (preview?.suggestions || []).length);
  const minimum = Math.max(4, planned + Math.min(4, suggestions));
  const workdaySlots = Math.ceil(Math.max(0, Number(config.endMinutes || 0) - Number(config.startMinutes || 0) - Math.max(0, Number(config.lunchMinutes || 0))) / Math.max(15, Number(config.minBlockMinutes || 30)));
  return Math.max(1, Math.min(SCHEDULE_AI_DURATION_MAX_TASKS, Math.max(minimum, Math.ceil(workdaySlots * 0.75))));
}

function fallbackScheduleDuration(candidate, config, policies = null) {
  const durationPolicies = policies || config.durationPolicies;
  const text = `${candidate.content || ""} ${candidate.description || ""}`.toLowerCase();
  let minutes = schedulerDefaultFocusMinutes(config, durationPolicies);
  if (isPeopleCoordinationScheduleTask(candidate, durationPolicies)) {
    minutes = schedulerDurationPolicyMaxMinutes(schedulerPeopleFollowupPolicy(durationPolicies), config);
    return scheduleDurationWithLocalPolicy(candidate, minutes, config, durationPolicies);
  }
  if (/\breview|draft|prepare|analy[sz]e|write|document|proposal|report|presentation\b/.test(text)) minutes = Math.max(minutes, 90);
  if (/\bmeeting|call|follow[- ]?up|email|send|confirm|check\b/.test(text)) minutes = Math.max(minutes, 30);
  if (/\bcomplex|strategy|plan|protocol|grant|manuscript|reviewer|committee\b/.test(text)) minutes = Math.max(minutes, 120);
  return scheduleDurationWithLocalPolicy(candidate, minutes, config, durationPolicies);
}

function scheduleDurationWithLocalPolicy(candidate, minutes, config, policies = null) {
  const durationPolicies = policies || config.durationPolicies;
  const rounded = Math.max(config.minBlockMinutes || 0, roundToScheduleChunk(minutes, config) || config.minBlockMinutes || 0);
  const policy = schedulerPeopleFollowupPolicy(durationPolicies);
  if (!policy || !isPeopleCoordinationScheduleTask(candidate, durationPolicies)) return rounded;
  return Math.min(rounded, roundToScheduleChunk(schedulerDurationPolicyMaxMinutes(policy, config), config) || config.minBlockMinutes || 30);
}

function isPeopleCoordinationScheduleTask(candidate, policies = null) {
  if (!schedulerPeopleFollowupPolicy(policies)) return false;
  const text = `${candidate?.content || ""} ${candidate?.description || ""}`.toLowerCase();
  if (!text.trim()) return false;
  const action = /\b(discuss(?:ing|ion)?(?:\b|.*?\bwith\b)|meet with|meeting with|touch base(?: with)?|check[- ]?in(?: with)?|follow[- ]?up(?: with)?|call|email|ask|confirm with|coordinate with|schedule (?:a |the )?(?:meeting|call)|book (?:a |the )?(?:meeting|call)|arrange (?:a |the )?(?:meeting|call))\b/.test(text);
  if (!action) return false;
  const work = /^(?:review|draft|prepare|analy[sz]e|write|document|finali[sz]e|build|create)\b|\b(?:to|and)\s+(?:review|draft|prepare|analy[sz]e|write|document|finali[sz]e|build|create)\b/.test(text);
  return !work;
}

function scheduleContinuationTitle(candidate) {
  return `Continue: ${singleLine(candidate.content || "task")}`;
}

function normalizeTodoistDuration(duration) {
  if (!duration) return null;
  const amount = Number(duration.amount || duration.duration || 0);
  const unit = String(duration.unit || duration.duration_unit || "minute");
  if (!amount || amount < 1) return null;
  return { amount: Math.round(amount), unit: unit === "day" ? "day" : "minute" };
}

function durationMinutes(duration) {
  const normalized = normalizeTodoistDuration(duration);
  if (!normalized) return 0;
  return normalized.unit === "day" ? normalized.amount * 8 * 60 : normalized.amount;
}

function roundToScheduleChunk(minutes, config = {}) {
  const chunk = scheduleDurationStepMinutes(config);
  const value = Number(minutes || 0);
  if (!value) return 0;
  return Math.max(chunk, Math.ceil(value / chunk) * chunk);
}

function floorToScheduleStep(minutes, config = {}) {
  const chunk = scheduleDurationStepMinutes(config);
  const value = Number(minutes || 0);
  if (!value) return 0;
  return Math.max(0, Math.floor(value / chunk) * chunk);
}

function scheduleDurationStepMinutes(config = {}) {
  return Math.max(1, Math.round(Number(config.durationStepMinutes || config.chunkMinutes || 15)));
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

function parseClockMinutes(value, fallback) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return fallback;
  const hours = Math.max(0, Math.min(23, Number(match[1])));
  const minutes = Math.max(0, Math.min(59, Number(match[2])));
  return hours * 60 + minutes;
}

function minutesToClock(minutes) {
  const safe = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(minutes || 0))));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function localDateTimeString(date, minutes) {
  return `${date}T${minutesToClock(minutes)}:00`;
}

function isDateTimeString(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(value || ""));
}

function datePart(value) {
  return (/^\d{4}-\d{2}-\d{2}/.exec(String(value || "")) || [])[0] || "";
}

function minutesFromDateTime(value) {
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(String(value || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function daysBetweenLocalDates(startDate, endDate) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (!start || !end) return 0;
  return Math.round((end - start) / 86400000);
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextWorkdayDate(dateText) {
  const date = parseLocalDate(dateText) || new Date();
  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() === 0 || date.getDay() === 6);
  return formatLocalDate(date);
}

function rangesOverlap(start, end, otherStart, otherEnd) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(otherStart) || !Number.isFinite(otherEnd)) return false;
  if (otherEnd <= otherStart) return false;
  return start < otherEnd && end > otherStart;
}

function setScheduleMarker(line, scheduledDateTime, minutes, options = {}) {
  const cleaned = String(line || "").replace(/\s*%%\[sched::\s*[^\]]*?\]%%/g, "").trimEnd();
  if ((!scheduledDateTime || !minutes) && options.removeIfEmpty) return cleaned;
  if (!scheduledDateTime || !minutes) return cleaned;
  const marker = ` %%[sched:: ${scheduledDateTime}; dur:: ${Math.max(0, Math.round(minutes))}]%%`;
  const oidIndex = cleaned.search(/\s%%\[oid::/);
  if (oidIndex >= 0) return `${cleaned.slice(0, oidIndex)}${marker}${cleaned.slice(oidIndex)}`;
  return `${cleaned}${marker}`;
}

function cleanTask(task, allowedLabels = null, settings = DEFAULT_SETTINGS) {
  return cleanTaskWithRole(task, allowedLabels, false, settings);
}

function cleanTaskWithRole(task, allowedLabels = null, isSubtask = false, settings = DEFAULT_SETTINGS) {
  const labels = (task.labels || []).map(cleanLabel).filter(Boolean).filter((label) => !allowedLabels || allowedLabels.has(label.toLowerCase()));
  return {
    content: clamp(singleLine(task.content || ""), 250),
    description: isSubtask ? "" : cleanGeneratedDescriptionSummary(task.description || ""),
    due_date: validDate(task.due_date) ? task.due_date : null,
    deadline_date: validDate(task.deadline_date) ? task.deadline_date : null,
    priority: normalizePriority(task.priority),
    labels,
    subtasks: (task.subtasks || []).map((subtask) => cleanTaskWithRole(subtask, allowedLabels, true, settings)).filter((subtask) => subtask.content)
  };
}

function todoistTaskArgs(task, location, settings = DEFAULT_SETTINGS) {
  const isSubtask = Boolean(location?.parent_id || task.isSubtask);
  const args = Object.assign({
    content: clamp(singleLine(task.content), 250),
    priority: isSubtask && !settings.subtaskIncludePriority ? 1 : normalizePriority(task.priority),
    labels: isSubtask && !settings.subtaskIncludeLabels ? [] : (task.labels || []).map(cleanLabel).filter(Boolean)
  }, location || {});
  if (!location?.parent_id && isRichTodoistDescription(task.description)) args.description = formatTodoistDescription(task.description, settings);
  if (task.due_date && (!isSubtask || settings.subtaskIncludeDueDate)) args.due = { date: task.due_date };
  if (task.deadline_date && (!isSubtask || settings.subtaskIncludeDeadline)) args.deadline = { date: task.deadline_date };
  return args;
}

function taskPlanToMarkdown(tasks, settings) {
  const lines = [];
  for (const task of tasks) {
    lines.push(parsedTaskToLine(Object.assign({ isCompleted: false, isSubtask: false }, task), settings));
    for (const subtask of task.subtasks || []) {
      const line = parsedTaskToLine(Object.assign({ isCompleted: false, isSubtask: true, section: "" }, subtask), settings);
      const indent = desiredSubtaskIndent(settings);
      lines.push(`${indent}${line.trimStart()}`);
    }
  }
  return lines;
}

function assignGeneratedTaskOids(tasks, settings) {
  for (const task of tasks || []) {
    if (!task.oid) task.oid = generateUniqueOid(settings);
    for (const subtask of task.subtasks || []) {
      if (!subtask.oid) subtask.oid = generateUniqueOid(settings);
    }
  }
}

function assignGeneratedTaskSectionId(tasks, sectionId) {
  for (const task of tasks || []) {
    task.sectionId = sectionId || "";
    for (const subtask of task.subtasks || []) subtask.sectionId = "";
  }
}

function emptySyncStats() {
  return { created: 0, updated: 0, relinked: 0, deleted: 0, completedForgotten: 0, normalized: 0, conflicts: 0, preservedCompleted: 0 };
}

function mergeSyncStats(target, source) {
  for (const key of Object.keys(emptySyncStats())) target[key] = (target[key] || 0) + (source?.[key] || 0);
  if (source?.staleReferences) target.staleReferences = (target.staleReferences || 0) + source.staleReferences;
  return target;
}

function uniqueSectionCleanupCandidates(sections) {
  const seen = new Set();
  const unique = [];
  for (const section of sections || []) {
    const sectionId = String(section?.sectionId || "");
    if (!sectionId || seen.has(sectionId)) continue;
    seen.add(sectionId);
    unique.push({
      sectionId,
      section: section.section || "",
      projectId: String(section.projectId || "")
    });
  }
  return unique;
}

async function asyncPool(items, workerCount, worker) {
  const list = Array.from(items || []);
  const count = Math.max(1, Math.min(list.length || 1, parseInt(workerCount, 10) || 1));
  let index = 0;
  const workers = Array.from({ length: count }, async () => {
    while (index < list.length) {
      const currentIndex = index;
      index += 1;
      await worker(list[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
}

function syncWorkerCount(settings = DEFAULT_SETTINGS) {
  return Math.max(1, Math.min(4, parseInt(settings.syncWorkerCount, 10) || DEFAULT_SETTINGS.syncWorkerCount || 1));
}

function semanticEmbeddingBatchSize(settings = DEFAULT_SETTINGS) {
  return Math.max(1, Math.min(96, parseInt(settings.embeddingBatchSize, 10) || DEFAULT_SETTINGS.embeddingBatchSize || 16));
}

function geminiEmbeddingConcurrency(settings = DEFAULT_SETTINGS) {
  return Math.max(1, Math.min(GEMINI_EMBEDDING_CONCURRENCY, semanticEmbeddingBatchSize(settings)));
}

function referenceRebuildWorkerCount(settings = DEFAULT_SETTINGS) {
  return Math.max(1, Math.min(8, parseInt(settings.referenceRebuildWorkerCount, 10) || DEFAULT_SETTINGS.referenceRebuildWorkerCount || 1));
}

function emailAutoPollIntervalSeconds(settings = DEFAULT_SETTINGS) {
  return Math.max(MIN_EMAIL_AUTO_POLL_INTERVAL_SECONDS, parseInt(settings.emailPollIntervalSeconds, 10) || DEFAULT_SETTINGS.emailPollIntervalSeconds);
}

function allActiveWorkflowStatusItems(plugin) {
  const fileSyncCount = plugin.fileSyncInProgress?.size || 0;
  const indexCount = plugin.pendingIndexPaths?.size || 0;
  const items = [];
  if (plugin.aiActivity) items.push({ label: "AI", value: plugin.aiActivity });
  if (plugin.schedulerInProgress) items.push({ label: "Scheduler", value: "Planning" });
  if (plugin.emailProcessingInProgress) items.push({ label: "Email", value: "Processing" });
  if (plugin.syncInProgress || fileSyncCount) items.push({ label: "Notes", value: `Syncing${fileSyncCount ? ` (${fileSyncCount})` : ""}` });
  else if (plugin.noteSyncTimer) items.push({ label: "Notes", value: "Sync queued" });
  if (plugin.semanticIndexLoadInProgress) items.push({ label: "Index", value: "Loading" });
  else if (plugin.semanticIndexLoadTimer) items.push({ label: "Index", value: "Cache queued" });
  else if (plugin.semanticIndexOptimizeInProgress) items.push({ label: "Index", value: "Optimizing" });
  else if (plugin.semanticIndexInProgress) items.push({ label: "Index", value: "Indexing vault" });
  else if (plugin.semanticIndexWarmupInProgress) items.push({ label: "Index", value: "Preparing" });
  else if (indexCount) items.push({ label: "Index", value: `Queued (${indexCount})` });
  else if (plugin.semanticIndexTimer) items.push({ label: "Index", value: "Queued" });
  if (plugin.referenceRebuildInProgress) items.push({ label: "References", value: "Rebuilding" });
  return items;
}

function activeWorkflowStatusItems(plugin, currentStatus = "Ready") {
  const status = singleLine(currentStatus || "Ready") || "Ready";
  const explicit = /^ready$/i.test(status) ? "" : status;
  const items = [];
  if (explicit) items.push({ label: "Status", value: explicit });
  items.push(...allActiveWorkflowStatusItems(plugin));
  return items.length ? items : [{ label: "Status", value: "Ready" }];
}

function isReadyWorkflowStatusItems(items) {
  return (items || []).length === 1 && /^status$/i.test(items[0]?.label || "") && /^ready$/i.test(items[0]?.value || "");
}

function workflowStatusItemKey(item) {
  return singleLine(item?.label || "Status").toLowerCase();
}

function allActiveWorkflowStatusParts(plugin) {
  return allActiveWorkflowStatusItems(plugin).map((item) => `${item.label}: ${item.value}`);
}

function activeWorkflowStatusMessage(plugin, currentStatus = "Ready") {
  return activeWorkflowStatusItems(plugin, currentStatus).map((item) => `${item.label}: ${item.value}`).join(" | ");
}

function activeWorkflowStatusParts(plugin, currentStatus = "Ready") {
  return [];
}

function isReferenceRebuildCandidate(line, settings = DEFAULT_SETTINGS) {
  if (!/^\s*[-*]\s+\[[ xX]\]/.test(line)) return false;
  const includeLegacy = shouldConvertLegacyTodoistIds(settings);
  return line.includes(settings.syncTag) ||
    hasSubtaskSyncMarker(line, settings) ||
    (includeLegacy && /#tdsyncsub\b/i.test(line)) ||
    (includeLegacy && /#tdsync\b/i.test(line)) ||
    Boolean(getTaskOid(line)) ||
    (includeLegacy && Boolean(getLegacyTodoistId(line)));
}

function findMatchedParentId(task, lines, matchedByLine) {
  const index = parentLineIndex(task, lines);
  return index >= 0 ? matchedByLine.get(index)?.id || "" : "";
}

function parentLineIndex(task, lines) {
  if (!task.isSubtask || task.indent <= 0) return -1;
  for (let i = task.lineNumber - 1; i >= 0; i -= 1) {
    const line = lines[i] || "";
    if (!line.trim()) continue;
    if (!/^\s*[-*]\s+\[[ xX]\]/.test(line)) continue;
    if (indentationLevel(line) >= task.indent) continue;
    return i;
  }
  return -1;
}

function uniqueOidForRebuiltReference(preferredOid, todoistId, settings) {
  const existing = oidForTodoistId(settings, todoistId);
  if (existing) return existing;
  const preferred = String(preferredOid || "").toUpperCase();
  if (/^[A-Z0-9]{1,5}$/.test(preferred) && !todoistIdForOid(settings, preferred)) return preferred;
  return generateUniqueOid(settings);
}

function parsedTaskFromTodoistReference(remote, parsed, oid, path, lineNumber, parentMatch = null) {
  const parentReference = parentReferenceForParsedTask(parsed) || {};
  return Object.assign({}, parsed, {
    id: remote.id,
    oid,
    path,
    lineNumber,
    content: remote.content || parsed.content,
    description: remote.description || "",
    labels: remote.labels || parsed.labels || [],
    priority: normalizePriority(remote.priority || parsed.priority),
    due_date: remote.dueDate || parsed.due_date || null,
    deadline_date: remote.deadlineDate || parsed.deadline_date || null,
    isCompleted: Boolean(remote.isCompleted || parsed.isCompleted),
    isSubtask: Boolean(remote.parentId || parsed.isSubtask),
    parentId: remote.parentId || parentMatch?.id || parsed.parentId || parentReference.id || "",
    parentOid: parentMatch?.oid || parsed.parentOid || parentReference.oid || "",
    parentContent: parsed.parentContent || parentReference.content || "",
    parentLineNumber: Number.isFinite(parsed.parentLineNumber) ? parsed.parentLineNumber : Number.isFinite(parentReference.lineNumber) ? parentReference.lineNumber : null,
    section: remote.section || parsed.section || "",
    sectionId: remote.sectionId || parsed.sectionId || "",
    projectId: remote.projectId || parsed.projectId || "",
    projectName: remote.projectName || parsed.projectName || ""
  });
}

function enrichTodoistTasksWithSnapshot(snapshot = {}) {
  const projectNameById = new Map((snapshot.projects || []).map((project) => [String(project.id), project.name || ""]));
  const sectionsById = new Map((snapshot.sections || []).map((section) => [section.id, section]));
  return (snapshot.tasks || []).map((task) => Object.assign({}, task, {
    projectName: task.projectName || projectNameById.get(String(task.projectId || "")) || "",
    section: task.section || sectionsById.get(task.sectionId)?.name || ""
  }));
}

function applyRemoteTodoistLocation(parsed, remote) {
  if (!parsed || !remote) return parsed;
  parsed.projectId = remote.projectId || parsed.projectId || "";
  parsed.projectName = remote.projectName || parsed.projectName || "";
  parsed.sectionId = remote.sectionId || parsed.sectionId || "";
  parsed.section = remote.section || parsed.section || "";
  parsed.parentId = remote.parentId || parsed.parentId || "";
  return parsed;
}

function todoistRemoteIsSubtask(remote = {}, base = {}) {
  return Boolean(base.isSubtask || remote.parentId || remote.parent_id);
}

function cleanTodoistLabels(labels = []) {
  return (labels || []).map(cleanLabel).filter(Boolean);
}

function sortedTodoistLabels(labels = []) {
  return cleanTodoistLabels(labels).sort();
}

function sameStringArray(left = [], right = []) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}

function subtaskFieldEnabled(task, settings, key) {
  return !task?.isSubtask || Boolean(settings?.[key]);
}

function taskLabelsForTodoist(task, settings = DEFAULT_SETTINGS) {
  if (!subtaskFieldEnabled(task, settings, "subtaskIncludeLabels")) return [];
  return sortedTodoistLabels(task?.labels || []);
}

function taskPriorityForTodoist(task, settings = DEFAULT_SETTINGS) {
  if (!subtaskFieldEnabled(task, settings, "subtaskIncludePriority")) return 1;
  return normalizePriority(task?.priority);
}

function taskDueDateForTodoist(task, settings = DEFAULT_SETTINGS) {
  if (!subtaskFieldEnabled(task, settings, "subtaskIncludeDueDate")) return null;
  if (task?.scheduledDueDateTime && (!task?.due_date || datePart(task.scheduledDueDateTime) === task.due_date)) return task.scheduledDueDateTime;
  return task?.due_date || null;
}

function taskDeadlineForTodoist(task, settings = DEFAULT_SETTINGS) {
  if (!subtaskFieldEnabled(task, settings, "subtaskIncludeDeadline")) return null;
  return task?.deadline_date || null;
}

function taskDescriptionForTodoist(task, settings = DEFAULT_SETTINGS) {
  if (task?.isSubtask || !task?.descriptionShouldSync || !isRichTodoistDescription(task.description)) return "";
  return formatTodoistDescription(task.description, settings);
}

function todoistRemoteDueDate(remote = {}, base = {}) {
  return remote.dueDate || remote.due?.date || base.due_date || null;
}

function todoistRemoteDeadlineDate(remote = {}, base = {}) {
  return remote.deadlineDate || remote.deadline?.date || base.deadline_date || null;
}

function todoistRemoteDescription(remote = {}, base = {}) {
  return isRichTodoistDescription(remote.description) ? remote.description : base.description || "";
}

function todoistRemoteCompletion(remote = {}, base = {}) {
  if (remote.isCompleted != null) return Boolean(remote.isCompleted);
  return Boolean(remote.is_completed || remote.checked || base.isCompleted);
}

function todoistTaskToParsedTask(remote, base = {}, settings = DEFAULT_SETTINGS) {
  const isSubtask = todoistRemoteIsSubtask(remote, base);
  const remoteTask = Object.assign({}, remote, { isSubtask });
  const projectId = String(remote.projectId || remote.project_id || base.projectId || "");
  const remoteDue = todoistRemoteDueDate(remote, base);
  return Object.assign({}, base, {
    id: String(remote.id || base.id || ""),
    content: remote.content || base.content || "",
    labels: subtaskFieldEnabled(remoteTask, settings, "subtaskIncludeLabels") ? cleanTodoistLabels(remote.labels || base.labels || []) : [],
    priority: subtaskFieldEnabled(remoteTask, settings, "subtaskIncludePriority") ? normalizePriority(remote.priority || base.priority) : 1,
    due_date: subtaskFieldEnabled(remoteTask, settings, "subtaskIncludeDueDate") ? (remoteDue ? datePart(remoteDue) : null) : null,
    deadline_date: subtaskFieldEnabled(remoteTask, settings, "subtaskIncludeDeadline") ? todoistRemoteDeadlineDate(remote, base) : null,
    scheduledDueDateTime: isDateTimeString(remoteDue) ? remoteDue : base.scheduledDueDateTime || "",
    duration: normalizeTodoistDuration(remote.duration || base.duration),
    description: todoistRemoteDescription(remote, base),
    isCompleted: todoistRemoteCompletion(remote, base),
    isSubtask,
    parentId: remote.parentId || remote.parent_id || base.parentId || "",
    section: isSubtask ? "" : (remote.section || base.section || ""),
    sectionId: remote.sectionId || remote.section_id || base.sectionId || "",
    projectId,
    projectName: remote.projectName || base.projectName || ""
  });
}

function referenceCacheEntry(id, task, settings = DEFAULT_SETTINGS, previous = null) {
  const description = task.isSubtask ? "" : sanitizeStoredTodoistDescription(task.description || previous?.description || "", settings);
  const noteRefs = mergeNoteReferences(previous?.noteRefs || [], [noteReferenceForTask(task, task.oid)]);
  const path = vaultRelativePath(task.path);
  const knowledgeTask = Object.assign({}, task, { path, description });
  const knowledge = taskKnowledgeSnapshot(knowledgeTask, settings, "", previous?.knowledge || null);
  return {
    oid: task.oid,
    path,
    lineNumber: task.lineNumber,
    content: task.content,
    description,
    labels: task.labels || [],
    priority: normalizePriority(task.priority),
    due_date: task.due_date || null,
    deadline_date: task.deadline_date || null,
    scheduledDueDateTime: task.scheduledDueDateTime || "",
    duration: normalizeTodoistDuration(task.duration),
    isCompleted: Boolean(task.isCompleted),
    isSubtask: Boolean(task.isSubtask),
    parentId: task.parentId || previous?.parentId || "",
    parentOid: task.parentOid || previous?.parentOid || "",
    parentContent: task.parentContent || previous?.parentContent || "",
    parentLineNumber: Number.isFinite(task.parentLineNumber) ? task.parentLineNumber : previous?.parentLineNumber ?? null,
    section: task.section || "",
    sectionId: task.sectionId || "",
    projectId: task.projectId || "",
    projectName: task.projectName || "",
    noteRefs,
    knowledge,
    signature: parsedTaskSignature(task),
    cachedAt: deviceTimestamp(),
    rebuiltAt: deviceTimestamp()
  };
}

function mergeReferenceCacheEntry(existing, incoming) {
  const noteRefs = mergeNoteReferences(existing.noteRefs || [], incoming.noteRefs || []);
  return Object.assign({}, existing, incoming, {
    path: existing.path || incoming.path || "",
    lineNumber: Number.isFinite(existing.lineNumber) ? existing.lineNumber : incoming.lineNumber,
    noteRefs,
    duplicateNoteReferenceCount: Math.max(0, noteRefs.length - 1)
  });
}

function noteReferenceForTask(task, oid = "") {
  return {
    id: task?.id || "",
    oid: oid || task?.oid || "",
    path: vaultRelativePath(task?.path || ""),
    lineNumber: Number.isFinite(task?.lineNumber) ? task.lineNumber : null,
    isSubtask: Boolean(task?.isSubtask),
    parentOid: task?.parentOid || "",
    parentId: task?.parentId || "",
    content: task?.content || ""
  };
}

function mergeNoteReferences(existing = [], incoming = []) {
  const refs = [];
  const seen = new Set();
  for (const ref of [...existing, ...incoming]) {
    if (!ref?.path) continue;
    const key = `${ref.path}:${Number.isFinite(ref.lineNumber) ? ref.lineNumber : ""}:${String(ref.oid || "").toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

function referenceNoteRefsText(task) {
  const refs = Array.isArray(task.noteRefs) && task.noteRefs.length
    ? task.noteRefs
    : task.path ? [noteReferenceForTask(task, task.oid)] : [];
  if (!refs.length) return "";
  if (refs.length === 1) return `${refs[0].path}${Number.isFinite(refs[0].lineNumber) ? `:${refs[0].lineNumber + 1}` : ""}`;
  return `${refs.length} note references: ${refs.map((ref) => `${ref.path}${Number.isFinite(ref.lineNumber) ? `:${ref.lineNumber + 1}` : ""}`).join("; ")}`;
}

function flattenTaskPlan(tasks) {
  const flat = [];
  for (const task of tasks || []) {
    flat.push(Object.assign({ isSubtask: false }, task));
    for (const subtask of task.subtasks || []) flat.push(Object.assign({ isSubtask: true }, subtask));
  }
  return flat;
}

function ensureGeneratedTaskMetadata(tasks, sectionName, settings = DEFAULT_SETTINGS) {
  for (const task of tasks || []) {
    task.section = sectionName;
    for (const subtask of task.subtasks || []) {
      subtask.section = "";
      subtask.description = "";
      if (!settings.subtaskIncludeLabels) subtask.labels = [];
      if (!settings.subtaskIncludePriority) subtask.priority = 1;
      if (!settings.subtaskIncludeDueDate) subtask.due_date = null;
      if (!settings.subtaskIncludeDeadline) subtask.deadline_date = null;
    }
  }
}

function renderTaskHeading(settings, template = null) {
  const value = template?.taskHeading || DEFAULT_TASK_HEADING;
  const heading = singleLine(value).replace(/\{\{date\}\}/g, today()) || DEFAULT_TASK_HEADING;
  return /^#{1,6}\s+/.test(heading) ? heading : `## ${heading}`;
}

function renderPromptResponseHeading(template = {}) {
  const value = template.taskHeading || `## Semantic Todoist Sync - ${singleLine(template.name || "Prompt Response")}`;
  const heading = singleLine(value).replace(/\{\{date\}\}/g, today());
  return /^#{1,6}\s+/.test(heading) ? heading : `## ${heading}`;
}

function parsedTaskToLine(task, settings, id) {
  const oid = ensureTaskOid(settings, task, id);
  const tag = task.isSubtask ? settings.subtaskSyncTag : settings.syncTag;
  const labels = (!task.isSubtask || settings.subtaskIncludeLabels) ? (task.labels || []).filter(Boolean).map((label) => `#${cleanLabel(label)}`).join(" ") : "";
  const deadline = task.deadline_date && (!task.isSubtask || settings.subtaskIncludeDeadline) ? ` {{${task.deadline_date}}}` : "";
  const due = task.due_date && (!task.isSubtask || settings.subtaskIncludeDueDate) ? ` 📅 ${task.due_date}` : "";
  const priority = (!task.isSubtask || settings.subtaskIncludePriority) ? ` !!${normalizePriority(task.priority)}` : "";
  const section = !task.isSubtask && task.section ? ` ///${task.section}` : "";
  const project = !task.isSubtask && task.projectName ? ` ${projectMarker(task.projectName)}` : "";
  const link = oid ? ` ${oidLink(oid, id, settings)}` : "";
  const core = `- [${task.isCompleted ? "x" : " "}] ${singleLine(task.content)} ${tag}${labels ? ` ${labels}` : ""}${priority}`;
  return setScheduleMarker(`${core}${section}${project}${deadline}${due}${link}`, task.scheduledDueDateTime, durationMinutes(task.duration), { removeIfEmpty: true });
}

function preserveTaskIndent(originalLine, newLine) {
  const indent = (/^[ \t]*/.exec(originalLine || "") || [""])[0];
  return `${indent}${String(newLine || "").trimStart()}`;
}

function taskLineWithStableIndent(originalLine, task, settings, id) {
  return ensureSubtaskIndent(
    preserveTaskIndent(originalLine, parsedTaskToLine(task, settings, id)),
    task,
    settings
  );
}

function ensureSubtaskIndent(line, task, settings = DEFAULT_SETTINGS) {
  const value = String(line || "");
  if (!shouldIndentAsSubtask(value, task, settings)) return value;
  const indent = desiredSubtaskIndent(settings);
  const match = /^([ \t]*)([-*]\s+\[[ xX]\].*)$/.exec(value);
  if (!match) return `${indent}${value.trimStart()}`;
  const currentWidth = indentationLevel(match[1]);
  return currentWidth >= indent.length ? value : `${indent}${match[2]}`;
}

function preflightTaskLine(line, settings) {
  if (!/^\s*[-*]\s+\[[ xX]\]/.test(line)) return line;
  let next = normalizeLegacySyncTags(normalizeLegacyReferenceMarkers(line, settings), settings);
  if (hasSubtaskSyncMarker(next, settings)) {
    next = ensureSubtaskIndent(next, { isSubtask: true }, settings);
  }
  if (hasSubtaskSyncMarker(next, settings)) {
    next = next.replace(new RegExp(`(\\S(?:.*?\\S)?)\\s+(?:sub\\s+){1,}(${escapeRegExp(settings.subtaskSyncTag)}\\b)`, "i"), "$1 $2");
  }
  return next;
}

function shouldIndentAsSubtask(line, task, settings = DEFAULT_SETTINGS) {
  return Boolean(
    task?.isSubtask ||
    task?.parentId ||
    task?.parent_id ||
    task?.parentOid ||
    hasSubtaskSyncMarker(line, settings)
  );
}

function hasSubtaskSyncMarker(line, settings = DEFAULT_SETTINGS) {
  const value = String(line || "");
  const configured = String(settings?.subtaskSyncTag || DEFAULT_SETTINGS.subtaskSyncTag || "#STSubSync");
  return Boolean(
    (configured && value.toLowerCase().includes(configured.toLowerCase())) ||
    /#tdsyncsub\b/i.test(value)
  );
}

function collapseInlineSpacesPreservingIndent(line) {
  const value = String(line || "");
  const match = /^([ \t]*)([\s\S]*)$/.exec(value) || ["", "", value];
  return `${match[1]}${match[2].replace(/[ \t]{2,}/g, " ")}`.trimEnd();
}

function repairSyncedSubtaskIndentationLines(lines, settings = DEFAULT_SETTINGS, byOid = null) {
  if (!Array.isArray(lines)) return 0;
  let repaired = 0;
  const subtaskMarker = String(settings?.subtaskSyncTag || DEFAULT_SETTINGS.subtaskSyncTag || "#STSubSync").toLowerCase();
  const oidLookup = byOid || taskCacheByOid(settings);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^\s*[-*]\s+\[[ xX]\]/.test(line || "")) continue;
    const lowered = String(line || "").toLowerCase();
    if (!lowered.includes(subtaskMarker) && !/#tdsyncsub\b/i.test(line) && !getTaskOid(line)) continue;
    const cached = cachedTaskForTaskLine(line, settings, oidLookup) || {};
    if (!shouldIndentAsSubtask(line, cached, settings)) continue;
    const next = ensureSubtaskIndent(line, cached, settings);
    if (next === line) continue;
    lines[i] = next;
    repaired += 1;
  }
  return repaired;
}

function cachedTaskForTaskLine(line, settings = DEFAULT_SETTINGS, byOid = null) {
  const oid = getTaskOid(line);
  const idFromOid = oid ? byOid?.get?.(String(oid).toUpperCase()) || (!byOid ? todoistIdForOid(settings, oid) : "") : "";
  const legacyId = (shouldConvertLegacyTodoistIds(settings) || hasSemanticSyncMarker(line, settings)) ? getLegacyTodoistId(line) : "";
  const id = idFromOid || legacyId;
  return id ? settings?.taskCache?.[id] || null : null;
}

function taskCacheByOid(settings = DEFAULT_SETTINGS) {
  const byOid = new Map();
  for (const [id, cached] of Object.entries(settings?.taskCache || {})) {
    const oid = String(cached?.oid || "").toUpperCase();
    if (oid) byOid.set(oid, id);
  }
  return byOid;
}

function cachedTaskPathsForIndentRepair(settings = DEFAULT_SETTINGS) {
  const paths = new Set();
  for (const cached of Object.values(settings?.taskCache || {})) {
    if (!cached?.path) continue;
    paths.add(vaultRelativePath(cached.path));
  }
  return Array.from(paths);
}

function subtaskIndentRepairFingerprint(settings = DEFAULT_SETTINGS) {
  return [
    SUBTASK_INDENT_REPAIR_VERSION,
    settings?.subtaskSyncTag || DEFAULT_SETTINGS.subtaskSyncTag,
    settings?.subtaskIndentSpaces || DEFAULT_SETTINGS.subtaskIndentSpaces
  ].join("|");
}

function desiredSubtaskIndent(settings = DEFAULT_SETTINGS) {
  return " ".repeat(Math.max(2, parseInt(settings.subtaskIndentSpaces, 10) || DEFAULT_SETTINGS.subtaskIndentSpaces || 4));
}

function replaceTaskLineContent(line, content, settings) {
  const text = String(line || "");
  const match = /^(\s*[-*]\s+\[[ xX]\]\s*)(.*)$/.exec(text);
  if (!match) return text;
  const body = match[2];
  const markers = taskSyntaxMarkerIndexes(body, settings).filter((index) => index >= 0);
  const firstMarker = markers.length ? Math.min(...markers) : body.length;
  const suffix = body.slice(firstMarker);
  const spacer = suffix && !/^\s/.test(suffix) ? " " : "";
  return `${match[1]}${singleLine(content)}${spacer}${suffix}`;
}

function addSectionToTaskLine(line, sectionName, settings) {
  if (!sectionName || extractSection(line)) return line;
  const marker = ` ///${sectionName}`;
  const oidIndex = line.search(/\s%%\[oid::/);
  if (oidIndex >= 0) return `${line.slice(0, oidIndex)}${marker}${line.slice(oidIndex)}`;
  const dateIndex = line.search(/\s(?:\{\{\d{4}-\d{2}-\d{2}\}\}|(?:📅|📆|🗓️|🗓|@)\s*\d{2,4}-\d{1,2}-\d{1,2})/);
  if (dateIndex >= 0) return `${line.slice(0, dateIndex)}${marker}${line.slice(dateIndex)}`;
  return `${line}${marker}`;
}

function syncProjectMarkerOnTaskLine(line, task, settings) {
  if (!line || task.isSubtask) return removeProjectMarker(line);
  const projectId = String(task.projectId || "");
  const projectName = singleLine(task.projectName || "");
  if (!projectName || isDefaultTodoistProject(projectId, settings)) return removeProjectMarker(line);
  return setProjectMarker(line, projectName);
}

function syncLocationMarkersOnTaskLine(line, task, settings) {
  return ensureSubtaskIndent(syncProjectMarkerOnTaskLine(syncSectionMarkerOnTaskLine(line, task, settings), task, settings), task, settings);
}

function syncSectionMarkerOnTaskLine(line, task, settings) {
  if (!line || task.isSubtask) return removeSectionMarker(line);
  const section = singleLine(task.section || "");
  if (!section) return removeSectionMarker(line);
  return setSectionMarker(line, section);
}

function setSectionMarker(line, sectionName) {
  const marker = ` ///${singleLine(sectionName).replace(/\s+/g, "_")}`;
  const cleaned = removeSectionMarker(line).trimEnd();
  const projectIndex = cleaned.search(/\s%%\[p::/);
  if (projectIndex >= 0) return `${cleaned.slice(0, projectIndex)}${marker}${cleaned.slice(projectIndex)}`;
  const oidIndex = cleaned.search(/\s%%\[oid::/);
  if (oidIndex >= 0) return `${cleaned.slice(0, oidIndex)}${marker}${cleaned.slice(oidIndex)}`;
  const dateIndex = cleaned.search(/\s(?:\{\{\d{4}-\d{2}-\d{2}\}\}|(?:📅|📆|🗓️|🗓|@)\s*\d{2,4}-\d{1,2}-\d{1,2})/);
  if (dateIndex >= 0) return `${cleaned.slice(0, dateIndex)}${marker}${cleaned.slice(dateIndex)}`;
  return `${cleaned}${marker}`;
}

function removeSectionMarker(line) {
  return collapseInlineSpacesPreservingIndent(String(line || "").replace(/\s+\/\/\/[^\s%{]+/g, ""));
}

function setProjectMarker(line, projectName) {
  const marker = ` ${projectMarker(projectName)}`;
  const cleaned = removeProjectMarker(line).trimEnd();
  const oidIndex = cleaned.search(/\s%%\[oid::/);
  if (oidIndex >= 0) return `${cleaned.slice(0, oidIndex)}${marker}${cleaned.slice(oidIndex)}`;
  const dateIndex = cleaned.search(/\s(?:\{\{\d{4}-\d{2}-\d{2}\}\}|(?:📅|📆|🗓️|🗓|@)\s*\d{2,4}-\d{1,2}-\d{1,2})/);
  if (dateIndex >= 0) return `${cleaned.slice(0, dateIndex)}${marker}${cleaned.slice(dateIndex)}`;
  return `${cleaned}${marker}`;
}

function removeProjectMarker(line) {
  return collapseInlineSpacesPreservingIndent(String(line || "").replace(/\s*%%\[p::\s*([^\]]+?)\s*\](?:%%+)?/g, ""));
}

function projectMarker(projectName) {
  return `%%[p:: ${singleLine(projectName)}]%%`;
}

function isDefaultTodoistProject(projectId, settings) {
  if (!projectId) return true;
  const defaultProjectId = String(settings.todoistTaskProjectId || settings.todoistInboxProjectId || "");
  return Boolean(defaultProjectId && String(projectId) === defaultProjectId);
}

function taskSyntaxMarkerIndexes(body, settings) {
  return [
    body.indexOf(settings.subtaskSyncTag),
    body.indexOf(settings.syncTag),
    body.search(/\s#[\w/-]+/),
    body.search(/\s!![1-4]\b/),
    body.search(/\s\/\/\/[\w/-]+/),
    body.search(/\s%%\[p::/),
    body.search(/\s%%\[sched::/),
    body.search(/\s\{\{\d{4}-\d{2}-\d{2}\}\}/),
    body.search(/\s(?:📅|📆|🗓️|🗓|@)\s*\d{2,4}-\d{1,2}-\d{1,2}/),
    body.search(/\s%%\[oid::/)
  ];
}

function parsedTaskSignature(task) {
  return JSON.stringify({
    content: singleLine(task.content),
    labels: (task.labels || []).map(cleanLabel).sort(),
    priority: normalizePriority(task.priority),
    due_date: task.due_date || null,
    scheduledDueDateTime: task.scheduledDueDateTime || "",
    durationMinutes: durationMinutes(task.duration),
    deadline_date: task.deadline_date || null,
    description: singleLine(task.description || ""),
    isCompleted: Boolean(task.isCompleted),
    section: task.section || ""
  });
}

function remoteTaskComparableSignature(remote, parsed, settings = DEFAULT_SETTINGS) {
  if (!remote) return "";
  return parsedTaskSignature(todoistTaskToParsedTask(remote, parsed || {}, settings));
}

function todoistUpdatePayload(task, remote = null, settings = DEFAULT_SETTINGS) {
  const updates = {};
  if (!remote || singleLine(remote.content || "") !== singleLine(task.content || "")) updates.content = task.content;
  const localLabels = taskLabelsForTodoist(task, settings);
  const remoteLabels = sortedTodoistLabels(remote?.labels || []);
  if (!remote || !sameStringArray(localLabels, remoteLabels)) updates.labels = localLabels;
  const localPriority = taskPriorityForTodoist(task, settings);
  if (!remote || normalizePriority(remote.priority) !== localPriority) updates.priority = localPriority;
  const localDescription = taskDescriptionForTodoist(task, settings);
  if (localDescription && (!remote || String(remote.description || "").trim() !== localDescription.trim())) updates.description = localDescription;
  const dueDate = taskDueDateForTodoist(task, settings);
  if (dueDate && (!remote || (remote.dueDate || remote.due?.date || "") !== dueDate)) updates.due_date = dueDate;
  const localDuration = normalizeTodoistDuration(task.duration);
  const remoteDuration = normalizeTodoistDuration(remote?.duration);
  if (localDuration?.amount && (!remoteDuration || remoteDuration.amount !== localDuration.amount || remoteDuration.unit !== localDuration.unit)) updates.duration = localDuration;
  const deadlineDate = taskDeadlineForTodoist(task, settings);
  if (deadlineDate && (!remote || (remote.deadlineDate || remote.deadline?.date || "") !== deadlineDate)) updates.deadline_date = deadlineDate;
  return updates;
}

function pendingTaskKey(path, task) {
  return `${vaultRelativePath(path)}::${singleLine(task.content || "").toLowerCase()}::${task.section || ""}::${task.due_date || ""}::${task.deadline_date || ""}`;
}

function pendingTaskContentKey(path, task) {
  return `${vaultRelativePath(path)}::content::${singleLine(task.content || "").toLowerCase()}`;
}

function pendingTaskOidKey(path, oid) {
  return `${vaultRelativePath(path)}::oid::${String(oid || "").toUpperCase()}`;
}

function parentReferenceForParsedTask(task, settings = DEFAULT_SETTINGS) {
  return parentReferenceForLine(task?.lineNumber, task?.allLines, settings, task?.isSubtask);
}

function parentReferenceForLine(lineNumber, allLines, settings = DEFAULT_SETTINGS, isSubtask = true) {
  if (!isSubtask || !Array.isArray(allLines) || !Number.isFinite(lineNumber)) return {};
  const line = allLines[lineNumber] || "";
  const indent = indentationLevel(line);
  if (indent <= 0) return {};
  for (let i = lineNumber - 1; i >= 0; i -= 1) {
    const candidate = allLines[i] || "";
    if (!candidate.trim()) continue;
    if (!/^\s*[-*]\s+\[[ xX]\]/.test(candidate)) continue;
    if (indentationLevel(candidate) >= indent) continue;
    return {
      lineNumber: i,
      oid: getTaskOid(candidate),
      id: getTodoistId(candidate, settings),
      content: extractTaskContent(candidate, settings)
    };
  }
  return {};
}

function parseTaskLine(line, lineNumber, path, allLines, settings) {
  if (!/^\s*[-*]\s+\[[ xX]\]/.test(line)) return null;
  const normalizedLine = normalizeLegacySyncTags(line, settings);
  const isSyncTask = normalizedLine.includes(settings.syncTag) || hasSubtaskSyncMarker(normalizedLine, settings);
  if (!isSyncTask) return null;
  const oid = getTaskOid(line);
  const id = getTodoistId(line, settings);
  const isSubtask = hasSubtaskSyncMarker(normalizedLine, settings);
  const parentReference = parentReferenceForLine(lineNumber, allLines, settings, isSubtask);
  const scheduleMarker = extractScheduleMarker(line);
  const labels = (line.match(/#[\w/-]+/g) || []).map((label) => label.slice(1)).filter((label) => {
    if (!settings.excludeSyncTagsFromLabels) return true;
    return !isSyncMarkerLabel(label, settings);
  });
  return {
    id,
    oid,
    line,
    lineNumber,
    path,
    allLines,
    isSyncTask,
    isSubtask,
    isCompleted: /^\s*[-*]\s+\[[xX]\]/.test(line),
    indent: indentationLevel(line),
    parentId: parentReference.id || "",
    parentOid: parentReference.oid || "",
    parentContent: parentReference.content || "",
    parentLineNumber: Number.isFinite(parentReference.lineNumber) ? parentReference.lineNumber : null,
    content: extractTaskContent(line, settings),
    labels,
    priority: extractPriority(line),
    due_date: extractDueDate(line),
    deadline_date: extractDeadline(line),
    scheduledDueDateTime: scheduleMarker.scheduledDueDateTime,
    duration: scheduleMarker.duration,
    section: extractSection(line),
    projectName: extractProjectName(line),
    description: obsidianDescription(path)
  };
}

function parseTaskReferenceLine(line, lineNumber, path, settings) {
  if (!/^\s*[-*]\s+\[[ xX]\]/.test(line)) return null;
  const scheduleMarker = extractScheduleMarker(line);
  const labels = (line.match(/#[\w/-]+/g) || []).map((label) => label.slice(1)).filter((label) => {
    if (!settings.excludeSyncTagsFromLabels) return true;
    return !isSyncMarkerLabel(label, settings);
  });
  return {
    oid: getTaskOid(line),
    id: getTodoistId(line, settings),
    line,
    lineNumber,
    path,
    allLines: [],
    isSyncTask: false,
    isSubtask: indentationLevel(line) > 0,
    isCompleted: /^\s*[-*]\s+\[[xX]\]/.test(line),
    indent: indentationLevel(line),
    parentId: "",
    parentOid: "",
    parentContent: "",
    parentLineNumber: null,
    content: extractTaskContent(line, settings),
    labels,
    priority: extractPriority(line),
    due_date: extractDueDate(line),
    deadline_date: extractDeadline(line),
    scheduledDueDateTime: scheduleMarker.scheduledDueDateTime,
    duration: scheduleMarker.duration,
    section: extractSection(line),
    projectName: extractProjectName(line),
    description: obsidianDescription(path)
  };
}

function todoistArgsFromParsedTask(task, projectId, parent, sectionId, settings = DEFAULT_SETTINGS) {
  const effectiveTask = Object.assign({}, task, { isSubtask: Boolean(parent || task.isSubtask) });
  const args = {
    content: task.content,
    labels: taskLabelsForTodoist(effectiveTask, settings),
    priority: taskPriorityForTodoist(effectiveTask, settings)
  };
  if (!parent && !task.isSubtask && isRichTodoistDescription(task.description)) args.description = formatTodoistDescription(task.description, settings);
  if (parent) args.parent_id = parent;
  else if (sectionId) args.section_id = sectionId;
  else args.project_id = projectId;
  const dueDate = taskDueDateForTodoist(effectiveTask, settings);
  if (dueDate) args.due = { date: dueDate };
  const deadlineDate = taskDeadlineForTodoist(effectiveTask, settings);
  if (deadlineDate) args.deadline = { date: deadlineDate };
  return args;
}

function findParentForTask(task, lineToTemp, settings = null) {
  if (!task.isSubtask || task.indent <= 0) return "";
  for (let i = task.lineNumber - 1; i >= 0; i -= 1) {
    const line = task.allLines[i];
    if (!line || !line.trim()) break;
    if (indentationLevel(line) >= task.indent) continue;
    return getTodoistId(line, settings) || lineToTemp.get(i) || "";
  }
  return "";
}

function addTodoistLink(line, id, settings, oidOverride = "") {
  const existingOid = getTaskOid(line);
  const oid = existingOid || oidOverride || oidForTodoistId(settings, id) || generateUniqueOid(settings);
  return normalizeTaskOidLine(line, oid, settings, id);
}

function normalizeTaskOidLine(line, oid, settings, todoistId = "") {
  const link = oidLink(oid);
  const cleaned = stripBrokenTodoistLink(line);
  return cleaned.endsWith(link) ? cleaned : `${cleaned} ${link}`;
}

function oidLink(oid) {
  return `%%[oid:: ${oid}]%%`;
}

function getTodoistId(line, settings = null) {
  const oid = getTaskOid(line);
  const shouldReadLegacy = shouldConvertLegacyTodoistIds(settings) || hasSemanticSyncMarker(line, settings);
  return (settings ? todoistIdForOid(settings, oid) : "") || (shouldReadLegacy ? getLegacyTodoistId(line) : "");
}

function hasSemanticSyncMarker(line, settings = DEFAULT_SETTINGS) {
  const text = String(line || "");
  return Boolean(settings && (text.includes(settings.syncTag) || hasSubtaskSyncMarker(text, settings)));
}

function getLegacyTodoistId(line) {
  const text = String(line || "");
  const patterns = [
    /tid::\s*(?:\[)?([A-Za-z0-9]{6,})(?:\])?/i,
    /todoist:\/\/task\?id=([A-Za-z0-9]{6,})/i,
    /todoist\.com\/(?:app\/)?task\/(?:[^)\s\/]+-)?([A-Za-z0-9]{6,})/i,
    /(?:^|\s)Todoist(?:\s*ID)?\s*:\s*([A-Za-z0-9]{6,})/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return "";
}

function getTaskOid(line) {
  return (/oid::\s*(?:\[)?([A-Za-z0-9]{1,5})(?:\])?/.exec(line) || [])[1] || "";
}

function ensureTaskOid(settings, task, todoistId = "") {
  if (task.oid) return task.oid;
  if (todoistId) {
    const cachedOid = oidForTodoistId(settings, todoistId);
    if (cachedOid) {
      task.oid = cachedOid;
      return cachedOid;
    }
  }
  if (!todoistId && !task.id) return "";
  task.oid = generateUniqueOid(settings);
  return task.oid;
}

function todoistIdForOid(settings, oid) {
  if (!oid) return "";
  const target = String(oid).toUpperCase();
  for (const [id, cached] of Object.entries(settings?.taskCache || {})) {
    if (String(cached.oid || "").toUpperCase() === target) return id;
    for (const ref of cached.noteRefs || []) {
      if (String(ref?.oid || "").toUpperCase() === target) return id;
    }
  }
  for (const reference of Object.values(settings?.pendingTaskReferences || {})) {
    if (String(reference?.oid || "").toUpperCase() === target && reference?.id) return String(reference.id);
  }
  return "";
}

function oidForTodoistId(settings, todoistId) {
  return settings?.taskCache?.[todoistId]?.oid || "";
}

function generateUniqueOid(settings) {
  const runtimeUsed = settings?.__taskReferenceUsedOids;
  const used = runtimeUsed && typeof runtimeUsed.has === "function" && typeof runtimeUsed.add === "function"
    ? settings.__taskReferenceUsedOids
    : new Set(Object.values(settings?.taskCache || {}).map((task) => String(task.oid || "").toUpperCase()).filter(Boolean));
  if (!(runtimeUsed && typeof runtimeUsed.has === "function" && typeof runtimeUsed.add === "function")) {
    for (const task of Object.values(settings?.taskCache || {})) {
      for (const ref of task?.noteRefs || []) {
        const oid = String(ref?.oid || "").toUpperCase();
        if (oid) used.add(oid);
      }
    }
    for (const ref of Object.values(settings?.pendingTaskReferences || {})) {
      const oid = String(ref?.oid || "").toUpperCase();
      if (oid) used.add(oid);
    }
  }
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const oid = Math.random().toString(36).replace(/[^a-z0-9]/gi, "").slice(2, 7).toUpperCase().padEnd(5, "0");
    if (!used.has(oid)) {
      used.add(oid);
      return oid;
    }
  }
  const fallback = uuid().replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase();
  used.add(fallback);
  return fallback;
}

function stripBrokenTodoistLink(line) {
  const original = String(line || "");
  const indent = (/^[ \t]*/.exec(original) || [""])[0];
  const body = original.slice(indent.length)
    .replace(/<!--\s*tid::\s+\[[^\]]+\]\([^)]+\)\s*-->/g, "")
    .replace(/<!--\s*tid::\s*[A-Za-z0-9]+\s*-->/g, "")
    .replace(/%%\[tid::\s+\[[^\]]+\]\([^)]+\)\]%%/g, "")
    .replace(/%%\[tid::\s*[A-Za-z0-9]+\s*\]%%/g, "")
    .replace(/%%\[oid::\s*(?:\[[A-Za-z0-9]{1,5}\]\([^)]+\)|[A-Za-z0-9]{1,5})\]%%/g, "")
    .replace(/\[tid::\s+\[[^\]]+\]\([^)]+\)\]/g, "")
    .replace(/\[tid::\s*[A-Za-z0-9]+\]/g, "")
    .replace(/\s*todoist:\/\/task\?id=[A-Za-z0-9]+/gi, "")
    .replace(/\s*https?:\/\/(?:app\.)?todoist\.com\/[^\s)]+/gi, "")
    .replace(/\s*\bTodoist(?:\s*ID)?\s*:\s*[A-Za-z0-9]+/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
  return `${indent}${body.trimStart()}`;
}

function normalizeLegacyReferenceMarkers(line, settings) {
  const oid = getTaskOid(line);
  const cleaned = stripBrokenTodoistLink(line);
  if (!oid) return cleaned;
  return normalizeTaskOidLine(cleaned, oid, settings);
}

function normalizeLegacySyncTags(line, settings = DEFAULT_SETTINGS) {
  if (!shouldConvertLegacyTodoistIds(settings)) return String(line || "");
  return String(line || "")
    .replace(/#tdsyncsub\b/gi, settings.subtaskSyncTag)
    .replace(/#tdsync\b/gi, settings.syncTag);
}

function shouldConvertLegacyTodoistIds(settings = DEFAULT_SETTINGS) {
  return settings?.legacyTodoistIdMode === "convert";
}

function isSyncMarkerLabel(label, settings = DEFAULT_SETTINGS) {
  const value = String(label || "").replace(/^#/, "").toLowerCase();
  return value === String(settings.syncTag || "").replace("#", "").toLowerCase() ||
    value === String(settings.subtaskSyncTag || "").replace("#", "").toLowerCase() ||
    value === "tdsync" ||
    value === "tdsyncsub";
}

function extractTaskContent(line, settings) {
  return stripTodoistTitleArtifacts(normalizeLegacySyncTags(line, settings))
    .replace(/^(\s*)[-*]\s+\[[ xX]\]\s*/, "")
    .replace(/<!--\s*tid::\s+\[[^\]]+\]\([^)]+\)\s*-->/g, "")
    .replace(/%%\[.*?\]%%/g, "")
    .replace(new RegExp(escapeRegExp(settings.subtaskSyncTag), "g"), "")
    .replace(new RegExp(escapeRegExp(settings.syncTag), "g"), "")
    .replace(/#tdsyncsub\b/gi, "")
    .replace(/#tdsync\b/gi, "")
    .replace(/#[\w/-]+/g, "")
    .replace(/!![1-4]/g, "")
    .replace(/\{\{\d{4}-\d{2}-\d{2}\}\}/g, "")
    .replace(/(?:📅|📆|🗓️|🗓|@)\s*\d{2,4}-\d{1,2}-\d{1,2}/g, "")
    .replace(/\/\/\/[\w/-]+/g, "")
    .replace(/%%\[p::\s*([^\]]+?)\s*\]%%+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTodoistTitleArtifacts(line) {
  return String(line || "")
    .replace(/<!--\s*tid::\s+\[[^\]]+\]\([^)]+\)\s*-->/g, "")
    .replace(/<!--\s*tid::\s*[A-Za-z0-9]+\s*-->/g, "")
    .replace(/%%\[tid::\s+\[[^\]]+\]\([^)]+\)\]%%/g, "")
    .replace(/%%\[tid::\s*[A-Za-z0-9]+\s*\]%%/g, "")
    .replace(/\[tid::\s+\[[^\]]+\]\([^)]+\)\]/g, "")
    .replace(/\[tid::\s*[A-Za-z0-9]+\]/g, "")
    .replace(/\bTodoist(?:\s*ID)?\s*:\s*[A-Za-z0-9]+/gi, "")
    .replace(/https?:\/\/(?:app\.)?todoist\.com\/[^\s)]+/gi, "")
    .replace(/todoist:\/\/[^\s)]+/gi, "");
}

function extractPriority(line) {
  return normalizePriority((/!!([1-4])/.exec(line) || [])[1] || 1);
}

function extractDueDate(line) {
  const match = /(?:📅|📆|🗓️|🗓|@)\s*(\d{2,4}-\d{1,2}-\d{1,2})/.exec(line);
  return match ? normalizeDate(match[1]) : null;
}

function extractDeadline(line) {
  const match = /\{\{(\d{2,4}-\d{1,2}-\d{1,2})\}\}?/.exec(line);
  return match ? normalizeDate(match[1]) : null;
}

function extractScheduleMarker(line) {
  const match = /%%\[sched::\s*([^;\]]+?)(?:\s*;\s*dur::\s*(\d+))?\s*\]%%/.exec(String(line || ""));
  if (!match) return { scheduledDueDateTime: "", duration: null };
  const scheduledDueDateTime = isDateTimeString(match[1]) ? match[1].trim() : "";
  const minutes = Number(match[2] || 0);
  return {
    scheduledDueDateTime,
    duration: minutes > 0 ? { amount: Math.round(minutes), unit: "minute" } : null
  };
}

function extractSection(line) {
  return (/\/\/\/([\w/-]+)/.exec(line) || [])[1] || "";
}

function extractProjectName(line) {
  return singleLine((/%%\[p::\s*([^\]]+?)\s*\]%%+/.exec(line) || [])[1] || "");
}

function indentationLevel(line) {
  const indent = (/^[ \t]*/.exec(line) || [""])[0];
  let width = 0;
  for (const char of indent) {
    width += char === "\t" ? 4 : 1;
  }
  return width;
}

function parseRawEmail(raw) {
  const normalized = raw.replace(/\r\n/g, "\n");
  const [headerText, ...bodyParts] = normalized.split("\n\n");
  const headers = parseHeaders(headerText);
  const body = bodyParts.join("\n\n");
  const boundary = (/boundary="?([^";]+)"?/i.exec(headers["content-type"] || "") || [])[1];
  let text = "";
  if (boundary) {
    const parts = body.split(`--${boundary}`);
    text = decodeMimePart(parts.find((part) => /content-type:\s*text\/plain/i.test(part)) || parts.find((part) => /content-type:\s*text\/html/i.test(part)) || body);
  } else {
    text = decodeBody(body, headers["content-transfer-encoding"] || "", headers["content-type"] || "");
  }
  return { subject: decodeHeader(headers.subject || ""), from: headers.from || "", to: headers.to || "", date: headers.date || "", text: cleanupEmailText(text) };
}

function originalEmailReceivedAt(parsed, fallbackReceivedAt = "") {
  return extractForwardedOriginalDate(parsed?.text || "") ||
    normalizeEmailDate(parsed?.date || "") ||
    normalizeEmailDate(fallbackReceivedAt || "") ||
    deviceTimestamp();
}

function extractForwardedOriginalDate(text) {
  const body = String(text || "").replace(/\r\n/g, "\n");
  const forwardedIndex = body.search(/(?:^-{2,}\s*forwarded message\s*-{2,}$|^begin forwarded message:|^from:\s.*\n(?:.*\n){0,6}?(?:sent|date):)/im);
  const forwardedBody = forwardedIndex >= 0 ? body.slice(forwardedIndex) : body;
  const patterns = [
    /^Date:\s*(.+)$/gim,
    /^Sent:\s*(.+)$/gim,
    /^Received:\s*(.+)$/gim
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(forwardedBody))) {
      const normalized = normalizeEmailDate(match[1]);
      if (normalized) return normalized;
    }
  }
  return "";
}

function normalizeEmailDate(value) {
  const raw = singleLine(String(value || "").replace(/\([^)]*\)/g, " ").replace(/\bat\b/gi, " "));
  if (!raw) return "";
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? deviceTimestamp(date) : "";
}

function parseHeaders(text) {
  const headers = {};
  for (const line of text.replace(/\n[ \t]+/g, " ").split("\n")) {
    const index = line.indexOf(":");
    if (index > -1) headers[line.slice(0, index).toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function decodeMimePart(part) {
  const [headerText, ...bodyParts] = part.replace(/\r\n/g, "\n").split("\n\n");
  const headers = parseHeaders(headerText);
  return decodeBody(bodyParts.join("\n\n"), headers["content-transfer-encoding"] || "", headers["content-type"] || "");
}

function decodeBody(body, transfer, contentType) {
  let text = body.trim();
  if (/base64/i.test(transfer)) {
    try { text = base64ToUtf8(text.replace(/\s+/g, "")); } catch {}
  } else if (/quoted-printable/i.test(transfer)) {
    text = text.replace(/=\n/g, "").replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  return /text\/html/i.test(contentType) ? stripHtml(text) : text;
}

function base64ToUtf8(value) {
  if (typeof Buffer !== "undefined") return Buffer.from(value, "base64").toString("utf8");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function decodeHeader(value) {
  return String(value || "").replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (_, charset, encoding, text) => {
    try {
      return encoding.toUpperCase() === "B" ? base64ToUtf8(text) : text.replace(/_/g, " ").replace(/=([A-Fa-f0-9]{2})/g, (__, hex) => String.fromCharCode(parseInt(hex, 16)));
    } catch { return text; }
  });
}

function cleanupEmailText(text) {
  return text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function stripHtml(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}

function chunkMarkdown(text, maxChars = 900, maxChunks = 12) {
  const cleaned = text.replace(/```[\s\S]*?```/g, " ").replace(/\n{3,}/g, "\n\n");
  const chunks = [];
  let current = "";
  for (const block of cleaned.split(/\n(?=#{1,6}\s)|\n\n/)) {
    const compactBlock = clamp(block.trim(), maxChars);
    if ((current + "\n\n" + compactBlock).length > maxChars && current.trim()) {
      chunks.push(current.trim());
      if (chunks.length >= maxChunks) break;
      current = compactBlock;
    } else current = current ? `${current}\n\n${compactBlock}` : compactBlock;
  }
  if (current.trim() && chunks.length < maxChunks) chunks.push(current.trim());
  return chunks;
}

function formatContext(chunks, maxChars, settings = DEFAULT_SETTINGS, query = "", options = {}) {
  const hasCitationMap = options.citationMap instanceof Map;
  return clamp(chunks.map((chunk, index) => {
    const source = sourceReference(chunk, options.basePath || "");
    const citationNumber = source ? options.citationMap?.get(source) : null;
    const heading = citationNumber
      ? `Context Note (${citationNumber}): ${source}`
      : hasCitationMap
        ? `Additional Vault Context: ${source}`
        : `Context ${index + 1}: ${source}`;
    return [
      heading,
      chunk.matchRationale ? `Match rationale: ${chunk.matchRationale}` : "",
      chunk.matchScore ? `Match score: ${chunk.matchScore}` : "",
      "Ranked relevant excerpt:",
      rankedContextExcerpt(chunk.text || "", query, settings)
    ].filter(Boolean).join("\n");
  }).join("\n\n---\n\n"), maxChars);
}

function rankedContextExcerpt(text, query = "", settings = DEFAULT_SETTINGS) {
  const cleaned = stripExcludedLinks(stripGeneratedActionItemsSection(String(text || "")), settings);
  const queryTerms = termCounts(query);
  const segments = cleaned
    .split(/\n{2,}|\n(?=#{1,6}\s)/)
    .flatMap((block) => {
      const trimmed = block.trim();
      if (!trimmed) return [];
      if (/^#{1,6}\s/.test(trimmed) && trimmed.length <= 120) return [trimmed];
      return splitDescriptionSentences(trimmed).length ? splitDescriptionSentences(trimmed) : [trimmed];
    })
    .map((segment, index) => {
      const value = singleLine(segment.replace(/^#{1,6}\s*/, ""));
      const actionScore = /action|todo|follow|review|send|confirm|complete|deadline|due|need|waiting|owner|lead|draft|update|share|clarify|coordinate|decision|dependency|risk|block/i.test(value) ? 0.75 : 0;
      const lexical = lexicalScore(queryTerms, value);
      return { value, index, lexical, score: lexical + actionScore };
    })
    .filter((item) => item.value && item.value.length >= 18);
  const directMatches = segments.filter((item) => item.lexical > 0);
  const ranked = (directMatches.length ? directMatches : segments)
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.value);
  const excerpt = ranked.length ? ranked.join(" ") : cleaned;
  return clamp(excerpt, 1400);
}

function formatSourceLinks(active, chunks) {
  const sources = [];
  if (active?.path) sources.push({ path: active.path, title: active.title || active.path, role: "Active note" });
  for (const chunk of chunks || []) sources.push({ path: chunk.path, title: chunk.title || chunk.path, role: "Relevant note" });
  const seen = new Set();
  return sources
    .filter((source) => {
      if (!source.path || seen.has(source.path)) return false;
      seen.add(source.path);
      return true;
    })
    .slice(0, 10)
    .map((source) => `- ${source.role}: [${source.title}](obsidian://open?file=${encodeURIComponent(source.path)})`)
    .join("\n");
}

function formatChatHistory(messages) {
  const lines = (messages || [])
    .filter((message) => message.role !== "assistant" || message.text !== "Thinking...")
    .slice(-8)
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${clamp(singleLine(message.text), 700)}`);
  return lines.length ? lines.join("\n") : "No recent chat.";
}

function adaptiveContextBudget(mode = "chat") {
  return ADAPTIVE_CONTEXT_MODE_BUDGETS[mode] || ADAPTIVE_CONTEXT_MODE_BUDGETS.chat;
}

function adaptiveContextDepth(mode = "chat", prompt = "") {
  const budget = adaptiveContextBudget(mode);
  if (mode === "description" || mode === "schedule") return budget.maxDepth;
  const text = String(prompt || "");
  if (BROAD_CONTEXT_QUERY_RE.test(text)) return budget.maxDepth;
  if (TASK_ACTION_CONTEXT_RE.test(text)) return Math.min(budget.maxDepth, Math.max(budget.defaultDepth, 5));
  return budget.defaultDepth;
}

function adaptiveSemanticRetrievalLimit(settings = DEFAULT_SETTINGS, mode = "chat", baseLimit = 8, prompt = "") {
  const depth = adaptiveContextDepth(mode, prompt);
  const budget = adaptiveContextBudget(mode);
  const base = Math.max(1, Number(baseLimit || settings.maxChatContextChunks || 8));
  const expanded = depth >= 7 ? Math.max(base * budget.retrievalMultiplier, budget.maxNotes * 2) : depth >= 5 ? Math.max(base, Math.ceil(base * 1.5)) : base;
  return Math.max(base, Math.min(budget.maxRetrieval, expanded));
}

function modelEscalationSignals(mode = "chat", options = {}) {
  const prompt = String(options.prompt || "");
  const context = Array.isArray(options.context) ? options.context : [];
  const pack = options.adaptivePack || {};
  const taskCards = Array.isArray(pack.taskCards) ? pack.taskCards : [];
  const projectCards = Array.isArray(pack.projectCards) ? pack.projectCards : [];
  const paths = uniqueValues(context.map((chunk) => chunk?.path || "").filter(Boolean));
  const projects = uniqueValues(paths.map(projectKeyFromPath).filter(Boolean));
  const scores = context
    .map((chunk) => Number(chunk?.matchScore ?? chunk?.score ?? 0))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  const topScore = scores[0] || 0;
  const nearTopChunks = topScore ? scores.filter((score) => score >= topScore * 0.82).length : 0;
  const dates = uniqueValues(context.map(contextDatePart).filter(Boolean)).sort();
  const recencySpreadDays = dates.length > 1 ? Math.abs(daysBetweenLocalDates(dates[0], dates[dates.length - 1])) : 0;
  const taskCount = Math.max(taskCards.length, Number(options.taskCount || 0));
  return {
    mode,
    retrievedChunks: context.length,
    uniqueNotes: paths.length,
    projectDiversity: Math.max(projects.length, projectCards.length),
    nearTopChunks,
    taskCards: taskCount,
    projectCards: projectCards.length,
    dateMentions: dates.length,
    recencySpreadDays,
    broadPrompt: BROAD_CONTEXT_QUERY_RE.test(prompt),
    recencyPrompt: RECENCY_OR_CONFLICT_QUERY_RE.test(prompt),
    actionPrompt: TASK_ACTION_CONTEXT_RE.test(prompt),
    validationRepair: options.validationRepair === true
  };
}

function modelEscalationScore(mode = "chat", signals = {}) {
  let score = 0;
  if (mode === "description") score += 25;
  else if (mode === "schedule") score += 18;
  else if (mode === "task-generation") score += 16;
  if (signals.validationRepair) score += 10;
  if (signals.broadPrompt) score += 20;
  if (signals.recencyPrompt) score += 14;
  if (signals.actionPrompt) score += 8;
  if (signals.projectDiversity >= 5) score += 16;
  else if (signals.projectDiversity >= 3) score += 10;
  if (signals.uniqueNotes >= 10) score += 12;
  else if (signals.uniqueNotes >= 6) score += 8;
  if (signals.nearTopChunks >= 8) score += 10;
  else if (signals.nearTopChunks >= 4) score += 6;
  if (signals.taskCards >= 12) score += 10;
  else if (signals.taskCards >= 6) score += 6;
  if (signals.projectCards >= 4) score += 8;
  if (signals.recencySpreadDays >= 45 && signals.recencyPrompt) score += 12;
  else if (signals.recencySpreadDays >= 14 && signals.recencyPrompt) score += 7;
  return Math.min(100, score);
}

function modelEscalationReasons(mode = "chat", signals = {}, score = 0) {
  const reasons = [];
  if (mode === "description") reasons.push("portfolio-level task description");
  if (mode === "task-generation") reasons.push("task-generation reasoning");
  if (mode === "schedule") reasons.push("scheduler reasoning");
  if (signals.broadPrompt) reasons.push("broad project or priority request");
  if (signals.recencyPrompt) reasons.push("recency or conflicting-guidance request");
  if (signals.actionPrompt) reasons.push("action or next-step selection");
  if (signals.projectDiversity >= 3) reasons.push(`${signals.projectDiversity} project areas`);
  if (signals.uniqueNotes >= 6) reasons.push(`${signals.uniqueNotes} relevant notes`);
  if (signals.nearTopChunks >= 4) reasons.push("several similarly relevant context matches");
  if (signals.recencySpreadDays >= 14 && signals.recencyPrompt) reasons.push(`${signals.recencySpreadDays} days of recency spread`);
  if (score >= STRONG_MODEL_HARD_ESCALATION_THRESHOLD) reasons.push("near-maximum local complexity score");
  return reasons.slice(0, 6);
}

function projectKeyFromPath(filePath = "") {
  return String(filePath || "").split("/").filter(Boolean).slice(0, 3).join("/");
}

function contextDatePart(chunk = {}) {
  const timestamp = Number(chunk.createdAt || chunk.modifiedAt || 0);
  if (timestamp) return formatLocalDate(new Date(timestamp));
  return datePartFromText(`${chunk.title || ""} ${chunk.path || ""} ${chunk.text || ""}`);
}

function datePartFromText(value = "") {
  const text = String(value || "");
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const long = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i.exec(text);
  if (!long) return "";
  const month = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12"
  }[long[1].toLowerCase()];
  return `${long[3]}-${month}-${String(long[2]).padStart(2, "0")}`;
}

function adaptiveNoteCardsFromChunks(chunks = [], query = "", settings = DEFAULT_SETTINGS, options = {}) {
  const grouped = new Map();
  for (const chunk of chunks || []) {
    if (!chunk?.path) continue;
    if (chunk.kind === "todoist-task-reference" || chunk.source === "local-reference-table") continue;
    const source = sourceReference(chunk, options.basePath || "");
    const existing = grouped.get(chunk.path) || {
      path: chunk.path,
      source,
      title: chunk.title || chunk.path,
      createdAt: Number(chunk.createdAt || 0),
      modifiedAt: Number(chunk.modifiedAt || 0),
      score: 0,
      chunks: []
    };
    existing.createdAt = Math.max(existing.createdAt || 0, Number(chunk.createdAt || 0));
    existing.modifiedAt = Math.max(existing.modifiedAt || 0, Number(chunk.modifiedAt || 0));
    existing.score = Math.max(existing.score || 0, Number(chunk.matchScore || 0));
    existing.chunks.push(chunk);
    grouped.set(chunk.path, existing);
  }
  const cards = [];
  for (const group of grouped.values()) {
    const text = group.chunks.map((chunk) => `${chunk.title || group.title}\n${chunk.text || ""}`).join("\n\n");
    const signals = adaptiveContextSignals(text, query, group.title, group.path);
    const excerpt = rankedContextExcerpt(text, query, settings);
    const citationNumber = group.source && options.citationMap instanceof Map ? options.citationMap.get(group.source) : null;
    const freshnessAt = group.createdAt || group.modifiedAt || 0;
    cards.push({
      title: group.title,
      path: group.path,
      source: group.source,
      citationNumber,
      type: signals.type,
      score: (group.score || 0) + signals.score + recencyBoost(freshnessAt),
      recency: freshnessAt,
      people: signals.people,
      outcomes: signals.outcomes,
      problems: signals.problems,
      dependencies: signals.dependencies,
      nextSteps: signals.nextSteps,
      decisions: signals.decisions,
      topics: signals.topics,
      evidence: truncateAtWord(excerpt, 950)
    });
  }
  return cards
    .sort((a, b) => b.score - a.score || b.recency - a.recency || a.path.localeCompare(b.path))
    .slice(0, Math.max(1, options.maxCards || adaptiveContextBudget().maxNotes));
}

function adaptiveContextSignals(text = "", query = "", title = "", path = "") {
  const sourceText = singleLine([title, path, text].filter(Boolean).join(" "));
  const people = extractPeopleCandidates(sourceText);
  const outcomes = signalSentences(text, /(outcome|result|resolved|resolution|put in place|implemented|finalized|approved|agreed|confirmed|decided|decision|next version|process|workflow)/i, 3);
  const problems = signalSentences(text, /(problem|issue|risk|concern|unclear|blocked|blocker|gap|challenge|constraint|missing|waiting|delay|stuck)/i, 3);
  const dependencies = signalSentences(text, /(depend|dependency|waiting|need(?:s|ed)?|requires?|approval|confirm|clarify|input|feedback|review from|blocked by)/i, 3);
  const nextSteps = signalSentences(text, /(next step|action|todo|follow[-\s]?up|review|send|draft|update|share|schedule|coordinate|prepare|complete|finalize|ask|confirm)/i, 4);
  const decisions = signalSentences(text, /(decided|decision|agreed|approved|confirmed|changed|superseded|current guidance|now use|will use|should use)/i, 3);
  const topics = adaptiveTopics([title, path, query, text].join(" "));
  const type = /meeting|discussion|touchbase|sync|call|agenda|minutes/i.test([title, path].join(" ")) ? "meeting note" : /email/i.test(path) ? "email note" : "vault note";
  const score = Math.min(1.6, (people.length ? 0.15 : 0) + outcomes.length * 0.18 + problems.length * 0.16 + dependencies.length * 0.14 + nextSteps.length * 0.12 + decisions.length * 0.18);
  return { type, score, people, outcomes, problems, dependencies, nextSteps, decisions, topics };
}

function signalSentences(text = "", pattern, limit = 3) {
  const lines = String(text || "")
    .split(/\n+/)
    .flatMap((line) => splitDescriptionSentences(line.replace(/^[-*]\s+/, "").trim()))
    .map((line) => singleLine(line))
    .filter((line) => line.length >= 24 && pattern.test(line));
  const seen = new Set();
  const unique = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(truncateAtWord(line, 220));
    if (unique.length >= limit) break;
  }
  return unique;
}

function adaptiveTopics(text = "", limit = 6) {
  const counts = termCounts(text);
  const stop = new Set(["task", "tasks", "todoist", "note", "notes", "meeting", "meetings", "project", "projects", "context", "source", "semantic", "sync", "review", "follow", "update", "need", "needs", "using", "with", "from", "that", "this", "have", "will", "your"]);
  return Object.entries(counts)
    .filter(([term]) => term.length >= 4 && !stop.has(term))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function extractPeopleCandidates(text = "", limit = 8) {
  const candidates = [];
  const add = (value) => {
    const clean = singleLine(value || "").replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    if (!clean || clean.length < 2 || clean.length > 40) return;
    if (/^(The|This|That|Todoist|Semantic|Obsidian|Google|OpenAI|Gemini|Email|Project|Meeting|Source|Context|Task|Tasks|May|June|July|August|September|October|November|December|January|February|March|April)$/i.test(clean)) return;
    if (!candidates.some((item) => item.toLowerCase() === clean.toLowerCase())) candidates.push(clean);
  };
  String(text || "").replace(/\b(?:with|from|to|for|by|ask|asked|email|meet(?:ing)? with|discussion with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g, (_, name) => {
    add(name);
    return _;
  });
  String(text || "").replace(/\b([A-Z][a-z]+)\s+(?:and|&)\s+([A-Z][a-z]+)\b/g, (_, first, second) => {
    add(first);
    add(second);
    return _;
  });
  return candidates.slice(0, limit);
}

function adaptiveProjectCards(noteCards = [], taskCards = [], options = {}) {
  const groups = new Map();
  const add = (key, patch) => {
    const cleanKey = singleLine(key || "").replace(/\.md$/i, "");
    if (!cleanKey) return;
    const group = groups.get(cleanKey) || { name: cleanKey, score: 0, notes: [], tasks: [], people: new Set(), topics: new Set(), problems: 0, outcomes: 0, nextSteps: 0 };
    Object.assign(group, patch(group));
    groups.set(cleanKey, group);
  };
  for (const card of noteCards || []) {
    const project = noteProjectKey(card.path, card.title);
    add(project, (group) => {
      group.score += (card.score || 0) + recencyBoost(card.recency || 0);
      group.notes.push(card);
      for (const person of card.people || []) group.people.add(person);
      for (const topic of card.topics || []) group.topics.add(topic);
      group.problems += card.problems?.length || 0;
      group.outcomes += card.outcomes?.length || 0;
      group.nextSteps += card.nextSteps?.length || 0;
      return group;
    });
  }
  for (const card of taskCards || []) {
    const project = card.project || noteProjectKey(card.path, card.title);
    add(project, (group) => {
      group.score += (card.score || 0) + (card.priority || 0) * 0.2;
      group.tasks.push(card);
      for (const person of card.knowledge?.people || []) group.people.add(person);
      for (const topic of card.knowledge?.topics || []) group.topics.add(topic);
      if (card.knowledge?.problem) group.problems += 1;
      if (card.knowledge?.outcome) group.outcomes += 1;
      if (card.knowledge?.nextStep) group.nextSteps += 1;
      return group;
    });
  }
  return Array.from(groups.values())
    .map((group) => ({
      name: group.name,
      score: group.score,
      noteCount: group.notes.length,
      taskCount: group.tasks.length,
      people: Array.from(group.people).slice(0, 6),
      topics: Array.from(group.topics).slice(0, 8),
      problems: group.problems,
      outcomes: group.outcomes,
      nextSteps: group.nextSteps,
      topNotes: group.notes.slice(0, 3).map((note) => note.title),
      topTasks: group.tasks.slice(0, 4).map((task) => task.title)
    }))
    .sort((a, b) => b.score - a.score || b.taskCount - a.taskCount || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, options.maxCards || adaptiveContextBudget().maxProjects));
}

function noteProjectKey(path = "", title = "") {
  const parts = String(path || "").split("/").filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, Math.min(3, parts.length - 1)).join("/");
  return parts[0]?.replace(/\.md$/i, "") || title || "Vault";
}

function uniqueAdaptiveTaskCards(cards = []) {
  const seen = new Set();
  const unique = [];
  for (const card of cards || []) {
    const titleKey = singleLine(card.title).toLowerCase();
    const pathTitleKey = `${card.path || ""}:${titleKey}`;
    const keys = [card.id ? `id:${card.id}` : "", pathTitleKey !== ":" ? `path-title:${pathTitleKey}` : "", titleKey ? `title:${titleKey}` : ""].filter(Boolean);
    if (!keys.length || keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    unique.push(card);
  }
  return unique;
}

function taskKnowledgeSnapshot(task = {}, settings = DEFAULT_SETTINGS, childText = "", previous = null) {
  const source = [
    task.content,
    task.description,
    task.parentContent,
    childText,
    task.projectName,
    task.section,
    (task.labels || []).join(" ")
  ].filter(Boolean).join("\n");
  const fingerprint = shortHash(source);
  if (previous?.fingerprint === fingerprint) return previous;
  const signals = adaptiveContextSignals(source, task.content || "", task.content || "", task.path || "");
  const outcomeType = classifyTaskOutcomeType(source);
  const intent = deriveTaskIntent(task, outcomeType, signals);
  const rationale = deriveTaskRationale(task, signals, intent);
  return {
    version: 1,
    fingerprint,
    intent,
    rationale,
    outcomeType,
    problem: signals.problems[0] || "",
    outcome: signals.outcomes[0] || "",
    dependency: signals.dependencies[0] || "",
    nextStep: signals.nextSteps[0] || "",
    people: signals.people,
    topics: signals.topics,
    evidence: truncateAtWord([signals.problems[0], signals.outcomes[0], signals.dependencies[0], signals.nextSteps[0], task.description].filter(Boolean).join(" "), 700)
  };
}

function compactTaskKnowledge(value = {}) {
  if (!value || typeof value !== "object") return null;
  return {
    version: value.version || 1,
    fingerprint: value.fingerprint || "",
    intent: value.intent || "",
    rationale: value.rationale || "",
    outcomeType: value.outcomeType || "",
    problem: value.problem || "",
    outcome: value.outcome || "",
    dependency: value.dependency || "",
    nextStep: value.nextStep || "",
    people: (value.people || []).slice(0, 8),
    topics: (value.topics || []).slice(0, 8),
    evidence: truncateAtWord(value.evidence || "", 700)
  };
}

function classifyTaskOutcomeType(text = "") {
  const value = String(text || "").toLowerCase();
  if (/follow[-\s]?up|check in|ask|confirm|clarify|coordinate|discuss|reply|email/.test(value)) return "follow-up or coordination";
  if (/draft|write|prepare|create|develop|build|template|document|summary/.test(value)) return "create or document";
  if (/review|read|assess|evaluate|analy[sz]e|compare/.test(value)) return "review or assess";
  if (/decide|decision|approve|finali[sz]e|sign off/.test(value)) return "decision or approval";
  if (/schedule|plan|timeline|workday|calendar/.test(value)) return "planning or scheduling";
  if (/fix|resolve|repair|debug|correct|issue|problem|blocked/.test(value)) return "resolve a problem";
  return "general action";
}

function deriveTaskIntent(task = {}, outcomeType = "general action", signals = {}) {
  const title = singleLine(task.content || "this task");
  const project = task.projectName ? ` for ${singleLine(task.projectName)}` : "";
  const parent = task.parentContent ? ` as part of "${singleLine(task.parentContent)}"` : "";
  if (signals.problems?.[0]) return `Resolve or move forward the issue behind "${title}"${project}${parent}.`;
  if (signals.outcomes?.[0]) return `Put the captured outcome into action for "${title}"${project}${parent}.`;
  if (signals.dependencies?.[0]) return `Clear the dependency or missing information needed for "${title}"${project}${parent}.`;
  if (outcomeType === "follow-up or coordination") return `Move the related conversation, dependency, or handoff forward for "${title}"${project}${parent}.`;
  if (outcomeType === "create or document") return `Create a useful artifact or process output for "${title}"${project}${parent}.`;
  if (outcomeType === "review or assess") return `Review the relevant material so the next decision or action for "${title}" can proceed${project}${parent}.`;
  if (outcomeType === "resolve a problem") return `Resolve the open problem or implementation gap represented by "${title}"${project}${parent}.`;
  return `Complete the user-owned action represented by "${title}"${project}${parent}.`;
}

function deriveTaskRationale(task = {}, signals = {}, intent = "") {
  const useful = signals.problems?.[0] || signals.outcomes?.[0] || signals.dependencies?.[0] || signals.decisions?.[0] || signals.nextSteps?.[0] || "";
  if (useful) return truncateAtWord(useful, 280);
  const description = cleanGeneratedDescriptionSummary(task.description || "");
  if (description) return truncateAtWord(description, 280);
  return truncateAtWord(intent, 280);
}

function formatAdaptiveContextPack(pack = {}, maxChars = 10000) {
  const depth = Math.max(1, Math.min(7, Number(pack.depth || 4)));
  const chatMode = pack.mode === "chat";
  const sections = [];
  sections.push(`Adaptive context depth: ${depth}/7 (${ADAPTIVE_CONTEXT_TIERS.slice(0, depth).join(" -> ")}).`);
  sections.push("Use this local-first context to understand why tasks exist, what they are trying to resolve or put in place, and which recent source notes should guide the answer.");
  if (chatMode) sections.push("Chat evidence hierarchy: answer from vault note content first; use existing Todoist tasks only as secondary links to related actions unless the user explicitly asks about tasks.");
  if (pack.active?.path || pack.sourceTitle) {
    sections.push([
      "Tier 1 - Active/source note:",
      `- ${pack.sourceTitle || pack.active?.title || "Active source"}${pack.active?.path ? ` (${pack.active.path})` : ""}.`
    ].join("\n"));
  }
  if (chatMode) {
    if (depth >= 4 && pack.noteCards?.length) {
      sections.push(["Primary vault evidence - origin meetings, outcomes, and related note thread:"].concat(pack.noteCards.map(formatAdaptiveNoteCard)).join("\n"));
    }
    if (depth >= 6 && pack.projectCards?.length) {
      sections.push(["Supporting project and portfolio context:"].concat(pack.projectCards.map(formatAdaptiveProjectCard)).join("\n"));
    }
    if (depth >= 2 && pack.taskCards?.length) {
      sections.push(["Secondary Todoist task references - related existing actions only:"].concat(pack.taskCards.map(formatAdaptiveTaskCard)).join("\n"));
    } else if (depth >= 2 && pack.taskContext) {
      sections.push(["Secondary existing task context:", truncateAtWord(pack.taskContext, 1600)].join("\n"));
    }
  } else {
    if (depth >= 6 && pack.projectCards?.length) {
      sections.push(["Tier 6-7 - Project and portfolio context:"].concat(pack.projectCards.map(formatAdaptiveProjectCard)).join("\n"));
    }
    if (depth >= 2 && pack.taskCards?.length) {
      sections.push(["Tier 2-3 - Task snapshots, intent, and rationale:"].concat(pack.taskCards.map(formatAdaptiveTaskCard)).join("\n"));
    } else if (depth >= 2 && pack.taskContext) {
      sections.push(["Tier 2 - Existing task context:", truncateAtWord(pack.taskContext, 1600)].join("\n"));
    }
    if (depth >= 4 && pack.noteCards?.length) {
      sections.push(["Tier 4-5 - Origin meeting/outcome and related note thread:"].concat(pack.noteCards.map(formatAdaptiveNoteCard)).join("\n"));
    }
  }
  return truncateMarkdownAtWord(sections.filter(Boolean).join("\n\n"), maxChars);
}

function formatAdaptiveTaskCard(card) {
  const meta = [
    card.status,
    card.project ? `project: ${card.project}` : "",
    card.section ? `section: ${card.section}` : "",
    card.priority ? `priority: ${card.priority}` : "",
    card.due ? `due: ${card.due}` : "",
    card.deadline ? `deadline: ${card.deadline}` : ""
  ].filter(Boolean).join("; ");
  const parts = [
    `- Task: ${card.todoistLink || card.title}${meta ? ` (${meta})` : ""}`,
    card.parent ? `  Parent: ${card.parent}` : "",
    card.knowledge?.intent ? `  Intent: ${card.knowledge.intent}` : "",
    card.knowledge?.rationale ? `  Rationale: ${card.knowledge.rationale}` : "",
    card.knowledge?.dependency ? `  Dependency/blocker: ${card.knowledge.dependency}` : "",
    card.knowledge?.nextStep ? `  Next step signal: ${card.knowledge.nextStep}` : "",
    card.knowledge?.people?.length ? `  People: ${card.knowledge.people.join(", ")}` : "",
    card.path ? `  Source note: [${card.path}](obsidian://open?file=${encodeURIComponent(card.path)})` : ""
  ];
  return parts.filter(Boolean).join("\n");
}

function formatAdaptiveNoteCard(card) {
  const heading = card.citationNumber
    ? `- Context Note (${card.citationNumber}): [${card.title}](obsidian://open?file=${encodeURIComponent(card.path)})`
    : `- Related note: [${card.title}](obsidian://open?file=${encodeURIComponent(card.path)})`;
  const parts = [
    `${heading} (${card.type || "vault note"})`,
    card.people?.length ? `  People/entities: ${card.people.join(", ")}` : "",
    card.decisions?.length ? `  Decisions/current guidance: ${card.decisions.join(" ")}` : "",
    card.outcomes?.length ? `  Outcomes/resolutions: ${card.outcomes.join(" ")}` : "",
    card.problems?.length ? `  Problems/open issues: ${card.problems.join(" ")}` : "",
    card.dependencies?.length ? `  Dependencies: ${card.dependencies.join(" ")}` : "",
    card.nextSteps?.length ? `  Next steps: ${card.nextSteps.join(" ")}` : "",
    card.evidence ? `  Evidence excerpt: ${card.evidence}` : ""
  ];
  return parts.filter(Boolean).join("\n");
}

function formatAdaptiveProjectCard(card) {
  const parts = [
    `- Project/thread: ${card.name} (${card.noteCount} note${card.noteCount === 1 ? "" : "s"}, ${card.taskCount} task${card.taskCount === 1 ? "" : "s"})`,
    card.people?.length ? `  People/entities: ${card.people.join(", ")}` : "",
    card.topics?.length ? `  Topics: ${card.topics.join(", ")}` : "",
    card.outcomes || card.problems || card.nextSteps ? `  Signals: ${card.outcomes} outcome/resolution, ${card.problems} problem/dependency, ${card.nextSteps} next-step mention${card.nextSteps === 1 ? "" : "s"}.` : "",
    card.topNotes?.length ? `  Key notes: ${card.topNotes.join("; ")}` : "",
    card.topTasks?.length ? `  Key tasks: ${card.topTasks.join("; ")}` : ""
  ];
  return parts.filter(Boolean).join("\n");
}

function embedBareMarkdownLinks(value) {
  const lines = String(value || "").split("\n");
  let inFence = false;
  return lines.map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return line;
    }
    return inFence ? line : embedBareMarkdownLinksInLine(line);
  }).join("\n");
}

function embedBareMarkdownLinksInLine(line) {
  const withAutolinks = String(line || "").replace(/<((?:https?:\/\/|obsidian:\/\/|todoist:\/\/)[^>\s]+)>/gi, (_, rawUrl) => markdownLinkForUrl(rawUrl));
  return withAutolinks.replace(/\b(?:https?:\/\/|obsidian:\/\/|todoist:\/\/)[^\s<>\]]+/gi, (rawUrl, offset, fullLine) => {
    if (fullLine.slice(Math.max(0, offset - 2), offset) === "](") return rawUrl;
    const { url, suffix } = splitLinkTrailingPunctuation(rawUrl);
    return `${markdownLinkForUrl(url)}${suffix}`;
  });
}

function markdownLinkForUrl(rawUrl) {
  const url = String(rawUrl || "");
  return `[${markdownLinkLabelForUrl(url)}](${url})`;
}

function markdownLinkLabelForUrl(rawUrl) {
  const url = String(rawUrl || "");
  if (/^todoist:\/\//i.test(url) || /^https?:\/\/(?:www\.)?todoist\.com\/app\/task\//i.test(url)) return "Open task";
  if (/^obsidian:\/\/open/i.test(url)) {
    const file = decodeUrlParam(url, "file");
    if (file) return shortTitle(file.split("/").pop()?.replace(/\.md$/i, "") || "Open note", 48);
    return "Open note";
  }
  const host = url.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.replace(/^www\./i, "");
  return host || "Open link";
}

function decodeUrlParam(url, key) {
  const match = String(url || "").match(new RegExp(`[?&]${key}=([^&#]+)`, "i"));
  if (!match) return "";
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

function splitLinkTrailingPunctuation(rawUrl) {
  let url = String(rawUrl || "");
  let suffix = "";
  while (/[.,;:!?]$/.test(url)) {
    suffix = url.slice(-1) + suffix;
    url = url.slice(0, -1);
  }
  while (url.endsWith(")") && countChar(url, "(") < countChar(url, ")")) {
    suffix = ")" + suffix;
    url = url.slice(0, -1);
  }
  return { url, suffix };
}

function countChar(value, char) {
  return Array.from(String(value || "")).filter((item) => item === char).length;
}

function mergeChunks(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const chunk of group || []) {
      const key = chunk.id || `${chunk.path}:${chunk.text.slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(chunk);
    }
  }
  return merged;
}

function uniqueChunksByPath(chunks) {
  const seen = new Set();
  const unique = [];
  for (const chunk of chunks || []) {
    const key = chunk.path || chunk.id || singleLine(chunk.title || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(chunk);
  }
  return unique;
}

function mergeContextCandidates(...groups) {
  const byId = new Map();
  for (const group of groups) {
    for (const item of group || []) {
      const chunk = item.chunk || item;
      const key = chunk.id || `${chunk.path}:${chunk.text?.slice(0, 80) || ""}`;
      const existing = byId.get(key);
      if (!existing) {
        byId.set(key, Object.assign({}, item, { chunk }));
        continue;
      }
      existing.semantic = Math.max(existing.semantic || 0, item.semantic || 0);
      existing.lexical = Math.max(existing.lexical || 0, item.lexical || 0);
      existing.title = Math.max(existing.title || 0, item.title || 0);
      existing.recency = Math.max(existing.recency || 0, item.recency || 0);
    }
  }
  return Array.from(byId.values());
}

function rankContextCandidates(candidates = []) {
  const list = (candidates || []).map((item) => Object.assign({}, item));
  if (!list.length) return list;
  const topRelevance = Math.max(0, ...list.map((item) => contextCandidateRelevanceScore(item)));
  const freshnessTimes = list
    .filter((item) => contextCandidateFreshnessEligible(item, topRelevance))
    .map((item) => contextCandidateFreshnessAt(item))
    .filter(Boolean);
  const oldest = freshnessTimes.length ? Math.min(...freshnessTimes) : 0;
  const newest = freshnessTimes.length ? Math.max(...freshnessTimes) : 0;
  for (const item of list) item.relativeRecency = contextRelativeRecencyBoost(item, topRelevance, oldest, newest);
  return list.sort((a, b) => contextCandidateScore(b) - contextCandidateScore(a) ||
    contextCandidateFreshnessAt(b) - contextCandidateFreshnessAt(a) ||
    (b.semantic || 0) - (a.semantic || 0) ||
    (b.lexical || 0) - (a.lexical || 0));
}

function contextCandidateRelevanceScore(item) {
  return (item.semantic || 0) * 0.72 +
    Math.min(0.22, (item.lexical || 0) * 0.018) +
    Math.min(0.08, (item.title || 0) * 0.025);
}

function contextCandidateScore(item) {
  return contextCandidateRelevanceScore(item) +
    (item.recency || 0) +
    (item.relativeRecency || 0);
}

function contextCandidateFreshnessEligible(item, topRelevance = 0) {
  const relevance = contextCandidateRelevanceScore(item);
  if (relevance <= 0) return false;
  if ((item.lexical || 0) > 0 || (item.title || 0) > 0) return relevance >= Math.max(0.08, topRelevance * 0.45);
  return relevance >= Math.max(0.18, topRelevance * 0.7);
}

function contextRelativeRecencyBoost(item, topRelevance = 0, oldest = 0, newest = 0) {
  const freshnessAt = contextCandidateFreshnessAt(item);
  if (!freshnessAt || !oldest || !newest || newest <= oldest) return 0;
  if (!contextCandidateFreshnessEligible(item, topRelevance)) return 0;
  const closeness = topRelevance > 0 ? Math.min(1, contextCandidateRelevanceScore(item) / topRelevance) : 0;
  if (closeness < 0.45) return 0;
  const relative = Math.max(0, Math.min(1, (freshnessAt - oldest) / (newest - oldest)));
  return Math.min(0.16, relative * 0.16 * closeness);
}

function contextCandidateFreshnessAt(item) {
  const chunk = item?.chunk || item || {};
  const useNoteCreatedTime = item?.useNoteCreatedTime !== false;
  const storedCreatedAt = Number(chunk.createdAt || 0);
  return (storedCreatedAt && (useNoteCreatedTime || chunk.createdAtSource === "file") ? storedCreatedAt : 0) ||
    (useNoteCreatedTime ? noteCreatedTimestamp(chunk.text || "") : 0) ||
    (useNoteCreatedTime ? noteDateTimestamp(chunk.title, chunk.path) : 0) ||
    Number(chunk.modifiedAt || 0);
}

function diversifyContextCandidates(candidates, limit) {
  const selected = [];
  const perPath = new Map();
  const selectedKeys = new Set();
  const maxItems = Math.max(1, limit || 1);
  const passes = [1, 2, 3, Number.POSITIVE_INFINITY];
  for (const maxPerPath of passes) {
    for (const item of candidates || []) {
      const chunk = item.chunk || item;
      const key = chunk.id || `${chunk.path || ""}:${String(chunk.text || "").slice(0, 80)}`;
      if (selectedKeys.has(key)) continue;
      const path = chunk.path || "";
      const count = perPath.get(path) || 0;
      if (count >= maxPerPath) continue;
      selected.push(item);
      selectedKeys.add(key);
      perPath.set(path, count + 1);
      if (selected.length >= maxItems) return selected;
    }
  }
  return selected;
}

function annotateContextChunk(item) {
  const chunk = item.chunk || item;
  const score = contextCandidateScore(item);
  const reasons = [];
  if ((item.semantic || 0) > 0.2) reasons.push(`semantic ${item.semantic.toFixed(3)}`);
  if (item.lexical) reasons.push(`keyword ${item.lexical.toFixed(1)}`);
  if (item.title) reasons.push("title/path match");
  if (item.relativeRecency) reasons.push("newer matching note");
  if (item.recency) reasons.push("recent note");
  return Object.assign({}, chunk, {
    matchScore: Math.round(score * 1000) / 1000,
    matchRationale: reasons.join("; ") || "lexical fallback"
  });
}

function mergeStrings(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const item of group || []) {
      const key = singleLine(item).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

function recencyBoost(modifiedAt) {
  if (!modifiedAt) return 0;
  const ageDays = Math.max(0, (Date.now() - modifiedAt) / 86400000);
  return Math.max(0, 0.12 - Math.min(0.12, ageDays * 0.002));
}

function labelsAllowedByInstructions(text) {
  const value = String(text || "");
  if (/\b(?:do\s+not|don't|never)\s+(?:add|create|use)\s+(?:any\s+)?labels?\b|\bno\s+labels?\b/i.test(value)) return new Set();
  const labels = new Set((value.match(/#[\w/-]+/g) || []).map((label) => cleanLabel(label).toLowerCase()).filter(Boolean));
  return labels.size ? labels : null;
}

function taskGenerationRequirements(taskInstructions, settings = DEFAULT_SETTINGS) {
  return [
    "Vault context requirements:",
    "- Use the active source content together with the ranked relevant vault context for both main tasks and subtasks.",
    "- Use the existing generated/synced task context from the local Todoist reference table to avoid duplicates and to preserve continuity with tasks already created from the vault.",
    "- Treat vault context as required supporting context when it is available, while using only relevant ranked excerpts and not unrelated note content.",
    "",
    "Main task requirements:",
    `- Actionability: ${taskInstructions.main || "Create only concrete user-owned actions."}`,
    `- Section title: Return one section_name for the full generated task group. Follow this setting exactly: ${taskInstructions.sectionTitle || "Create one Todoist section for tasks from the same source."}`,
    `- Labels: ${taskInstructions.tags || "Do not add labels unless explicitly instructed."}`,
    `- Priority: ${taskInstructions.priorities || "Assign priority 1 to 4."}`,
    "Dates and deadlines:",
    `- Follow this setting exactly: ${taskInstructions.dates || "Use YYYY-MM-DD dates only when supported by the source."}`,
    "- due_date and deadline_date are independent. Do not copy due_date into deadline_date or deadline_date into due_date unless the setting explicitly says to mirror them.",
    "- Use null for any due_date or deadline_date that is not supported by the source and the setting. If the setting says deadlines require explicit source language, deadline_date must be null unless the source explicitly indicates a deadline.",
    "- Descriptions: leave description empty in this JSON step; descriptions are generated separately.",
    "",
    "Subtask requirements:",
    `- Actionability: ${taskInstructions.subtasks || "Create subtasks only for concrete required steps under a main task."}`,
    "- Relationship: every subtask must support its parent main task and must not duplicate the parent task title.",
    `- Labels: ${settings.subtaskIncludeLabels ? `Allowed when useful, but only from the main label rules: ${taskInstructions.tags || "no labels configured"}` : "Disabled. Return an empty labels array for every subtask."}`,
    `- Priority: ${settings.subtaskIncludePriority ? `Allowed. Assign priority 1 to 4 using the same priority rules: ${taskInstructions.priorities || "use task urgency and importance"}` : "Disabled. Return priority 1 for every subtask."}`,
    `- Due date: ${settings.subtaskIncludeDueDate ? `Allowed only when supported by the source and the Dates and Deadlines setting: ${taskInstructions.dates || "use YYYY-MM-DD dates"}` : "Disabled. Return due_date null for every subtask."}`,
    `- Deadline date: ${settings.subtaskIncludeDeadline ? `Allowed only when supported by explicit source/deadline context and the Dates and Deadlines setting: ${taskInstructions.dates || "use YYYY-MM-DD dates"}` : "Disabled. Return deadline_date null for every subtask."}`,
    "- Descriptions: subtasks must not have descriptions.",
    "- Section/project: subtasks inherit the parent task location; do not create a separate section concept for subtasks."
  ].join("\n");
}

function subtaskCriteriaInstructions(settings = DEFAULT_SETTINGS) {
  return [
    settings.subtaskIncludeLabels ? "Labels may be used on subtasks only when allowed by tag instructions." : "Do not add labels to subtasks.",
    settings.subtaskIncludePriority ? "Priority may be assigned to subtasks." : "Use priority 1 for all subtasks.",
    settings.subtaskIncludeDueDate ? "Due dates may be assigned to subtasks when clearly useful." : "Use null due_date for all subtasks.",
    settings.subtaskIncludeDeadline ? "Deadlines may be assigned to subtasks when clearly useful." : "Use null deadline_date for all subtasks."
  ].join(" ");
}

function contextNotesForTaskPlan(chunks, activePath, maxNotes) {
  const seen = new Set();
  const notes = [];
  for (const chunk of chunks || []) {
    if (!chunk.path || chunk.path === activePath || seen.has(chunk.path)) continue;
    seen.add(chunk.path);
    notes.push({
      path: chunk.path,
      title: chunk.title || chunk.path.split("/").pop()?.replace(/\.md$/i, "") || chunk.path,
      summary: truncateAtWord(singleLine(stripGeneratedActionItemsSection(chunk.text || "")), 180)
    });
    if (notes.length >= Math.max(1, maxNotes || 5)) break;
  }
  return notes;
}

function addContextToTaskDescriptions(tasks, contextNotes, active, settings = DEFAULT_SETTINGS, contextChunks = [], basePath = "", includeSourceList = true) {
  const citationState = contextCitationState(contextNotes, basePath, includeSourceList, active);
  const sources = includeSourceList ? descriptionSourceList(active, contextNotes, basePath) : "";
  for (const task of tasks || []) {
    const parentSummary = isUsefulDescriptionSummary(task.description, task.content, settings) ? task.description : fallbackActionSummary(task, active?.text || "", contextChunks, active?.title || "", settings);
    task.description = taskDescriptionWithSources(parentSummary, task.content, sources, settings, active?.title || "", citationState);
    for (const subtask of task.subtasks || []) {
      subtask.description = "";
    }
  }
}

function taskDescriptionWithSources(taskSummary, taskTitle, sources, settings = DEFAULT_SETTINGS, sourceTitle = "", citationState = {}) {
  const summary = ensureContextCitation(
    sanitizeContextCitations(removeSourceLeadIn(removeTitleEcho(conciseDescriptionSummary([cleanGeneratedDescriptionSummary(taskSummary, settings)], settings), taskTitle), sourceTitle), citationState),
    taskTitle,
    citationState
  );
  const parts = [];
  if (isUsefulDescriptionSummary(summary, taskTitle, settings)) parts.push(summary);
  if (sources) parts.push(sources);
  return formatTodoistDescription(parts.join("\n\n"), settings);
}

function cleanTaskDescriptionSummary(value, taskTitle = "", sourceTitle = "", settings = DEFAULT_SETTINGS, citationState = {}) {
  const cleaned = cleanGeneratedDescriptionSummary(value || "", settings);
  return ensureContextCitation(
    sanitizeContextCitations(removeSourceLeadIn(removeTitleEcho(cleaned, taskTitle), sourceTitle), citationState),
    taskTitle,
    citationState
  );
}

function isUsefulDescriptionSummary(value, taskTitle = "", settings = DEFAULT_SETTINGS) {
  const text = removeTitleEcho(cleanGeneratedDescriptionSummary(value || "", settings), taskTitle);
  if (text.length < 80) return false;
  if (/^use the source material to complete this task\.?$/i.test(text)) return false;
  if (/^(review|complete|action)\s+(the\s+)?(source|task|material)\b/i.test(text) && text.length < 140) return false;
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  return words.length >= 12;
}

function descriptionQualityReason(value, taskTitle = "", settings = DEFAULT_SETTINGS) {
  const text = removeTitleEcho(cleanGeneratedDescriptionSummary(value || "", settings), taskTitle);
  if (text.length < 80) return `too short (${text.length} characters)`;
  if (/^use the source material to complete this task\.?$/i.test(text)) return "generic source-material instruction";
  if (/^(review|complete|action)\s+(the\s+)?(source|task|material)\b/i.test(text) && text.length < 140) return "generic source/task wording";
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length < 12) return `too few words (${words.length})`;
  return "passed";
}

function fallbackActionSummary(task, sourceText, contextChunks, sourceTitle = "", settings = DEFAULT_SETTINGS) {
  const query = [task.content, (task.labels || []).join(" "), sourceTitle].filter(Boolean).join(" ");
  const activeContext = summarizeSourceForTaskContext(sourceText, query, 780, settings);
  const vaultContext = summarizeSourceForTaskContext((contextChunks || []).map((chunk) => `${chunk.title || chunk.path}\n${chunk.text || ""}`).join("\n\n"), query, 420, settings);
  const summary = removeTitleEcho(conciseDescriptionSummary(mergeStrings([activeContext], [vaultContext]), settings), task.content);
  if (isUsefulDescriptionSummary(summary, task.content, settings)) return truncateAtWord(summary, 1200);
  return truncateAtWord(`The source context indicates this is a user-owned action from ${sourceTitle || "the source material"}. Review the active note or email for the current status, confirm the relevant people, documents, and timing, then complete the next concrete follow-up required for this item.`, 1200);
}

function enrichTaskDescriptions(tasks, sourceText, contextChunks, sourceTitle = "") {
  for (const task of tasks || []) {
    const base = cleanGeneratedDescriptionSummary(task.description || "");
    const query = [task.content, (task.labels || []).join(" "), sourceTitle].filter(Boolean).join(" ");
    const activeContext = summarizeSourceForTaskContext(sourceText, query, 620);
    const vaultContext = summarizeSourceForTaskContext((contextChunks || []).map((chunk) => chunk.text).join("\n"), query, 420);
    const enriched = conciseDescriptionSummary(mergeStrings(
      [removeTitleEcho(base, task.content)],
      [removeTitleEcho(activeContext, task.content)],
      [removeTitleEcho(vaultContext, task.content)]
    ));
    task.description = truncateAtWord(enriched || base || activeContext || "", 1200);
    for (const subtask of task.subtasks || []) subtask.description = "";
  }
}

function removeTitleEcho(summary, taskTitle) {
  let text = singleLine(summary || "");
  const title = singleLine(taskTitle || "");
  if (!text || !title) return text;
  const normalizedText = text.toLowerCase();
  const normalizedTitle = title.toLowerCase();
  if (normalizedText === normalizedTitle) return "";
  if (normalizedText.startsWith(normalizedTitle)) {
    text = text.slice(title.length).replace(/^[\s:.-]+/, "").trim();
  }
  return text;
}

function removeSourceLeadIn(summary, sourceTitle = "") {
  let text = singleLine(summary || "");
  if (!text) return text;
  const aliases = sourceTitleAliases(sourceTitle);
  const titlePattern = aliases.length ? aliases.map((title) => escapeRegExp(title).replace(/\s+/g, "\\s+")).join("|") : "";
  const genericLead = "the\\s+(?:active\\s+|primary\\s+|source\\s+)?(?:note|source|email|thread|meeting\\s+note|document)";
  const verbs = "(?:records?|notes?|states?|says?|indicates?|mentions?|highlights?|identifies?|establishes?|describes?|explains?|shows?|captures?)";
  const patterns = [
    titlePattern ? new RegExp(`^(?:${titlePattern})(?:\\.md)?\\s+(?:${verbs}\\s+(?:that\\s+)?|[-:–—]\\s*)`, "i") : null,
    new RegExp(`^(?:${genericLead})\\s+${verbs}\\s+(?:that\\s+)?`, "i"),
    new RegExp(`^(?:according\\s+to|based\\s+on|from)\\s+(?:${genericLead}${titlePattern ? `|${titlePattern}(?:\\.md)?` : ""})\\s*,?\\s*`, "i")
  ].filter(Boolean);
  for (const pattern of patterns) text = text.replace(pattern, "");
  return capitalizeSentenceStart(text.trim().replace(/^[,;:\-–—]\s*/, ""));
}

function sourceTitleAliases(sourceTitle = "") {
  const title = singleLine(sourceTitle || "").replace(/\.md$/i, "");
  const aliases = [];
  const add = (value) => {
    const clean = singleLine(value || "").replace(/\.md$/i, "");
    if (clean && clean.length >= 8 && !aliases.some((item) => item.toLowerCase() === clean.toLowerCase())) aliases.push(clean);
  };
  add(title);
  add(title.replace(/^(?:\w+\s+\d{1,2},\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[-_/]\d{1,2}[-_/]\d{2,4})\s*[-:–—]\s*/i, ""));
  return aliases;
}

function capitalizeSentenceStart(value) {
  const text = String(value || "").trim();
  return text.replace(/^([a-z])/, (match) => match.toUpperCase());
}

function descriptionSourceList(active, contextNotes, basePath = "") {
  const lines = ["Source List:"];
  const primaryPath = sourceReference(active, basePath);
  if (primaryPath) lines.push(`Primary Note: ${primaryPath}`);
  const seen = new Set(primaryPath ? [primaryPath] : []);
  const contextLines = [];
  for (const note of contextNotes || []) {
    const notePath = sourceReference(note, basePath);
    if (!notePath || seen.has(notePath)) continue;
    seen.add(notePath);
    contextLines.push(notePath);
  }
  if (contextLines.length) {
    if (primaryPath) lines.push("");
    lines.push("Context Notes:");
    contextLines.forEach((line, index) => lines.push(`${index + 1}. ${line}`));
  }
  return lines.join("\n");
}

function contextCitationMap(contextNotes, basePath = "", primary = null) {
  const map = new Map();
  const primaryPath = sourceReference(primary, basePath);
  const seen = new Set(primaryPath ? [primaryPath] : []);
  for (const note of contextNotes || []) {
    const notePath = sourceReference(note, basePath);
    if (!notePath || seen.has(notePath)) continue;
    seen.add(notePath);
    map.set(notePath, map.size + 1);
  }
  return map;
}

function contextCitationState(contextNotes, basePath = "", enabled = true, primary = null) {
  const citationMap = contextCitationMap(contextNotes, basePath, primary);
  const contextCitationNotes = [];
  for (const note of contextNotes || []) {
    const notePath = sourceReference(note, basePath);
    const number = notePath ? citationMap.get(notePath) : null;
    if (!number || contextCitationNotes.some((item) => item.number === number)) continue;
    contextCitationNotes.push({
      number,
      source: notePath,
      title: note.title || note.basename || notePath,
      text: note.text || note.excerpt || ""
    });
  }
  return {
    citationMap,
    contextCitationNotes,
    citeContextNotes: enabled !== false && citationMap.size > 0,
    allowedContextCitations: new Set(citationMap.values())
  };
}

function contextCitationInstructions(enabled) {
  if (!enabled) return "Disabled. Do not add numbered context citations.";
  return [
    "Enabled. If a description sentence is primarily derived from a numbered context note, end that sentence with the matching note number in parentheses, for example (1).",
    "Do not cite facts that come from the active/primary source.",
    "Do not invent citation numbers; use only the Context Note (N) numbers shown in the ranked vault context.",
    "Only cite the sentence that uses the context-note information."
  ].join(" ");
}

function sanitizeContextCitations(value, citationState = {}) {
  const text = String(value || "");
  if (!text) return "";
  const allowed = citationState.allowedContextCitations instanceof Set ? citationState.allowedContextCitations : null;
  const citationsEnabled = citationState.citeContextNotes !== false && allowed && allowed.size > 0;
  return text
    .replace(/\s*\((\d{1,3})\)(?=([.!?;,)]|$))/g, (match, rawNumber) => {
      const number = Number(rawNumber);
      return citationsEnabled && allowed.has(number) ? match : "";
    })
    .replace(/\s+([.!?,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hasValidContextCitation(value, citationState = {}) {
  const allowed = citationState.allowedContextCitations instanceof Set ? citationState.allowedContextCitations : null;
  if (!citationState.citeContextNotes || !allowed?.size) return false;
  const matches = String(value || "").match(/\((\d{1,3})\)/g) || [];
  return matches.some((match) => allowed.has(Number(match.replace(/\D/g, ""))));
}

function ensureContextCitation(value, taskTitle = "", citationState = {}) {
  const text = String(value || "").trim();
  if (!text || !citationState.citeContextNotes || hasValidContextCitation(text, citationState)) return text;
  const notes = Array.isArray(citationState.contextCitationNotes) ? citationState.contextCitationNotes : [];
  if (!notes.length) return text;
  const queryTerms = termCounts([text, taskTitle].filter(Boolean).join(" "));
  let bestNumber = 0;
  let bestScore = 0;
  for (const note of notes) {
    const candidate = [note.title, note.source, note.text].filter(Boolean).join("\n");
    const score = lexicalScore(queryTerms, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestNumber = note.number;
    }
  }
  if (!bestNumber || bestScore < 1.5) return text;
  const punctuation = /[.!?]$/.test(text) ? text.slice(-1) : "";
  const body = punctuation ? text.slice(0, -1).trim() : text;
  return `${body} (${bestNumber})${punctuation}`;
}

function cleanGeneratedDescriptionSummary(value, settings = DEFAULT_SETTINGS) {
  const text = stripLinkAvailabilitySentences(stripWikiLinkSyntax(stripExcludedLinks(stripTaskAndMetadataLines(String(value || "")), settings)))
    .replace(/\r\n/g, "\n")
    .replace(/\.\.\.\s*\[truncated\]/gi, "")
    .replace(/\[truncated\]/gi, "")
    .replace(/\b(document(?: topic)?|project|program|tags?|sub-?tasks?|tasks?|source(?:s)?(?:\s+note)?|useful\s+vault\s+context|vault\s+context|note\s+context)\s*:\s*/gi, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (isDescriptionMetadataLine(line)) return false;
      if (/^[-*]\s+\[[ xX]\]/.test(line)) return false;
      if (/^#\w/.test(line)) return false;
      return true;
    })
    .join(" ");
  return stripMetadataSentences(singleLine(text));
}

function conciseDescriptionSummary(parts, settings = DEFAULT_SETTINGS) {
  const sentences = mergeStrings(parts || [])
    .flatMap((part) => splitDescriptionSentences(part))
    .map((part) => cleanGeneratedDescriptionSummary(part, settings))
    .filter(Boolean);
  const selected = [];
  let length = 0;
  for (const sentence of sentences) {
    const nextLength = length + (selected.length ? 1 : 0) + sentence.length;
    if (nextLength > 1200) continue;
    selected.push(sentence);
    length = nextLength;
  }
  if (selected.length) return selected.join(" ");
  const fallback = cleanGeneratedDescriptionSummary((parts || []).join(" "), settings);
  return truncateAtWord(fallback, 1200);
}

function splitDescriptionSentences(text) {
  return String(text || "")
    .replace(/\.\.\.\s*\[truncated\]/gi, "")
    .replace(/\[truncated\]/gi, "")
    .split(/(?<=[.!?])\s+|\n+|\s+-\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !isDescriptionMetadataLine(sentence))
    .filter(isUsableDescriptionSentence);
}

function isUsableDescriptionSentence(sentence) {
  const text = singleLine(sentence);
  if (!text) return false;
  if (text.length < 18) return false;
  if (/^\w{1,12}\s*[-:]\s*/.test(text) && text.length < 80) return false;
  if (/\b(truncated|copy-paste|document topic|sub-?tasks?|tags?)\b/i.test(text)) return false;
  if (/\b(no|not|without|missing|unavailable|unable to find|none)\b.{0,60}\b(web\s*links?|links?|linked files?|referenced files?|attachments?)\b/i.test(text)) return false;
  if (/\b(web\s*links?|links?|linked files?|referenced files?|attachments?)\b.{0,60}\b(no|not|missing|unavailable|found|provided|included)\b/i.test(text)) return false;
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length < 5) return false;
  if (!/[.!?]$/.test(text) && text.length > 180) return false;
  return true;
}

function stripMetadataSentences(text) {
  return splitDescriptionSentences(text).join(" ");
}

function isDescriptionMetadataLine(line) {
  const value = singleLine(line).replace(/^[-*]\s*/, "");
  return /^(summary|source(?:s)?(?:\s+note)?|source list|primary note|context notes?|useful vault context|vault context|note context|document(?: topic)?|project|program|tags?|sub-?tasks?|tasks?)\s*:/i.test(value) ||
    /\b(document(?: topic)?|project|program|tags?|sub-?tasks?)\s*:/i.test(value);
}

function stripTaskAndMetadataLines(text) {
  return stripGeneratedActionItemsSection(String(text || ""))
    .split("\n")
    .filter((line) => {
      const value = line.trim();
      if (!value) return true;
      if (/#(?:STsync|STSubSync|tdsync|tdsyncsub)\b|tid::|oid::|%%\[(?:t|o)id::|<!--\s*tid::/i.test(value)) return false;
      if (/^\s*[-*]\s+\[[ xX]\]/.test(value)) return false;
      if (/^#+\s*(?:Semantic Todoist Sync - Action Items|Actionable Items from Note)/i.test(value)) return false;
      if (isDescriptionMetadataLine(value)) return false;
      return true;
    })
    .join("\n");
}

function stripGeneratedActionItemsSection(text) {
  const lines = String(text || "").split("\n");
  const output = [];
  let skipping = false;
  const headingLevel = /^(\s*#{1,6})\s*(?:Semantic Todoist Sync\s*-\s*)?(?:[^\w#]+[-\s]*)?(?:Actionable\s+Items(?:\s+from\s+Note)?|Action\s+Items|Tasks?\s*&\s*Projects?|Tasks?|Projects?)\b/i;
  let skipLevel = 0;
  for (const line of lines) {
    const start = headingLevel.exec(line);
    if (start || isStandaloneActionItemsHeading(line)) {
      skipping = true;
      skipLevel = start ? start[1].trim().length : 2;
      continue;
    }
    if (skipping) {
      const heading = /^(\s*#{1,6})\s+/.exec(line);
      if (heading && heading[1].trim().length <= skipLevel) {
        skipping = false;
      } else {
        continue;
      }
    }
    output.push(line);
  }
  return output.join("\n");
}

function isStandaloneActionItemsHeading(line) {
  const value = singleLine(line).replace(/^#+\s*/, "").replace(/^[^\w]+[-\s]*/, "");
  return /^(?:Semantic Todoist Sync\s*-\s*)?(Actionable\s+Items(?:\s+from\s+Note)?|Action\s+Items|Tasks?\s*&\s*Projects?|Tasks?|Projects?)(?:\s+Completed|\s+Processed|\s+Delegated|[\s:-]|$)/i.test(value);
}

function sanitizeStoredTodoistDescription(value, settings = DEFAULT_SETTINGS) {
  const text = String(value || "");
  if (!text) return "";
  const sourceIndex = text.search(/(?:^|\n)\s*(source list|sources?)\s*:/i);
  const sourceBlock = sourceIndex >= 0 ? normalizeStoredSourceList(text.slice(sourceIndex)) : "";
  const summaryText = sourceIndex >= 0 ? text.slice(0, sourceIndex) : text;
  const summary = conciseDescriptionSummary([summaryText], settings);
  return formatTodoistDescription([summary, sourceBlock].filter(Boolean).join("\n\n"), settings);
}

function isRichTodoistDescription(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  const withoutLinks = text
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/obsidian:\/\/\S+/g, "")
    .replace(/source list|primary note|context notes?/gi, "")
    .replace(/[:\s.\n-]+/g, " ")
    .trim();
  if (withoutLinks.length < 40) return false;
  if (/^use the source material to complete this task\.?$/i.test(withoutLinks)) return false;
  return true;
}

function normalizeStoredSourceList(value) {
  const rawLines = String(value || "")
    .replace(/\[[^\]]+\]\(obsidian:\/\/open\?file=([^)]+)\)/g, (_, file) => decodeURIComponent(file))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/obsidian:\/\/\S+/g, "")
    .split("\n")
    .map((line) => singleLine(line).replace(/^[-*]\s*/, ""))
    .filter(Boolean);
  const primary = vaultRelativePath(rawLines.find((line) => /^primary note\s*:/i.test(line))?.replace(/^primary note\s*:\s*/i, "").trim() || "");
  const context = rawLines
    .filter((line) => /^\d+\.\s*/.test(line))
    .map((line) => vaultRelativePath(line.replace(/^\d+\.\s*/, "").trim()))
    .filter(Boolean);
  if (!primary && !context.length) return "";
  const lines = ["Source List:"];
  if (primary) lines.push(`Primary Note: ${primary}`);
  if (context.length) {
    if (primary) lines.push("");
    lines.push("Context Notes:");
    context.slice(0, 8).forEach((source, index) => lines.push(`${index + 1}. ${source}`));
  }
  return lines.join("\n");
}

function summarizeSourceForTaskContext(text, query = "", maxChars = 360, settings = DEFAULT_SETTINGS) {
  const cleaned = stripExcludedLinks(stripTaskAndMetadataLines(String(text || "")), settings);
  const queryTerms = termCounts(query);
  const lines = cleaned
    .split("\n")
    .flatMap((line) => splitDescriptionSentences(line.replace(/^[-*]\s+/, "").trim()))
    .filter((line) => {
      if (!line || /^---$/.test(line) || /^```/.test(line)) return false;
      if (isDescriptionMetadataLine(line)) return false;
      if (line.length < 18) return false;
      return true;
    })
    .map((line, index) => {
      const actionScore = /action|todo|follow|review|send|confirm|complete|deadline|due|need|waiting|owner|lead|draft|update|share|clarify|coordinate|post|blog|email|document/i.test(line) ? 1 : 0;
      return { line, index, score: lexicalScore(queryTerms, line) + actionScore };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(2, Math.min(6, Math.ceil(maxChars / 180))))
    .sort((a, b) => a.index - b.index)
    .map((item) => item.line);
  const summary = lines.length ? lines.join(" ") : "";
  return truncateAtWord(cleanGeneratedDescriptionSummary(summary, settings), maxChars);
}

function renderContextSummary(contextNotes) {
  if (!contextNotes?.length) return "";
  const links = contextNotes.map((note) => `[[${note.path}|${note.title}]]`).join(", ");
  return `> Context notes used: ${links}`;
}

function formatTaskReference(task, settings = DEFAULT_SETTINGS) {
  const status = task.isCompleted ? "completed" : "open";
  const todoist = task.id ? ` Todoist: ${todoistTaskMarkdownLink(task.id, settings, task.content)}. OID: ${task.oid || "unknown"}.` : " No Todoist link.";
  const due = task.due_date ? ` Due: ${task.due_date}.` : "";
  const labels = task.labels?.length ? ` Labels: ${task.labels.map((label) => `#${label}`).join(" ")}.` : "";
  return `- ${status}: ${task.content}.${due}${labels}${todoist} Note: [${task.path}](obsidian://open?file=${encodeURIComponent(task.path)}).`;
}

function formatCachedTaskReference(id, task, settings = DEFAULT_SETTINGS) {
  const status = task.isCompleted ? "completed" : "open";
  const due = task.due_date ? ` Due: ${task.due_date}.` : "";
  const labels = task.labels?.length ? ` Labels: ${task.labels.map((label) => `#${label}`).join(" ")}.` : "";
  const path = task.path || "";
  const source = path ? ` Note: [${path}](obsidian://open?file=${encodeURIComponent(path)}).` : "";
  const title = task.content || "Untitled task";
  const intent = task.knowledge?.intent ? ` Intent: ${task.knowledge.intent}` : "";
  return `- ${status}: ${title}.${due}${labels}${intent} Todoist: ${todoistTaskMarkdownLink(id, settings, title)}. OID: ${task.oid || "unknown"}.${source}`;
}

function semanticTaskReferenceText(id, task, settings = DEFAULT_SETTINGS, childText = "") {
  const content = singleLine(task?.content || "");
  if (!content) return "";
  const knowledge = task?.knowledge?.intent ? task.knowledge : taskKnowledgeSnapshot(task, settings, childText, task?.knowledge || null);
  const parts = [
    task?.isSubtask ? "Todoist subtask" : "Todoist task",
    task?.isCompleted ? "completed" : "open",
    content
  ];
  if (task?.parentContent) parts.push(`parent: ${singleLine(task.parentContent)}`);
  if (childText && !task?.isSubtask) parts.push(`subtasks: ${truncateAtWord(childText, 180)}`);
  if (task?.due_date) parts.push(`due: ${task.due_date}`);
  if (task?.scheduledDueDateTime) parts.push(`scheduled: ${task.scheduledDueDateTime}`);
  if (durationMinutes(task?.duration)) parts.push(`duration: ${durationMinutes(task.duration)} minutes`);
  if (task?.deadline_date) parts.push(`deadline: ${task.deadline_date}`);
  if (task?.priority) parts.push(`priority: ${normalizePriority(task.priority)}`);
  if (task?.labels?.length) parts.push(`labels: ${task.labels.map((label) => `#${cleanLabel(label)}`).join(" ")}`);
  if (task?.section) parts.push(`section: ${singleLine(task.section)}`);
  if (task?.projectName) parts.push(`project: ${singleLine(task.projectName)}`);
  if (task?.description && !task?.isSubtask) parts.push(`description: ${truncateAtWord(cleanGeneratedDescriptionSummary(task.description, settings), 160)}`);
  if (knowledge?.intent) parts.push(`intent: ${truncateAtWord(knowledge.intent, 180)}`);
  if (knowledge?.rationale) parts.push(`rationale: ${truncateAtWord(knowledge.rationale, 220)}`);
  if (knowledge?.outcomeType) parts.push(`outcome type: ${knowledge.outcomeType}`);
  if (knowledge?.dependency) parts.push(`dependency: ${truncateAtWord(knowledge.dependency, 160)}`);
  if (task?.oid) parts.push(`oid: ${task.oid}`);
  return `- ${parts.filter(Boolean).join(". ")}.`;
}

function chunkTaskReferenceRows(path, rows, maxChars = 1100) {
  const header = [
    "Local Todoist reference table task snapshot for semantic search.",
    `Note path: ${path}.`,
  ].join("\n");
  const chunks = [];
  let current = header;
  const uniqueRows = Array.from(new Set((rows || []).filter(Boolean)));
  for (const row of uniqueRows) {
    const next = `${current}\n${row}`;
    if (current !== header && next.length > Math.max(500, maxChars)) {
      chunks.push(current);
      current = `${header}\n${row}`;
    } else {
      current = next;
    }
  }
  if (current !== header) chunks.push(current);
  return chunks;
}

function semanticPathChunksMatch(index, path, nextChunks) {
  const currentChunks = (index || []).filter((chunk) => chunk.path === path);
  if (currentChunks.length !== nextChunks.length) return false;
  const currentById = new Map(currentChunks.map((chunk) => [chunk.id, chunk]));
  for (const next of nextChunks) {
    const current = currentById.get(next.id);
    if (!current) return false;
    if (String(current.text || "") !== String(next.text || "")) return false;
    if (String(current.title || "") !== String(next.title || "")) return false;
    if (String(current.kind || "") !== String(next.kind || "")) return false;
    if (String(current.source || "") !== String(next.source || "")) return false;
    if (Number(current.createdAt || 0) !== Number(next.createdAt || 0)) return false;
    if (String(current.createdAtSource || "") !== String(next.createdAtSource || "")) return false;
  }
  return true;
}

function semanticChunkEmbeddingInput(chunk) {
  return `${chunk?.title || ""}\n${chunk?.text || ""}`;
}

function semanticChunkReuseKey(chunk) {
  return [
    String(chunk?.title || ""),
    String(chunk?.kind || ""),
    String(chunk?.source || ""),
    shortHash(String(chunk?.text || ""))
  ].join("\u0000");
}

function semanticChunkEmbeddingsReusable(settings = DEFAULT_SETTINGS, meta = {}) {
  const currentModel = settings.embeddingModel || DEFAULT_SETTINGS.embeddingModel;
  const indexedModel = meta?.model || currentModel;
  if (indexedModel && indexedModel !== currentModel) return false;
  const currentPrecision = Number(settings.semanticIndexEmbeddingPrecision || DEFAULT_SETTINGS.semanticIndexEmbeddingPrecision);
  const indexedPrecision = Number(meta?.embeddingPrecision || currentPrecision);
  return indexedPrecision === currentPrecision;
}

function buildSemanticChunkReuseMap(index, settings = DEFAULT_SETTINGS, meta = {}) {
  const reuseMap = new Map();
  if (!semanticChunkEmbeddingsReusable(settings, meta)) return reuseMap;
  for (const chunk of index || []) {
    if (!Array.isArray(chunk?.embedding) || !chunk.embedding.length) continue;
    const key = semanticChunkReuseKey(chunk);
    if (key && !reuseMap.has(key)) reuseMap.set(key, chunk.embedding);
  }
  return reuseMap;
}

function reusedSemanticChunk(chunk, reuseMap) {
  const embedding = reuseMap?.get(semanticChunkReuseKey(chunk));
  if (!Array.isArray(embedding) || !embedding.length) return null;
  return Object.assign({}, chunk, { embedding });
}

function todoistTaskMarkdownLink(id, settings = DEFAULT_SETTINGS, label = "") {
  const url = todoistTaskUrl(id, settings);
  const title = markdownLinkText(label || "Open task");
  return url ? `[${title}](${url})` : String(id || "");
}

function todoistTaskUrl(id, settings = DEFAULT_SETTINGS) {
  const taskId = String(id || "").trim();
  if (!taskId) return "";
  return settings.linksAppURI ? `todoist://task?id=${encodeURIComponent(taskId)}` : `https://todoist.com/app/task/${encodeURIComponent(taskId)}`;
}

function markdownLinkText(value) {
  const text = singleLine(value || "Open task") || "Open task";
  return text.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function compressForTaskPrompt(text, maxChars, settings = DEFAULT_SETTINGS) {
  const cleaned = cleanupEmailText(stripExcludedLinks(String(text || ""), settings));
  const links = Array.from(new Set(cleaned.match(/https?:\/\/\S+/g) || []))
    .filter((url) => !isExcludedUrl(url, settings))
    .slice(0, 20);
  const actionLines = cleaned.split("\n").filter((line) => {
    const l = line.toLowerCase();
    return /please|action|todo|to do|follow up|review|comment|tracked changes?|verify|verification|accuracy|gap|highlight|draft|document|report|send|confirm|confirmation|complete|deadline|due|urgent|need|waiting|legal|finance|owner|assignee|client|customer|vendor|lawyer|accounting/.test(l);
  }).slice(0, 120).join("\n");
  const compact = [
    actionLines || cleaned.slice(0, Math.floor(maxChars * 0.75)),
    links.length ? `\nReferenced links:\n${links.join("\n")}` : ""
  ].join("\n").trim();
  return clamp(compact || cleaned, maxChars);
}

function compressSourceForTaskPrompt(source, settings = DEFAULT_SETTINGS) {
  const maxChars = source.maxChars || DEFAULT_SETTINGS.maxEmailChars;
  if (source.type === "note") {
    const cleaned = cleanupEmailText(stripExcludedLinks(stripGeneratedActionItemsSection(String(source.text || "")), settings));
    return clamp(cleaned, maxChars);
  }
  return compressForTaskPrompt(source.text, maxChars, settings);
}

function explicitReviewRequestFallbackTask(source = {}, sourceSummary = "", settings = DEFAULT_SETTINGS) {
  const text = cleanupEmailText(stripExcludedLinks([source.title, source.text, sourceSummary].filter(Boolean).join("\n"), settings));
  if (!/\b(?:review|comment|comments|tracked\s+changes?|verify|verification|accuracy|gap|gaps|highlighted?|confirmation)\b/i.test(text)) return null;
  if (!/\b(?:draft|document|doc|report|spotlight|attachment|linked|link|file)\b/i.test(text)) return null;
  if (!/\b(?:may\s+i\s+ask|please|seeking|for\s+your\s+review|your\s+comments|your\s+initial|at\s+your\s+earliest\s+convenience|provide|confirm|confirmation|verify|verification)\b/i.test(text)) return null;
  const sender = firstNameFromEmailHeader(text.match(/^From:\s*(.+)$/im)?.[1] || "");
  const documentLabel = /\bspotlight\b/i.test(text) ? "draft report" : /\breport\b/i.test(text) ? "draft report" : "draft document";
  const provider = sender ? ` that ${sender} has provided` : "";
  const highlighted = /\byellow\s+highlighted|highlighted\s+segments?\b/i.test(text);
  return {
    content: truncateAtWord(`Review the linked ${documentLabel}${provider} for verification of accuracy and confirmation of any gaps${highlighted ? " (note yellow highlighted segments within the document)" : ""}.`, 250),
    due_date: null,
    deadline_date: null,
    priority: /\bearliest convenience|urgent|asap|deadline|due\b/i.test(text) ? 3 : 2,
    labels: [],
    subtasks: []
  };
}

function firstNameFromEmailHeader(value = "") {
  const text = singleLine(value).replace(/<[^>]+>/g, " ").replace(/["']/g, " ").trim();
  const match = text.match(/[A-Za-z][A-Za-z'-]*/);
  if (!match) return "";
  return match[0].charAt(0).toUpperCase() + match[0].slice(1);
}

function cosine(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / ((Math.sqrt(magA) * Math.sqrt(magB)) || 1);
}

function termCounts(text) {
  const counts = {};
  for (const term of String(text).toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || []) {
    if (STOP_WORDS.has(term)) continue;
    counts[term] = (counts[term] || 0) + 1;
  }
  return counts;
}

function lexicalScore(queryTerms, text) {
  const terms = termCounts(text);
  return lexicalScoreFromCounts(queryTerms, terms);
}

function lexicalScoreFromCounts(queryTerms, terms) {
  let score = 0;
  for (const [term, count] of Object.entries(queryTerms)) if (terms[term]) score += Math.min(3, terms[term]) * count;
  return score;
}

function taskSearchTermCounts(text) {
  const counts = termCounts(text);
  for (const term of String(text || "").toLowerCase().match(/\b\d{1,4}\b/g) || []) {
    counts[term] = (counts[term] || 0) + 1;
  }
  return counts;
}

function taskContentQueryTermCounts(text) {
  const counts = taskSearchTermCounts(text);
  for (const token of dateSearchTokens(text)) delete counts[token];
  for (const token of ["task", "tasks", "related", "meeting", "last", "note", "notes", "any", "from", "with"]) delete counts[token];
  return counts;
}

function taskSearchLexicalScore(queryTerms, text) {
  return lexicalScoreFromCounts(queryTerms, taskSearchTermCounts(text));
}

function datePhraseOverlapScore(queryText, text) {
  const queryTokens = dateSearchTokens(queryText);
  if (!queryTokens.size) return 0;
  const textTokens = dateSearchTokens(text);
  let score = 0;
  for (const token of queryTokens) if (textTokens.has(token)) score += token.length === 4 ? 1 : 2;
  return score;
}

function dateSearchTokens(text) {
  const tokens = new Set();
  const value = String(text || "").toLowerCase();
  for (const match of value.matchAll(/\b(\d{4})[-_/](\d{1,2})[-_/](\d{1,2})\b/g)) {
    tokens.add(match[1]);
    tokens.add(String(parseInt(match[2], 10)));
    tokens.add(String(parseInt(match[3], 10)));
  }
  for (const match of value.matchAll(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\b/g)) {
    tokens.add(match[0].match(/[a-z]+/)?.[0]?.slice(0, 3) || "");
    tokens.add(String(parseInt(match[1], 10)));
    if (match[2]) tokens.add(match[2]);
  }
  for (const match of value.matchAll(/\b(\d{1,2})\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:\s+(\d{4}))?\b/g)) {
    tokens.add(String(parseInt(match[1], 10)));
    tokens.add(match[0].match(/[a-z]+/)?.[0]?.slice(0, 3) || "");
    if (match[2]) tokens.add(match[2]);
  }
  tokens.delete("");
  return tokens;
}

function specificDateTokens(text) {
  const tokens = new Set();
  const value = String(text || "").toLowerCase();
  for (const match of value.matchAll(/\b\d{4}[-_/]\d{1,2}[-_/](\d{1,2})\b/g)) {
    tokens.add(String(parseInt(match[1], 10)));
  }
  const monthPattern = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  for (const match of value.matchAll(new RegExp(`\\b${monthPattern}\\.?\\s+(\\d{1,2})(?:,\\s*\\d{4})?\\b`, "g"))) {
    tokens.add(String(parseInt(match[1], 10)));
  }
  for (const match of value.matchAll(new RegExp(`\\b(\\d{1,2})\\s+${monthPattern}\\.?`, "g"))) {
    tokens.add(String(parseInt(match[1], 10)));
  }
  return tokens;
}

function dateTokensOverlap(requiredTokens, candidateTokens) {
  for (const token of requiredTokens || []) if ((candidateTokens || new Set()).has(token)) return true;
  return false;
}

function noteCreatedTimestamp(text) {
  const head = String(text || "").slice(0, 2400);
  const frontmatter = head.match(/^\s*---\s*\n([\s\S]*?)\n---/);
  const scope = frontmatter ? frontmatter[1] : head.split("\n").slice(0, 30).join("\n");
  const line = scope.match(/^\s*(?:created|created[_\s-]*at|date[_\s-]*created|meeting[_\s-]*date)\s*:\s*(.+)$/im);
  return line ? parseLooseDateTimestamp(line[1]) : 0;
}

function semanticNoteCreatedTimeEnabled(settings = DEFAULT_SETTINGS) {
  return settings?.useNoteCreatedTimeForSemanticIndex !== false;
}

function semanticCreatedAtForFile(file, text = "", settings = DEFAULT_SETTINGS) {
  return semanticCreatedMetadataForFile(file, text, settings).createdAt;
}

function semanticCreatedMetadataForFile(file, text = "", settings = DEFAULT_SETTINGS) {
  const fileCreatedAt = Number(file?.stat?.ctime || 0);
  const fileModifiedAt = Number(file?.stat?.mtime || 0);
  if (semanticNoteCreatedTimeEnabled(settings)) {
    const noteCreatedAt = noteCreatedTimestamp(text);
    if (noteCreatedAt) return { createdAt: noteCreatedAt, createdAtSource: "note" };
  }
  if (fileCreatedAt) return { createdAt: fileCreatedAt, createdAtSource: "file" };
  if (fileModifiedAt) return { createdAt: fileModifiedAt, createdAtSource: "file" };
  return { createdAt: 0, createdAtSource: "" };
}

function noteDateTimestamp(...values) {
  return parseLooseDateTimestamp(values.filter(Boolean).join(" "));
}

function parseLooseDateTimestamp(value) {
  const text = String(value || "")
    .replace(/[\[\]"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return 0;
  let match = text.match(/\b(\d{4})[-_/](\d{1,2})[-_/](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/);
  if (match) return timestampFromDateParts(match[1], match[2], match[3], match[4], match[5]);
  const monthPattern = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  match = text.match(new RegExp(`\\b${monthPattern}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(\\d{4})(?:\\s+(\\d{1,2}):(\\d{2}))?`, "i"));
  if (match) return timestampFromDateParts(match[3], monthNumber(match[1]), match[2], match[4], match[5]);
  match = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthPattern}\\.?\\s+(\\d{4})(?:\\s+(\\d{1,2}):(\\d{2}))?`, "i"));
  if (match) return timestampFromDateParts(match[3], monthNumber(match[2]), match[1], match[4], match[5]);
  return 0;
}

function timestampFromDateParts(year, month, day, hour = 0, minute = 0) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const h = Number(hour || 0);
  const min = Number(minute || 0);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return 0;
  return new Date(y, m - 1, d, h, min, 0, 0).getTime();
}

function monthNumber(value) {
  const key = String(value || "").slice(0, 3).toLowerCase();
  return { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }[key] || 0;
}

function taskReferenceSearchText(task, childText = "") {
  const refs = Array.isArray(task?.noteRefs) ? task.noteRefs.map((ref) => ref?.path || "").join(" ") : "";
  return [
    task?.content,
    task?.parentContent,
    childText,
    task?.section,
    task?.projectName,
    task?.path,
    refs,
    task?.due_date,
    task?.deadline_date,
    (task?.labels || []).join(" ")
  ].filter(Boolean).join(" ");
}

function taskReferenceScore(task, queryTerms, queryText = "", childText = "") {
  const text = taskReferenceSearchText(task, childText);
  return taskSearchLexicalScore(queryTerms, text);
}

function taskChildTextByParentOid(entries) {
  const map = new Map();
  for (const [, task] of entries || []) {
    const parentOid = String(task?.parentOid || "").toUpperCase();
    if (!parentOid) continue;
    const text = [task?.content, (task?.labels || []).join(" ")].filter(Boolean).join(" ");
    if (!text) continue;
    map.set(parentOid, `${map.get(parentOid) || ""} ${text}`.trim());
  }
  return map;
}

function taskReferenceParentContext(task = {}, index = emptyTaskReferenceIndex()) {
  const parent = taskReferenceParentTask(task, index);
  if (!parent) return {};
  const parentChildText = taskReferenceParentChildText(parent, task, index);
  return {
    parentContent: task.parentContent || parent.content || "",
    parentDescription: parent.description || "",
    parentProjectName: parent.projectName || "",
    parentSection: parent.section || "",
    parentChildText,
    siblingText: parentChildText
  };
}

function taskReferenceParentTask(task = {}, index = emptyTaskReferenceIndex()) {
  const parentId = String(task.parentId || "");
  if (parentId && index.byId?.has(parentId)) return index.byId.get(parentId);
  const parentOid = String(task.parentOid || "").toUpperCase();
  if (parentOid && index.byOid?.has(parentOid)) {
    const id = index.byOid.get(parentOid);
    if (id && index.byId?.has(id)) return index.byId.get(id);
  }
  return null;
}

function taskReferenceParentChildText(parent = {}, task = {}, index = emptyTaskReferenceIndex()) {
  const parentOid = String(parent.oid || task.parentOid || "").toUpperCase();
  if (parentOid && index.childTextByParentOid?.has(parentOid)) return index.childTextByParentOid.get(parentOid) || "";
  const parentId = String(parent.id || task.parentId || "");
  if (!parentId) return "";
  return (index.entries || [])
    .filter(([, child]) => String(child?.parentId || "") === parentId)
    .map(([, child]) => [child?.content, child?.description, (child?.labels || []).join(" ")].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" ");
}

function taskReferenceKey(task, id = "") {
  const oid = String(task?.oid || "").toUpperCase();
  if (oid) return `oid:${oid}`;
  const taskId = String(id || task?.id || "");
  if (taskId) return `id:${taskId}`;
  return `task:${singleLine(task?.path || "")}:${singleLine(task?.content || "").toLowerCase()}:${singleLine(task?.parentContent || "").toLowerCase()}`;
}

function uniqueTaskReferenceRows(rows) {
  const seen = new Set();
  return (rows || []).filter((row) => {
    const key = row?.key || row?.text || "";
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function limitTaskRowsForChat(rows, maxRows = TASK_CONTEXT_MAX_ROWS, maxPerPath = TASK_CONTEXT_MAX_ROWS_PER_PATH) {
  const counts = new Map();
  const selected = [];
  for (const row of rows || []) {
    const path = row.path || "";
    const count = counts.get(path) || 0;
    if (path && count >= maxPerPath) continue;
    selected.push(row);
    if (path) counts.set(path, count + 1);
    if (selected.length >= maxRows) break;
  }
  return selected;
}

function matchedTaskNoteSummary(file, taskCount = 0) {
  if (!file?.path) return "";
  const countText = taskCount > 0 ? `; showing only the most relevant task references below` : "";
  return `Matched task note: [${file.path}](obsidian://open?file=${encodeURIComponent(file.path)})${countText}.`;
}

const STOP_WORDS = new Set("the and for that with this from are you your have will would could should about into email task tasks action required completed please thanks than then them they their there here what when where who why how our out not but can has had was were been being".split(" "));

function splitList(value) { return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
function trimSlashes(value) { return String(value || "").replace(/^\/+|\/+$/g, ""); }
function vaultBasePath(app) {
  try { return app?.vault?.adapter?.getBasePath?.() || ""; } catch { return ""; }
}
function vaultRelativePath(value, basePath = "") {
  let path = singleLine(value || "")
    .replace(/^file:\/\//i, "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  if (!path) return "";
  try { path = decodeURIComponent(path); } catch {}
  path = path.replace(/\[[^\]]+\]\((obsidian:\/\/open\?file=[^)]+)\)/i, "$1");
  const obsidianFile = path.match(/obsidian:\/\/open\?file=([^&#\s)]+)/i)?.[1] || "";
  if (obsidianFile) {
    try { path = decodeURIComponent(obsidianFile); } catch { path = obsidianFile; }
  }
  const parenthesizedPath = path.match(/\(([^()]+\.md)\)$/i)?.[1] || "";
  if (parenthesizedPath) path = parenthesizedPath;
  path = path.replace(/\\/g, "/");
  const normalizedBase = trimSlashes(String(basePath || "").replace(/\\/g, "/"));
  const normalizedPath = trimSlashes(path);
  if (normalizedBase && (normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`))) {
    return trimSlashes(normalizedPath.slice(normalizedBase.length));
  }
  return normalizedPath;
}
function normalizeSemanticIndexPaths(chunks, app) {
  const basePath = vaultBasePath(app);
  return (chunks || []).map((chunk) => Object.assign({}, chunk, {
    path: vaultRelativePath(chunk.path || "", basePath),
    id: chunk.id && chunk.path ? `${vaultRelativePath(chunk.path, basePath)}${String(chunk.id).includes("#") ? `#${String(chunk.id).split("#").pop()}` : ""}` : chunk.id
  }));
}
function normalizeStoredTaskReferencePaths(task, basePath = "") {
  const normalized = Object.assign({}, task, {
    path: vaultRelativePath(task?.path || "", basePath)
  });
  if (Array.isArray(task?.noteRefs)) {
    normalized.noteRefs = task.noteRefs.map((ref) => Object.assign({}, ref, {
      path: vaultRelativePath(ref?.path || "", basePath)
    }));
  }
  return normalized;
}
function normalizePendingDescriptionKeys(entries, basePath = "") {
  const normalized = {};
  for (const [key, value] of Object.entries(entries || {})) {
    const text = String(key || "");
    let nextKey = text;
    for (const marker of ["::oid::", "::content::"]) {
      const index = text.indexOf(marker);
      if (index >= 0) {
        nextKey = `${vaultRelativePath(text.slice(0, index), basePath)}${text.slice(index)}`;
        break;
      }
    }
    if (nextKey === text && text.includes("::")) {
      const [path, ...rest] = text.split("::");
      nextKey = [vaultRelativePath(path, basePath), ...rest].join("::");
    }
    normalized[nextKey] = value;
  }
  return normalized;
}
function normalizedExcludedFolders(folders) {
  const normalized = [];
  for (const folder of folders || []) {
    const value = trimSlashes(folder);
    if (!value) continue;
    if (normalized.some((existing) => value === existing || value.startsWith(`${existing}/`))) continue;
    for (let i = normalized.length - 1; i >= 0; i -= 1) {
      if (normalized[i].startsWith(`${value}/`)) normalized.splice(i, 1);
    }
    normalized.push(value);
  }
  return normalized;
}
function isFolderExcluded(path, folders) {
  const value = trimSlashes(path);
  if (!value) return false;
  return (folders || []).map(trimSlashes).filter(Boolean).some((folder) => value === folder || value.startsWith(`${folder}/`));
}
function singleLine(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function shortHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function normalizeAiProvider(value, fallback = "openai") {
  const provider = String(value || "").toLowerCase();
  if (provider === "gemini" || provider === "google") return "gemini";
  if (provider === "openai" || provider === "open-ai") return "openai";
  return fallback === "gemini" ? "gemini" : "openai";
}
function providerDisplayName(provider) {
  return normalizeAiProvider(provider) === "gemini" ? "Gemini" : "OpenAI";
}
function normalizeOpenAIModelId(value) {
  return String(value || "").replace(/^openai[/:]/i, "").trim();
}
function normalizeGeminiModelId(value) {
  return String(value || "")
    .replace(/^google[/:]/i, "")
    .replace(/^gemini[/:](?=gemini-)/i, "")
    .replace(/^models\//i, "")
    .trim();
}
function usesGeminiChatModel(value) {
  const model = String(value || "");
  return /^gemini[/:]/i.test(model) || /^google[/:]/i.test(model) || /^gemini-/i.test(model);
}
function usesOpenAIChatModel(value) {
  return !usesGeminiChatModel(value);
}
function usesGeminiEmbeddingModel(value) {
  const model = String(value || "");
  return /^gemini[/:]/i.test(model) || /^google[/:]/i.test(model) || /^gemini-embedding/i.test(model);
}
function usesOpenAIEmbeddingModel(value) {
  return !usesGeminiEmbeddingModel(value);
}
function aiProviderForModel(value) {
  return usesGeminiChatModel(value) || usesGeminiEmbeddingModel(value) ? "gemini" : "openai";
}
function modelIdentity(value) {
  if (usesGeminiChatModel(value) || usesGeminiEmbeddingModel(value)) return `gemini:${normalizeGeminiModelId(value).toLowerCase()}`;
  if (usesOpenAIChatModel(value) || usesOpenAIEmbeddingModel(value)) return `openai:${normalizeOpenAIModelId(value).toLowerCase()}`;
  return String(value || "").trim().toLowerCase();
}
function isDeprecatedGeminiChatModel(value) {
  const model = normalizeGeminiModelId(value).toLowerCase();
  return model === "gemini-2.0-flash";
}
function isUsableGeminiChatModel(value) {
  const model = normalizeGeminiModelId(value);
  return /^gemini-/i.test(model) && !/embedding|image|tts|computer-use/i.test(model) && !isDeprecatedGeminiChatModel(model);
}
function rankGeminiFallbackModels(models = []) {
  const list = uniqueValues((models || []).map(normalizeGeminiModelId).filter(isUsableGeminiChatModel));
  const score = (model) => {
    const value = normalizeGeminiModelId(model).toLowerCase();
    if (value === "gemini-3.1-flash-lite") return 0;
    if (/^gemini-3\.\d+-flash-lite$/.test(value)) return 1;
    if (/^gemini-3\.\d+-flash$/.test(value)) return 2;
    if (/^gemini-2\.5-flash$/.test(value)) return 3;
    if (/^gemini-2\.5-flash-lite$/.test(value)) return 3;
    if (/^gemini-3-flash/.test(value)) return 4;
    if (/flash/.test(value)) return 5;
    if (/pro/.test(value)) return 6;
    return 7;
  };
  return list.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
}
function rankGeminiPrimaryModels(models = []) {
  const list = uniqueValues((models || []).map(normalizeGeminiModelId).filter(isUsableGeminiChatModel));
  const score = (model) => {
    const value = normalizeGeminiModelId(model).toLowerCase();
    if (value === "gemini-3.5-flash") return 0;
    if (/^gemini-3\.\d+-flash$/.test(value)) return 1;
    if (value === "gemini-3.1-flash-lite") return 2;
    if (/^gemini-3\.\d+-flash-lite$/.test(value)) return 3;
    if (/^gemini-2\.5-flash$/.test(value)) return 4;
    if (/^gemini-2\.5-flash-lite$/.test(value)) return 5;
    if (/flash/.test(value)) return 6;
    if (/pro/.test(value)) return 7;
    return 8;
  };
  return list.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
}
function openAiChatModels(settings = DEFAULT_SETTINGS) {
  return uniqueValues((settings.availableChatModels?.length ? settings.availableChatModels : DEFAULT_SETTINGS.availableChatModels)
    .map(normalizeOpenAIModelId)
    .filter(Boolean));
}
function openAiEmbeddingModels(settings = DEFAULT_SETTINGS) {
  return uniqueValues((settings.availableEmbeddingModels?.length ? settings.availableEmbeddingModels : DEFAULT_SETTINGS.availableEmbeddingModels)
    .map(normalizeOpenAIModelId)
    .filter(Boolean));
}
function geminiChatModels(settings = DEFAULT_SETTINGS) {
  return rankGeminiPrimaryModels(settings.availableGeminiModels?.length ? settings.availableGeminiModels : DEFAULT_SETTINGS.availableGeminiModels);
}
function geminiEmbeddingModels(settings = DEFAULT_SETTINGS) {
  return uniqueValues((settings.availableGeminiEmbeddingModels?.length ? settings.availableGeminiEmbeddingModels : DEFAULT_SETTINGS.availableGeminiEmbeddingModels)
    .map(normalizeGeminiModelId)
    .filter(Boolean));
}
function preferredChatModelForProvider(settings = DEFAULT_SETTINGS, provider = "openai") {
  const normalized = normalizeAiProvider(provider);
  const current = settings.chatModel || DEFAULT_SETTINGS.chatModel;
  if (normalized === "gemini") {
    if (usesGeminiChatModel(current) && isUsableGeminiChatModel(current)) return `gemini/${normalizeGeminiModelId(current)}`;
    const models = geminiChatModels(settings);
    const preferred = models.includes("gemini-3.5-flash") ? "gemini-3.5-flash" : models[0] || "gemini-3.5-flash";
    return `gemini/${preferred}`;
  }
  if (usesOpenAIChatModel(current)) return normalizeOpenAIModelId(current);
  const models = openAiChatModels(settings);
  return models.includes(DEFAULT_SETTINGS.chatModel) ? DEFAULT_SETTINGS.chatModel : models[0] || DEFAULT_SETTINGS.chatModel;
}
function preferredFallbackModelForProvider(settings = DEFAULT_SETTINGS, provider = "openai", primaryModel = "") {
  const normalized = normalizeAiProvider(provider);
  if (normalized === "gemini") {
    const primary = normalizeGeminiModelId(primaryModel || preferredChatModelForProvider(settings, normalized));
    const manual = settings.chatFallbackModel && usesGeminiChatModel(settings.chatFallbackModel) ? normalizeGeminiModelId(settings.chatFallbackModel) : "";
    const models = rankGeminiFallbackModels(geminiChatModels(settings));
    const preferred = uniqueValues([manual, "gemini-3.1-flash-lite"].concat(models))
      .find((model) => isUsableGeminiChatModel(model) && normalizeGeminiModelId(model) !== primary);
    return preferred ? `gemini/${normalizeGeminiModelId(preferred)}` : "";
  }
  const primary = normalizeOpenAIModelId(primaryModel || preferredChatModelForProvider(settings, normalized));
  const manual = settings.chatFallbackModel && usesOpenAIChatModel(settings.chatFallbackModel) ? normalizeOpenAIModelId(settings.chatFallbackModel) : "";
  const models = openAiChatModels(settings);
  return uniqueValues([manual, DEFAULT_SETTINGS.chatFallbackModel].concat(models))
    .find((model) => normalizeOpenAIModelId(model) && normalizeOpenAIModelId(model) !== primary) || "";
}
function preferredEmbeddingModelForProvider(settings = DEFAULT_SETTINGS, provider = "openai") {
  const normalized = normalizeAiProvider(provider);
  const current = settings.embeddingModel || DEFAULT_SETTINGS.embeddingModel;
  if (normalized === "gemini") {
    if (usesGeminiEmbeddingModel(current)) return `gemini/${normalizeGeminiModelId(current)}`;
    const models = geminiEmbeddingModels(settings);
    const preferred = models.includes("gemini-embedding-2") ? "gemini-embedding-2" : models[0] || "gemini-embedding-2";
    return `gemini/${preferred}`;
  }
  if (usesOpenAIEmbeddingModel(current)) return normalizeOpenAIModelId(current);
  const models = openAiEmbeddingModels(settings);
  return models.includes(DEFAULT_SETTINGS.embeddingModel) ? DEFAULT_SETTINGS.embeddingModel : models[0] || DEFAULT_SETTINGS.embeddingModel;
}
function schedulerDurationEstimateModel(settings = DEFAULT_SETTINGS) {
  const primary = settings.chatModel || DEFAULT_SETTINGS.chatModel;
  if (usesGeminiChatModel(primary)) {
    const primaryId = normalizeGeminiModelId(primary);
    const manualFallback = settings.chatFallbackModel && usesGeminiChatModel(settings.chatFallbackModel)
      ? normalizeGeminiModelId(settings.chatFallbackModel)
      : "";
    const preferredId = manualFallback || "gemini-3.1-flash-lite";
    const available = new Set((settings.availableGeminiModels?.length ? settings.availableGeminiModels : DEFAULT_SETTINGS.availableGeminiModels)
      .map(normalizeGeminiModelId)
      .filter(isUsableGeminiChatModel));
    if (isUsableGeminiChatModel(preferredId) && preferredId !== primaryId && (available.has(preferredId) || preferredId === "gemini-3.1-flash-lite")) {
      return `gemini/${preferredId}`;
    }
  }
  if (usesOpenAIChatModel(primary) && settings.chatFallbackModel && usesOpenAIChatModel(settings.chatFallbackModel)) {
    return normalizeOpenAIModelId(primary);
  }
  return primary;
}
function aiModelOptions(settings, key, listKey) {
  const options = [];
  const provider = normalizeAiProvider(settings.aiModelProvider, aiProviderForModel(settings.chatModel));
  if (key === "chatModel") {
    if (provider === "openai") {
      for (const model of openAiChatModels(settings)) options.push({ value: model, label: `OpenAI: ${model}` });
    } else {
      for (const model of geminiChatModels(settings)) {
        const id = normalizeGeminiModelId(model);
        if (isUsableGeminiChatModel(id)) options.push({ value: `gemini/${id}`, label: `Gemini: ${id}` });
      }
    }
    return uniqueModelOptions(options);
  }
  if (key === "embeddingModel") {
    if (provider === "openai") {
      for (const model of openAiEmbeddingModels(settings)) options.push({ value: model, label: `OpenAI: ${model}` });
    } else {
      for (const model of geminiEmbeddingModels(settings)) options.push({ value: `gemini/${normalizeGeminiModelId(model)}`, label: `Gemini: ${normalizeGeminiModelId(model)}` });
    }
    return uniqueModelOptions(options);
  }
  return (settings[listKey] || []).map((model) => ({ value: model, label: model }));
}
function uniqueModelOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    const key = String(option.value ?? "");
    if (option.value == null || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function uniqueValues(values) {
  const seen = new Set();
  return (values || []).filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
function shallowObjectEqual(a = {}, b = {}) {
  const aKeys = Object.keys(a || {});
  const bKeys = Object.keys(b || {});
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}
function semanticIndexStorageFingerprint(manifestBody, shards = []) {
  const parts = [`manifest:${utf8ByteLength(manifestBody)}:${shortHash(manifestBody)}`];
  for (const shard of shards || []) {
    const body = shard.body || "";
    const bytes = shard.bytes || utf8ByteLength(body);
    const hash = shard.hash || shortHash(body);
    parts.push(`${shard.file || ""}:${bytes}:${hash}`);
  }
  return shortHash(parts.join("|"));
}
function semanticIndexShardBodies(indexFile, meta, chunks, maxBytes = SEMANTIC_INDEX_SHARD_MAX_BYTES) {
  const shards = [];
  let currentBodies = [];
  let currentBytes = 0;
  const flush = () => {
    if (!currentBodies.length) return;
    const shard = semanticIndexShardFromBodies(indexFile, meta, shards.length, currentBodies, currentBytes);
    shards.push(shard);
    currentBodies = [];
    currentBytes = 0;
  };
  for (const chunk of chunks || []) {
    const chunkBody = JSON.stringify(chunk);
    const chunkBytes = utf8ByteLength(chunkBody);
    const nextBytes = currentBytes + chunkBytes;
    const projectedBytes = semanticIndexShardProjectedBytes(indexFile, meta, shards.length, currentBodies.length + 1, nextBytes);
    if (currentBodies.length && projectedBytes > maxBytes) flush();
    currentBodies.push(chunkBody);
    currentBytes += chunkBytes;
  }
  flush();
  return shards;
}

async function semanticIndexShardBodiesAsync(indexFile, meta, chunks, maxBytes = SEMANTIC_INDEX_SHARD_MAX_BYTES) {
  const shards = [];
  let currentBodies = [];
  let currentBytes = 0;
  const flush = async () => {
    if (!currentBodies.length) return;
    const shard = semanticIndexShardFromBodies(indexFile, meta, shards.length, currentBodies, currentBytes);
    shards.push(shard);
    currentBodies = [];
    currentBytes = 0;
    await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
  };
  for (let index = 0; index < (chunks || []).length; index += 1) {
    const chunk = chunks[index];
    const chunkBody = JSON.stringify(chunk);
    const chunkBytes = utf8ByteLength(chunkBody);
    const nextBytes = currentBytes + chunkBytes;
    const projectedBytes = semanticIndexShardProjectedBytes(indexFile, meta, shards.length, currentBodies.length + 1, nextBytes);
    if (currentBodies.length && projectedBytes > maxBytes) await flush();
    currentBodies.push(chunkBody);
    currentBytes += chunkBytes;
    if (index && index % 50 === 0) await idlePause(SEMANTIC_INDEX_FILE_PAUSE_MS);
  }
  await flush();
  return shards;
}

function semanticIndexShardMeta(indexFile, meta, shardIndex, chunkCount) {
  const file = semanticIndexShardFileName(indexFile, shardIndex);
  return Object.assign({}, meta, {
    file,
    parentFile: indexFile,
    shardIndex,
    chunks: chunkCount
  });
}

function semanticIndexShardHeader(indexFile, meta, shardIndex, chunkCount) {
  return `{"meta":${JSON.stringify(semanticIndexShardMeta(indexFile, meta, shardIndex, chunkCount))},"chunks":[`;
}

function semanticIndexShardProjectedBytes(indexFile, meta, shardIndex, chunkCount, chunkBytes) {
  return utf8ByteLength(semanticIndexShardHeader(indexFile, meta, shardIndex, chunkCount)) + chunkBytes + Math.max(0, chunkCount - 1) + 2;
}

function semanticIndexShardFromBodies(indexFile, meta, shardIndex, chunkBodies, chunkBytes) {
  const file = semanticIndexShardFileName(indexFile, shardIndex);
  const header = semanticIndexShardHeader(indexFile, meta, shardIndex, chunkBodies.length);
  const body = `${header}${chunkBodies.join(",")}]}`;
  const bytes = utf8ByteLength(body);
  return { file, body, bytes, chunkCount: chunkBodies.length };
}

function semanticIndexShardFileName(indexFile, index) {
  return String(indexFile || SEMANTIC_INDEX_FILE).replace(/\.json$/i, `.${String(index + 1).padStart(3, "0")}.json`);
}

function isSemanticIndexShardFile(indexFile, fileName) {
  const prefix = String(indexFile || "").replace(/\.json$/i, "");
  return new RegExp(`^${escapeRegExp(prefix)}\\.\\d{3}\\.json$`, "i").test(String(fileName || ""));
}

function utf8ByteLength(value) {
  const text = String(value || "");
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  if (typeof Buffer !== "undefined") return Buffer.byteLength(text, "utf8");
  return text.length;
}
function modelDisplayName(value) {
  if (usesGeminiChatModel(value) || usesGeminiEmbeddingModel(value)) return `Gemini: ${normalizeGeminiModelId(value)}`;
  return `OpenAI: ${normalizeOpenAIModelId(value)}`;
}
function isTransientAiModelError(error) {
  const message = String(error?.message || error || "");
  return /\b(404|429|500|502|503|504)\b/.test(message) ||
    /overload|too much demand|temporarily unavailable|unavailable|not found|no longer available|rate limit|rate-limit|capacity|try again|deadline exceeded/i.test(message);
}
function geminiEmbeddingInput(text, role = "document", model = "") {
  const value = String(text || "").trim();
  if (model !== "gemini-embedding-2") return value;
  if (role === "query") return `task: search result | query: ${value}`;
  const [titleLine, ...rest] = value.split("\n");
  const title = singleLine(titleLine || "none") || "none";
  const body = rest.join("\n").trim() || value;
  return `title: ${title} | text: ${body}`;
}
function geminiCompatibleSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiCompatibleSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (["additionalProperties", "$schema", "strict", "pattern", "minItems", "maxItems"].includes(key)) continue;
    if (key === "type" && Array.isArray(value)) {
      const nonNullTypes = value.filter((type) => type !== "null");
      out.type = nonNullTypes[0] || "null";
      if (value.includes("null")) out.nullable = true;
      continue;
    }
    out[key] = geminiCompatibleSchema(value);
  }
  return out;
}
function excludedLinkDomains(settings = DEFAULT_SETTINGS) {
  return splitList(settings.excludedLinkDomains || DEFAULT_SETTINGS.excludedLinkDomains)
    .map((domain) => domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim())
    .filter(Boolean);
}
function isExcludedUrl(url, settings = DEFAULT_SETTINGS) {
  const domains = excludedLinkDomains(settings);
  if (!domains.length) return false;
  try {
    const host = new URL(String(url).replace(/[)\].,;!?]+$/, "")).hostname.toLowerCase().replace(/^www\./, "");
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
function stripExcludedLinks(value, settings = DEFAULT_SETTINGS) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, (match, label, url) => isExcludedUrl(url, settings) ? label : match)
    .replace(/https?:\/\/[^\s<>)\]]+/gi, (url) => isExcludedUrl(url, settings) ? "" : url);
}
function stripLinkAvailabilitySentences(value) {
  return String(value || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => {
      const text = singleLine(sentence);
      if (!text) return false;
      if (/\b(no|not|without|missing|unavailable|unable to find|none)\b.{0,70}\b(web\s*links?|links?|linked files?|referenced files?|attachments?)\b/i.test(text)) return false;
      if (/\b(web\s*links?|links?|linked files?|referenced files?|attachments?)\b.{0,70}\b(no|not|missing|unavailable|found|provided|included)\b/i.test(text)) return false;
      return true;
    })
    .join(" ");
}
function stripWikiLinkSyntax(value) {
  return String(value || "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\]\]/g, "")
    .replace(/\[\[/g, "");
}
function clamp(value, max) { const text = String(value || ""); return text.length <= max ? text : truncateAtWord(text, max); }
function truncateAtWord(value, max) {
  const text = singleLine(value);
  if (text.length <= max) return text;
  const sliced = text.slice(0, max + 1);
  const boundary = sliced.lastIndexOf(" ");
  return sliced.slice(0, boundary > Math.floor(max * 0.75) ? boundary : max).trim();
}
function truncateMarkdownAtWord(value, max) {
  const text = String(value || "");
  if (text.length <= max) return text;
  const sliced = text.slice(0, max + 1);
  const boundary = Math.max(sliced.lastIndexOf(" "), sliced.lastIndexOf("\n"));
  return sliced.slice(0, boundary > Math.floor(max * 0.75) ? boundary : max).trim();
}
function formatTodoistDescription(value, settings = DEFAULT_SETTINGS) {
  const max = Math.min(TODOIST_DESCRIPTION_LIMIT, Math.max(1, parseInt(settings.todoistDescriptionMaxChars, 10) || DEFAULT_SETTINGS.todoistDescriptionMaxChars));
  const cleaned = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length <= max ? cleaned : truncateMarkdownAtWord(cleaned, max);
}
function cleanLabel(label) { return String(label || "").replace(/^#/, "").replace(/\s+/g, "").trim(); }
function shortTitle(value, max) { const text = singleLine(String(value || "").replace(/\.md$/i, "")); return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`; }
function compactEmbedding(values, precision) { const factor = Math.pow(10, precision || 4); return (values || []).map((value) => Math.round(value * factor) / factor); }
function normalizePriority(value) { const priority = parseInt(value, 10); return Number.isFinite(priority) ? Math.max(1, Math.min(4, priority)) : 1; }
function validDate(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value); }
function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
  } catch {
    return "America/Toronto";
  }
}
function deviceTimestamp(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const safeDate = Number.isFinite(value.getTime()) ? value : new Date();
  const pad = (number, length = 2) => String(Math.trunc(Math.abs(number))).padStart(length, "0");
  const offsetMinutes = -safeDate.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const minutes = pad(Math.abs(offsetMinutes) % 60);
  return `${safeDate.getFullYear()}-${pad(safeDate.getMonth() + 1)}-${pad(safeDate.getDate())}T${pad(safeDate.getHours())}:${pad(safeDate.getMinutes())}:${pad(safeDate.getSeconds())}.${pad(safeDate.getMilliseconds(), 3)}${sign}${hours}:${minutes}`;
}
function deviceDateString(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const safeDate = Number.isFinite(value.getTime()) ? value : new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `${safeDate.getFullYear()}-${pad(safeDate.getMonth() + 1)}-${pad(safeDate.getDate())}`;
}
function today() { return deviceDateString(); }
function uuid() { return globalThis.crypto?.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((c === "x" ? Math.random() * 16 : (Math.random() * 16 & 0x3 | 0x8)) | 0).toString(16)); }
function escapeRegExp(text) { return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function obsidianDescription(path) {
  const notePath = vaultRelativePath(path);
  return notePath ? `[${notePath}](obsidian://open?file=${encodeURIComponent(notePath)})` : "";
}
function sourceReference(source, basePath = "") {
  return vaultRelativePath(source?.path || "", basePath);
}
function isEmailLogPath(path, settings = DEFAULT_SETTINGS) {
  const folder = trimSlashes(settings.emailLogFolder || DEFAULT_SETTINGS.emailLogFolder || "");
  const notePath = trimSlashes(path || "");
  return Boolean(folder && (notePath === folder || notePath.startsWith(`${folder}/`)));
}
function sectionKey(name) { return singleLine(name).toLowerCase(); }

async function appendMarkdownBlock(app, file, markdown) {
  if (!(file instanceof TFile)) throw new Error("Active note was not found.");
  const current = await app.vault.read(file);
  await app.vault.modify(file, markdownWithSingleBlankLineBeforeAppend(current, markdown));
}

function markdownWithSingleBlankLineBeforeAppend(current, markdown) {
  const before = String(current || "").replace(/\s+$/, "");
  const block = String(markdown || "").trim();
  return before ? `${before}\n\n${block}\n` : `${block}\n`;
}

async function ensureVaultFolder(app, folderPath) {
  const parts = trimSlashes(folderPath).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try {
        await app.vault.createFolder(current);
      } catch (error) {
        if (!/exist/i.test(error.message || String(error))) throw error;
      }
    }
  }
}

function normalizeTodoistProjects(projects) {
  return (projects || [])
    .map((project) => ({
      id: String(project.id || ""),
      name: singleLine(project.name || "Untitled project"),
      isInbox: Boolean(project.isInbox || project.is_inbox_project || project.inbox_project)
    }))
    .filter((project) => project.id)
    .sort((a, b) => (a.isInbox === b.isInbox ? a.name.localeCompare(b.name) : a.isInbox ? -1 : 1));
}

function normalizeTodoistSections(sections, projectId) {
  return (sections || [])
    .map((section) => ({
      id: String(section.id || ""),
      name: singleLine(section.name || ""),
      projectId: String(section.project_id || section.projectId || projectId || "")
    }))
    .filter((section) => section.id && section.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeTodoistTask(task) {
  return {
    id: String(task.id || ""),
    content: singleLine(task.content || ""),
    description: task.description || "",
    parentId: String(task.parent_id || task.parentId || ""),
    sectionId: String(task.section_id || task.sectionId || ""),
    projectId: String(task.project_id || task.projectId || ""),
    labels: (task.labels || []).map(cleanLabel).filter(Boolean),
    priority: normalizePriority(task.priority),
    dueDate: task.due?.date || task.due_date || "",
    deadlineDate: task.deadline?.date || task.deadline_date || "",
    duration: normalizeTodoistDuration(task.duration),
    isCompleted: Boolean(task.is_completed || task.checked || task.completed)
  };
}

function findExistingTodoistTaskMatch(parsed, existingTasks, parentId = "") {
  const content = singleLine(parsed.content || "").toLowerCase();
  if (!content) return null;
  const due = parsed.due_date || "";
  const deadline = parsed.deadline_date || "";
  const projectName = singleLine(parsed.projectName || "").toLowerCase();
  const candidates = existingTasks.filter((task) => {
    if (singleLine(task.content).toLowerCase() !== content) return false;
    if (parentId && task.parentId && task.parentId !== parentId) return false;
    if (parsed.isSubtask && parentId && task.parentId !== parentId) return false;
    if (projectName && task.projectName && singleLine(task.projectName).toLowerCase() !== projectName) return false;
    if (due && task.dueDate && datePart(task.dueDate) !== due) return false;
    if (deadline && task.deadlineDate && task.deadlineDate !== deadline) return false;
    return true;
  });
  candidates.sort((a, b) => existingTodoistTaskMatchScore(b, parsed, parentId) - existingTodoistTaskMatchScore(a, parsed, parentId));
  return candidates[0] || null;
}

function existingTodoistTaskMatchScore(task, parsed, parentId) {
  let score = 0;
  if (parsed.isSubtask && parentId && task.parentId === parentId) score += 5;
  if (parsed.projectName && task.projectName && singleLine(parsed.projectName).toLowerCase() === singleLine(task.projectName).toLowerCase()) score += 5;
  if (parsed.section && task.section && singleLine(parsed.section).toLowerCase() === singleLine(task.section).toLowerCase()) score += 4;
  if (!parsed.isSubtask && parsed.section && task.sectionId) score += 4;
  if (!parsed.isSubtask && !task.parentId) score += 2;
  if (parsed.due_date && datePart(task.dueDate) === parsed.due_date) score += 1;
  if (parsed.deadline_date && task.deadlineDate === parsed.deadline_date) score += 1;
  return score;
}

function emptyTaskDeduplicationStats() {
  return {
    checked: 0,
    merged: 0,
    created: 0,
    ambiguous: 0,
    copiedSubtasks: 0,
    removedSubtasks: 0,
    generatedDuplicates: 0,
    aiUsed: 0,
    candidateFlags: [],
    matches: []
  };
}

function taskDeduplicationRunSummary(stats = emptyTaskDeduplicationStats()) {
  return `${stats.merged || 0} linked to existing tasks, ${stats.created || 0} left as new, ${stats.ambiguous || 0} ambiguous, ${stats.copiedSubtasks || 0} existing subtasks copied, ${stats.generatedDuplicates || 0} generated duplicates collapsed, ${(stats.candidateFlags || []).length} local-only duplicate candidates flagged.`;
}

async function deduplicateGeneratedTaskBatch(tasks = [], settings = DEFAULT_SETTINGS, options = {}, aiMergeFn = null) {
  const stats = { merged: 0, matches: [], aiUsed: 0, ambiguous: 0, candidateFlags: [] };
  if (!Array.isArray(tasks) || tasks.length < 2) return stats;
  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    if (!task || task.id || task.isSubtask) continue;
    const candidates = generatedTaskBatchCandidates(tasks, i);
    const decision = bestTaskDeduplicationMatch(task, candidates, settings, Object.assign({}, options, { isSubtask: false, intraBatch: true }));
    if (!decision.candidate?.generatedTask) continue;
    if (!isAiMediatedTaskDeduplicationCandidate(decision)) continue;
    if (settings.enableAiAmbiguousTaskDeduplication !== true) {
      stats.ambiguous += 1;
      stats.candidateFlags.push(taskDeduplicationCandidateFlag(task, decision, settings, { intraBatch: true }));
      continue;
    }
    const aiMerge = typeof aiMergeFn === "function" ? await aiMergeFn(task, decision, Object.assign({}, options, { intraBatch: true })) : null;
    if (aiMerge?.used) stats.aiUsed += 1;
    if (aiMerge?.match !== true) continue;
    mergeGeneratedDuplicateTask(decision.candidate.generatedTask, task, decision, settings, aiMerge.task);
    stats.merged += 1;
    stats.matches.push(taskDeduplicationMatchSummary(task, Object.assign({}, decision, {
      id: "",
      reasons: uniqueValues(["merged with generated task"].concat(decision.reasons || []))
    })));
    tasks.splice(i, 1);
    i -= 1;
  }
  return stats;
}

function generatedTaskBatchCandidates(tasks = [], beforeIndex = 0) {
  const candidates = [];
  for (let index = 0; index < beforeIndex; index += 1) {
    const task = tasks[index];
    if (!task || task.isSubtask) continue;
    candidates.push({
      id: task.id || task.oid || `generated:${index}`,
      generatedTask: task,
      task: Object.assign({}, task, {
        id: task.id || task.oid || `generated:${index}`,
        childText: taskDeduplicationSubtaskText(task)
      })
    });
  }
  return candidates;
}

function mergeGeneratedDuplicateTask(target, duplicate, decision = {}, settings = DEFAULT_SETTINGS, aiTask = null) {
  if (!target || !duplicate) return target;
  if (aiTask) applyAiTaskDeduplicationMerge(target, aiTask, settings);
  else return target;
  target.knowledge = taskKnowledgeSnapshot(target, settings, "", target.knowledge || duplicate.knowledge || null);
  target.descriptionShouldSync = true;
  target.deduplication = {
    todoistId: target.id || "",
    confidence: decision.confidence || 0,
    reasons: uniqueValues(["merged with generated task"].concat(decision.reasons || []))
  };
  return target;
}

function applyAiTaskDeduplicationMerge(task, aiTask = {}, settings = DEFAULT_SETTINGS) {
  if (!task || !aiTask) return task;
  task.content = singleLine(aiTask.content || task.content || "");
  task.description = isRichTodoistDescription(aiTask.description) ? aiTask.description : task.description || aiTask.description || "";
  if (Object.prototype.hasOwnProperty.call(aiTask, "due_date")) task.due_date = aiTask.due_date || "";
  if (Object.prototype.hasOwnProperty.call(aiTask, "deadline_date")) task.deadline_date = aiTask.deadline_date || "";
  task.priority = normalizePriority(aiTask.priority || task.priority || 1);
  task.labels = (aiTask.labels || task.labels || []).map(cleanLabel).filter(Boolean);
  if (Array.isArray(aiTask.subtasks) && !task.isSubtask) {
    task.subtasks = aiTask.subtasks
      .map((subtask, index) => aiMergedSubtask(subtask, task.subtasks?.[index] || {}, task, settings))
      .filter((subtask) => subtask.content);
  }
  task.knowledge = taskKnowledgeSnapshot(task, settings, taskDeduplicationSubtaskText(task), task.knowledge || null);
  task.descriptionShouldSync = true;
  return task;
}

function aiMergedSubtask(aiSubtask = {}, existing = {}, parentTask = {}, settings = DEFAULT_SETTINGS) {
  const merged = Object.assign({}, existing, {
    content: singleLine(aiSubtask.content || existing.content || ""),
    description: aiSubtask.description || existing.description || "",
    due_date: aiSubtask.due_date || existing.due_date || "",
    deadline_date: aiSubtask.deadline_date || existing.deadline_date || "",
    priority: normalizePriority(aiSubtask.priority || existing.priority || 1),
    labels: (aiSubtask.labels || existing.labels || []).map(cleanLabel).filter(Boolean),
    isSubtask: true,
    oid: existing.oid || generateUniqueOid(settings),
    parentId: parentTask.id || existing.parentId || "",
    parentOid: parentTask.oid || existing.parentOid || "",
    parentContent: parentTask.content || existing.parentContent || "",
    projectId: parentTask.projectId || existing.projectId || "",
    projectName: parentTask.projectName || existing.projectName || "",
    section: parentTask.section || existing.section || "",
    sectionId: parentTask.sectionId || existing.sectionId || ""
  });
  merged.knowledge = taskKnowledgeSnapshot(merged, settings, "", merged.knowledge || null);
  return merged;
}

function taskDeduplicationAiMergeTaskFromResponse(parsed = {}, existing = {}, incoming = {}, settings = DEFAULT_SETTINGS) {
  const task = parsed?.task && typeof parsed.task === "object" ? parsed.task : {};
  return {
    content: singleLine(task.content || incoming.content || existing.content || ""),
    description: truncateMarkdownAtWord(task.description || incoming.description || existing.description || "", Number(settings.todoistDescriptionMaxChars || DEFAULT_SETTINGS.todoistDescriptionMaxChars || 8000)),
    due_date: task.due_date || incoming.due_date || existing.due_date || "",
    deadline_date: task.deadline_date || incoming.deadline_date || existing.deadline_date || "",
    priority: normalizePriority(task.priority || incoming.priority || existing.priority || 1),
    labels: (task.labels || mergedTaskLabelsForDeduplication(incoming.labels || [], existing.labels || [], settings)).map(cleanLabel).filter(Boolean),
    subtasks: (task.subtasks || []).map((subtask) => ({
      content: singleLine(subtask.content || ""),
      description: subtask.description || "",
      due_date: subtask.due_date || "",
      deadline_date: subtask.deadline_date || "",
      priority: normalizePriority(subtask.priority || 1),
      labels: (subtask.labels || []).map(cleanLabel).filter(Boolean)
    })).filter((subtask) => subtask.content)
  };
}

function mergeGeneratedDuplicateSubtasks(targetSubtasks = [], duplicateSubtasks = [], settings = DEFAULT_SETTINGS) {
  const merged = Array.isArray(targetSubtasks) ? targetSubtasks : [];
  for (const subtask of duplicateSubtasks || []) {
    if (!subtask?.content) continue;
    const candidates = merged.map((task, index) => ({
      id: task.id || task.oid || `generated-subtask:${index}`,
      generatedTask: task,
      task: Object.assign({}, task, { id: task.id || task.oid || `generated-subtask:${index}` })
    }));
    const decision = bestTaskDeduplicationMatch(subtask, candidates, settings, { isSubtask: true, intraBatch: true });
    if (decision.decision === "merge" && decision.candidate?.generatedTask) {
      continue;
    } else {
      merged.push(subtask);
    }
  }
  return merged;
}

function taskDeduplicationThreshold(settings = DEFAULT_SETTINGS) {
  const strictness = settings.taskDeduplicationStrictness || "conservative";
  if (strictness === "strict") return 90;
  if (strictness === "permissive") return 78;
  return 84;
}

function taskDeduplicationAiReviewConfig(settings = DEFAULT_SETTINGS, options = {}) {
  const sensitivity = settings.taskDeduplicationAiReviewSensitivity || DEFAULT_SETTINGS.taskDeduplicationAiReviewSensitivity;
  const configs = {
    narrow: {
      band: options.intraBatch ? 18 : Math.max(8, TASK_DEDUPLICATION_AI_AMBIGUOUS_BAND - 6),
      titleOverlap: options.intraBatch ? 0.28 : 0.48,
      contextOverlap: options.intraBatch ? 0.38 : 0.48,
      batchTitleOverlap: 0.22,
      batchContextOverlap: 0.26
    },
    balanced: {
      band: options.intraBatch ? 24 : TASK_DEDUPLICATION_AI_AMBIGUOUS_BAND,
      titleOverlap: options.intraBatch ? 0.24 : 0.42,
      contextOverlap: options.intraBatch ? 0.34 : 0.42,
      batchTitleOverlap: 0.18,
      batchContextOverlap: 0.22
    },
    broad: {
      band: options.intraBatch ? 32 : TASK_DEDUPLICATION_AI_AMBIGUOUS_BAND + 8,
      titleOverlap: options.intraBatch ? 0.2 : 0.36,
      contextOverlap: options.intraBatch ? 0.28 : 0.36,
      batchTitleOverlap: 0.12,
      batchContextOverlap: 0.16
    }
  };
  return configs[sensitivity] || configs.balanced;
}

function isAiMediatedTaskDeduplicationCandidate(decision = {}) {
  return Boolean(decision?.candidate && (decision.decision === "merge" || decision.decision === "ambiguous"));
}

function bestTaskDeduplicationMatch(task, candidates = [], settings = DEFAULT_SETTINGS, options = {}) {
  const threshold = taskDeduplicationThreshold(settings);
  let best = null;
  for (const candidate of candidates) {
    if (!candidate?.id || candidate.task?.isCompleted) continue;
    const scored = taskDeduplicationScore(task, candidate, settings, options);
    if (scored.hierarchyMismatch && !scored.hierarchyCandidate) continue;
    if (!best || scored.confidence > best.confidence) best = scored;
  }
  if (!best || !best.candidate) return { decision: "create", confidence: 0, reasons: ["No active local candidate."], candidate: null };
  const contextSupported = best.projectContextMatch === true;
  if (best.confidence >= threshold && (best.titleOverlap >= 0.52 || contextSupported) && !best.hardMismatch) return Object.assign(best, { decision: "merge" });
  const aiReview = taskDeduplicationAiReviewConfig(settings, options);
  if (options.intraBatch && best.batchContextMatch && !best.hardMismatch) return Object.assign(best, { decision: "ambiguous" });
  if (options.intraBatch && best.titleOverlap >= aiReview.batchTitleOverlap && best.contextOverlap >= aiReview.batchContextOverlap && !best.hardMismatch) return Object.assign(best, { decision: "ambiguous" });
  if (best.confidence >= threshold - aiReview.band && (best.titleOverlap >= aiReview.titleOverlap || best.contextOverlap >= aiReview.contextOverlap || contextSupported) && !best.hardMismatch) return Object.assign(best, { decision: "ambiguous" });
  return Object.assign(best, { decision: "create" });
}

function taskDeduplicationScore(task, candidate, settings = DEFAULT_SETTINGS, options = {}) {
  const existing = candidate.task || {};
  const sourceKnowledge = task?.knowledge?.intent ? task.knowledge : taskKnowledgeSnapshot(task, settings, "", task?.knowledge || null);
  const existingKnowledge = existing.knowledge?.intent ? existing.knowledge : taskKnowledgeSnapshot(existing, settings, "", existing.knowledge || null);
  if (task && !task.knowledge?.intent) task.knowledge = sourceKnowledge;
  if (existing && !existing.knowledge?.intent) existing.knowledge = existingKnowledge;
  const sourceTitle = canonicalTaskMatchTitle(task?.content || "");
  const existingTitle = canonicalTaskMatchTitle(existing.content || "");
  const sourceTitleTokens = taskDedupeTokenSet(sourceTitle);
  const existingTitleTokens = taskDedupeTokenSet(existingTitle);
  const titleOverlap = tokenDiceScore(sourceTitleTokens, existingTitleTokens);
  const sourceContextTokens = taskDedupeTokenSet(taskDeduplicationContextText(Object.assign({}, task, { knowledge: sourceKnowledge })));
  const existingContextTokens = taskDedupeTokenSet(taskDeduplicationContextText(Object.assign({}, existing, { knowledge: existingKnowledge })));
  const contextOverlap = tokenDiceScore(sourceContextTokens, existingContextTokens);
  const sameProject = sameTaskDeduplicationProject(task, existing);
  const differentConcreteProject = differentConcreteTaskDeduplicationProject(task, existing);
  const projectContextEligible = sameProject && !isGenericTodoistInboxTask(task) && !isGenericTodoistInboxTask(existing);
  const sameSection = sameTaskDeduplicationSection(task, existing);
  const sharedTitleTokens = tokenIntersection(sourceTitleTokens, existingTitleTokens);
  const peopleOverlap = tokenOverlapCount(sourceKnowledge.people || [], existingKnowledge.people || []);
  const topicOverlap = tokenOverlapCount(sourceKnowledge.topics || [], existingKnowledge.topics || []);
  const labelOverlap = tokenOverlapCount(task?.labels || [], existing.labels || []);
  const hierarchy = taskDeduplicationHierarchySignal(task, existing, options, {
    titleOverlap,
    contextOverlap,
    sharedTitleTokens
  });
  const progressDistinct = taskDeduplicationProgressDistinct(task, existing, {
    titleOverlap,
    contextOverlap
  });
  const componentDistinct = taskDeduplicationComponentDistinct(task, existing, {
    titleOverlap,
    contextOverlap
  });
  const sequentialDistinct = taskDeduplicationSequentialActionDistinct(task, existing, {
    titleOverlap,
    contextOverlap
  });
  const reasons = [];
  let score = 0;
  if (sourceTitle && existingTitle && sourceTitle === existingTitle) {
    score += 72;
    reasons.push("exact task title");
  } else if (titleOverlap >= 0.9) {
    score += 68;
    reasons.push("near-exact task title");
  } else {
    const titleScore = Math.round(titleOverlap * 48);
    score += titleScore;
    if (titleScore >= 24) reasons.push("similar task title");
  }
  if (sourceTitle && existingTitle && (sourceTitle.includes(existingTitle) || existingTitle.includes(sourceTitle)) && Math.min(sourceTitle.length, existingTitle.length) >= 18) {
    score += 12;
    reasons.push("contained task phrase");
  }
  const contextScore = Math.round(contextOverlap * 20);
  score += contextScore;
  if (contextScore >= 8) reasons.push("similar intent/context");
  if (peopleOverlap) {
    score += Math.min(10, peopleOverlap * 5);
    reasons.push("same people");
  }
  if (topicOverlap) {
    score += Math.min(10, topicOverlap * 4);
    reasons.push("same topics");
  }
  if (labelOverlap) {
    score += Math.min(6, labelOverlap * 3);
    reasons.push("same labels");
  }
  if (sameSection) {
    score += 4;
    reasons.push("same generated section");
  }
  if (task?.due_date && existing.due_date && datePart(task.due_date) === datePart(existing.due_date)) score += 4;
  if (task?.deadline_date && existing.deadline_date && task.deadline_date === existing.deadline_date) score += 4;
  let projectContextMatch = false;
  if (projectContextEligible && !progressDistinct && !componentDistinct && !sequentialDistinct) {
    score += 12;
    reasons.push("same Todoist project");
    if (sharedTitleTokens.length >= 2 && titleOverlap >= 0.3 && contextOverlap >= 0.28) {
      const projectContextScore = Math.min(40, 30 + sharedTitleTokens.length * 2);
      score += projectContextScore;
      projectContextMatch = true;
      reasons.push("same project action context");
    }
  }
  if (hierarchy.sameParent) {
    score += 16;
    reasons.push("same parent task");
  }
  if (hierarchy.parentSubtaskRestatement) {
    score += 18;
    reasons.push("parent/subtask restatement");
  }
  if (hierarchy.identicalAcrossParents) {
    score += 12;
    reasons.push("same action under different parents");
  }
  let hardMismatch = false;
  if (differentConcreteProject) {
    score -= 42;
    reasons.push("different Todoist projects");
    hardMismatch = true;
  }
  if (hierarchy.differentParent && !hierarchy.identicalAcrossParents) {
    score -= 16;
    if (!hierarchy.parentSubtaskRestatement && titleOverlap < 0.72) hardMismatch = true;
  }
  if (progressDistinct) {
    score -= 30;
    reasons.push("newer progress step differs from older task");
    if (titleOverlap < 0.78) hardMismatch = true;
  }
  if (componentDistinct) {
    score -= 28;
    reasons.push("distinct component of broader task");
    if (titleOverlap < 0.7) hardMismatch = true;
  }
  if (sequentialDistinct) {
    score -= 26;
    reasons.push("distinct sequential action");
    if (titleOverlap < 0.65) hardMismatch = true;
  }
  const aiReview = taskDeduplicationAiReviewConfig(settings, options);
  const batchContextMatch = Boolean(options.intraBatch
    && (sameSection || labelOverlap || topicOverlap || peopleOverlap)
    && (titleOverlap >= aiReview.batchTitleOverlap || contextOverlap >= aiReview.batchContextOverlap || sharedTitleTokens.length >= 1 || (labelOverlap && topicOverlap)));
  if (sourceTitleTokens.size >= 3) {
    if (options.intraBatch) {
      if (titleOverlap < 0.1 && contextOverlap < 0.1 && !batchContextMatch) hardMismatch = true;
    } else if (titleOverlap < 0.3 && contextOverlap < 0.25) {
      hardMismatch = true;
    }
  }
  const confidence = Math.max(0, Math.min(100, Math.round(score)));
  return {
    id: candidate.id,
    task: existing,
    candidate,
    confidence,
    titleOverlap,
    contextOverlap,
    projectContextMatch,
    batchContextMatch,
    hierarchyMismatch: hierarchy.mismatch,
    hierarchyCandidate: hierarchy.candidate,
    hardMismatch,
    reasons: reasons.length ? reasons : ["weak local overlap"]
  };
}

function applyTaskDeduplicationMatch(task, decision, settings = DEFAULT_SETTINGS, options = {}) {
  const existing = decision.task || decision.candidate?.task || {};
  task.id = decision.id || existing.id || task.id || "";
  task.oid = task.oid || generateUniqueOid(settings);
  task.labels = mergedTaskLabelsForDeduplication(task.labels || [], existing.labels || [], settings);
  task.priority = normalizePriority(task.priority || existing.priority || 1);
  task.due_date = task.due_date || existing.due_date || "";
  task.deadline_date = task.deadline_date || existing.deadline_date || "";
  task.duration = normalizeTodoistDuration(task.duration) || normalizeTodoistDuration(existing.duration);
  task.description = isRichTodoistDescription(task.description) ? task.description : existing.description || task.description || "";
  task.section = task.section || existing.section || "";
  task.sectionId = task.sectionId || existing.sectionId || "";
  task.projectId = task.projectId || existing.projectId || "";
  task.projectName = task.projectName || existing.projectName || "";
  task.parentId = options.parentTask?.id || task.parentId || existing.parentId || "";
  task.parentOid = options.parentTask?.oid || task.parentOid || existing.parentOid || "";
  task.parentContent = options.parentTask?.content || task.parentContent || existing.parentContent || "";
  task.knowledge = taskKnowledgeSnapshot(task, settings, "", task.knowledge || existing.knowledge || null);
  task.descriptionShouldSync = true;
  task.deduplication = {
    todoistId: task.id,
    confidence: decision.confidence || 0,
    reasons: decision.reasons || []
  };
}

function copyExistingTaskAsDedupedSubtask(candidate, parentTask, settings = DEFAULT_SETTINGS, path = "") {
  const existing = candidate.task || {};
  return {
    id: candidate.id,
    oid: generateUniqueOid(settings),
    path: vaultRelativePath(path || existing.path || ""),
    content: existing.content || "",
    labels: existing.labels || [],
    priority: normalizePriority(existing.priority || 1),
    due_date: existing.due_date || "",
    deadline_date: existing.deadline_date || "",
    duration: normalizeTodoistDuration(existing.duration),
    description: "",
    isSubtask: true,
    parentId: parentTask.id || "",
    parentOid: parentTask.oid || "",
    parentContent: parentTask.content || "",
    section: parentTask.section || existing.section || "",
    sectionId: parentTask.sectionId || existing.sectionId || "",
    projectId: existing.projectId || parentTask.projectId || "",
    projectName: existing.projectName || parentTask.projectName || "",
    knowledge: taskKnowledgeSnapshot(Object.assign({}, existing, {
      parentId: parentTask.id || "",
      parentOid: parentTask.oid || "",
      parentContent: parentTask.content || "",
      path: vaultRelativePath(path || existing.path || "")
    }), settings, "", existing.knowledge || null),
    descriptionShouldSync: false,
    deduplication: {
      todoistId: candidate.id,
      confidence: 100,
      reasons: ["copied existing subtask under matched parent"]
    }
  };
}

function taskDeduplicationMatchSummary(task, decision) {
  return {
    task: truncateAtWord(singleLine(task?.content || ""), 90),
    todoistId: decision.id || "",
    confidence: decision.confidence || 0,
    reasons: (decision.reasons || []).slice(0, 3)
  };
}

function taskDeduplicationCandidateFlag(task = {}, decision = {}, settings = DEFAULT_SETTINGS, options = {}) {
  const existing = decision.task || decision.candidate?.task || {};
  const isGenerated = Boolean(options.intraBatch || decision.candidate?.generatedTask);
  return {
    task: truncateAtWord(singleLine(task.content || ""), 120),
    candidate: truncateAtWord(singleLine(existing.content || ""), 120),
    candidateId: isGenerated ? "" : decision.id || existing.id || "",
    candidateType: isGenerated ? "same task generation batch" : "existing Todoist task",
    confidence: Math.round(decision.confidence || 0),
    reasons: (decision.reasons || []).slice(0, 3),
    projectName: singleLine(task.projectName || existing.projectName || ""),
    section: singleLine(task.section || existing.section || ""),
    parentContent: singleLine(options.parentContent || task.parentContent || existing.parentContent || ""),
    link: !isGenerated && (decision.id || existing.id) ? todoistTaskMarkdownLink(decision.id || existing.id, settings, existing.content || "Open task") : ""
  };
}

function taskDeduplicationCandidateChatMessage(flags = [], options = {}) {
  const source = options.source ? ` from ${options.source}` : "";
  const path = options.path ? `\nSource: ${options.path}` : "";
  const lines = [
    `Possible duplicate tasks were found${source}, but AI-mediated deduplication is off.`,
    "No task merge was applied. Local-only deduplication can be less accurate and less efficient than AI-mediated review, so please manually inspect these candidates and edit Todoist or the generated task list as needed.",
    path,
    ""
  ].filter((line) => line !== "");
  flags.slice(0, 8).forEach((flag, index) => {
    const where = [flag.projectName ? `Project: ${flag.projectName}` : "", flag.section ? `Section: ${flag.section}` : "", flag.parentContent ? `Parent: ${truncateAtWord(flag.parentContent, 80)}` : ""].filter(Boolean).join(" | ");
    lines.push(`${index + 1}. Generated task: ${flag.task || "Untitled task"}`);
    lines.push(`   Possible duplicate: ${flag.link || flag.candidate || "Earlier generated task"} (${flag.candidateType}, local score ${flag.confidence || 0})`);
    if (where) lines.push(`   Context: ${where}`);
    if (flag.reasons?.length) lines.push(`   Local evidence: ${flag.reasons.join("; ")}`);
  });
  if (flags.length > 8) lines.push(`...and ${flags.length - 8} more possible duplicate${flags.length - 8 === 1 ? "" : "s"}.`);
  lines.push("");
  lines.push("To merge automatically next time, turn on AI-mediated deduplication or choose a dedupe model in settings.");
  return lines.join("\n");
}

function mergedTaskLabelsForDeduplication(generated = [], existing = [], settings = DEFAULT_SETTINGS) {
  const generatedLabels = (generated || []).map(cleanLabel).filter(Boolean);
  if (settings.taskDeduplicationMergeLabelsAdditive === false) return generatedLabels;
  return uniqueValues((existing || []).map(cleanLabel).filter(Boolean).concat(generatedLabels));
}

function isExplicitSubtaskRemovalInstruction(task = {}) {
  const text = `${task.content || ""} ${task.description || ""}`.toLowerCase();
  return /\b(no longer needed|not needed|obsolete|remove this subtask|remove subtask|delete this subtask|cancel this subtask)\b/.test(text);
}

function canonicalTaskMatchTitle(value = "") {
  return singleLine(scrubTaskDeduplicationBoilerplate(value))
    .replace(/%%\\[oid::\\s*[^\\]]+\\]%%/gi, " ")
    .replace(/#[\\w/-]+/g, " ")
    .replace(/[📅⏳✅⛔⏫🔼🔽]/g, " ")
    .replace(/\\b(?:due|deadline|priority|section|project)[:=]\\s*\\S+/gi, " ")
    .replace(/\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\\s+/g, " ")
    .trim()
    .toLowerCase();
}

const TASK_DEDUPE_STOP_WORDS = new Set(["the", "and", "for", "with", "from", "this", "that", "task", "tasks", "todo", "action", "item", "items", "note", "notes", "meeting", "review", "follow", "about", "into", "onto", "have", "has", "was", "were", "will", "would", "should", "could", "need", "needs"]);

function taskDedupeTokenSet(text = "") {
  const tokens = String(text || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  return new Set(tokens.map(normalizeTaskDedupeToken).filter((token) => token && !TASK_DEDUPE_STOP_WORDS.has(token)));
}

function normalizeTaskDedupeToken(token = "") {
  const value = String(token || "").toLowerCase();
  if (value.length > 4 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 5 && /(ches|shes|xes|zes|ses)$/.test(value)) return value.slice(0, -2);
  if (value.length > 4 && value.endsWith("s") && !/(ss|us|is)$/.test(value)) return value.slice(0, -1);
  return value;
}

function tokenIntersection(left = new Set(), right = new Set()) {
  const matches = [];
  for (const token of left) if (right.has(token)) matches.push(token);
  return matches;
}

function sameTaskDeduplicationProject(task = {}, existing = {}) {
  if (task.projectId && existing.projectId && String(task.projectId) === String(existing.projectId)) return true;
  const sourceProject = singleLine(task.projectName || "").toLowerCase();
  const existingProject = singleLine(existing.projectName || "").toLowerCase();
  return Boolean(sourceProject && existingProject && sourceProject === existingProject);
}

function isGenericTodoistInboxTask(task = {}) {
  return Boolean(task?.isInbox || singleLine(task.projectName || "").toLowerCase() === "inbox");
}

function differentConcreteTaskDeduplicationProject(task = {}, existing = {}) {
  if (isGenericTodoistInboxTask(task) || isGenericTodoistInboxTask(existing)) return false;
  if (task.projectId && existing.projectId && String(task.projectId) !== String(existing.projectId)) return true;
  const sourceProject = singleLine(task.projectName || "").toLowerCase();
  const existingProject = singleLine(existing.projectName || "").toLowerCase();
  return Boolean(sourceProject && existingProject && sourceProject !== existingProject);
}

function sameTaskDeduplicationSection(task = {}, existing = {}) {
  if (task.sectionId && existing.sectionId && String(task.sectionId) === String(existing.sectionId)) return true;
  const sourceSection = singleLine(task.section || "").toLowerCase();
  const existingSection = singleLine(existing.section || "").toLowerCase();
  return Boolean(sourceSection && existingSection && sourceSection === existingSection);
}

function tokenDiceScore(left = new Set(), right = new Set()) {
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function tokenOverlapCount(left = [], right = []) {
  const rightTokens = new Set((right || []).map((item) => canonicalTaskMatchTitle(item)).filter(Boolean));
  let count = 0;
  for (const item of left || []) if (rightTokens.has(canonicalTaskMatchTitle(item))) count += 1;
  return count;
}

function taskDeduplicationHierarchySignal(task = {}, existing = {}, options = {}, metrics = {}) {
  const sourceIsSubtask = Boolean(options.isSubtask || task.isSubtask || task.parentId || task.parentContent);
  const existingIsSubtask = Boolean(existing.isSubtask || existing.parentId || existing.parentContent);
  const sourceParentId = String(options.parentId || task.parentId || "");
  const existingParentId = String(existing.parentId || "");
  const sameParent = Boolean(sourceParentId && existingParentId && sourceParentId === existingParentId);
  const differentParent = Boolean(sourceIsSubtask && existingIsSubtask && sourceParentId && existingParentId && sourceParentId !== existingParentId);
  const crossHierarchy = sourceIsSubtask !== existingIsSubtask;
  const sourceTitleTokens = taskDedupeTokenSet(task?.content || "");
  const existingTitleTokens = taskDedupeTokenSet(existing.content || "");
  const sourceParentOverlap = tokenDiceScore(taskDedupeTokenSet([task.parentContent || options.parentContent || "", task.parentDescription || ""].join(" ")), existingTitleTokens);
  const existingParentOverlap = tokenDiceScore(taskDedupeTokenSet([existing.parentContent || "", existing.parentDescription || ""].join(" ")), sourceTitleTokens);
  const parentSubtaskRestatement = Boolean(crossHierarchy && (
    (metrics.titleOverlap || 0) >= 0.58 ||
    (metrics.contextOverlap || 0) >= 0.56 ||
    sourceParentOverlap >= 0.62 ||
    existingParentOverlap >= 0.62
  ) && (metrics.sharedTitleTokens || []).length >= 2);
  const identicalAcrossParents = Boolean(differentParent && (metrics.titleOverlap || 0) >= 0.9);
  const hierarchyMismatch = Boolean(crossHierarchy || differentParent);
  const hierarchyCandidate = Boolean(parentSubtaskRestatement || identicalAcrossParents || (!hierarchyMismatch && !differentParent));
  return {
    sourceIsSubtask,
    existingIsSubtask,
    crossHierarchy,
    sameParent,
    differentParent,
    parentSubtaskRestatement,
    identicalAcrossParents,
    mismatch: hierarchyMismatch,
    candidate: hierarchyCandidate
  };
}

function taskDeduplicationProgressDistinct(task = {}, existing = {}, metrics = {}) {
  if ((metrics.titleOverlap || 0) >= 0.8) return false;
  const sourceRaw = [task.content, task.description].filter(Boolean).join(" ");
  const targetRaw = [existing.content, existing.description].filter(Boolean).join(" ");
  const source = canonicalTaskMatchTitle(sourceRaw);
  const target = canonicalTaskMatchTitle(targetRaw);
  const progressSpecific = /\b(edits?|comments?|returned|minor comment|approval|approve|review and approve|current status|status update|currently with|where they sit|decision points?|outstanding)\b/i;
  const broadStatus = /\b(currently with|where they sit|status|decision points?|outstanding|advance them|check status|project status|concept notes?|broader|overall)\b/i;
  const oneSpecific = progressSpecific.test(source) || progressSpecific.test(target);
  const oneBroad = broadStatus.test(source) || broadStatus.test(target);
  if (!oneSpecific || !oneBroad) return false;
  const sourceNames = taskDedupeNameTokens(sourceRaw);
  const targetNames = taskDedupeNameTokens(targetRaw);
  const sharedNames = tokenIntersection(sourceNames, targetNames);
  const hasDifferentNamedProgress = sourceNames.size && targetNames.size && !sharedNames.length;
  return Boolean(hasDifferentNamedProgress || (metrics.contextOverlap || 0) < 0.62);
}

function taskDeduplicationComponentDistinct(task = {}, existing = {}, metrics = {}) {
  if ((metrics.titleOverlap || 0) >= 0.7) return false;
  const source = canonicalTaskMatchTitle([task.content, task.description, task.parentContent, task.parentDescription].filter(Boolean).join(" "));
  const target = canonicalTaskMatchTitle([existing.content, existing.description, existing.parentContent, existing.parentDescription].filter(Boolean).join(" "));
  const sourceTitle = canonicalTaskMatchTitle(task.content || "");
  const targetTitle = canonicalTaskMatchTitle(existing.content || "");
  const sourceChild = canonicalTaskMatchTitle([task.childText, task.parentChildText, task.siblingText, taskDeduplicationSubtaskText(task)].filter(Boolean).join(" "));
  const targetChild = canonicalTaskMatchTitle([existing.childText, existing.parentChildText, existing.siblingText, taskDeduplicationSubtaskText(existing)].filter(Boolean).join(" "));
  const broad = /\b(prepare questions?|prepare question|plan|coordinate|organize|list|identify|decisions?|decision|multiple|several|package|process)\b/i;
  const specific = /\b(ask|approve|send|confirm|book|draft|review|revise|finalize|provide)\b/i;
  const oneBroad = broad.test(source) || broad.test(target);
  const oneSpecific = specific.test(source) || specific.test(target);
  const childMentionsOther = (sourceChild && targetTitle && sourceChild.includes(targetTitle)) || (targetChild && sourceTitle && targetChild.includes(sourceTitle));
  return Boolean(oneBroad && oneSpecific && childMentionsOther);
}

function taskDeduplicationSequentialActionDistinct(task = {}, existing = {}, metrics = {}) {
  if ((metrics.titleOverlap || 0) >= 0.65) return false;
  const source = canonicalTaskMatchTitle([task.content, task.description, task.parentContent, task.parentDescription].filter(Boolean).join(" "));
  const target = canonicalTaskMatchTitle([existing.content, existing.description, existing.parentContent, existing.parentDescription].filter(Boolean).join(" "));
  const reviewFirst = /\b(review|check|identify|list|determine|which|select|assess|evaluate)\b/i;
  const sendLater = /\b(send|issue|deliver|submit|publish|notify|confirming status|letter|letters|forms)\b/i;
  const sourceReviewTargetSend = reviewFirst.test(source) && sendLater.test(target);
  const targetReviewSourceSend = reviewFirst.test(target) && sendLater.test(source);
  return Boolean((sourceReviewTargetSend || targetReviewSourceSend) && (metrics.contextOverlap || 0) < 0.62);
}

function taskDedupeNameTokens(text = "") {
  const words = String(text || "").match(/\b[A-Z][a-z][A-Za-z'-]*\b/g) || [];
  return new Set(words.map((word) => canonicalTaskMatchTitle(word)).filter((word) => word.length > 2 && !TASK_DEDUPE_STOP_WORDS.has(word)));
}

function taskDeduplicationContextText(task = {}) {
  const knowledge = task.knowledge || {};
  return scrubTaskDeduplicationBoilerplate([
    task.content,
    task.description,
    task.parentContent,
    task.parentDescription,
    task.childText,
    task.parentChildText,
    task.siblingText,
    taskDeduplicationSubtaskText(task),
    task.section,
    task.projectName,
    (task.labels || []).join(" "),
    knowledge.intent,
    knowledge.rationale,
    knowledge.problem,
    knowledge.outcome,
    knowledge.dependency,
    knowledge.nextStep,
    knowledge.evidence,
    (knowledge.people || []).join(" "),
    (knowledge.topics || []).join(" ")
  ].filter(Boolean).join(" "));
}

function taskDeduplicationSubtaskText(task = {}) {
  return (task.subtasks || [])
    .map((subtask) => [subtask?.content, subtask?.description].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" ");
}

function taskDeduplicationSourceContextText(options = {}) {
  const lines = ["Source and note context for AI-mediated deduplication:"];
  if (options.source) lines.push(`Workflow: ${options.source}`);
  if (options.path) lines.push(`Source path: ${options.path}`);
  if (options.sectionName) lines.push(`Generated Todoist section: ${options.sectionName}`);
  const noteLines = (options.contextNotes || []).slice(0, 5).map((note) => {
    const title = note.title || note.path || "Context note";
    const path = note.path ? ` (${note.path})` : "";
    const excerpt = note.excerpt || note.summary || note.text || "";
    return `- ${singleLine(title)}${path}${excerpt ? `: ${truncateAtWord(scrubTaskDeduplicationBoilerplate(singleLine(excerpt)), 260)}` : ""}`;
  });
  if (noteLines.length) lines.push("Relevant notes:", ...noteLines);
  const semanticLines = (options.semanticContext || []).slice(0, 5).map((chunk) => {
    const path = chunk.path || chunk.file || chunk.title || "Context";
    const text = chunk.text || chunk.content || chunk.chunk || "";
    return `- ${singleLine(path)}${text ? `: ${truncateAtWord(scrubTaskDeduplicationBoilerplate(singleLine(text)), 320)}` : ""}`;
  });
  if (semanticLines.length) lines.push("Relevant semantic context:", ...semanticLines);
  return lines.join("\n");
}

function taskDeduplicationAiTaskCard(task = {}) {
  const knowledge = task.knowledge || {};
  return [
    `Title: ${scrubTaskDeduplicationBoilerplate(task.content || "")}`,
    `Description: ${truncateAtWord(scrubTaskDeduplicationBoilerplate(task.description || ""), 900)}`,
    `Intent: ${scrubTaskDeduplicationBoilerplate(knowledge.intent || "")}`,
    `Rationale: ${scrubTaskDeduplicationBoilerplate(knowledge.rationale || "")}`,
    `People: ${(knowledge.people || []).join(", ")}`,
    `Topics: ${(knowledge.topics || []).join(", ")}`,
    `Parent: ${task.parentContent || ""}`,
    `Parent description: ${truncateAtWord(scrubTaskDeduplicationBoilerplate(task.parentDescription || ""), 500)}`,
    `Related parent/sibling/subtask context: ${truncateAtWord(scrubTaskDeduplicationBoilerplate([task.parentChildText, task.siblingText, task.childText, taskDeduplicationSubtaskText(task)].filter(Boolean).join(" ")), 700)}`,
    `Project: ${task.projectName || ""}`,
    `Section: ${task.section || ""}`,
    `Labels: ${(task.labels || []).join(", ")}`,
    `Due: ${task.due_date || ""}`,
    `Deadline: ${task.deadline_date || ""}`
  ].join("\n");
}

function scrubTaskDeduplicationBoilerplate(text = "") {
  return String(text || "")
    .replace(/\b\S*reply[-_\s]?to\S*\b/gi, " ")
    .replace(/\b(?:cc|copy|keep|include)\s+(?:the\s+)?(?:reply[-_\s]?to|tracking|ticket|mailbox|inbox)\s+(?:address|alias|mailbox|email)?\b/gi, " ")
    .replace(/\b(?:so|to ensure)\s+(?:records?|tickets?|emails?)\s+(?:are|is)\s+(?:captured|tracked|logged)\b/gi, " ")
    .replace(/\bunique\s+(?:email|mailbox|reply[-\s]?to|tracking)\s+(?:address|alias)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value) {
  const parts = String(value).split("-").map((part) => part.padStart(2, "0"));
  if (parts[0].length === 2) parts[0] = `20${parts[0]}`;
  return `${parts[0]}-${parts[1]}-${parts[2]}`;
}

function makeSectionName(receivedAt, subject) {
  const date = new Date(receivedAt || Date.now());
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const topic = String(subject || "No_Subject").replace(/^(re|fw|fwd):\s*/gi, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 70) || "No_Subject";
  return `Email_${yy}_${mm}_${dd}_${topic}`;
}

function emailTaskNoteTitle(receivedAt, subject) {
  const date = new Date(receivedAt || Date.now());
  const datePart = Number.isFinite(date.getTime()) ? deviceDateString(date) : today();
  const topic = safeMarkdownFileName(String(subject || "No Subject").replace(/^(re|fw|fwd):\s*/gi, ""), 110) || "No Subject";
  return `${datePart} - ${topic}`;
}

function safeMarkdownFileName(value, maxLength = 120) {
  return singleLine(value)
    .replace(/[\\/#^[\]|:?*<>"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .replace(/[. ]+$/g, "");
}

function uniqueMarkdownPath(app, folder, title) {
  const base = safeMarkdownFileName(title, 150) || "Untitled";
  let path = `${folder}/${base}.md`;
  let counter = 2;
  while (app.vault.getAbstractFileByPath(path)) {
    path = `${folder}/${base} ${counter}.md`;
    counter += 1;
  }
  return path;
}

function makeNoteSectionName(title, text = "", path = "") {
  const noteDate = extractNoteDate(title, text, path);
  const datePart = noteDate ? `_${noteDate.slice(2, 4)}_${noteDate.slice(5, 7)}_${noteDate.slice(8, 10)}` : "";
  const topicSource = String(title || "Note")
    .replace(/^\d{4}-\d{2}-\d{2}\s*[-–—:]\s*/i, "")
    .replace(/^[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*[-–—:]\s*/i, "");
  const topic = topicSource.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 70) || "Note";
  return `Notes${datePart}_${topic}`;
}

function cleanGeneratedSectionName(value) {
  const text = singleLine(value || "")
    .replace(/^section(?:\s+name|\s+title)?\s*:\s*/i, "")
    .replace(/^#+\s*/, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return truncateAtWord(text || "Tasks", 120).replace(/\s+/g, "_");
}

function extractNoteDate(title, text, path) {
  const source = `${title || ""}\n${path || ""}\n${String(text || "").slice(0, 500)}`;
  const iso = /(?:created:\s*\[?"?|^|\D)(\d{4})-(\d{2})-(\d{2})/im.exec(source);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const month = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i.exec(source);
  if (month) {
    const index = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].indexOf(month[1].toLowerCase()) + 1;
    return `${month[3]}-${String(index).padStart(2, "0")}-${String(month[2]).padStart(2, "0")}`;
  }
  return "";
}

function extractOutputText(response) {
  const parts = [];
  for (const item of response.output || []) for (const content of item.content || []) if (content.type === "output_text" && content.text) parts.push(content.text);
  return parts.join("\n");
}

function extractGeminiText(response) {
  const parts = [];
  for (const candidate of response?.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.text) parts.push(part.text);
    }
  }
  return parts.join("\n").trim();
}

function extractJsonPayload(text) {
  let value = String(text || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    JSON.parse(value);
    return value;
  } catch {}
  const start = value.search(/[\[{]/);
  if (start < 0) return value;
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < value.length; i += 1) {
    const char = value[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
    else if (char === "}" || char === "]") {
      if (stack.pop() !== char) break;
      if (!stack.length) {
        const candidate = value.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          break;
        }
      }
    }
  }
  return value;
}

function nextBusinessDate(daysAhead) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  let added = 0;
  while (added < Math.max(1, daysAhead || 1)) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    added += 1;
  }
  return deviceDateString(date);
}

function elapsedMs(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Date.now() - time;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function idlePause(timeoutMs = 50) {
  return new Promise((resolve) => {
    if (typeof window?.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: Math.max(50, timeoutMs) });
      return;
    }
    window.setTimeout(resolve, timeoutMs);
  });
}
