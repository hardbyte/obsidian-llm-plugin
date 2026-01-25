import { App, Modal, DropdownComponent, Notice } from "obsidian";
import type LLMPlugin from "../../main";
import type { LLMProvider } from "../types";
import { LLMExecutor } from "../executor/LLMExecutor";

const PROVIDER_DISPLAY_NAMES: Record<LLMProvider, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  codex: "Codex",
  gemini: "Gemini",
};

export interface QuickPromptOptions {
  /** Initial text to populate the prompt (e.g., selected text) */
  initialText?: string;
  /** Callback when response is received */
  onResponse?: (response: string) => void;
  /** Optional prefix to add to the prompt (e.g., "Summarize this:") */
  promptPrefix?: string;
}

export class QuickPromptModal extends Modal {
  plugin: LLMPlugin;
  private executor: LLMExecutor;
  private currentProvider: LLMProvider;
  private options: QuickPromptOptions;
  private inputEl: HTMLTextAreaElement | null = null;
  private responseEl: HTMLElement | null = null;
  private submitBtn: HTMLButtonElement | null = null;
  private copyBtn: HTMLButtonElement | null = null;
  private insertBtn: HTMLButtonElement | null = null;
  private isLoading = false;
  private lastResponse = "";

  constructor(app: App, plugin: LLMPlugin, options: QuickPromptOptions = {}) {
    super(app);
    this.plugin = plugin;
    this.executor = new LLMExecutor(plugin.settings);
    this.currentProvider = plugin.settings.defaultProvider;
    this.options = options;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-quick-prompt-modal");

    this.renderHeader(contentEl);
    this.renderInput(contentEl);
    this.renderResponse(contentEl);
    this.renderActions(contentEl);

    // Focus the input
    setTimeout(() => this.inputEl?.focus(), 50);
  }

  private renderHeader(container: HTMLElement) {
    const header = container.createDiv({ cls: "llm-quick-prompt-header" });
    header.createEl("h2", { text: "Quick LLM Prompt" });

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
  }

  private renderInput(container: HTMLElement) {
    const inputContainer = container.createDiv({ cls: "llm-quick-prompt-input-container" });

    if (this.options.promptPrefix) {
      inputContainer.createEl("label", {
        text: this.options.promptPrefix,
        cls: "llm-quick-prompt-label",
      });
    }

    this.inputEl = inputContainer.createEl("textarea", {
      cls: "llm-quick-prompt-input",
      attr: {
        placeholder: "Enter your prompt... (Ctrl+Enter to submit)",
        rows: "6",
      },
    });

    // Pre-populate with initial text if provided
    if (this.options.initialText) {
      this.inputEl.value = this.options.initialText;
    }

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.submitPrompt();
      }
    });

    this.submitBtn = inputContainer.createEl("button", {
      text: "Submit",
      cls: "llm-quick-prompt-submit mod-cta",
    });

    this.submitBtn.addEventListener("click", () => this.submitPrompt());
  }

  private renderResponse(container: HTMLElement) {
    this.responseEl = container.createDiv({ cls: "llm-quick-prompt-response" });
    this.responseEl.style.display = "none";
  }

  private renderActions(container: HTMLElement) {
    const actionsContainer = container.createDiv({ cls: "llm-quick-prompt-actions" });
    actionsContainer.style.display = "none";

    this.copyBtn = actionsContainer.createEl("button", {
      text: "Copy to Clipboard",
      cls: "llm-quick-prompt-action",
    });

    this.copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(this.lastResponse);
      new Notice("Copied to clipboard");
    });

    this.insertBtn = actionsContainer.createEl("button", {
      text: "Insert into Document",
      cls: "llm-quick-prompt-action mod-cta",
    });

    this.insertBtn.addEventListener("click", () => {
      if (this.options.onResponse) {
        this.options.onResponse(this.lastResponse);
      }
      this.close();
    });
  }

  private async submitPrompt() {
    if (!this.inputEl || this.isLoading) return;

    let prompt = this.inputEl.value.trim();
    if (!prompt) return;

    // Add prefix if specified
    if (this.options.promptPrefix) {
      prompt = `${this.options.promptPrefix}\n\n${prompt}`;
    }

    // Add system prompt if set
    if (this.plugin.settings.systemPrompt) {
      prompt = `System: ${this.plugin.settings.systemPrompt}\n\nUser: ${prompt}`;
    }

    this.setLoading(true);

    try {
      const response = await this.executor.execute(prompt, this.currentProvider);

      if (response.error) {
        this.showResponse(`Error: ${response.error}`, true);
      } else {
        this.lastResponse = response.content;
        this.showResponse(response.content, false);
      }
    } catch (error) {
      this.showResponse(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        true
      );
    } finally {
      this.setLoading(false);
    }
  }

  private setLoading(loading: boolean) {
    this.isLoading = loading;
    if (this.submitBtn) {
      this.submitBtn.disabled = loading;
      this.submitBtn.setText(loading ? "Processing..." : "Submit");
    }
    if (this.inputEl) {
      this.inputEl.disabled = loading;
    }
  }

  private showResponse(content: string, isError: boolean) {
    if (!this.responseEl) return;

    this.responseEl.empty();
    this.responseEl.style.display = "block";

    if (isError) {
      this.responseEl.addClass("llm-error-message");
    } else {
      this.responseEl.removeClass("llm-error-message");
    }

    this.responseEl.setText(content);

    // Show action buttons if not an error
    const actionsContainer = this.responseEl.parentElement?.querySelector(
      ".llm-quick-prompt-actions"
    ) as HTMLElement;
    if (actionsContainer) {
      actionsContainer.style.display = isError ? "none" : "flex";
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    this.executor.cancel();
  }
}
