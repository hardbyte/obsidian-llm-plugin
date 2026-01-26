import {
  ItemView,
  WorkspaceLeaf,
  DropdownComponent,
  MarkdownRenderer,
  Notice,
  setIcon,
  TFile,
  MarkdownView,
  Component,
} from "obsidian";
import type LLMPlugin from "../../main";
import type { LLMProvider, ConversationMessage, ProgressEvent } from "../types";
import { LLMExecutor } from "../executor/LLMExecutor";

export const CHAT_VIEW_TYPE = "llm-chat-view";

const PROVIDER_DISPLAY_NAMES: Record<LLMProvider, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  codex: "Codex",
  gemini: "Gemini",
};

export class ChatView extends ItemView {
  plugin: LLMPlugin;
  private executor: LLMExecutor;
  private messages: ConversationMessage[] = [];
  private currentProvider: LLMProvider;
  private isLoading = false;
  private messagesContainer: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;
  private includeContextToggle: HTMLInputElement | null = null;
  private progressContainer: HTMLElement | null = null;
  private currentToolUse: string | null = null;
  private markdownComponents: Component[] = [];
  private toolHistory: string[] = [];
  private recentStatuses: string[] = [];
  private hasActiveSession = false; // Track if we have an active Claude session

  constructor(leaf: WorkspaceLeaf, plugin: LLMPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.executor = new LLMExecutor(plugin.settings);
    this.currentProvider = plugin.settings.defaultProvider;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "LLM Chat";
  }

  getIcon(): string {
    return "message-square";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("llm-chat-view");

    this.renderHeader(container as HTMLElement);
    this.renderMessages(container as HTMLElement);
    this.renderInput(container as HTMLElement);

    // Focus the input
    setTimeout(() => this.inputEl?.focus(), 50);
  }

  async onClose() {
    this.executor.cancel();
    // Clean up markdown components
    this.markdownComponents.forEach((c) => c.unload());
    this.markdownComponents = [];
    // Reset status bar to default provider
    this.plugin.updateStatusBar();
  }

  private renderHeader(container: HTMLElement) {
    const header = container.createDiv({ cls: "llm-chat-header" });

    const controlsRow = header.createDiv({ cls: "llm-chat-controls" });

    // Provider selector
    const providerSelector = controlsRow.createDiv({ cls: "llm-provider-selector" });
    providerSelector.createSpan({ text: "Provider: " });

    const dropdown = new DropdownComponent(providerSelector);

    const providers: LLMProvider[] = ["claude", "opencode", "codex", "gemini"];
    providers.forEach((provider) => {
      if (this.plugin.settings.providers[provider].enabled) {
        dropdown.addOption(provider, PROVIDER_DISPLAY_NAMES[provider]);
      }
    });

    dropdown.setValue(this.currentProvider);
    dropdown.onChange((value) => {
      this.currentProvider = value as LLMProvider;
      this.plugin.updateStatusBar(this.currentProvider);
    });

    // Update status bar to show initial provider
    this.plugin.updateStatusBar(this.currentProvider);

    // Include context toggle
    const contextToggle = controlsRow.createDiv({ cls: "llm-context-toggle" });
    const contextLabel = contextToggle.createEl("label", {
      cls: "llm-toggle-label",
    });
    this.includeContextToggle = contextLabel.createEl("input", {
      type: "checkbox",
      attr: { checked: "true" },
    });
    this.includeContextToggle.checked = true;
    contextLabel.createSpan({ text: " Include open files" });

    // Clear conversation button
    const clearBtn = controlsRow.createEl("button", {
      cls: "llm-icon-btn",
      attr: { "aria-label": "Clear conversation" },
    });
    setIcon(clearBtn, "trash-2");
    clearBtn.addEventListener("click", () => {
      this.messages = [];
      this.executor.clearSession(); // Clear Claude session when conversation is cleared
      this.renderMessagesContent();
    });
  }

  private renderMessages(container: HTMLElement) {
    this.messagesContainer = container.createDiv({ cls: "llm-chat-messages" });
    this.renderMessagesContent();
  }

  private async renderMessagesContent() {
    if (!this.messagesContainer) return;

    // Clean up old markdown components
    this.markdownComponents.forEach((c) => c.unload());
    this.markdownComponents = [];

    this.messagesContainer.empty();

    if (this.messages.length === 0) {
      const emptyState = this.messagesContainer.createDiv({
        cls: "llm-empty-state",
      });
      emptyState.createEl("p", { text: "Start a conversation with the LLM." });
      emptyState.createEl("p", {
        text: "Toggle 'Include open files' to provide context from your workspace.",
        cls: "llm-empty-hint",
      });
      return;
    }

    // Get source path for link resolution (use active file if available)
    const activeFile = this.app.workspace.getActiveFile();
    const sourcePath = activeFile?.path ?? "";

    for (const msg of this.messages) {
      const msgEl = this.messagesContainer.createDiv({
        cls: `llm-message llm-message-${msg.role}`,
      });

      const headerEl = msgEl.createDiv({ cls: "llm-message-header" });
      headerEl.createSpan({
        text: msg.role === "user" ? "You" : PROVIDER_DISPLAY_NAMES[msg.provider],
        cls: "llm-message-role",
      });
      headerEl.createSpan({
        text: new Date(msg.timestamp).toLocaleTimeString(),
        cls: "llm-message-time",
      });

      // Add action buttons for all messages
      const actionsEl = headerEl.createDiv({ cls: "llm-message-actions" });

      // Copy button (for both user and assistant messages)
      const copyBtn = actionsEl.createEl("button", {
        cls: "llm-action-btn",
        attr: { "aria-label": "Copy to clipboard" },
      });
      setIcon(copyBtn, "copy");
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(msg.content);
        new Notice("Copied to clipboard");
      });

      // Create note button (only for assistant messages)
      if (msg.role === "assistant") {
        const createNoteBtn = actionsEl.createEl("button", {
          cls: "llm-action-btn",
          attr: { "aria-label": "Create note from response" },
        });
        setIcon(createNoteBtn, "file-plus");
        createNoteBtn.addEventListener("click", () => this.createNoteFromMessage(msg));
      }

      const contentEl = msgEl.createDiv({ cls: "llm-message-content" });

      if (msg.role === "assistant") {
        // Render assistant messages as markdown
        const component = new Component();
        component.load();
        this.markdownComponents.push(component);
        await MarkdownRenderer.render(
          this.app,
          msg.content,
          contentEl,
          sourcePath,
          component
        );

        // Add click handlers for internal links (wiki links)
        contentEl.querySelectorAll("a.internal-link").forEach((link) => {
          link.addEventListener("click", (e) => {
            e.preventDefault();
            const href = link.getAttribute("data-href");
            if (href) {
              this.app.workspace.openLinkText(href, sourcePath);
            }
          });
        });
      } else {
        // User messages as plain text
        contentEl.setText(msg.content);
      }
    }

    // Scroll to bottom
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private renderInput(container: HTMLElement) {
    const inputContainer = container.createDiv({ cls: "llm-chat-input-container" });

    this.inputEl = inputContainer.createEl("textarea", {
      cls: "llm-chat-input",
      attr: {
        placeholder: "Type your message... (Enter to send, Shift+Enter for newline)",
        rows: "3",
      },
    });

    // Enter to send, Shift+Enter for newline (common chat pattern)
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        this.sendMessage();
      }
    }, true);

    const buttonRow = inputContainer.createDiv({ cls: "llm-input-buttons" });

    this.sendBtn = buttonRow.createEl("button", {
      text: "Send",
      cls: "llm-chat-send mod-cta",
    });
    this.sendBtn.addEventListener("click", () => this.sendMessage());

    this.cancelBtn = buttonRow.createEl("button", {
      text: "Cancel",
      cls: "llm-chat-cancel",
    });
    this.cancelBtn.style.display = "none";
    this.cancelBtn.addEventListener("click", () => this.cancelRequest());
  }

  /**
   * Cancel the current request
   */
  private cancelRequest() {
    this.executor.cancel();
    this.isLoading = false;
    this.updateButtonStates();
    this.clearProgress();
    new Notice("Request cancelled");
  }

  /**
   * Update send/cancel button visibility based on loading state
   */
  private updateButtonStates() {
    if (this.sendBtn) {
      this.sendBtn.style.display = this.isLoading ? "none" : "block";
      this.sendBtn.disabled = this.isLoading;
    }
    if (this.cancelBtn) {
      this.cancelBtn.style.display = this.isLoading ? "block" : "none";
    }
    if (this.inputEl) {
      this.inputEl.disabled = this.isLoading;
    }
  }

  /**
   * Get context from open files in the workspace
   */
  private getOpenFilesContext(): string {
    const openFiles: { path: string; content: string }[] = [];
    const activeFile = this.app.workspace.getActiveFile();

    // Get all open markdown views
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        const file = leaf.view.file;
        if (file) {
          const content = leaf.view.editor.getValue();
          // Truncate large files
          const truncatedContent =
            content.length > 4000
              ? content.slice(0, 4000) + "\n... (truncated)"
              : content;

          openFiles.push({
            path: file.path,
            content: truncatedContent,
          });
        }
      }
    });

    if (openFiles.length === 0) {
      return "";
    }

    // Build context string
    const contextParts: string[] = [];
    contextParts.push("=== Open Files Context ===\n");

    openFiles.forEach(({ path, content }) => {
      const isActive = activeFile?.path === path;
      contextParts.push(`--- ${path}${isActive ? " (active)" : ""} ---`);
      contextParts.push(content);
      contextParts.push("");
    });

    contextParts.push("=== End of Context ===\n");

    return contextParts.join("\n");
  }

  /**
   * Get today's daily note content if the Daily Notes plugin is enabled
   */
  private async getDailyNoteContext(): Promise<string> {
    // Check if daily-notes core plugin is enabled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internalPlugins = (this.app as any).internalPlugins;
    const dailyNotesPlugin = internalPlugins?.plugins?.["daily-notes"];

    if (!dailyNotesPlugin?.enabled) {
      return "";
    }

    // Get daily notes settings
    const settings = dailyNotesPlugin.instance?.options || {};
    const folder = settings.folder || "";
    const format = settings.format || "YYYY-MM-DD";

    // Format today's date according to the configured format
    const today = new Date();
    const dateStr = this.formatDate(today, format);

    // Build the path to today's daily note
    const fileName = `${dateStr}.md`;
    const filePath = folder ? `${folder}/${fileName}` : fileName;

    // Try to find and read the file
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      // Daily note doesn't exist yet for today
      return "";
    }

    try {
      const content = await this.app.vault.cachedRead(file);
      // Truncate if too large
      const truncatedContent =
        content.length > 4000
          ? content.slice(0, 4000) + "\n... (truncated)"
          : content;

      return `=== Today's Daily Note (${filePath}) ===\n${truncatedContent}\n=== End Daily Note ===\n`;
    } catch {
      return "";
    }
  }

  /**
   * Format a date according to a moment.js-style format string
   * Supports common tokens: YYYY, YY, MM, M, DD, D, ddd, dddd
   */
  private formatDate(date: Date, format: string): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayOfWeek = date.getDay();

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayNamesShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const quarterNum = Math.ceil(month / 3);

    return format
      .replace(/YYYY/g, String(year))
      .replace(/YY/g, String(year).slice(-2))
      .replace(/MMMM/g, monthNames[month - 1])
      .replace(/MMM/g, monthNamesShort[month - 1])
      .replace(/MM/g, String(month).padStart(2, "0"))
      .replace(/M/g, String(month))
      .replace(/DD/g, String(day).padStart(2, "0"))
      .replace(/D/g, String(day))
      .replace(/dddd/g, dayNames[dayOfWeek])
      .replace(/ddd/g, dayNamesShort[dayOfWeek])
      .replace(/Q/g, String(quarterNum));
  }

  /**
   * Read the system prompt from the configured file
   */
  private async getSystemPrompt(): Promise<string> {
    const filePath = this.plugin.settings.systemPromptFile;
    if (!filePath) return "";

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      new Notice(`System prompt file not found: ${filePath}`);
      return "";
    }

    try {
      return await this.app.vault.cachedRead(file);
    } catch (error) {
      new Notice(`Error reading system prompt file: ${error}`);
      return "";
    }
  }

  private async sendMessage() {
    if (!this.inputEl || this.isLoading) return;

    const prompt = this.inputEl.value.trim();
    if (!prompt) return;

    // Add user message
    const userMessage: ConversationMessage = {
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      provider: this.currentProvider,
    };
    this.messages.push(userMessage);
    this.renderMessagesContent();

    // Clear input
    this.inputEl.value = "";

    // Show loading state
    this.setLoading(true);

    // Build conversation context
    const contextPrompt = await this.buildContextPrompt(prompt);

    try {
      // Stream callback for real-time text updates
      let streamedContent = "";
      const onStream = (chunk: string) => {
        streamedContent = chunk; // chunk is cumulative
        this.updateStreamingMessage(streamedContent);
      };

      // Progress callback for tool use/thinking events
      const onProgress = (event: ProgressEvent) => {
        this.handleProgressEvent(event);
      };

      // Get vault path to use as working directory
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vaultPath = (this.app.vault.adapter as any).basePath as string | undefined;

      const response = await this.executor.execute(
        contextPrompt,
        this.currentProvider,
        this.plugin.settings.streamOutput ? onStream : undefined,
        onProgress,
        vaultPath
      );

      if (response.error) {
        this.showError(response.error);
      } else {
        // Remove streaming/progress elements
        this.removeStreamingMessage();
        this.clearProgress();

        // Add assistant message
        const assistantMessage: ConversationMessage = {
          role: "assistant",
          content: response.content,
          timestamp: Date.now(),
          provider: this.currentProvider,
        };
        this.messages.push(assistantMessage);
        this.renderMessagesContent();
      }
    } catch (error) {
      this.showError(error instanceof Error ? error.message : String(error));
    } finally {
      this.setLoading(false);
      this.clearProgress();
    }
  }

  /**
   * Handle progress events from the LLM executor
   */
  private handleProgressEvent(event: ProgressEvent) {
    if (!this.messagesContainer) return;

    // Ensure progress container exists (it should already from setLoading, but just in case)
    if (!this.progressContainer) {
      this.progressContainer = this.messagesContainer.createDiv({
        cls: "llm-progress-container",
      });
    }

    switch (event.type) {
      case "tool_use": {
        this.currentToolUse = event.tool;
        const toolDisplay = event.input
          ? `${event.tool}: ${event.input}`
          : event.tool;
        // Add to tool history if not a duplicate of the last one
        if (this.toolHistory[this.toolHistory.length - 1] !== toolDisplay) {
          this.toolHistory.push(toolDisplay);
        }
        this.updateProgressDisplay(toolDisplay, "tool");
        break;
      }

      case "thinking": {
        // Show thinking content if available, otherwise generic "Thinking..."
        // Allow up to 300 chars to show meaningful context
        const thinkingMessage = event.content
          ? event.content.slice(0, 300) + (event.content.length > 300 ? "..." : "")
          : "Thinking...";
        this.addRecentStatus(thinkingMessage.slice(0, 100)); // Keep recent status shorter
        this.updateProgressDisplay(thinkingMessage, "thinking");
        break;
      }

      case "status":
        // Don't add "Processing..." to history, it's too generic
        if (event.message !== "Processing...") {
          this.addRecentStatus(event.message);
        }
        this.updateProgressDisplay(event.message, "status");
        break;

      case "text":
        // Text events are handled by onStream callback
        break;
    }
  }

  /**
   * Add a status to recent history (keep last 3)
   */
  private addRecentStatus(status: string) {
    if (this.recentStatuses[this.recentStatuses.length - 1] !== status) {
      this.recentStatuses.push(status);
      if (this.recentStatuses.length > 3) {
        this.recentStatuses.shift();
      }
    }
  }

  /**
   * Collapse consecutive repeated tools into counts
   * e.g., ["glob: *.md", "glob: *.ts", "read: file.md", "read: other.md"]
   *    -> [{ name: "glob", detail: "*.md", count: 2 }, { name: "read", detail: "file.md", count: 2 }]
   * Preserves detail from first occurrence for display
   */
  private collapsedToolHistory(): { name: string; detail?: string; count: number }[] {
    const collapsed: { name: string; detail?: string; count: number }[] = [];

    for (const tool of this.toolHistory) {
      const colonIdx = tool.indexOf(":");
      const toolName = colonIdx > 0 ? tool.slice(0, colonIdx).trim() : tool;
      const detail = colonIdx > 0 ? tool.slice(colonIdx + 1).trim() : undefined;
      const last = collapsed[collapsed.length - 1];

      if (last && last.name === toolName) {
        last.count++;
      } else {
        collapsed.push({ name: toolName, detail, count: 1 });
      }
    }

    return collapsed;
  }

  /**
   * Check if a string looks like a file path
   */
  private isFilePath(str: string): boolean {
    // Matches absolute paths, relative paths, and common file extensions
    return /^[\/~.]/.test(str) || /\.[a-zA-Z0-9]{1,6}$/.test(str) || str.includes("/");
  }

  /**
   * Create a clickable file path element
   */
  private createFileLink(container: HTMLElement, filePath: string, prefix?: string) {
    if (prefix) {
      container.createSpan({ text: prefix });
    }

    const link = container.createEl("a", {
      text: filePath,
      cls: "llm-file-link",
      attr: { href: "#" },
    });

    link.addEventListener("click", (e) => {
      e.preventDefault();
      // Try to open the file - handle both vault-relative and absolute paths
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vaultPath = (this.app.vault.adapter as any).basePath as string;
      let relativePath = filePath;

      // If it's an absolute path, try to make it relative to the vault
      if (filePath.startsWith("/") && vaultPath && filePath.startsWith(vaultPath)) {
        relativePath = filePath.slice(vaultPath.length + 1);
      }

      // Try to open as a vault file
      const file = this.app.vault.getAbstractFileByPath(relativePath);
      if (file instanceof TFile) {
        const leaf = this.app.workspace.getLeaf(false);
        leaf.openFile(file);
      } else {
        // Fallback: try opening as link text
        this.app.workspace.openLinkText(relativePath, "");
      }
    });
  }

  /**
   * Update the progress display with tool history and current status
   */
  private updateProgressDisplay(message: string, type: "tool" | "thinking" | "status") {
    if (!this.progressContainer) return;

    this.progressContainer.empty();

    // Show collapsed tool history if we have any - each tool on its own line
    const collapsed = this.collapsedToolHistory();
    if (collapsed.length > 0) {
      const historyEl = this.progressContainer.createDiv({ cls: "llm-progress-history" });

      // Show tools with checkmarks for completed ones, each on its own line
      // All but the last are complete, last is current/in-progress
      collapsed.forEach((item, i) => {
        const isLast = i === collapsed.length - 1;
        const toolLine = historyEl.createDiv({ cls: "llm-tool-history-item" });

        // Add checkmark for completed items, spinner for in-progress
        if (!isLast) {
          toolLine.createSpan({ text: "✓ ", cls: "llm-tool-complete" });
        } else {
          toolLine.createSpan({ text: "› ", cls: "llm-tool-active" });
        }

        if (item.count > 1) {
          toolLine.createSpan({ text: `${item.name} `, cls: "llm-tool-name" });
          toolLine.createSpan({ text: `(${item.count}×)`, cls: "llm-tool-count" });
        } else if (item.detail && this.isFilePath(item.detail)) {
          // Make file paths clickable
          toolLine.createSpan({ text: `${item.name}: `, cls: "llm-tool-name" });
          this.createFileLink(toolLine, item.detail);
        } else if (item.detail) {
          toolLine.createSpan({ text: `${item.name}: `, cls: "llm-tool-name" });
          toolLine.createSpan({ text: item.detail, cls: "llm-tool-detail" });
        } else {
          toolLine.createSpan({ text: item.name, cls: "llm-tool-name" });
        }
      });
    }

    // Show current status with details
    const iconName = type === "tool" ? "wrench" : type === "thinking" ? "brain" : "loader";
    const progressEl = this.progressContainer.createDiv({ cls: `llm-progress llm-progress-${type}` });
    const iconEl = progressEl.createSpan({ cls: "llm-progress-icon" });
    setIcon(iconEl, iconName);

    // Check if the message contains a file path (e.g., "Read: /path/to/file.ts")
    const colonIdx = message.indexOf(":");
    if (colonIdx > 0) {
      const toolPart = message.slice(0, colonIdx + 1);
      const detailPart = message.slice(colonIdx + 1).trim();
      if (this.isFilePath(detailPart)) {
        const textEl = progressEl.createSpan({ cls: "llm-progress-text" });
        textEl.createSpan({ text: toolPart + " " });
        this.createFileLink(textEl, detailPart);
      } else {
        progressEl.createSpan({ text: message, cls: "llm-progress-text" });
      }
    } else {
      progressEl.createSpan({ text: message, cls: "llm-progress-text" });
    }

    this.messagesContainer!.scrollTop = this.messagesContainer!.scrollHeight;
  }

  /**
   * Clear the progress display
   */
  private clearProgress() {
    if (this.progressContainer) {
      this.progressContainer.remove();
      this.progressContainer = null;
    }
    this.currentToolUse = null;
    this.toolHistory = [];
    this.recentStatuses = [];
  }

  private async buildContextPrompt(currentPrompt: string): Promise<string> {
    const systemPrompt = await this.getSystemPrompt();
    const includeContext = this.includeContextToggle?.checked ?? false;
    const openFilesContext = includeContext ? this.getOpenFilesContext() : "";
    const dailyNoteContext = includeContext ? await this.getDailyNoteContext() : "";

    const contextParts: string[] = [];

    // Add system prompt if set
    if (systemPrompt) {
      contextParts.push(`System: ${systemPrompt}`);
    }

    // Add vault path and formatting hints
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vaultPath = (this.app.vault.adapter as any).basePath;
    if (vaultPath) {
      contextParts.push(`Obsidian Vault Path: ${vaultPath}`);
    }

    // Add formatting hints for Obsidian
    contextParts.push(
      "Formatting: When referencing Obsidian notes, use wiki links like [[Note Name]] or [[path/to/Note]] without backticks - they will render as clickable links."
    );

    // Add today's daily note context
    if (dailyNoteContext) {
      contextParts.push(dailyNoteContext);
    }

    // Add open files context
    if (openFilesContext) {
      contextParts.push(openFilesContext);
    }

    // Add conversation history if enabled
    if (
      this.plugin.settings.conversationHistory.enabled &&
      this.messages.length > 1
    ) {
      const maxMessages = this.plugin.settings.conversationHistory.maxMessages;
      const recentMessages = this.messages.slice(-maxMessages - 1, -1);

      recentMessages.forEach((msg) => {
        const role = msg.role === "user" ? "User" : "Assistant";
        contextParts.push(`${role}: ${msg.content}`);
      });
    }

    // Add current prompt
    contextParts.push(`User: ${currentPrompt}`);

    return contextParts.join("\n\n");
  }

  private setLoading(loading: boolean) {
    this.isLoading = loading;
    this.updateButtonStates();

    if (loading && this.messagesContainer) {
      // Create progress container immediately with initial "Processing..." status
      // This ensures there's always visible feedback even if progress events are delayed
      if (!this.progressContainer) {
        this.progressContainer = this.messagesContainer.createDiv({
          cls: "llm-progress-container",
        });
      }
      this.updateProgressDisplay("Processing...", "status");

      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    } else if (!loading && this.messagesContainer) {
      // Remove loading indicator if it exists
      const loadingEl = this.messagesContainer.querySelector(".llm-loading");
      loadingEl?.remove();
    }
  }

  private async updateStreamingMessage(content: string) {
    if (!this.messagesContainer) return;

    let streamingEl = this.messagesContainer.querySelector(
      ".llm-message-streaming"
    ) as HTMLElement;

    if (!streamingEl) {
      // Remove loading indicator
      const loadingEl = this.messagesContainer.querySelector(".llm-loading");
      loadingEl?.remove();

      // Create streaming message element
      streamingEl = this.messagesContainer.createDiv({
        cls: "llm-message llm-message-assistant llm-message-streaming",
      });

      const headerEl = streamingEl.createDiv({ cls: "llm-message-header" });
      headerEl.createSpan({
        text: PROVIDER_DISPLAY_NAMES[this.currentProvider],
        cls: "llm-message-role",
      });
      headerEl.createSpan({ text: "...", cls: "llm-message-time" });

      streamingEl.createDiv({ cls: "llm-message-content" });
    }

    const contentEl = streamingEl.querySelector(".llm-message-content") as HTMLElement;
    if (contentEl) {
      // Clear and render markdown
      contentEl.empty();
      const activeFile = this.app.workspace.getActiveFile();
      const sourcePath = activeFile?.path ?? "";

      // Use a temporary component for streaming renders
      const component = new Component();
      component.load();
      await MarkdownRenderer.render(
        this.app,
        content,
        contentEl,
        sourcePath,
        component
      );
      // Don't track this component - it gets replaced on each update
      component.unload();
    }

    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private removeStreamingMessage() {
    if (!this.messagesContainer) return;
    const streamingEl = this.messagesContainer.querySelector(
      ".llm-message-streaming"
    );
    streamingEl?.remove();
  }

  private showError(message: string) {
    if (!this.messagesContainer) return;

    const errorEl = this.messagesContainer.createDiv({ cls: "llm-error-message" });
    errorEl.setText(`Error: ${message}`);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  /**
   * Create a new note from an LLM response
   */
  private async createNoteFromMessage(msg: ConversationMessage) {
    // Generate a title from the first line or first few words
    const firstLine = msg.content.split("\n")[0];
    let title = firstLine
      .replace(/^#+\s*/, "") // Remove markdown headers
      .replace(/[\\/*?"<>|:]/g, "") // Remove invalid filename chars
      .trim();

    if (title.length > 50) {
      title = title.slice(0, 47) + "...";
    }
    if (!title) {
      title = `LLM Response ${new Date(msg.timestamp).toLocaleDateString()}`;
    }

    // Find a unique filename
    let fileName = `${title}.md`;
    let counter = 1;
    while (this.app.vault.getAbstractFileByPath(fileName)) {
      fileName = `${title} ${counter}.md`;
      counter++;
    }

    try {
      const file = await this.app.vault.create(fileName, msg.content);
      new Notice(`Created note: ${file.path}`);

      // Open the new file
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } catch (error) {
      new Notice(`Failed to create note: ${error}`);
    }
  }
}
