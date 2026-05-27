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
  requestUrl
} = require("obsidian");

const VIEW_TYPE = "semantic-todoist-sync-view";
const TODOIST_API = "https://api.todoist.com/api/v1";
const SEMANTIC_INDEX_FILE = "semantic-index.json";
const OPENAI_SEMANTIC_INDEX_FILE = "semantic-index.openai.json";
const GEMINI_SEMANTIC_INDEX_FILE = "semantic-index.gemini.json";
const TODOIST_DESCRIPTION_LIMIT = 16000;
const DEFAULT_TASK_HEADING = "## Semantic Todoist Sync - Action Items";
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
  chatModel: "gemini/gemini-3.5-flash",
  chatMode: "Vault QA",
  embeddingModel: "gemini/gemini-embedding-2",
  availableChatModels: [],
  availableEmbeddingModels: [],
  availableGeminiModels: ["gemini-3.5-flash", "gemini-2.5-flash"],
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
  indexedFolders: "",
  excludedFolders: "Semantic Todoist Sync/Email-To-Todoist",
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
  todoistSnapshotCacheMinutes: 5,
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
  emailPollIntervalSeconds: 60,
  lastEmailPollAt: "",
  localLog: [],
  maxEmailChars: 18000,
  maxNoteChars: 22000,
  maxGeneratedMainTasks: 10,
  maxGeneratedSubtasksPerMainTask: 4,
  todoistDescriptionMaxChars: 8000,
  emailLogFolder: "Semantic Todoist Sync/Email-To-Todoist",
  promptTemplatesFolder: "Semantic Todoist Sync/Prompts",
  taskGenerationPromptTemplate: "Generate Todoist task list",
  chatFontSizePx: 13,
  insertGeneratedTasksIntoNote: true,
  syncAfterInsertingGeneratedTasks: true,
  obsidianTasksDateOrder: true,
  taskContextSummaryMaxNotes: 5,
  excludedLinkDomains: "",
  builtInPromptTemplates: [
    {
      name: "Generate Todoist task list",
      prompt: "Scan the active note or selected text and generate a Todoist-ready task list. Use the shared task instructions. Include clear main tasks and subtasks only when they are actionable.",
      mode: "tasks",
      createTasks: true,
      taskGenerationTemplate: true
    },
    {
      name: "Extract follow-ups only",
      prompt: "Scan the active note or selected text and generate only follow-up tasks. Apply the FollowUp tag rules and include enough context to act.",
      mode: "tasks",
      createTasks: true,
      taskGenerationTemplate: true
    }
  ],
  mainTaskInstructions: "Review the tasks that are required to be actioned or completed. Create a detailed list of tasks with brief context for each. Each task should be no longer than 250 characters. Do not group unrelated items under one main task. Main tasks and subtasks should refer to the same project or program.",
  subtaskInstructions: "Create subtasks only when they are required. Subtasks should be clear actionable items, not background information.",
  sectionTitleInstructions: "Create one Todoist section for all tasks from the same source. For Notes-To-Todoist, use Notes_YY_MM_DD_Subject based on the note date and note subject. For Email-To-Todoist, use Email_YY_MM_DD_Subject based on the email received date and email subject.",
  dateInstructions: "Determine a task completion deadline and a due date for each main task based on urgency, priority, and complexity. Do not add due dates to subtasks. Avoid weekends and the holidays that apply to the user's locale.",
  tagInstructions: "Only create Todoist labels that are explicitly named in these instructions. Add labels only when the source content clearly matches a configured rule.",
  priorityInstructions: "Assign priority 1 to 4 to each task and subtask, where 4 is highest priority and 1 is no priority.",
  descriptionInstructions: "Include the source subject or note title and useful context in the Todoist description. Include directly relevant referenced links or files only when they are available and not excluded by settings. Do not mention whether links or linked files were found or missing. Separate details with periods. Do not include preamble.",
  emailMainTaskInstructions: "Review the email chain and identify only items that clearly require my action, follow-up, review, decision, or completion. Exclude informational updates, vague possibilities, and tasks owned by others unless I need to follow up on them. Create detailed Todoist tasks that preserve enough email context to act without rereading the full thread.",
  emailSubtaskInstructions: "Create email subtasks only for concrete steps required to complete the parent task. Do not create subtasks for background details, simple reminders, or loosely related information.",
  emailSectionTitleInstructions: "Create one Todoist section for all tasks from the same email using Email_YY_MM_DD_Subject based on the email received date and subject.",
  emailDateInstructions: "Determine due dates and deadlines from the email's urgency, stated dates, complexity, and sender expectations. Avoid weekends and the holidays that apply to the user's locale. Do not add due dates to subtasks.",
  emailTagInstructions: "Only create Todoist labels explicitly named here. Suggested starter rule: create tasks for follow-up items and add #FollowUp. Add more label rules in plain language for your own people, teams, or projects.",
  emailPriorityInstructions: "Assign priority 1 to 4 to each email-derived task and subtask, where 4 is highest priority and 1 is no priority.",
  emailDescriptionInstructions: "Include the email subject, concise thread context, and useful vault context in the Todoist description. Include directly relevant referenced links or files only when they are available and not excluded by settings. Do not mention whether links or linked files were found or missing. Separate details with periods. Do not include preamble.",
  noteMainTaskInstructions: "Review the active note or selected note text and identify only items that clearly require my action, follow-up, review, decision, or completion. Strongly prioritize items I manually marked with #todo and nearby context. Exclude informational discussion, ideas owned by others, vague possibilities, and simple reminders unless the note indicates I need to act or follow up. Create detailed Todoist tasks that reflect the note's current state.",
  noteSubtaskInstructions: "Create note subtasks only for concrete steps required to complete the parent task. Do not create subtasks for background details, simple reminders, or loosely related information.",
  noteSectionTitleInstructions: "Create one Todoist section for all tasks from the same note using Notes_YY_MM_DD_Subject based on the note date and note subject.",
  noteDateInstructions: "Determine due dates and deadlines from the note's timing, urgency, complexity, and any explicit dates. Avoid weekends and the holidays that apply to the user's locale. Do not add due dates to subtasks.",
  noteTagInstructions: "Only create Todoist labels explicitly named here. Suggested starter rule: create tasks for follow-up items and add #FollowUp. Add more label rules in plain language for your own people, teams, or projects.",
  notePriorityInstructions: "Assign priority 1 to 4 to each note-derived task and subtask, where 4 is highest priority and 1 is no priority.",
  noteDescriptionInstructions: "Include the source note title, concise note context, and useful vault context in the Todoist description. Include directly relevant referenced links or files only when they are available and not excluded by settings. Do not mention whether links or linked files were found or missing. Separate details with periods. Do not include preamble."
};

module.exports = class SemanticTodoistSyncPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.queryEmbeddingCache = new Map();
    await this.migrateSettings();
    await this.ensureCompatibleEmbeddingForChatModel();
    await this.loadSemanticIndex();
    await this.ensurePromptTemplateFolder(false);
    this.pendingIndexPaths = new Set();
    this.syncInProgress = false;
    this.emailProcessingInProgress = false;
    this.semanticIndexInProgress = false;
    this.internalNoteWriteUntil = new Map();
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
    this.addCommand({ id: "semantic-todoist-sync-notes", name: "Sync note tasks with Todoist", callback: () => this.syncNoteTasks() });
    this.addCommand({ id: "semantic-todoist-rebuild-references", name: "Rebuild local Todoist reference table", callback: () => this.rebuildTodoistReferenceTable(true) });

    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.handleActiveLeafChange(leaf)));
    this.registerEvent(this.app.workspace.on("file-open", () => this.notifySidebarActiveNoteChanged()));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.queueSemanticIndexUpdate(file.path);
      if (this.settings.notesAutoSync && this.settings.todoistToken && !this.isInternalNoteWrite(file.path)) this.queueNoteSync(file.path);
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && file.extension === "md") this.queueSemanticIndexUpdate(file.path);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile && file.extension === "md") this.removePathFromSemanticIndex(file.path);
    }));

    this.registerInterval(window.setInterval(() => this.backgroundTick(), 30000));
    window.setTimeout(() => this.backgroundTick(), 5000);
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async migrateSettings() {
    let changed = false;
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
    if (!this.settings.chatModel || this.settings.chatModel === "gpt-5.4-mini") {
      this.settings.chatModel = DEFAULT_SETTINGS.chatModel;
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
    if (!this.settings.excludedFolders || this.settings.excludedFolders === "Email-To-Todoist") {
      this.settings.excludedFolders = DEFAULT_SETTINGS.excludedFolders;
      changed = true;
    } else if (splitList(this.settings.excludedFolders).includes("Email-To-Todoist")) {
      const folders = splitList(this.settings.excludedFolders).map((folder) => folder === "Email-To-Todoist" ? DEFAULT_SETTINGS.emailLogFolder : folder);
      this.settings.excludedFolders = Array.from(new Set(folders)).join(", ");
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
    for (const [key, [oldValue, newValue]] of Object.entries(descriptionUpdates)) {
      if (this.settings[key] === oldValue) {
        this.settings[key] = newValue;
        changed = true;
      }
    }
    const validTaskCache = {};
    for (const [todoistId, task] of Object.entries(this.settings.taskCache || {})) {
      if (task?.oid) validTaskCache[todoistId] = task;
      else changed = true;
    }
    this.settings.taskCache = validTaskCache;
    const validPendingReferences = {};
    for (const [key, reference] of Object.entries(this.settings.pendingTaskReferences || {})) {
      if (reference?.oid) validPendingReferences[key] = reference;
      else changed = true;
    }
    this.settings.pendingTaskReferences = validPendingReferences;
    if (changed) await this.saveSettings();
  }

  async loadSemanticIndex() {
    this.semanticIndex = [];
    const indexFile = this.semanticIndexFileName();
    this.semanticIndexStats = { bytes: 0, path: indexFile };
    try {
      const raw = await this.app.vault.adapter.read(`${this.manifest.dir}/${indexFile}`);
      this.semanticIndexStats.bytes = raw.length;
      const parsed = JSON.parse(raw);
      this.semanticIndex = parsed.chunks || [];
      this.settings.semanticIndexMeta = Object.assign({}, parsed.meta || {}, { chunks: this.semanticIndex.length, file: indexFile });
    } catch (error) {
      if (usesOpenAIEmbeddingModel(this.settings.embeddingModel) && indexFile !== SEMANTIC_INDEX_FILE) {
        try {
          const raw = await this.app.vault.adapter.read(`${this.manifest.dir}/${SEMANTIC_INDEX_FILE}`);
          this.semanticIndexStats = { bytes: raw.length, path: SEMANTIC_INDEX_FILE };
          const parsed = JSON.parse(raw);
          this.semanticIndex = parsed.chunks || [];
          this.settings.semanticIndexMeta = Object.assign({}, parsed.meta || {}, { chunks: this.semanticIndex.length, file: SEMANTIC_INDEX_FILE, legacy: true });
        } catch {}
      }
      if (!this.semanticIndex.length && Array.isArray(this.settings.semanticIndex) && this.settings.semanticIndex.length) {
        this.semanticIndex = this.settings.semanticIndex;
        delete this.settings.semanticIndex;
        await this.saveSemanticIndex();
      }
    }
    if (!this.semanticIndex.length) {
      this.settings.semanticIndexMeta = {
        model: this.settings.embeddingModel,
        provider: usesGeminiEmbeddingModel(this.settings.embeddingModel) ? "gemini" : "openai",
        file: indexFile,
        chunks: 0
      };
    }
    if (Array.isArray(this.settings.semanticIndex)) delete this.settings.semanticIndex;
    await this.saveSettings();
  }

  async saveSemanticIndex() {
    const indexFile = this.semanticIndexFileName();
    const body = JSON.stringify({
      meta: Object.assign({}, this.settings.semanticIndexMeta || {}, {
        model: this.settings.embeddingModel,
        provider: usesGeminiEmbeddingModel(this.settings.embeddingModel) ? "gemini" : "openai",
        file: indexFile
      }),
      chunks: this.semanticIndex || []
    });
    await this.app.vault.adapter.write(`${this.manifest.dir}/${indexFile}`, body);
    this.semanticIndexStats = { bytes: body.length, path: indexFile };
  }

  semanticIndexFileName(model = this.settings.embeddingModel) {
    return usesGeminiEmbeddingModel(model) ? GEMINI_SEMANTIC_INDEX_FILE : OPENAI_SEMANTIC_INDEX_FILE;
  }

  async purgeSemanticIndex(showNotice = true) {
    const indexFile = this.semanticIndexFileName();
    try {
      await this.app.vault.adapter.remove(`${this.manifest.dir}/${indexFile}`);
    } catch {}
    this.semanticIndex = [];
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
    if (showNotice) new Notice(`Purged semantic index: ${indexFile}`);
  }

  async ensureCompatibleEmbeddingForChatModel() {
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
      await this.loadSemanticIndex();
      await this.saveSettings();
    }
  }

  async setChatModel(value) {
    this.settings.chatModel = value;
    await this.ensureCompatibleEmbeddingForChatModel();
    await this.saveSettings();
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

  backgroundTick() {
    const now = Date.now();
    if (this.settings.autoProcessEmails && this.settings.workerUrl && this.settings.workerToken && elapsedMs(this.settings.lastEmailPollAt) >= Math.max(30, this.settings.emailPollIntervalSeconds) * 1000) {
      this.processPendingEmails(false);
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
    this.saveSettings().catch((error) => console.error("Semantic Todoist local log save failed", error));
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
    }, {
      insertIntoNote: this.settings.insertGeneratedTasksIntoNote,
      syncAfterInsert: this.settings.syncAfterInsertingGeneratedTasks
    }).open();
  }

  queueNoteSync(path) {
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

  queueSemanticIndexUpdate(path) {
    if (!this.settings.autoUpdateSemanticIndex || !this.isIndexablePath(path)) return;
    if (!aiAccessConfigured(this.settings)) return;
    this.pendingIndexPaths.add(path);
    window.clearTimeout(this.semanticIndexTimer);
    this.semanticIndexTimer = window.setTimeout(() => this.flushSemanticIndexUpdates(), Math.max(5, this.settings.semanticIndexDelaySeconds) * 1000);
    this.refreshSidebarStatus();
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
        const text = await this.app.vault.cachedRead(selected);
        return { title: selected.basename, path: selected.path, text, selection: "" };
      }
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView) ||
      (this.lastActiveMarkdownLeaf?.view instanceof MarkdownView ? this.lastActiveMarkdownLeaf.view : null);
    const file = view?.file;
    if (!view || !file) return { title: "", path: "", text: "", selection: "" };
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
    const previousIndex = this.semanticIndex || [];
    const previousMeta = Object.assign({}, this.settings.semanticIndexMeta || {});
    const startedAt = Date.now();
    this.setSidebarStatus("Indexing vault...");
    try {
      await this.ensureCompatibleEmbeddingForChatModel();
      this.requireAiAccess();
      const files = this.getIndexableFiles();
      if (!files.length) throw new Error("No indexable Markdown notes were found. Check Indexed folders and Excluded folders in settings.");
      const chunks = [];
      for (const file of files) {
        const text = await this.app.vault.cachedRead(file);
        const fileChunks = chunkMarkdown(text, this.settings.semanticIndexMaxChunkChars, this.settings.semanticIndexMaxChunksPerNote);
        for (let index = 0; index < fileChunks.length; index += 1) {
          chunks.push({ id: `${file.path}#${index}`, path: file.path, title: file.basename, text: fileChunks[index], modifiedAt: file.stat?.mtime || 0 });
        }
      }
      if (!chunks.length) throw new Error("No indexable note text was found. The existing semantic index was left unchanged.");

      const indexed = [];
      for (let i = 0; i < chunks.length; i += this.settings.embeddingBatchSize) {
        const batch = chunks.slice(i, i + this.settings.embeddingBatchSize);
        const embeddings = await this.embedTexts(batch.map((chunk) => `${chunk.title}\n${chunk.text}`), "document");
        for (let j = 0; j < batch.length; j += 1) {
          indexed.push(Object.assign({}, batch[j], { embedding: compactEmbedding(embeddings[j], this.settings.semanticIndexEmbeddingPrecision) }));
        }
      }

      this.semanticIndex = indexed;
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
      this.logLocal("Semantic index rebuilt", { files: files.length, chunks: indexed.length, ms: Date.now() - startedAt });
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

  hasUsableSemanticIndex() {
    const meta = this.settings.semanticIndexMeta || {};
    return Boolean((this.semanticIndex || []).length && Number(meta.chunks || 0) > 0 && meta.rebuiltAt);
  }

  getSyncableTaskFiles() {
    const exclude = splitList(this.settings.excludedFolders).map(trimSlashes);
    return this.app.vault.getMarkdownFiles().filter((file) => {
      if (exclude.some((folder) => file.path === folder || file.path.startsWith(`${folder}/`))) return false;
      return true;
    });
  }

  isIndexablePath(path, include, exclude) {
    const includeFolders = include || splitList(this.settings.indexedFolders).map(trimSlashes);
    const excludeFolders = exclude || splitList(this.settings.excludedFolders).map(trimSlashes);
    if (path.startsWith(`${this.settings.emailLogFolder}/`)) return false;
    if (includeFolders.length && !includeFolders.some((folder) => path === folder || path.startsWith(`${folder}/`))) return false;
    if (excludeFolders.some((folder) => path === folder || path.startsWith(`${folder}/`))) return false;
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
      for (const path of paths) await this.reindexFile(path);
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
      this.logLocal("Semantic index updated", { files: paths.length, chunks: this.settings.semanticIndexMeta.chunks });
    } catch (error) {
      console.error(error);
      this.logLocal("Semantic index update failed", { error: error.message || String(error) });
    } finally {
      this.semanticIndexInProgress = false;
      this.setSidebarStatus("Ready");
    }
  }

  async reindexFile(path) {
    this.removePathFromSemanticIndex(path, false);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || !this.isIndexablePath(path)) return;
    this.requireAiAccess();
    const text = await this.app.vault.cachedRead(file);
    const chunks = chunkMarkdown(text, this.settings.semanticIndexMaxChunkChars, this.settings.semanticIndexMaxChunksPerNote)
      .map((chunk, index) => ({ id: `${path}#${index}`, path, title: file.basename, text: chunk, modifiedAt: file.stat?.mtime || 0 }));
    for (let i = 0; i < chunks.length; i += this.settings.embeddingBatchSize) {
      const batch = chunks.slice(i, i + this.settings.embeddingBatchSize);
      const embeddings = await this.embedTexts(batch.map((chunk) => `${chunk.title}\n${chunk.text}`), "document");
      for (let j = 0; j < batch.length; j += 1) {
        this.semanticIndex.push(Object.assign({}, batch[j], { embedding: compactEmbedding(embeddings[j], this.settings.semanticIndexEmbeddingPrecision) }));
      }
    }
  }

  async removePathFromSemanticIndex(path, save = true) {
    const before = (this.semanticIndex || []).length;
    this.semanticIndex = (this.semanticIndex || []).filter((chunk) => chunk.path !== path);
    if (save && before !== this.semanticIndex.length) {
      this.settings.semanticIndexMeta = Object.assign({}, this.settings.semanticIndexMeta, {
        updatedAt: deviceTimestamp(),
        chunks: this.semanticIndex.length
      });
      await this.saveSemanticIndex();
      await this.saveSettings();
    }
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
    const embeddings = [];
    for (const text of texts) {
      const body = { content: { parts: [{ text: geminiEmbeddingInput(text, role, model) }] } };
      if (model === "gemini-embedding-001") body.taskType = role === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
      const response = await this.geminiEmbeddingRequest(model, body);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Gemini embeddings returned ${response.status}: ${redactSecrets(response.text)}`);
      }
      embeddings.push(response.json?.embedding?.values || []);
    }
    return embeddings;
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
    const index = this.semanticIndex || [];
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
    const semanticCandidates = index
      .map((chunk) => {
        const semantic = cosine(queryEmbedding, chunk.embedding);
        const lexical = lexicalScore(queryTerms, `${chunk.title} ${chunk.path} ${chunk.text}`);
        const title = lexicalScore(queryTerms, `${chunk.title} ${chunk.path}`);
        const recency = recencyBoost(chunk.modifiedAt);
        return { chunk, semantic, lexical, title, recency };
      })
      .sort((a, b) => contextCandidateScore(b) - contextCandidateScore(a))
      .slice(0, poolSize);
    const lexicalCandidates = this.lexicalContextCandidates(query, poolSize);
    const candidates = mergeContextCandidates(semanticCandidates, lexicalCandidates)
      .sort((a, b) => contextCandidateScore(b) - contextCandidateScore(a));
    return diversifyContextCandidates(candidates, limit).map((item) => annotateContextChunk(item));
  }

  retrieveLexicalContext(query, limit) {
    return this.lexicalContextCandidates(query, limit).slice(0, limit).map((item) => annotateContextChunk(item));
  }

  lexicalContextCandidates(query, limit) {
    const chunks = this.semanticIndex || [];
    const queryTerms = termCounts(query);
    return chunks
      .map((chunk) => {
        const lexical = lexicalScore(queryTerms, `${chunk.title} ${chunk.path} ${chunk.text}`);
        const title = lexicalScore(queryTerms, `${chunk.title} ${chunk.path}`);
        const recency = recencyBoost(chunk.modifiedAt);
        return { chunk, semantic: 0, lexical, title, recency };
      })
      .filter((item) => item.lexical > 0 || item.title > 0)
      .sort((a, b) => contextCandidateScore(b) - contextCandidateScore(a))
      .slice(0, Math.max(limit, 1));
  }

  async buildTaskContext(active, chunks, query = "") {
    const byPath = new Map();
    if (active?.path) byPath.set(active.path, active.text || "");
    for (const chunk of chunks || []) {
      if (!chunk.path || byPath.has(chunk.path)) continue;
      const file = this.app.vault.getAbstractFileByPath(chunk.path);
      if (file instanceof TFile) byPath.set(chunk.path, await this.app.vault.cachedRead(file));
    }
    const taskLines = [];
    for (const [path, text] of byPath.entries()) {
      const lines = String(text || "").split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const parsed = parseTaskLine(lines[i], i, path, lines, this.settings) || parseTaskReferenceLine(lines[i], i, path, this.settings);
        if (!parsed) continue;
        taskLines.push(formatTaskReference(parsed, this.settings));
      }
    }
    const queryTerms = termCounts([query, active?.title, active?.selection].filter(Boolean).join("\n"));
    const cachedTasks = Object.entries(this.settings.taskCache || {})
      .map(([id, task]) => ({ id, task, score: lexicalScore(queryTerms, `${task.content || ""} ${(task.labels || []).join(" ")} ${task.path || ""}`) + recencyBoost(Date.parse(task.cachedAt || 0)) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25)
      .map((item) => formatCachedTaskReference(item.id, item.task, this.settings));
    return clamp(mergeStrings(taskLines, cachedTasks).slice(0, 40).join("\n"), 5000);
  }

  async chat(prompt, activeOverride = null, history = []) {
    await this.ensureCompatibleEmbeddingForChatModel();
    this.requireAiAccess();
    const active = activeOverride || (this.settings.autoAddActiveContentToContext ? await this.getActiveMarkdownContext() : null);
    const query = [prompt, active?.title, active?.selection].filter(Boolean).join("\n");
    const context = await this.retrieveSemanticContext(query, this.settings.maxChatContextChunks);
    const contextText = formatContext(context, this.settings.maxContextChars, this.settings);
    const activeText = active?.text ? (active.selection || active.text) : "";
    const sources = formatSourceLinks(active, context);
    const taskContext = await this.buildTaskContext(active, context, prompt);
    const response = await this.openaiResponse({
      model: this.settings.chatModel,
      system: [
        "You are a concise Obsidian sidebar assistant.",
        "Answer in plain language, usually in 3-6 short bullets or 1-3 short paragraphs.",
        "Use the active note and vault context when useful, and say when the vault does not contain enough evidence.",
        "Treat the active note as implied source context: cite it at most once in a response unless the user asks for line-by-line sourcing.",
        "When using context from other vault notes, cite the relevant note directly from the supplied source list near the claim it supports.",
        "Use markdown links exactly as supplied, and do not invent sources.",
        "Use the task context to identify whether a task already exists in the notes or Todoist-linked task cache before suggesting task creation.",
        "If the user asks about a specific existing task or asks for a Todoist link, use the supplied Todoist task link from the local reference table task context.",
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
        "Existing task context from notes and local Todoist-linked cache:",
        taskContext || "No matching local task context found.",
        "",
        "Semantic vault context:",
        contextText || "No semantic context found.",
        "",
        "User prompt:",
        prompt
      ].join("\n")
    });
    return { answer: response, context };
  }

  async openaiResponse({ model, system, user, jsonSchema }) {
    if (usesGeminiChatModel(model || this.settings.chatModel)) {
      return this.geminiResponse({ model, system, user, jsonSchema });
    }
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
      if (usesOpenAIChatModel(this.settings.chatModel) && !chat.includes(normalizeOpenAIModelId(this.settings.chatModel)) && chat.length) this.settings.chatModel = chat[0];
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
    if (!chat.includes("gemini-3.5-flash")) chat.unshift("gemini-3.5-flash");
    return {
      chat: Array.from(new Set(chat)).sort((a, b) => a.localeCompare(b)),
      embeddings: Array.from(new Set(embeddings)).sort((a, b) => a.localeCompare(b))
    };
  }

  async createTaskPlan(source) {
    await this.ensureCompatibleEmbeddingForChatModel();
    const sourceSummary = compressSourceForTaskPrompt(source, this.settings);
    const context = await this.retrieveSemanticContext(`${source.title}\n${sourceSummary}`, this.settings.maxTaskContextChunks);
    const taskContext = await this.buildTaskContext(
      source.type === "note" ? { path: source.path || "", text: source.text || "" } : null,
      context,
      `${source.title}\n${sourceSummary}`
    );
    const contextNotes = contextNotesForTaskPlan(context, source.path, this.settings.taskContextSummaryMaxNotes);
    const taskInstructions = this.taskInstructionsForSource(source.type);
    const maxMainTasks = generationMainTaskLimit(this.settings);
    const maxSubtasks = generationSubtaskLimit(this.settings);
    const instructions = [
      source.templateInstructions ? `Selected prompt:\n${source.templateInstructions}` : "",
      `Generation limits:\nCreate no more than ${maxMainTasks} main tasks. Create no more than ${maxSubtasks} subtasks under any main task. It is better to create fewer high-confidence tasks than to fill the limit.`,
      `Main task instructions:\n${taskInstructions.main}`,
      `Subtask instructions:\n${taskInstructions.subtasks}`,
      `Section title instructions:\n${taskInstructions.sectionTitle}`,
      `Date and deadline instructions:\n${taskInstructions.dates}`,
      `Tag instructions:\n${taskInstructions.tags}`,
      `Priority instructions:\n${taskInstructions.priorities}`,
      `Subtask criteria:\n${subtaskCriteriaInstructions(this.settings)}`
    ].filter(Boolean).join("\n\n");
    const json = await this.openaiResponse({
      model: this.settings.chatModel,
      jsonSchema: taskCreationSchema(maxMainTasks, maxSubtasks),
      system: [
        "Create Todoist task structure from the supplied source.",
        "Return only JSON matching the schema.",
        "Create only tasks that are truly actionable by the user. Skip informational discussion, vague ideas, duplicate tasks, status updates, and work clearly owned by someone else unless the user must follow up.",
        source.type === "note" ? "For notes, treat #todo markers and nearby lines as the strongest signal for user-owned actions. If no #todo markers exist, use only explicit action or follow-up language." : "For emails, use only explicit action, follow-up, review, waiting-on, or decision requests from the email thread.",
        `Hard limits: maximum ${maxMainTasks} main tasks and maximum ${maxSubtasks} subtasks per main task.`,
        "Labels must omit the leading #. Do not create any label unless it is explicitly named in the tag instructions.",
        "Use subtasks only when a main task has concrete required steps, and keep subtasks tied to the same project or program as the parent task.",
        "For subtasks, follow the configured subtask criteria exactly. Use null dates and priority 1 for disabled subtask criteria.",
        "Do not write task descriptions in this step. Descriptions are generated in a separate pass after local OIDs are assigned.",
        "Use YYYY-MM-DD dates.",
        `Today is ${today()}. Avoid weekends unless the source explicitly requires weekend work. Respect any local holiday or time-off rules described by the user instructions.`
      ].join(" "),
      user: [
        instructions,
        "",
        `Source type: ${source.type}`,
        `Source title: ${source.title}`,
        `Required section name: ${source.sectionName || ""}`,
        "",
        "Source content:",
        sourceSummary,
        "",
        "Relevant vault context:",
        formatContext(context, this.settings.maxContextChars, this.settings) || "No relevant vault context found.",
        "",
        "Existing task context from notes and local Todoist-linked cache:",
        taskContext || "No matching local task context found."
      ].join("\n")
    });
    const parsed = JSON.parse(json);
    const allowedLabels = labelsAllowedByInstructions(taskInstructions.tags);
    parsed.tasks = limitGeneratedTasks((parsed.tasks || []).map((task) => cleanTask(task, allowedLabels, this.settings)).filter((task) => task.content), maxMainTasks, maxSubtasks);
    parsed.contextNotes = contextNotes;
    parsed.sourceSummary = sourceSummary;
    parsed.semanticContext = context;
    parsed.descriptionInstructions = taskInstructions.descriptions;
    return parsed;
  }

  async refineTaskDescriptions(tasks, sourceSummary, context, sourceTitle, descriptionInstructions) {
    const mainTasks = (tasks || []).map((task, index) => ({
      index,
      title: task.content || "",
      currentDescription: task.description || "",
      labels: task.labels || [],
      subtasks: (task.subtasks || []).map((subtask) => subtask.content).filter(Boolean)
    }));
    if (!mainTasks.length) return;
    this.setSidebarStatus(`Writing descriptions for ${mainTasks.length} main task${mainTasks.length === 1 ? "" : "s"}...`);
    const json = await this.openaiResponse({
      model: this.settings.chatModel,
      jsonSchema: taskDescriptionSchema(),
      system: [
        "Write Todoist main-task descriptions only.",
        "Do not change task titles, due dates, priorities, labels, or subtasks.",
        "For each main task, write one concrete, useful paragraph between 80 and 1200 characters.",
        "Do not repeat or paraphrase the task title.",
        "Do not copy raw note lines. Summarize the active note and relevant vault context into useful action context.",
        "Prioritize active-note details. Add vault context only if it helps explain dependencies, constraints, people, documents, program status, rationale, or next information needed.",
        "Explain the useful why/so-what behind the context in plain language so the task can be actioned without reopening every source.",
        "Never return an empty description. Never say only to use the source material.",
        "Do not mention whether web links or linked files were found, missing, excluded, or unavailable.",
        "Do not include source lists, headings, bullets, tags, section names, date metadata, or subtask lists.",
        "Subtasks must not receive descriptions."
      ].join(" "),
      user: [
        `Source title: ${sourceTitle || ""}`,
        "",
        "Description instructions:",
        descriptionInstructions || "",
        "",
        `Excluded link domains: ${excludedLinkDomains(this.settings).join(", ") || "none"}`,
        "",
        "Main tasks needing descriptions:",
        JSON.stringify(mainTasks),
        "",
        "Active source content:",
        sourceSummary || "",
        "",
        "Relevant vault context:",
        formatContext(context, this.settings.maxContextChars, this.settings) || "No relevant vault context found."
      ].join("\n")
    });
    const parsed = JSON.parse(json);
    for (const item of parsed.descriptions || []) {
      const task = tasks[item.index];
      if (!task || task.isSubtask) continue;
      const summary = removeTitleEcho(cleanGeneratedDescriptionSummary(item.description || "", this.settings), task.content);
      task.description = truncateAtWord(summary || task.description || "", 1200);
      for (const subtask of task.subtasks || []) subtask.description = "";
    }
    const weakTasks = (tasks || []).map((task, index) => ({ task, index })).filter(({ task }) => !isUsefulDescriptionSummary(task.description, task.content, this.settings));
    if (weakTasks.length) {
      this.setSidebarStatus(`Repairing ${weakTasks.length} weak task description${weakTasks.length === 1 ? "" : "s"}...`);
      await this.repairTaskDescriptions(weakTasks, sourceSummary, context, sourceTitle, descriptionInstructions);
    }
    this.setSidebarStatus("Finalizing task descriptions...");
    for (const task of tasks || []) {
      if (!isUsefulDescriptionSummary(task.description, task.content, this.settings)) {
        task.description = fallbackActionSummary(task, sourceSummary, context, sourceTitle, this.settings);
      }
      for (const subtask of task.subtasks || []) subtask.description = "";
    }
  }

  async repairTaskDescriptions(weakTasks, sourceSummary, context, sourceTitle, descriptionInstructions) {
    const repairItems = weakTasks.map(({ task, index }) => ({
      index,
      title: task.content || "",
      labels: task.labels || [],
      subtasks: (task.subtasks || []).map((subtask) => subtask.content).filter(Boolean)
    }));
    if (!repairItems.length) return;
    const json = await this.openaiResponse({
      model: this.settings.chatModel,
      jsonSchema: taskDescriptionSchema(),
      system: [
        "Repair weak Todoist main-task descriptions.",
        "Return only JSON matching the schema.",
        "Each description must be 80-1200 characters and must explain the specific context, rationale, dependencies, people, documents, and next information needed to action the task.",
        "Use active source content first, then add relevant vault context. Do not repeat the title. Do not say to use the source material.",
        "Do not mention whether web links or linked files were found, missing, excluded, or unavailable.",
        "Do not include source lists, headings, bullets, tags, dates, section names, metadata, or subtask lists."
      ].join(" "),
      user: [
        `Source title: ${sourceTitle || ""}`,
        "",
        "Description instructions:",
        descriptionInstructions || "",
        "",
        `Excluded link domains: ${excludedLinkDomains(this.settings).join(", ") || "none"}`,
        "",
        "Tasks needing repaired descriptions:",
        JSON.stringify(repairItems),
        "",
        "Active source content:",
        sourceSummary || "",
        "",
        "Relevant vault context:",
        formatContext(context, Math.min(this.settings.maxContextChars || 8000, 8000), this.settings) || "No relevant vault context found."
      ].join("\n")
    });
    const parsed = JSON.parse(json);
    for (const item of parsed.descriptions || []) {
      const match = weakTasks.find(({ index }) => index === item.index);
      if (!match) continue;
      const summary = removeTitleEcho(cleanGeneratedDescriptionSummary(item.description || "", this.settings), match.task.content);
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

  async processPendingEmails(showNotice = true) {
    if (this.emailProcessingInProgress) return;
    this.emailProcessingInProgress = true;
    this.setSidebarStatus("Processing email tasks...");
    try {
      await this.ensureCompatibleEmbeddingForChatModel();
      this.requireAiAccess();
      this.requireTodoistAccess();
      this.requireEmailWorkerAccess();
      const pending = await this.workerJson("/pending?limit=25", "GET");
      this.settings.lastEmailPollAt = deviceTimestamp();
      const emails = pending.emails || [];
      if (!emails.length) {
        await this.saveSettings();
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
        const sectionName = makeSectionName(receivedAt, subject);
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
          sectionName,
          maxChars: this.settings.maxEmailChars
        });
        const tasks = plan.tasks || [];
        enforceGeneratedTaskLimits(tasks, this.settings);
        this.setSidebarStatus("Creating local email task OIDs...");
        ensureGeneratedTaskMetadata(tasks, sectionName, this.settings);
        assignGeneratedTaskOids(tasks, this.settings);
        this.setSidebarStatus("Preparing descriptions and Todoist section...");
        const sectionIdPromise = this.getTaskProjectId().then((projectId) => this.ensureTodoistSectionId(projectId, sectionName));
        const descriptionPromise = this.refineTaskDescriptions(tasks, plan.sourceSummary, plan.semanticContext || [], subject, plan.descriptionInstructions)
          .then(() => {
            this.setSidebarStatus("Adding email source context...");
            addContextToTaskDescriptions(tasks, plan.contextNotes || [], { title: subject, path: "", text: emailSourceText }, this.settings, plan.semanticContext || []);
          });
        const [sectionId] = await Promise.all([sectionIdPromise, descriptionPromise]);
        enforceGeneratedTaskLimits(tasks, this.settings);
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
      "4. Deploy an email queue Worker compatible with Semantic Todoist Sync.",
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
      `- Email poll interval: ${this.settings.emailPollIntervalSeconds || DEFAULT_SETTINGS.emailPollIntervalSeconds} seconds`,
      `- Worker token set in plugin: ${this.settings.workerToken ? "yes" : "no"}`,
      "",
      "Notes",
      "",
      "- This note is only a setup checklist. It does not modify Cloudflare, Todoist, or the working email workflow.",
      "- Keep the Worker token private. It is not written into this note.",
      "- If you need a Cloudflare account API token for manual Worker deployment tooling, create it from Cloudflare Profile > API Tokens. That token is separate from the plugin Worker token.",
      "- The plugin sends only email content selected for processing, retrieved vault context, and task fields needed to create Todoist tasks.",
      "- Do not reuse the Worker token anywhere else.",
      "- After changing domains or Worker URLs, send a test email before enabling automatic processing."
    ];
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, lines.join("\n"));
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
      const template = { name: "Active note task extraction", prompt: "Scan the active note or selected text and generate a Todoist-ready task list." };
      const result = await this.generateTaskListFromTemplate(template, {
        active,
        insertIntoNote: this.settings.insertGeneratedTasksIntoNote,
        syncAfterInsert: this.settings.syncAfterInsertingGeneratedTasks,
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
      const shouldInsert = options.insertIntoNote ?? this.settings.insertGeneratedTasksIntoNote;
      const shouldSyncAfterInsert = options.syncAfterInsert ?? this.settings.syncAfterInsertingGeneratedTasks;
      if (shouldInsert && shouldSyncAfterInsert) this.requireTodoistAccess();
      const sectionName = makeNoteSectionName(active.title, active.text, active.path);
      const plan = await this.createTaskPlan({
        type: "note",
        title: active.title,
        path: active.path,
        text: active.selection || active.text,
        sectionName,
        maxChars: this.settings.maxNoteChars,
        templateInstructions: template.prompt
      });
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
      const descriptionPromise = this.refineTaskDescriptions(tasks, plan.sourceSummary, plan.semanticContext || [], active.title, plan.descriptionInstructions)
        .then(() => {
          this.setSidebarStatus("Adding source context to descriptions...");
          addContextToTaskDescriptions(tasks, plan.contextNotes || [], active, this.settings, plan.semanticContext || []);
        });
      [preparedSectionId] = await Promise.all([sectionIdPromise, descriptionPromise]);
      enforceGeneratedTaskLimits(tasks, this.settings);
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
        await this.app.vault.append(file, `\n\n${markdown}\n`);
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
    if (isTaskGenerationTemplate(template)) {
      return this.generateTaskListFromTemplate(template, options);
    }
    if (template?.createTasks !== false) {
      return this.runPromptTemplateWithTaskGeneration(template, options);
    }
    return this.runPromptResponseTemplate(template, options);
  }

  async runPromptTemplateWithTaskGeneration(template, options = {}) {
    const active = options.active || await this.getActiveMarkdownContext();
    if (!active.path) throw new Error("Open a markdown note first.");
    const shouldInsert = options.insertIntoNote ?? template.insertResponse ?? true;
    const shouldSyncAfterInsert = options.syncAfterInsert ?? template.syncAfterInsert ?? false;
    const responseResult = await this.runPromptResponseTemplate(template, Object.assign({}, options, {
      active,
      insertIntoNote: shouldInsert,
      showNotice: false
    }));
    const taskTemplate = await this.resolveTaskGenerationTemplate(template);
    this.setSidebarStatus(`Creating tasks with ${taskTemplate.name || "Prompts"}...`);
    const taskResult = await this.generateTaskListFromTemplate(taskTemplate, Object.assign({}, options, {
      active,
      insertIntoNote: shouldInsert,
      syncAfterInsert: shouldSyncAfterInsert,
      showNotice: false
    }));
    if (options.showNotice) {
      const action = shouldInsert ? (shouldSyncAfterInsert ? "inserted and synced" : "inserted") : "shown in chat only";
      new Notice(`Ran "${template.name || "Prompt"}" and generated ${taskResult.tasks.length} main task${taskResult.tasks.length === 1 ? "" : "s"} with "${taskTemplate.name || "Prompts"}"; ${action}.`);
    }
    return Object.assign({}, responseResult, {
      tasks: taskResult.tasks || [],
      taskMarkdown: taskResult.markdown || "",
      taskContextNotes: taskResult.contextNotes || [],
      taskSemanticContext: taskResult.semanticContext || [],
      taskTemplate
    });
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
        await this.app.vault.append(file, `\n\n${markdown}\n`);
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
      this.settings.lastNoteAutoSyncAt = deviceTimestamp();
      this.requireTodoistAccess();
      this.setSidebarStatus("Syncing Todoist changes...");
      await this.pullTodoistUpdates();
      this.setSidebarStatus("Reconciling Todoist references...");
      const reconciled = await this.reconcileTodoistTaskCache();
      const files = fullScan ? this.getSyncableTaskFiles() : [];
      const totals = { files: files.length, created: 0, updated: 0, relinked: 0, deleted: 0, normalized: 0, conflicts: 0, staleReferences: reconciled.removed };
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
      if (!this.settings.todoistToken) throw new Error("Add a Todoist API token first.");
      const files = this.getSyncableTaskFiles();
      const localState = await this.referenceRebuildLocalState(files);
      stats.files = files.length;
      stats.scannedTasks = localState.candidateCount;
      if (!localState.candidateCount) {
        this.settings.taskCache = {};
        this.settings.pendingTaskReferences = {};
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
            match = findExistingTodoistTaskMatch(parsed, remote.tasks, parentId);
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
      this.settings.lastReferenceRebuildAt = deviceTimestamp();
      this.settings.lastReferenceRebuildFingerprint = localState.fingerprint;
      this.settings.lastReferenceRebuildCandidateCount = localState.candidateCount;
      await this.saveSettings();
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
      .filter((task) => !task.is_deleted && !task.checked)
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
      lines[parsed.lineNumber] = syncProjectMarkerOnTaskLine(addTodoistLink(lines[parsed.lineNumber], parsed.id, this.settings, parsed.oid), parsed, this.settings);
      changed = true;
      stats.relinked += 1;
    }
    for (const parsed of creations) {
      const id = tempToReal[parsed.tempId];
      if (!id) continue;
      parsed.id = id;
      parsed.oid = parsed.oid || generateUniqueOid(this.settings);
      presentIds.add(id);
      lines[parsed.lineNumber] = addTodoistLink(lines[parsed.lineNumber], id, this.settings, parsed.oid);
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
        const syncedLine = syncProjectMarkerOnTaskLine(lines[parsed.lineNumber], parsed, this.settings);
        if (syncedLine !== lines[parsed.lineNumber]) {
          lines[parsed.lineNumber] = syncedLine;
          changed = true;
          stats.normalized += 1;
        }
      }
      const signature = parsedTaskSignature(parsed);
      if (cached?.signature === signature && !remote) continue;
      const remoteSignature = remote ? remoteTaskComparableSignature(remote, parsed, this.settings) : "";
      if (remoteSignature && remoteSignature === signature) {
        this.cacheTask(parsed.id, parsed);
        continue;
      }
      const conflict = await this.todoistConflictForLocalUpdate(parsed, cached, remote);
      if (conflict) {
        const todoistContent = conflict.content || parsed.content;
        lines[parsed.lineNumber] = preserveTaskIndent(lines[parsed.lineNumber], replaceTaskLineContent(lines[parsed.lineNumber], todoistContent, this.settings));
        parsed.content = todoistContent;
        parsed.description = conflict.description || parsed.description;
        changed = true;
        stats.conflicts += 1;
        this.cacheTask(parsed.id, parsed);
        continue;
      }
      await this.updateTodoistFromParsedTask(parsed, remote);
      this.cacheTask(parsed.id, parsed);
      stats.updated += 1;
    }

    this.setSidebarStatus("Checking removed note tasks...");
    const deleted = await this.deleteTodoistTasksMissingFromFile(path, presentIds);
    stats.deleted = deleted;
    if (changed) {
      this.markInternalNoteWrite(path);
      await this.app.vault.modify(file, lines.join("\n"));
    }
    await this.saveSettings();
    if (showNotice) new Notice(`Synced ${creations.length + existingUpdates.length} task line${creations.length + existingUpdates.length === 1 ? "" : "s"}${deleted ? ` and deleted ${deleted} removed Todoist task${deleted === 1 ? "" : "s"}` : ""}.`);
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
      existing = remote.tasks;
    } catch (error) {
      this.logLocal("Todoist snapshot unavailable for relink check", { error: error.message || String(error) });
      existing = await this.getTodoistProjectTasks(await this.getTaskProjectId());
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
    for (const task of tasks) {
      task.projectId = task.projectId || projectId;
      task.projectName = task.projectName || projectName;
      const mainTempId = uuid();
      taskTemps.push({ tempId: mainTempId, task });
      commands.push({ type: "item_add", temp_id: mainTempId, uuid: uuid(), args: todoistTaskArgs(task, { section_id: sectionId }, this.settings) });
      for (const subtask of task.subtasks || []) {
        subtask.projectId = subtask.projectId || projectId;
        subtask.projectName = subtask.projectName || projectName;
        const subTempId = uuid();
        taskTemps.push({ tempId: subTempId, task: subtask });
        commands.push({ type: "item_add", temp_id: subTempId, uuid: uuid(), args: todoistTaskArgs(subtask, { parent_id: mainTempId }, this.settings) });
      }
    }
    this.logLocal("Email Todoist task create prepared", {
      tasks: taskTemps.length,
      rootTasks: tasks.length,
      section: sectionName,
      sectionId
    });
    const response = await this.todoistSync(commands);
    for (const item of taskTemps) if (response.temp_id_mapping?.[item.tempId]) item.task.id = response.temp_id_mapping[item.tempId];
    return tasks;
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
    for (const [id, cached] of Object.entries(this.settings.taskCache || {})) {
      if (cached.path !== path || presentIds.has(id)) continue;
      const ok = await this.deleteTodoistTask(id).catch((error) => {
        this.logLocal("Todoist delete failed", { id, path, error: error.message || String(error) });
        return false;
      });
      if (!ok) continue;
      delete this.settings.taskCache[id];
      deleted += 1;
    }
    return deleted;
  }

  async reconcileTodoistTaskCache() {
    const entries = Object.entries(this.settings.taskCache || {});
    const removed = [];
    let checked = 0;
    const removedIds = new Set();
    let activeTodoistIds = null;
    try {
      const snapshot = await this.getTodoistSnapshot(["items", "projects", "sections"], false);
      activeTodoistIds = new Set(snapshot.tasks.map((task) => task.id));
    } catch (error) {
      this.logLocal("Todoist snapshot unavailable for cache reconcile", { error: error.message || String(error) });
    }
    for (const [id, cached] of entries) {
      if (removedIds.has(id)) continue;
      checked += 1;
      const exists = activeTodoistIds ? activeTodoistIds.has(id) : await this.todoistTaskExists(id);
      if (exists) continue;
      const noteTouched = await this.removeDeletedTodoistTaskFromNote(cached);
      delete this.settings.taskCache[id];
      removedIds.add(id);
      if (!cached.isSubtask) {
        for (const [otherId, otherCached] of Object.entries(this.settings.taskCache || {})) {
          if (otherCached.path !== cached.path || !otherCached.isSubtask) continue;
          if (Math.abs((otherCached.lineNumber || 0) - (cached.lineNumber || 0)) > 25) continue;
          const otherExists = activeTodoistIds ? activeTodoistIds.has(otherId) : await this.todoistTaskExists(otherId);
          if (otherExists) continue;
          delete this.settings.taskCache[otherId];
          removedIds.add(otherId);
        }
      }
      removed.push({ id, oid: cached.oid || "", path: cached.path || "", noteTouched });
    }
    if (removed.length) {
      await this.saveSettings();
      this.logLocal("Todoist cache reconciled", { checked, removed: removed.length });
    }
    return { checked, removed: removed.length };
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
    await this.app.vault.modify(file, kept.join("\n"));
    return true;
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
    const updates = todoistUpdatePayload(task, remote, this.settings);
    if (Object.keys(updates).length) await this.todoistRequest(`/tasks/${task.id}`, "POST", updates);
    if (remote && Boolean(remote.isCompleted) === Boolean(task.isCompleted)) return;
    if (task.isCompleted) await this.todoistRequest(`/tasks/${task.id}/close`, "POST");
    else if (!remote || remote.isCompleted) await this.todoistRequest(`/tasks/${task.id}/reopen`, "POST").catch(() => null);
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
    if (events.some((event) => /updated|added|uncompleted|deleted|removed/i.test(event.event_type || event.eventType || ""))) {
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
        await this.removeDeletedTodoistTaskFromNote(cached);
        delete this.settings.taskCache[taskId];
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
  }

  async updateTaskLineFromTodoist(taskId, task) {
    const cached = this.settings.taskCache[taskId];
    if (!cached) return;
    const projectId = String(task.project_id || task.projectId || cached.projectId || "");
    const projectName = await this.todoistProjectNameForId(projectId);
    const parsed = Object.assign({}, cached, {
      oid: cached.oid || oidForTodoistId(this.settings, taskId) || generateUniqueOid(this.settings),
      content: task.content || cached.content,
      labels: cached.labels || [],
      priority: normalizePriority(cached.priority),
      due_date: cached.due_date || null,
      deadline_date: cached.deadline_date || null,
      description: isRichTodoistDescription(task.description) ? task.description : cached.description || "",
      isSubtask: Boolean(cached.isSubtask),
      parentId: task.parent_id || task.parentId || cached.parentId || "",
      parentOid: cached.parentOid || "",
      parentContent: cached.parentContent || "",
      parentLineNumber: cached.parentLineNumber ?? null,
      section: cached.section || "",
      sectionId: task.section_id || task.sectionId || cached.sectionId || "",
      projectId,
      projectName
    });
    await this.updateCachedLine(taskId, (line) => {
      const updatedContent = replaceTaskLineContent(line, parsed.content, this.settings);
      return syncProjectMarkerOnTaskLine(updatedContent, {
        projectId,
        projectName,
        isSubtask: parsed.isSubtask
      }, this.settings);
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
    lines[idx] = preserveTaskIndent(lines[idx], replacer(lines[idx]));
    await this.app.vault.modify(file, lines.join("\n"));
  }

  cacheTask(id, task) {
    const existingDescription = this.settings.taskCache?.[id]?.description || "";
    const incomingDescription = !task.isSubtask && isRichTodoistDescription(task.description) ? task.description : "";
    const description = task.isSubtask ? "" : sanitizeStoredTodoistDescription(incomingDescription || existingDescription || "", this.settings);
    const oid = task.oid || this.settings.taskCache?.[id]?.oid || generateUniqueOid(this.settings);
    const pendingReference = oid ? this.settings.pendingTaskReferences?.[pendingTaskOidKey(task.path, oid)] : null;
    const parentReference = parentReferenceForParsedTask(task, this.settings) || {};
    this.settings.taskCache[id] = {
      oid,
      path: task.path,
      lineNumber: task.lineNumber,
      content: task.content,
      description,
      labels: task.labels,
      priority: task.priority,
      due_date: task.due_date || null,
      deadline_date: task.deadline_date || null,
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
      noteRefs: mergeNoteReferences(this.settings.taskCache?.[id]?.noteRefs || [], [noteReferenceForTask(task, oid)]),
      signature: parsedTaskSignature(task),
      cachedAt: deviceTimestamp()
    };
    if (this.settings.pendingTaskDescriptions) {
      delete this.settings.pendingTaskDescriptions[pendingTaskKey(task.path, task)];
      delete this.settings.pendingTaskDescriptions[pendingTaskContentKey(task.path, task)];
      if (oid) delete this.settings.pendingTaskDescriptions[pendingTaskOidKey(task.path, oid)];
    }
    if (this.settings.pendingTaskReferences && oid) delete this.settings.pendingTaskReferences[pendingTaskOidKey(task.path, oid)];
  }

  savePendingTaskDescriptions(path, tasks) {
    this.settings.pendingTaskDescriptions = this.settings.pendingTaskDescriptions || {};
    for (const task of flattenTaskPlan(tasks)) {
      if (task.isSubtask) continue;
      const description = task.description || "";
      if (!description) continue;
      this.settings.pendingTaskDescriptions[pendingTaskKey(path, task)] = description;
      this.settings.pendingTaskDescriptions[pendingTaskContentKey(path, task)] = description;
      if (task.oid) this.settings.pendingTaskDescriptions[pendingTaskOidKey(path, task.oid)] = description;
    }
  }

  savePendingTaskReferences(path, tasks) {
    this.settings.pendingTaskReferences = this.settings.pendingTaskReferences || {};
    const createdAt = deviceTimestamp();
    for (const task of tasks || []) {
      if (task.oid) this.settings.pendingTaskReferences[pendingTaskOidKey(path, task.oid)] = {
        oid: task.oid,
        path,
        content: task.content || "",
        section: task.section || "",
        sectionId: task.sectionId || "",
        projectId: task.projectId || "",
        projectName: task.projectName || "",
        isSubtask: false,
        parentId: "",
        parentOid: "",
        parentContent: "",
        createdAt
      };
      for (const subtask of task.subtasks || []) {
        if (!subtask.oid) continue;
        this.settings.pendingTaskReferences[pendingTaskOidKey(path, subtask.oid)] = {
          oid: subtask.oid,
          parentOid: task.oid || "",
          parentId: task.id || "",
          parentContent: task.content || "",
          path,
          content: subtask.content || "",
          section: task.section || "",
          sectionId: task.sectionId || "",
          projectId: subtask.projectId || task.projectId || "",
          projectName: subtask.projectName || task.projectName || "",
          isSubtask: true,
          createdAt
        };
      }
    }
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
    if (task.oid) {
      const oidId = todoistIdForOid(this.settings, task.oid);
      if (oidId) return oidId;
    }
    const signature = parsedTaskSignature(task);
    const key = pendingTaskKey(task.path, task);
    for (const [id, cached] of Object.entries(this.settings.taskCache || {})) {
      if (cached.path !== task.path) continue;
      if (cached.signature === signature || pendingTaskKey(cached.path, cached) === key || pendingTaskContentKey(cached.path, cached) === pendingTaskContentKey(task.path, task)) return id;
    }
    return "";
  }

  async cacheLoggedTasks(path, tasks, sectionName) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const lines = (await this.app.vault.read(file)).split("\n");
    const byId = new Map();
    const byOid = new Map();
    for (const task of tasks || []) {
      if (task.id) byId.set(task.id, Object.assign({ isCompleted: false, isSubtask: false, section: sectionName }, task));
      if (task.oid) byOid.set(task.oid, Object.assign({ isCompleted: false, isSubtask: false, section: sectionName }, task));
      for (const subtask of task.subtasks || []) {
        if (subtask.id) byId.set(subtask.id, Object.assign({ isCompleted: false, isSubtask: true, section: "" }, subtask));
        if (subtask.oid) byOid.set(subtask.oid, Object.assign({ isCompleted: false, isSubtask: true, section: "" }, subtask));
      }
    }
    for (let i = 0; i < lines.length; i += 1) {
      const oid = getTaskOid(lines[i]);
      const id = getTodoistId(lines[i], this.settings) || byOid.get(oid)?.id;
      const task = byId.get(id) || byOid.get(oid);
      if (!task) continue;
      if (!id) continue;
      this.cacheTask(id, Object.assign({}, task, {
        oid: oid || task.oid,
        path,
        lineNumber: i,
        labels: (task.labels || []).map(cleanLabel).filter(Boolean),
        priority: normalizePriority(task.priority),
        due_date: task.due_date || null,
        deadline_date: task.deadline_date || null
      }));
    }
    await this.saveSettings();
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
        lines.push(`${" ".repeat(Math.max(2, this.settings.subtaskIndentSpaces || 4))}${line}`);
      }
    }
    if (!tasks?.length) lines.push("- No actionable tasks were found.");
    await this.app.vault.create(path, `${lines.join("\n")}\n`);
    await this.cacheLoggedTasks(path, tasks || [], sectionName);
    this.logLocal("Email task note created", { path, tasks: flattenTaskPlan(tasks || []).length, sectionName });
  }
};

class SemanticTodoistView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.messages = [];
    this.selectedPath = "";
    this.includeActiveNote = plugin.settings.searchIncludeActiveNote !== false;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Semantic Todoist Sync"; }
  getIcon() { return "list-checks"; }

  async onOpen() {
    this.render();
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.handleActiveNoteChanged()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.handleActiveNoteChanged()));
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
    header.createEl("button", { text: "Index" }).onclick = async () => {
      this.setStatus("Indexing vault...");
      try {
        await this.plugin.rebuildSemanticIndex(true);
      } catch (error) {
        console.error(error);
        this.setStatus(`Index failed: ${error.message || error}`);
        new Notice(`Index failed: ${error.message || error}`);
      }
    };
    const noteRow = container.createDiv({ cls: "semantic-todoist-note-row" });
    noteRow.createSpan({ text: "Active note" });
    const picker = noteRow.createDiv({ cls: "semantic-todoist-note-picker" });
    this.noteInputEl = picker.createEl("input", { type: "search", placeholder: "Current active note" });
    this.noteInputEl.oninput = () => {
      if (!this.noteInputEl.value.trim()) {
        this.selectedPath = "";
        this.noteSearchDirty = false;
        if (this.noteResultsEl) this.noteResultsEl.empty();
        this.refreshActiveSummary();
        return;
      }
      this.noteSearchDirty = true;
      this.renderNoteSearchResults();
    };
    this.noteInputEl.onfocus = () => this.renderNoteSearchResults();
    this.noteInputEl.onkeydown = (event) => {
      if (event.key !== "Enter") return;
      const first = this.getNoteSearchMatches(this.noteInputEl.value)[0];
      if (first) {
        event.preventDefault();
        this.selectNote(first.path);
      }
    };
    this.noteResultsEl = picker.createDiv({ cls: "semantic-todoist-note-results" });
    const includeRow = container.createDiv({ cls: "semantic-todoist-context-toggle" });
    const includeLabel = includeRow.createEl("label");
    const includeCheckbox = includeLabel.createEl("input", { type: "checkbox" });
    includeCheckbox.checked = this.includeActiveNote;
    includeLabel.createSpan({ text: "Include active note in chat search" });
    includeCheckbox.onchange = async () => {
      this.includeActiveNote = includeCheckbox.checked;
      this.plugin.settings.searchIncludeActiveNote = this.includeActiveNote;
      await this.plugin.saveSettings();
      this.refreshActiveSummary();
    };
    this.activeSummaryEl = container.createDiv({ cls: "semantic-todoist-active-summary" });
    this.relevantEl = container.createDiv({ cls: "semantic-todoist-relevant" });
    this.relevantEl.setText("Relevant notes will appear here after search or chat.");
    this.messagesEl = container.createDiv({ cls: "semantic-todoist-conversation" });
    this.promptEl = container.createEl("textarea", { placeholder: "Ask about your vault or draft a prompt..." });
    this.promptEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      this.ask();
    });
    const toolbar = container.createDiv({ cls: "semantic-todoist-toolbar" });
    toolbar.createEl("button", { text: "Ask" }).onclick = async () => {
      await this.ask();
    };
    toolbar.createEl("button", { text: "Tasks" }).onclick = async () => {
      await this.runDefaultTaskPrompt();
    };
    toolbar.createEl("button", { text: "New chat" }).onclick = () => {
      this.messages = [];
      this.renderMessages();
      this.renderRelevantNotes([]);
      this.setStatus("Ready");
    };
    toolbar.createEl("button", { text: "Prompts" }).onclick = async () => {
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
      }, {
        insertIntoNote: this.plugin.settings.insertGeneratedTasksIntoNote,
        syncAfterInsert: this.plugin.settings.syncAfterInsertingGeneratedTasks
      }).open();
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

  setStatus(message = "Ready") {
    this.currentStatus = message || "Ready";
    if (!this.statusEl) return;
    this.statusEl.empty();
    const line1 = this.statusEl.createDiv({ cls: "semantic-todoist-status-line" });
    line1.createEl("strong", { text: "Status:" });
    line1.createSpan({ text: ` ${singleLine(this.currentStatus) || "Ready"}` });
    const parts = activeWorkflowStatusParts(this.plugin, this.currentStatus);
    if (parts.length) {
      const line2 = this.statusEl.createDiv({ cls: "semantic-todoist-status-line semantic-todoist-status-detail" });
      parts.forEach((part, index) => {
        if (index) line2.createSpan({ cls: "semantic-todoist-status-separator", text: " | " });
        line2.createEl("strong", { text: `${part.label}:` });
        line2.createSpan({ text: ` ${part.value}` });
      });
    }
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
    if (this.noteInputEl) this.noteInputEl.value = path;
    if (this.noteResultsEl) this.noteResultsEl.empty();
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
    const active = await this.getSelectedActiveContext();
    if (!this.activeSummaryEl) return;
    this.activeSummaryEl.empty();
    if (!this.includeActiveNote) {
      this.activeSummaryEl.setText("Active note excluded from chat search.");
      return;
    }
    if (!active.path) {
      this.activeSummaryEl.setText("No active note selected.");
      if (!this.noteSearchDirty && this.noteInputEl) this.noteInputEl.value = "";
      return;
    }
    if (!this.noteSearchDirty && this.noteInputEl) this.noteInputEl.value = active.path;
    this.activeSummaryEl.createEl("strong", { text: active.title });
    this.activeSummaryEl.createDiv({ text: active.path });
    this.activeSummaryEl.createDiv({ text: active.selection ? "Selected text will be included." : "Full note will be included." });
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
    for (const chunk of uniqueChunks.slice(0, 3)) {
      const card = tabs.createDiv({ cls: "semantic-todoist-source-card" });
      card.setText(shortTitle(chunk.title || chunk.path, 18));
      card.title = chunk.path;
      card.onclick = () => {
        const file = this.plugin.app.vault.getAbstractFileByPath(chunk.path);
        if (file instanceof TFile) this.plugin.app.workspace.getLeaf(true).openFile(file);
      };
    }
  }

  addMessage(role, text) {
    this.messages.push({ role, text });
    this.renderMessages();
  }

  replaceLastAssistantMessage(text) {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      if (this.messages[i].role === "assistant") {
        this.messages[i].text = text;
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
    new Setting(containerEl).setName("Semantic Todoist Sync").setHeading();
    const tabs = containerEl.createDiv({ cls: "semantic-todoist-tabs" });
    for (const tab of ["Setup", "Basic", "API Access", "Email-To-Todoist", "Notes-To-Todoist", "References", "Activity"]) {
      const button = tabs.createEl("button", { text: tab });
      if (this.activeTab === tab) button.addClass("is-active");
      button.onclick = () => {
        this.activeTab = tab;
        this.display();
      };
    }
    if (this.activeTab === "Setup") this.renderSetup(containerEl);
    if (this.activeTab === "Basic") this.renderBasic(containerEl);
    if (this.activeTab === "API Access") this.renderApi(containerEl);
    if (this.activeTab === "Email-To-Todoist") this.renderEmail(containerEl);
    if (this.activeTab === "Notes-To-Todoist") this.renderNotes(containerEl);
    if (this.activeTab === "References") this.renderReferences(containerEl);
    if (this.activeTab === "Activity") this.renderActivity(containerEl);
  }

  renderSetup(containerEl) {
    settingsHeading(containerEl, "Quick Setup", "Follow these steps in order. AI credentials and Todoist access are required for both workflows. Cloudflare is optional and only needed for Email-To-Todoist.");
    settingsHeading(containerEl, "Step 1 - AI Provider", "Create a provider key in your browser, paste it below, then validate. Gemini is the default provider; OpenAI is optional.");
    setupStatusSetting(containerEl, "Open provider key pages", aiSetupSummary(this.plugin.settings), [
      ["Gemini API keys", () => this.plugin.openSetupUrl("https://aistudio.google.com/app/apikey")],
      ["Gemini instructions", () => this.plugin.openSetupUrl("https://ai.google.dev/gemini-api/docs/api-key")],
      ["OpenAI API keys", () => this.plugin.openSetupUrl("https://platform.openai.com/api-keys")]
    ]);
    secretSetting(containerEl, "Google Gemini API key", this.plugin, "googleApiKey");
    secretSetting(containerEl, "OpenAI API key", this.plugin, "openaiApiKey");
    modelDropdownSetting(containerEl, "Default AI model", "Used for sidebar chat, vault question-answering, task extraction, and task description generation. Refresh models after adding a key.", this.plugin, "chatModel", "availableChatModels");
    modelDropdownSetting(containerEl, "Embedding model", "Used for semantic vault indexing. The plugin keeps this on the same provider as the selected AI model by default.", this.plugin, "embeddingModel", "availableEmbeddingModels");
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
    settingsHeading(containerEl, "Step 4 - Email-To-Todoist Optional", "Use this only if you want forwarded emails processed through your own Cloudflare Worker. The email workflow still requires AI and Todoist first. The Worker token below is a local shared secret generated by this plugin, not a Cloudflare account API token.");
    setupStatusSetting(containerEl, "Open Cloudflare setup pages", `${emailSetupSummary(this.plugin.settings)} Use Email Routing for inbound email. Use Cloudflare API Tokens only for advanced deployment tooling; this plugin does not need your Cloudflare account API token during normal use.`, [
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
    settingsHeading(containerEl, "AI Model", "Choose the model used for sidebar answers, task extraction, task description writing, and prompts. The embedding model is automatically kept on the same provider when the selected AI model changes.");
    modelDropdownSetting(containerEl, "Default AI model", "Used for sidebar chat, vault question-answering, and task generation.", this.plugin, "chatModel", "availableChatModels");
    dropdownSettingWithDesc(containerEl, "Default sidebar mode", "Vault QA uses semantic vault search and active-note context for sourced answers. Chat is a lighter general conversation mode. Task Creation is for prompts that generate Todoist-ready tasks.", this.plugin, "chatMode", ["Vault QA", "Chat", "Task Creation"]);
    dropdownSetting(containerEl, "Open plugin in", this.plugin, "defaultOpenArea", ["view", "left", "right"]);
    numberSetting(containerEl, "Chat font size px", this.plugin, "chatFontSizePx");
    toggleSetting(containerEl, "Auto-add active content to context", "Include active note content in sidebar chat.", this.plugin, "autoAddActiveContentToContext");
    toggleSetting(containerEl, "Include active note in sidebar search by default", "The sidebar switch can still be changed per session.", this.plugin, "searchIncludeActiveNote");
    numberSetting(containerEl, "Max chat context chunks", this.plugin, "maxChatContextChunks");
    numberSetting(containerEl, "Max active-note context characters", this.plugin, "maxActiveNoteContextChars");
    settingsHeading(containerEl, "Prompts");
    textSetting(containerEl, "Prompts folder", "Markdown files in this folder appear as command-palette prompts.", this.plugin, "promptTemplatesFolder");
    taskGenerationPromptTemplateSetting(containerEl, this.plugin);
    new Setting(containerEl).setName("Open sidebar").addButton((button) => button.setButtonText("Open").onClick(() => this.plugin.openSidebar()));
    new Setting(containerEl).setName("Run prompts").setDesc("Runs custom prompts. Prompts can insert plain AI responses or create task lists when createTasks is true.").addButton((button) => button.setButtonText("Run").onClick(() => this.plugin.runTaskTemplateFromCommandPalette()));
  }

  renderApi(containerEl) {
    settingsHeading(containerEl, "API Keys");
    secretSetting(containerEl, "OpenAI API key", this.plugin, "openaiApiKey");
    secretSetting(containerEl, "Google API key", this.plugin, "googleApiKey");
    modelDropdownSetting(containerEl, "Embedding model", "Used for semantic RAG indexing and search. Default follows the selected AI provider; Gemini uses gemini-embedding-2.", this.plugin, "embeddingModel", "availableEmbeddingModels");
    new Setting(containerEl).setName("Available AI models").setDesc(modelSummary(this.plugin.settings)).addButton((button) => button.setButtonText("Refresh").onClick(async () => {
      try {
        await this.plugin.refreshOpenAIModels(true);
        this.display();
      } catch (error) {
        new Notice(`Could not load AI models: ${error.message || error}`);
      }
    }));
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
    folderListSetting(containerEl, "Excluded folders", "Folders ignored by search, semantic indexing, and note sync.", this.plugin, "excludedFolders");
    textSetting(containerEl, "Excluded link domains", "Comma-separated domains omitted from AI task prompts and Todoist descriptions. Subdomains are included. Example: internal.example.com.", this.plugin, "excludedLinkDomains");
    numberSetting(containerEl, "Embedding batch size", this.plugin, "embeddingBatchSize");
    numberSetting(containerEl, "Index chunk size characters", this.plugin, "semanticIndexMaxChunkChars");
    numberSetting(containerEl, "Max index chunks per note", this.plugin, "semanticIndexMaxChunksPerNote");
    numberSetting(containerEl, "Index embedding precision", this.plugin, "semanticIndexEmbeddingPrecision");
    toggleSetting(containerEl, "Automatically update semantic index", "Re-index created or modified notes after a short delay.", this.plugin, "autoUpdateSemanticIndex");
    numberSetting(containerEl, "Semantic index delay seconds", this.plugin, "semanticIndexDelaySeconds");
    new Setting(containerEl).setName("Semantic vault index").setDesc(indexSummary(this.plugin))
      .addButton((button) => button.setButtonText("Rebuild").onClick(() => this.plugin.rebuildSemanticIndex(true)))
      .addButton((button) => button.setButtonText("Purge current").onClick(() => this.plugin.purgeSemanticIndex(true)));
  }

  renderEmail(containerEl) {
    settingsHeading(containerEl, "Automation");
    toggleSetting(containerEl, "Automatically process new emails", "Poll Cloudflare for pending email tasks while Obsidian is open.", this.plugin, "autoProcessEmails");
    numberSetting(containerEl, "Email polling interval seconds", this.plugin, "emailPollIntervalSeconds");
    new Setting(containerEl).setName("Last email poll").setDesc(this.plugin.settings.lastEmailPollAt || "Not yet polled.");
    new Setting(containerEl).setName("Process pending email tasks").addButton((button) => button.setButtonText("Process").setCta().onClick(() => this.plugin.processPendingEmails()));
    settingsHeading(containerEl, "Email Content");
    numberSetting(containerEl, "Maximum email characters", this.plugin, "maxEmailChars");
    textSetting(containerEl, "Email log folder", "Plain-language processing log folder.", this.plugin, "emailLogFolder");
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
    toggleSetting(containerEl, "Obsidian Tasks date/link order", "Place Todoist metadata before due/deadline markers to reduce parsing issues.", this.plugin, "obsidianTasksDateOrder");
    numberSetting(containerEl, "Subtask indent spaces", this.plugin, "subtaskIndentSpaces");
    toggleSetting(containerEl, "Insert generated task list into note", "AI-generated note tasks are written into the active note.", this.plugin, "insertGeneratedTasksIntoNote");
    toggleSetting(containerEl, "Sync after inserting generated tasks", "Immediately create Todoist tasks after inserting generated note tasks.", this.plugin, "syncAfterInsertingGeneratedTasks");
    subtaskCriteriaSettings(containerEl, this.plugin);
    settingsHeading(containerEl, "Task Generation Limits", "Hard caps applied to AI-created tasks before anything is inserted or synced.");
    numberSetting(containerEl, "Maximum main tasks per email or note", this.plugin, "maxGeneratedMainTasks");
    numberSetting(containerEl, "Maximum subtasks per main task", this.plugin, "maxGeneratedSubtasksPerMainTask");
    numberSetting(containerEl, "Maximum note characters for task extraction", this.plugin, "maxNoteChars");
    numberSetting(containerEl, "Maximum Todoist description characters", this.plugin, "todoistDescriptionMaxChars");
    new Setting(containerEl).setName("Sync note tasks").addButton((button) => button.setButtonText("Sync").setCta().onClick(() => this.plugin.syncNoteTasks()));
    taskInstructionSettings(containerEl, this.plugin, "Note task instructions", "note");
  }

  renderActivity(containerEl) {
    containerEl.createEl("h3", { text: "Plugin Activity" });
    activitySetting(containerEl, "Semantic index", indexSummary(this.plugin));
    activitySetting(containerEl, "Index file", `${this.plugin.semanticIndexStats?.path || SEMANTIC_INDEX_FILE}. ${formatBytes(this.plugin.semanticIndexStats?.bytes || 0)}.`);
    activitySetting(containerEl, "AI models", modelSummary(this.plugin.settings));
    activitySetting(containerEl, "Tracking timezone", `${deviceTimeZone()} using device-local timestamps.`);
    activitySetting(containerEl, "Todoist", `${this.plugin.settings.availableTodoistProjects?.length || 0} projects loaded. ${Object.keys(this.plugin.settings.taskCache || {}).length} synced task references.`);
    activitySetting(containerEl, "Reference rebuild", `Last rebuild: ${this.plugin.settings.lastReferenceRebuildAt || "Not yet rebuilt"}. Auto-rebuild: ${this.plugin.settings.autoRebuildReferences ? "on" : "off"}. Workers: ${referenceRebuildWorkerCount(this.plugin.settings)}. Last local candidates: ${this.plugin.settings.lastReferenceRebuildCandidateCount || 0}. OID-only tasks can recover Todoist IDs by exact task-name matching.`);
    activitySetting(containerEl, "Cloudflare email", `Last poll: ${this.plugin.settings.lastEmailPollAt || "Not yet polled"}. Auto-processing: ${this.plugin.settings.autoProcessEmails ? "on" : "off"}.`);
    activitySetting(containerEl, "Notes sync", `Last sync: ${this.plugin.settings.lastNoteAutoSyncAt || "Not yet synced"}. Auto-sync: ${this.plugin.settings.notesAutoSync ? "on" : "off"}. Workers: ${syncWorkerCount(this.plugin.settings)}.`);
    new Setting(containerEl).setName("Refresh").addButton((button) => button.setButtonText("Refresh").onClick(() => this.display()));
    new Setting(containerEl).setName("Recent log").setDesc(localLogSummary(this.plugin.settings));
    const log = containerEl.createEl("pre", { cls: "semantic-todoist-activity-log" });
    log.setText(activityLogText(this.plugin.settings));
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
    new Setting(containerEl).setName("Rebuild local reference table").setDesc("Read-only Todoist reconciliation. Scans vault task references, rebuilds the local OID table from Todoist, and recovers missing Todoist IDs for OID-only note tasks by exact task-name matching. It does not create, update, complete, or delete Todoist tasks.").addButton((button) => button.setButtonText("Rebuild").setCta().onClick(async () => {
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
    new Setting(containerEl).setName("Refresh").addButton((button) => button.setButtonText("Refresh").onClick(() => this.display()));
    const rows = referenceRows(this.plugin.settings);
    containerEl.createDiv({ text: `${rows.length} local reference${rows.length === 1 ? "" : "s"}.` });
    const wrapper = containerEl.createDiv({ cls: "semantic-todoist-reference-table-wrap" });
    const table = wrapper.createEl("table", { cls: "semantic-todoist-reference-table" });
    const thead = table.createEl("thead");
    const header = thead.createEl("tr");
    for (const label of ["OID", "Todoist ID", "Task", "Priority", "Date", "Deadline", "Project", "Project ID", "Section", "Section ID", "Parent OID", "Parent Todoist ID", "Parent Task", "Note References", "Description", "Path", "Status"]) {
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

class PromptModal extends Modal {
  constructor(app, title, onSubmit) {
    super(app);
    this.title = title;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
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
    const createsTasks = template.createTasks !== false;
    const insertIntoNote = template.insertResponse !== false;
    const syncAfterInsert = createsTasks && insertIntoNote && template.syncAfterInsert === true;
    return { createsTasks, insertIntoNote, syncAfterInsert };
  }

  onOpen() {
    const { contentEl } = this;
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
  textAreaSetting(containerEl, "Main Task", plugin, `${prefix}MainTaskInstructions`);
  textAreaSetting(containerEl, "Subtasks", plugin, `${prefix}SubtaskInstructions`);
  textAreaSetting(containerEl, "Section Titles", plugin, `${prefix}SectionTitleInstructions`);
  textAreaSetting(containerEl, "Dates and Deadlines", plugin, `${prefix}DateInstructions`);
  textAreaSetting(containerEl, "Tags", plugin, `${prefix}TagInstructions`);
  textAreaSetting(containerEl, "Priorities", plugin, `${prefix}PriorityInstructions`);
  textAreaSetting(containerEl, "Descriptions and links", plugin, `${prefix}DescriptionInstructions`);
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
  promptTemplatesFolder: "Markdown files in this folder become reusable AI prompts. Frontmatter can set createTasks, insertResponse, and syncTasks.",
  taskGenerationPromptTemplate: "Prompt used as the separate Todoist task creation pass when a regular prompt also has createTasks enabled.",
  openaiApiKey: "Optional. Required only when you choose an OpenAI chat or embedding model.",
  googleApiKey: "Required for the default Gemini setup. Create this in Google AI Studio and paste it here.",
  embeddingModel: "Used to build and search the local semantic index. It follows the selected provider by default.",
  todoistToken: "Required for Todoist project loading, task creation, and two-way sync.",
  workerUrl: "Required only for Email-To-Todoist. This is the HTTPS URL of your Cloudflare Worker queue.",
  workerToken: "Required only for Email-To-Todoist. This shared secret authorizes Obsidian to read queued emails from your Worker.",
  indexedFolders: "Optional comma-separated folder list. Leave blank to index the whole vault except excluded folders.",
  excludedFolders: "Folders ignored by semantic indexing, vault search, and note task sync.",
  excludedLinkDomains: "Comma-separated web domains omitted from AI prompts and Todoist descriptions.",
  embeddingBatchSize: "How many note chunks are embedded per API batch. Larger values can be faster but heavier.",
  semanticIndexMaxChunkChars: "Approximate size of each note chunk before embedding.",
  semanticIndexMaxChunksPerNote: "Caps how much of a single note can enter the semantic index.",
  semanticIndexEmbeddingPrecision: "Number of decimal places retained in stored embeddings. Lower is smaller; higher is more precise.",
  autoUpdateSemanticIndex: "When enabled, edited notes are re-indexed after a delay while Obsidian is open.",
  semanticIndexDelaySeconds: "Wait time before re-indexing changed notes, so rapid edits collapse into one update.",
  autoProcessEmails: "When enabled, Obsidian polls your Cloudflare Worker for forwarded emails while the app is open.",
  emailPollIntervalSeconds: "How often Email-To-Todoist checks Cloudflare while automatic processing is enabled.",
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
  obsidianTasksDateOrder: "Keeps metadata ordered to work better with the Obsidian Tasks plugin.",
  subtaskIndentSpaces: "Number of leading spaces used when inserting generated subtasks.",
  subtaskIncludeLabels: "Allow Todoist labels on subtasks.",
  subtaskIncludePriority: "Allow priority markers and Todoist priority on subtasks.",
  subtaskIncludeDueDate: "Allow due dates on subtasks.",
  subtaskIncludeDeadline: "Allow deadline dates on subtasks.",
  insertGeneratedTasksIntoNote: "When enabled, generated note tasks are written into the active note.",
  syncAfterInsertingGeneratedTasks: "When enabled, inserted generated tasks are immediately created or updated in Todoist.",
  maxNoteChars: "Maximum note text sent to the AI for task extraction.",
  todoistDescriptionMaxChars: "Maximum generated description characters before the source list is added.",
  autoRebuildReferences: "Low-frequency reconciliation of the local OID reference table against Todoist.",
  referenceRebuildIntervalMinutes: "How often automatic reference reconciliation may run while Obsidian is open.",
  referenceRebuildWorkerCount: "Number of local note files processed in parallel during reference reconciliation.",
  todoistSnapshotCacheMinutes: "How long Todoist snapshots can be reused to reduce API calls.",
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

function taskGenerationPromptTemplateSetting(containerEl, plugin) {
  const current = plugin.settings.taskGenerationPromptTemplate || DEFAULT_SETTINGS.taskGenerationPromptTemplate;
  new Setting(containerEl)
    .setName("Task generation prompt")
    .setDesc("Used as the separate Todoist task creation pass when a prompt response template also has createTasks enabled.")
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
    text.setValue(String(plugin.settings[key] || DEFAULT_SETTINGS[key])).onChange(async (value) => {
      plugin.settings[key] = Math.max(1, parseInt(value, 10) || DEFAULT_SETTINGS[key]);
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
  new Setting(containerEl).setName(name).setDesc(selected.length ? `${desc} Current: ${selected.join(", ")}` : desc)
    .addDropdown((dropdown) => {
      if (!folders.length) dropdown.addOption("", "No folders found");
      for (const folder of folders) dropdown.addOption(folder, folder);
      dropdown.setValue(choice).onChange((value) => { choice = value; });
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
  for (const folder of selected) {
    new Setting(containerEl).setName(folder).setDesc("Excluded folder").addButton((button) => button.setButtonText("Remove").onClick(async () => {
      plugin.settings[key] = selected.filter((item) => item !== folder).join(", ");
      plugin.semanticIndex = [];
      plugin.settings.semanticIndexMeta = {};
      await plugin.saveSemanticIndex();
      await plugin.saveSettings();
      new Notice("Folder removed. Reopen this settings tab to refresh the folder list.");
    }));
  }
}

function textAreaSetting(containerEl, name, plugin, key) {
  const setting = new Setting(containerEl).setName(name).setDesc(settingDescription(name, key)).addTextArea((text) => text.setValue(plugin.settings[key] || "").onChange(async (value) => {
    plugin.settings[key] = value;
    await plugin.saveSettings();
  }));
  setting.settingEl.addClass("semantic-todoist-setting");
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

function promptTemplateFileText(template) {
  return [
    "---",
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
  const provider = usesGeminiChatModel(settings.chatModel) ? "Gemini" : usesOpenAIChatModel(settings.chatModel) ? "OpenAI" : "AI";
  const keyReady = usesGeminiChatModel(settings.chatModel) ? Boolean(settings.googleApiKey) : Boolean(settings.openaiApiKey);
  const embeddingReady = usesGeminiEmbeddingModel(settings.embeddingModel) ? Boolean(settings.googleApiKey) : Boolean(settings.openaiApiKey);
  return `${provider} is selected. Chat key: ${keyReady ? "set" : "missing"}. Embedding key: ${embeddingReady ? "set" : "missing"}. Model list: ${settings.modelsFetchedAt || settings.geminiModelsFetchedAt ? "loaded" : "not loaded"}.`;
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
  return `Requires AI + Todoist first. Optional Cloudflare Worker URL: ${settings.workerUrl ? "set" : "missing"}. Worker token: ${settings.workerToken ? "set" : "missing"}. Automatic processing: ${settings.autoProcessEmails ? "on" : "off"}.`;
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
  const bytes = pluginOrSettings.semanticIndexStats ? ` File: ${formatBytes(pluginOrSettings.semanticIndexStats.bytes || 0)}.` : "";
  const chunks = Number(meta.chunks || pluginOrSettings.semanticIndex?.length || 0);
  if (chunks && meta.rebuiltAt) return `${chunks} chunks. Model: ${meta.model}. Rebuilt: ${meta.rebuiltAt}.${bytes}`;
  if (chunks) return `${chunks} partial chunks are available, but no completed rebuild is recorded.${bytes} Rebuild the semantic vault index.`;
  if (pluginOrSettings.semanticIndexStats?.bytes) return `No semantic index chunks are available. ${bytes} Rebuild the semantic vault index.`;
  return "No semantic index has been built yet.";
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

function localLogSummary(settings) {
  const entries = settings.localLog || [];
  if (!entries.length) return "No local activity logged yet.";
  return entries.slice(0, 5).map((entry) => `${entry.at}: ${entry.message}`).join(" | ");
}

function activityLogText(settings) {
  const entries = settings.localLog || [];
  if (!entries.length) return "No local activity logged yet.";
  return entries.slice(0, 12).map((entry) => `${entry.at}  ${entry.message}  ${JSON.stringify(entry.data || {})}`).join("\n");
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
    required: ["tasks"]
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

function cleanTask(task, allowedLabels = null, settings = DEFAULT_SETTINGS) {
  return cleanTaskWithRole(task, allowedLabels, false, settings);
}

function cleanTaskWithRole(task, allowedLabels = null, isSubtask = false, settings = DEFAULT_SETTINGS) {
  const labels = isSubtask && !settings.subtaskIncludeLabels
    ? []
    : (task.labels || []).map(cleanLabel).filter(Boolean).filter((label) => !allowedLabels || allowedLabels.has(label.toLowerCase()));
  return {
    content: clamp(singleLine(task.content || ""), 250),
    description: isSubtask ? "" : cleanGeneratedDescriptionSummary(task.description || ""),
    due_date: validDate(task.due_date) && (!isSubtask || settings.subtaskIncludeDueDate) ? task.due_date : null,
    deadline_date: validDate(task.deadline_date) && (!isSubtask || settings.subtaskIncludeDeadline) ? task.deadline_date : null,
    priority: isSubtask && !settings.subtaskIncludePriority ? 1 : normalizePriority(task.priority),
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
      const indent = " ".repeat(Math.max(2, settings.subtaskIndentSpaces || 4));
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
  return { created: 0, updated: 0, relinked: 0, deleted: 0, normalized: 0, conflicts: 0 };
}

function mergeSyncStats(target, source) {
  for (const key of Object.keys(emptySyncStats())) target[key] = (target[key] || 0) + (source?.[key] || 0);
  if (source?.staleReferences) target.staleReferences = (target.staleReferences || 0) + source.staleReferences;
  return target;
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

function referenceRebuildWorkerCount(settings = DEFAULT_SETTINGS) {
  return Math.max(1, Math.min(8, parseInt(settings.referenceRebuildWorkerCount, 10) || DEFAULT_SETTINGS.referenceRebuildWorkerCount || 1));
}

function activeWorkflowStatusParts(plugin, currentStatus = "Ready") {
  const fileSyncCount = plugin.fileSyncInProgress?.size || 0;
  const indexCount = plugin.pendingIndexPaths?.size || 0;
  const parts = [];
  if (plugin.emailProcessingInProgress) parts.push({ label: "Email", value: "processing" });
  if (plugin.syncInProgress) parts.push({ label: "Notes", value: `syncing${fileSyncCount ? ` ${fileSyncCount}` : ""}` });
  else if (plugin.noteSyncTimer) parts.push({ label: "Notes", value: "queued" });
  if (plugin.syncInProgress || plugin.emailProcessingInProgress) parts.push({ label: "Todoist", value: "syncing" });
  if (plugin.semanticIndexInProgress) parts.push({ label: "Index", value: "updating" });
  else if (indexCount) parts.push({ label: "Index", value: `queued ${indexCount}` });
  else if (plugin.semanticIndexTimer) parts.push({ label: "Index", value: "queued" });
  if (plugin.referenceRebuildInProgress) parts.push({ label: "Refs", value: "reconciling" });
  const maxParts = /^ready$/i.test(singleLine(currentStatus || "")) ? 3 : 2;
  return parts.slice(0, maxParts);
}

function isReferenceRebuildCandidate(line, settings = DEFAULT_SETTINGS) {
  if (!/^\s*[-*]\s+\[[ xX]\]/.test(line)) return false;
  const includeLegacy = shouldConvertLegacyTodoistIds(settings);
  return line.includes(settings.syncTag) ||
    line.includes(settings.subtaskSyncTag) ||
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

function referenceCacheEntry(id, task, settings = DEFAULT_SETTINGS, previous = null) {
  const description = task.isSubtask ? "" : sanitizeStoredTodoistDescription(task.description || previous?.description || "", settings);
  const noteRefs = mergeNoteReferences(previous?.noteRefs || [], [noteReferenceForTask(task, task.oid)]);
  return {
    oid: task.oid,
    path: task.path,
    lineNumber: task.lineNumber,
    content: task.content,
    description,
    labels: task.labels || [],
    priority: normalizePriority(task.priority),
    due_date: task.due_date || null,
    deadline_date: task.deadline_date || null,
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
    oid: oid || task?.oid || "",
    path: task?.path || "",
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
  const fallbackDate = nextBusinessDate(5);
  for (const task of tasks || []) {
    task.section = sectionName;
    if (!task.deadline_date) task.deadline_date = task.due_date || fallbackDate;
    if (!task.due_date) task.due_date = task.deadline_date;
    for (const subtask of task.subtasks || []) {
      subtask.section = "";
      if (!settings.subtaskIncludeDueDate) subtask.due_date = null;
      if (!settings.subtaskIncludeDeadline) subtask.deadline_date = null;
      subtask.description = "";
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
  const section = task.section ? ` ///${task.section}` : "";
  const project = task.projectName ? ` ${projectMarker(task.projectName)}` : "";
  const link = oid ? ` ${oidLink(oid, id, settings)}` : "";
  const core = `- [${task.isCompleted ? "x" : " "}] ${singleLine(task.content)} ${tag}${labels ? ` ${labels}` : ""}${priority}`;
  return `${core}${section}${project}${deadline}${due}${link}`;
}

function preserveTaskIndent(originalLine, newLine) {
  const indent = (/^[ \t]*/.exec(originalLine || "") || [""])[0];
  return `${indent}${String(newLine || "").trimStart()}`;
}

function preflightTaskLine(line, settings) {
  if (!/^\s*[-*]\s+\[[ xX]\]/.test(line)) return line;
  let next = normalizeLegacySyncTags(normalizeLegacyReferenceMarkers(line, settings), settings);
  if (next.includes(settings.subtaskSyncTag) && !/^[ \t]+[-*]\s+\[[ xX]\]/.test(next)) {
    next = `${" ".repeat(Math.max(2, settings.subtaskIndentSpaces || 4))}${next.trimStart()}`;
  }
  if (next.includes(settings.subtaskSyncTag)) {
    next = next.replace(new RegExp(`(\\S(?:.*?\\S)?)\\s+(?:sub\\s+){1,}(${escapeRegExp(settings.subtaskSyncTag)}\\b)`, "i"), "$1 $2");
  }
  return next;
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
  return String(line || "").replace(/\s*%%\[p::\s*([^\]]+?)\s*\]%%+/g, "").replace(/[ \t]{2,}/g, " ").trimEnd();
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
    deadline_date: task.deadline_date || null,
    description: singleLine(task.description || ""),
    isCompleted: Boolean(task.isCompleted),
    section: task.section || ""
  });
}

function remoteTaskComparableSignature(remote, parsed, settings = DEFAULT_SETTINGS) {
  if (!remote) return "";
  const description = !parsed?.isSubtask && parsed?.descriptionShouldSync && isRichTodoistDescription(parsed.description)
    ? formatTodoistDescription(parsed.description, settings)
    : parsed?.description || "";
  return JSON.stringify({
    content: singleLine(remote.content || ""),
    labels: (remote.labels || []).map(cleanLabel).sort(),
    priority: normalizePriority(remote.priority),
    due_date: remote.dueDate || null,
    deadline_date: remote.deadlineDate || null,
    description: singleLine(description || ""),
    isCompleted: Boolean(remote.isCompleted),
    section: parsed?.section || ""
  });
}

function todoistUpdatePayload(task, remote = null, settings = DEFAULT_SETTINGS) {
  const updates = {};
  if (!remote || singleLine(remote.content || "") !== singleLine(task.content || "")) updates.content = task.content;
  const isSubtask = Boolean(task.isSubtask);
  const localLabels = (isSubtask && !settings.subtaskIncludeLabels ? [] : (task.labels || [])).map(cleanLabel).filter(Boolean).sort();
  const remoteLabels = (remote?.labels || []).map(cleanLabel).filter(Boolean).sort();
  if (!remote || JSON.stringify(localLabels) !== JSON.stringify(remoteLabels)) updates.labels = localLabels;
  const localPriority = isSubtask && !settings.subtaskIncludePriority ? 1 : normalizePriority(task.priority);
  if (!remote || normalizePriority(remote.priority) !== localPriority) updates.priority = localPriority;
  const localDescription = !task.isSubtask && task.descriptionShouldSync && isRichTodoistDescription(task.description)
    ? formatTodoistDescription(task.description, settings)
    : "";
  if (localDescription && (!remote || String(remote.description || "").trim() !== localDescription.trim())) updates.description = localDescription;
  if (task.due_date && (!isSubtask || settings.subtaskIncludeDueDate) && (!remote || (remote.dueDate || "") !== task.due_date)) updates.due_date = task.due_date;
  if (task.deadline_date && (!isSubtask || settings.subtaskIncludeDeadline) && (!remote || (remote.deadlineDate || "") !== task.deadline_date)) updates.deadline_date = task.deadline_date;
  return updates;
}

function pendingTaskKey(path, task) {
  return `${path || ""}::${singleLine(task.content || "").toLowerCase()}::${task.section || ""}::${task.due_date || ""}::${task.deadline_date || ""}`;
}

function pendingTaskContentKey(path, task) {
  return `${path || ""}::content::${singleLine(task.content || "").toLowerCase()}`;
}

function pendingTaskOidKey(path, oid) {
  return `${path || ""}::oid::${String(oid || "").toUpperCase()}`;
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
  const isSyncTask = normalizedLine.includes(settings.syncTag) || normalizedLine.includes(settings.subtaskSyncTag);
  if (!isSyncTask) return null;
  const oid = getTaskOid(line);
  const id = getTodoistId(line, settings);
  const isSubtask = normalizedLine.includes(settings.subtaskSyncTag);
  const parentReference = parentReferenceForLine(lineNumber, allLines, settings, isSubtask);
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
    section: extractSection(line),
    projectName: extractProjectName(line),
    description: obsidianDescription(path)
  };
}

function parseTaskReferenceLine(line, lineNumber, path, settings) {
  if (!/^\s*[-*]\s+\[[ xX]\]/.test(line)) return null;
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
    section: extractSection(line),
    projectName: extractProjectName(line),
    description: obsidianDescription(path)
  };
}

function todoistArgsFromParsedTask(task, projectId, parent, sectionId, settings = DEFAULT_SETTINGS) {
  const isSubtask = Boolean(parent || task.isSubtask);
  const args = {
    content: task.content,
    labels: isSubtask && !settings.subtaskIncludeLabels ? [] : task.labels,
    priority: isSubtask && !settings.subtaskIncludePriority ? 1 : task.priority
  };
  if (!parent && !task.isSubtask && isRichTodoistDescription(task.description)) args.description = formatTodoistDescription(task.description, settings);
  if (parent) args.parent_id = parent;
  else if (sectionId) args.section_id = sectionId;
  else args.project_id = projectId;
  if (task.due_date && (!isSubtask || settings.subtaskIncludeDueDate)) args.due = { date: task.due_date };
  if (task.deadline_date && (!isSubtask || settings.subtaskIncludeDeadline)) args.deadline = { date: task.deadline_date };
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
  return Boolean(settings && (text.includes(settings.syncTag) || text.includes(settings.subtaskSyncTag)));
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
  }
  return "";
}

function oidForTodoistId(settings, todoistId) {
  return settings?.taskCache?.[todoistId]?.oid || "";
}

function generateUniqueOid(settings) {
  const used = new Set(Object.values(settings?.taskCache || {}).map((task) => String(task.oid || "").toUpperCase()).filter(Boolean));
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const oid = Math.random().toString(36).replace(/[^a-z0-9]/gi, "").slice(2, 7).toUpperCase().padEnd(5, "0");
    if (!used.has(oid)) return oid;
  }
  return uuid().replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase();
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

function extractSection(line) {
  return (/\/\/\/([\w/-]+)/.exec(line) || [])[1] || "";
}

function extractProjectName(line) {
  return singleLine((/%%\[p::\s*([^\]]+?)\s*\]%%+/.exec(line) || [])[1] || "");
}

function indentationLevel(line) {
  const indent = (/^[ \t]*/.exec(line) || [""])[0];
  let level = 0;
  let spaces = 0;
  for (const char of indent) {
    if (char === "\t") {
      level += 1;
      spaces = 0;
    } else {
      spaces += 1;
      if (spaces === 2) {
        level += 1;
        spaces = 0;
      }
    }
  }
  return level;
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

function formatContext(chunks, maxChars, settings = DEFAULT_SETTINGS) {
  return clamp(chunks.map((chunk, index) => [
    `Context ${index + 1}: ${sourceReference(chunk)}`,
    chunk.matchRationale ? `Match rationale: ${chunk.matchRationale}` : "",
    chunk.matchScore ? `Match score: ${chunk.matchScore}` : "",
    "Relevant excerpt:",
    stripExcludedLinks(stripGeneratedActionItemsSection(chunk.text || ""), settings)
  ].filter(Boolean).join("\n")).join("\n\n---\n\n"), maxChars);
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

function contextCandidateScore(item) {
  return (item.semantic || 0) * 0.72 +
    Math.min(0.22, (item.lexical || 0) * 0.018) +
    Math.min(0.08, (item.title || 0) * 0.025) +
    (item.recency || 0);
}

function diversifyContextCandidates(candidates, limit) {
  const selected = [];
  const perPath = new Map();
  for (const item of candidates || []) {
    const path = item.chunk?.path || "";
    const count = perPath.get(path) || 0;
    if (count >= 3 && selected.length < Math.max(1, Math.floor(limit * 0.75))) continue;
    selected.push(item);
    perPath.set(path, count + 1);
    if (selected.length >= limit) break;
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
  return new Set((String(text || "").match(/#[\w/-]+/g) || []).map((label) => cleanLabel(label).toLowerCase()).filter(Boolean));
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

function addContextToTaskDescriptions(tasks, contextNotes, active, settings = DEFAULT_SETTINGS, contextChunks = []) {
  const sources = descriptionSourceList(active, contextNotes);
  for (const task of tasks || []) {
    const parentSummary = isUsefulDescriptionSummary(task.description, task.content, settings) ? task.description : fallbackActionSummary(task, active?.text || "", contextChunks, active?.title || "", settings);
    task.description = taskDescriptionWithSources(parentSummary, task.content, sources, settings);
    for (const subtask of task.subtasks || []) {
      subtask.description = "";
    }
  }
}

function taskDescriptionWithSources(taskSummary, taskTitle, sources, settings = DEFAULT_SETTINGS) {
  const summary = removeTitleEcho(conciseDescriptionSummary([cleanGeneratedDescriptionSummary(taskSummary, settings)], settings), taskTitle);
  const parts = [];
  if (isUsefulDescriptionSummary(summary, taskTitle, settings)) parts.push(summary);
  if (sources) parts.push(sources);
  return formatTodoistDescription(parts.join("\n\n"), settings);
}

function isUsefulDescriptionSummary(value, taskTitle = "", settings = DEFAULT_SETTINGS) {
  const text = removeTitleEcho(cleanGeneratedDescriptionSummary(value || "", settings), taskTitle);
  if (text.length < 80) return false;
  if (/^use the source material to complete this task\.?$/i.test(text)) return false;
  if (/^(review|complete|action)\s+(the\s+)?(source|task|material)\b/i.test(text) && text.length < 140) return false;
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  return words.length >= 12;
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

function descriptionSourceList(active, contextNotes) {
  const lines = ["Source List:"];
  if (active?.path || active?.title) lines.push(`Primary Note: ${sourceReference(active)}`);
  const seen = new Set(active?.path ? [active.path] : []);
  const contextLines = [];
  for (const note of contextNotes || []) {
    if (!note.path || seen.has(note.path)) continue;
    seen.add(note.path);
    contextLines.push(sourceReference(note));
  }
  if (contextLines.length) {
    lines.push("Context Notes:");
    contextLines.forEach((line, index) => lines.push(`${index + 1}. ${line}`));
  }
  return lines.join("\n");
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
  const primary = rawLines.find((line) => /^primary note\s*:/i.test(line))?.replace(/^primary note\s*:\s*/i, "").trim();
  const context = rawLines
    .filter((line) => /^\d+\.\s*/.test(line))
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
  if (!primary && !context.length) return "";
  const lines = ["Source List:"];
  if (primary) lines.push(`Primary Note: ${primary}`);
  if (context.length) {
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
  const todoist = task.id ? ` Todoist: ${todoistTaskMarkdownLink(task.id, settings)}. OID: ${task.oid || "unknown"}.` : " No Todoist link.";
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
  return `- ${status}: ${task.content || "Untitled task"}.${due}${labels} Todoist: ${todoistTaskMarkdownLink(id, settings)}. OID: ${task.oid || "unknown"}.${source}`;
}

function todoistTaskMarkdownLink(id, settings = DEFAULT_SETTINGS) {
  const url = todoistTaskUrl(id, settings);
  return url ? `[Open task](${url})` : String(id || "");
}

function todoistTaskUrl(id, settings = DEFAULT_SETTINGS) {
  const taskId = String(id || "").trim();
  if (!taskId) return "";
  return settings.linksAppURI ? `todoist://task?id=${encodeURIComponent(taskId)}` : `https://todoist.com/app/task/${encodeURIComponent(taskId)}`;
}

function compressForTaskPrompt(text, maxChars, settings = DEFAULT_SETTINGS) {
  const cleaned = cleanupEmailText(stripExcludedLinks(String(text || ""), settings));
  const links = Array.from(new Set(cleaned.match(/https?:\/\/\S+/g) || []))
    .filter((url) => !isExcludedUrl(url, settings))
    .slice(0, 20);
  const actionLines = cleaned.split("\n").filter((line) => {
    const l = line.toLowerCase();
    return /please|action|todo|to do|follow up|review|send|confirm|complete|deadline|due|urgent|need|waiting|legal|finance|owner|assignee|client|customer|vendor|lawyer|accounting/.test(l);
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
  let score = 0;
  for (const [term, count] of Object.entries(queryTerms)) if (terms[term]) score += Math.min(3, terms[term]) * count;
  return score;
}

const STOP_WORDS = new Set("the and for that with this from are you your have will would could should about into email task tasks action required completed please thanks than then them they their there here what when where who why how our out not but can has had was were been being".split(" "));

function splitList(value) { return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
function trimSlashes(value) { return String(value || "").replace(/^\/+|\/+$/g, ""); }
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
function aiModelOptions(settings, key, listKey) {
  const options = [];
  if (key === "chatModel") {
    for (const model of settings.availableChatModels || []) options.push({ value: model, label: `OpenAI: ${model}` });
    const geminiModels = settings.availableGeminiModels?.length ? settings.availableGeminiModels : DEFAULT_SETTINGS.availableGeminiModels;
    for (const model of geminiModels) options.push({ value: `gemini/${normalizeGeminiModelId(model)}`, label: `Gemini: ${normalizeGeminiModelId(model)}` });
    return uniqueModelOptions(options);
  }
  if (key === "embeddingModel") {
    for (const model of settings.availableEmbeddingModels || []) options.push({ value: model, label: `OpenAI: ${model}` });
    const geminiModels = settings.availableGeminiEmbeddingModels?.length ? settings.availableGeminiEmbeddingModels : DEFAULT_SETTINGS.availableGeminiEmbeddingModels;
    for (const model of geminiModels) options.push({ value: `gemini/${normalizeGeminiModelId(model)}`, label: `Gemini: ${normalizeGeminiModelId(model)}` });
    return uniqueModelOptions(options);
  }
  return (settings[listKey] || []).map((model) => ({ value: model, label: model }));
}
function uniqueModelOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    if (!option.value || seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}
function modelDisplayName(value) {
  if (usesGeminiChatModel(value) || usesGeminiEmbeddingModel(value)) return `Gemini: ${normalizeGeminiModelId(value)}`;
  return `OpenAI: ${normalizeOpenAIModelId(value)}`;
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
function formatTodoistDescription(value, settings = DEFAULT_SETTINGS) {
  const max = Math.min(TODOIST_DESCRIPTION_LIMIT, Math.max(1, parseInt(settings.todoistDescriptionMaxChars, 10) || DEFAULT_SETTINGS.todoistDescriptionMaxChars));
  const cleaned = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length <= max ? cleaned : truncateAtWord(cleaned, max);
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
function obsidianDescription(path) { return `[${path}](obsidian://open?file=${encodeURIComponent(path)})`; }
function sourceReference(source) {
  const title = singleLine(source?.title || source?.basename || source?.path || "Untitled source");
  const path = singleLine(source?.path || "");
  return path && path !== title ? `${title} (${path})` : title;
}
function sectionKey(name) { return singleLine(name).toLowerCase(); }

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
    if (due && task.dueDate && task.dueDate !== due) return false;
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
  if (parsed.due_date && task.dueDate === parsed.due_date) score += 1;
  if (parsed.deadline_date && task.deadlineDate === parsed.deadline_date) score += 1;
  return score;
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
