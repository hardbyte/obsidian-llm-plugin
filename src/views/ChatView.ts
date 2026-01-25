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
  private includeContextToggle: HTMLInputElement | null = null;
  private progressContainer: HTMLElement | null = null;
  private currentToolUse: string | null = null;
  private markdownComponents: Component[] = [];

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
  }

  private renderHeader(container: HTMLElement) {
    const header = container.createDiv({ cls: "llm-chat-header" });

    const titleRow = header.createDiv({ cls: "llm-chat-title-row" });
    titleRow.createEl("h4", { text: "LLM Chat" });

    // Clear conversation button
    const clearBtn = titleRow.createEl("button", {
      cls: "llm-icon-btn",
      attr: { "aria-label": "Clear conversation" },
    });
    setIcon(clearBtn, "trash-2");
    clearBtn.addEventListener("click", () => {
      this.messages = [];
      this.renderMessagesContent();
    });

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
    });

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
  }

  private renderMessages(container: HTMLElement) {
    this.messagesContainer = container.createDiv({ cls: "llm-chat-messages" });
    this.renderMessagesContent();
  }

  private renderMessagesContent() {
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

    this.messages.forEach((msg) => {
      const msgEl = this.messagesContainer!.createDiv({
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

      const contentEl = msgEl.createDiv({ cls: "llm-message-content" });

      if (msg.role === "assistant") {
        // Render assistant messages as markdown
        const component = new Component();
        component.load();
        this.markdownComponents.push(component);
        MarkdownRenderer.render(
          this.app,
          msg.content,
          contentEl,
          "",
          component
        );
      } else {
        // User messages as plain text
        contentEl.setText(msg.content);
      }
    });

    // Scroll to bottom
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private renderInput(container: HTMLElement) {
    const inputContainer = container.createDiv({ cls: "llm-chat-input-container" });

    this.inputEl = inputContainer.createEl("textarea", {
      cls: "llm-chat-input",
      attr: {
        placeholder: "Type your message... (Ctrl+Enter to send)",
        rows: "3",
      },
    });

    // Use capture phase and stop propagation to prevent Obsidian from intercepting
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
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

      const response = await this.executor.execute(
        contextPrompt,
        this.currentProvider,
        this.plugin.settings.streamOutput ? onStream : undefined,
        onProgress
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

    // Ensure progress container exists
    if (!this.progressContainer) {
      this.progressContainer = this.messagesContainer.createDiv({
        cls: "llm-progress-container",
      });
    }

    switch (event.type) {
      case "tool_use":
        this.currentToolUse = event.tool;
        this.updateProgressDisplay(`Using tool: ${event.tool}`, "tool");
        break;

      case "thinking":
        if (event.content) {
          this.updateProgressDisplay("Thinking...", "thinking");
        }
        break;

      case "status":
        this.updateProgressDisplay(event.message, "status");
        break;

      case "text":
        // Text events are handled by onStream callback
        break;
    }
  }

  /**
   * Update the progress display
   */
  private updateProgressDisplay(message: string, type: "tool" | "thinking" | "status") {
    if (!this.progressContainer) return;

    this.progressContainer.empty();

    const iconName = type === "tool" ? "wrench" : type === "thinking" ? "brain" : "loader";

    const progressEl = this.progressContainer.createDiv({ cls: `llm-progress llm-progress-${type}` });
    const iconEl = progressEl.createSpan({ cls: "llm-progress-icon" });
    setIcon(iconEl, iconName);
    progressEl.createSpan({ text: message, cls: "llm-progress-text" });

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
  }

  private async buildContextPrompt(currentPrompt: string): Promise<string> {
    const systemPrompt = await this.getSystemPrompt();
    const includeContext = this.includeContextToggle?.checked ?? false;
    const openFilesContext = includeContext ? this.getOpenFilesContext() : "";

    const contextParts: string[] = [];

    // Add system prompt if set
    if (systemPrompt) {
      contextParts.push(`System: ${systemPrompt}`);
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
    if (this.sendBtn) {
      this.sendBtn.disabled = loading;
      this.sendBtn.setText(loading ? "..." : "Send");
    }
    if (this.inputEl) {
      this.inputEl.disabled = loading;
    }

    if (loading && this.messagesContainer) {
      // Add loading indicator
      const loadingEl = this.messagesContainer.createDiv({ cls: "llm-loading" });
      loadingEl.createDiv({ cls: "llm-loading-spinner" });
      loadingEl.createSpan({ text: "Thinking..." });
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    } else if (!loading && this.messagesContainer) {
      // Remove loading indicator
      const loadingEl = this.messagesContainer.querySelector(".llm-loading");
      loadingEl?.remove();
    }
  }

  private updateStreamingMessage(content: string) {
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

    const contentEl = streamingEl.querySelector(".llm-message-content");
    if (contentEl) {
      contentEl.setText(content);
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
}
