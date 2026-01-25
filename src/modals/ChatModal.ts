import { App, Modal, DropdownComponent, setIcon } from "obsidian";
import type LLMPlugin from "../../main";
import type { LLMProvider, ConversationMessage } from "../types";
import { LLMExecutor } from "../executor/LLMExecutor";

const PROVIDER_DISPLAY_NAMES: Record<LLMProvider, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  codex: "Codex",
  gemini: "Gemini",
};

export class ChatModal extends Modal {
  plugin: LLMPlugin;
  private executor: LLMExecutor;
  private messages: ConversationMessage[] = [];
  private currentProvider: LLMProvider;
  private isLoading = false;
  private messagesContainer: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;

  constructor(app: App, plugin: LLMPlugin) {
    super(app);
    this.plugin = plugin;
    this.executor = new LLMExecutor(plugin.settings);
    this.currentProvider = plugin.settings.defaultProvider;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-chat-modal");

    this.renderHeader(contentEl);
    this.renderMessages(contentEl);
    this.renderInput(contentEl);

    // Focus the input
    setTimeout(() => this.inputEl?.focus(), 50);
  }

  private renderHeader(container: HTMLElement) {
    const header = container.createDiv({ cls: "llm-chat-header" });
    header.createEl("h2", { text: "LLM Chat" });

    const providerSelector = header.createDiv({ cls: "llm-provider-selector" });
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

    // Clear conversation button
    const clearBtn = header.createEl("button", {
      cls: "llm-clear-btn",
      attr: { "aria-label": "Clear conversation" },
    });
    setIcon(clearBtn, "trash-2");
    clearBtn.addEventListener("click", () => {
      this.messages = [];
      this.renderMessagesContent();
    });
  }

  private renderMessages(container: HTMLElement) {
    this.messagesContainer = container.createDiv({ cls: "llm-chat-messages" });
    this.renderMessagesContent();
  }

  private renderMessagesContent() {
    if (!this.messagesContainer) return;
    this.messagesContainer.empty();

    if (this.messages.length === 0) {
      const emptyState = this.messagesContainer.createDiv({
        cls: "llm-empty-state",
      });
      emptyState.createEl("h3", { text: "Start a conversation" });
      emptyState.createEl("p", {
        text: "Type a message below to begin chatting with the LLM.",
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
      });
      headerEl.createSpan({
        text: new Date(msg.timestamp).toLocaleTimeString(),
      });

      const contentEl = msgEl.createDiv({ cls: "llm-message-content" });
      contentEl.setText(msg.content);
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

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.sendBtn = inputContainer.createEl("button", {
      text: "Send",
      cls: "llm-chat-send",
    });

    this.sendBtn.addEventListener("click", () => this.sendMessage());
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
    const contextPrompt = this.buildContextPrompt(prompt);

    try {
      // Stream callback for real-time updates
      let streamedContent = "";
      const onStream = (chunk: string) => {
        streamedContent += chunk;
        this.updateStreamingMessage(streamedContent);
      };

      const response = await this.executor.execute(
        contextPrompt,
        this.currentProvider,
        this.plugin.settings.streamOutput ? onStream : undefined
      );

      if (response.error) {
        this.showError(response.error);
      } else {
        // Remove streaming message if present
        this.removeStreamingMessage();

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
    }
  }

  private buildContextPrompt(currentPrompt: string): string {
    if (
      !this.plugin.settings.conversationHistory.enabled ||
      this.messages.length <= 1
    ) {
      // Include system prompt if set
      if (this.plugin.settings.systemPrompt) {
        return `System: ${this.plugin.settings.systemPrompt}\n\nUser: ${currentPrompt}`;
      }
      return currentPrompt;
    }

    // Build conversation history
    const maxMessages = this.plugin.settings.conversationHistory.maxMessages;
    const recentMessages = this.messages.slice(-maxMessages - 1, -1); // Exclude the message we just added

    let contextParts: string[] = [];

    if (this.plugin.settings.systemPrompt) {
      contextParts.push(`System: ${this.plugin.settings.systemPrompt}`);
    }

    recentMessages.forEach((msg) => {
      const role = msg.role === "user" ? "User" : "Assistant";
      contextParts.push(`${role}: ${msg.content}`);
    });

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
      });
      headerEl.createSpan({ text: "..." });

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

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    this.executor.cancel();
  }
}
