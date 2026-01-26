import { Editor, MarkdownView, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import type { LLMPluginSettings, LLMProvider } from "./src/types";
import { DEFAULT_SETTINGS } from "./src/types";
import { LLMSettingTab } from "./src/settings/SettingsTab";
import { QuickPromptModal } from "./src/modals";
import { ChatView, CHAT_VIEW_TYPE } from "./src/views";
import { LLMExecutor, detectAvailableProviders } from "./src/executor/LLMExecutor";

export default class LLMPlugin extends Plugin {
  settings: LLMPluginSettings;
  private executor: LLMExecutor | null = null;
  private statusBarEl: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();

    // Initialize executor
    this.executor = new LLMExecutor(this.settings);

    // Register the chat view
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // Add ribbon icon for quick chat
    this.addRibbonIcon("message-square", "Open LLM Chat", () => {
      this.activateChatView();
    });

    // Add status bar item
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("llm-status-bar-item");
    this.updateStatusBar();

    // Command: Open LLM Chat
    this.addCommand({
      id: "open-llm-chat",
      name: "Open Chat",
      callback: () => {
        this.activateChatView();
      },
    });

    // Command: Quick Prompt
    this.addCommand({
      id: "quick-llm-prompt",
      name: "Quick Prompt",
      callback: () => {
        new QuickPromptModal(this.app, this).open();
      },
    });

    // Command: Send Selection to LLM
    this.addCommand({
      id: "send-selection-to-llm",
      name: "Send Selection to LLM",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }

        new QuickPromptModal(this.app, this, {
          initialText: selection,
          onResponse: (response) => {
            this.insertResponse(editor, response);
          },
        }).open();
      },
    });

    // Command: Summarize Selection
    this.addCommand({
      id: "summarize-selection",
      name: "Summarize Selection",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }

        new QuickPromptModal(this.app, this, {
          initialText: selection,
          promptPrefix: "Please summarize the following text concisely:",
          onResponse: (response) => {
            this.insertResponse(editor, response);
          },
        }).open();
      },
    });

    // Command: Explain Selection
    this.addCommand({
      id: "explain-selection",
      name: "Explain Selection",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }

        new QuickPromptModal(this.app, this, {
          initialText: selection,
          promptPrefix: "Please explain the following in simple terms:",
          onResponse: (response) => {
            this.insertResponse(editor, response);
          },
        }).open();
      },
    });

    // Command: Improve Writing
    this.addCommand({
      id: "improve-writing",
      name: "Improve Writing",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        const selection = editor.getSelection();
        if (!selection) {
          new Notice("No text selected");
          return;
        }

        new QuickPromptModal(this.app, this, {
          initialText: selection,
          promptPrefix:
            "Please improve the following text for clarity and readability while preserving the meaning:",
          onResponse: (response) => {
            this.insertResponse(editor, response);
          },
        }).open();
      },
    });

    // Command: Generate from Context
    this.addCommand({
      id: "generate-from-context",
      name: "Generate from Current Note Context",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        const content = editor.getValue();
        const cursor = editor.getCursor();

        new QuickPromptModal(this.app, this, {
          promptPrefix: `Given the following note content, please continue writing or answer questions about it:\n\n---\n${content.slice(0, 2000)}${content.length > 2000 ? "..." : ""}\n---\n\nYour request:`,
          onResponse: (response) => {
            this.insertResponse(editor, response);
          },
        }).open();
      },
    });

    // Command: Detect Available Providers
    this.addCommand({
      id: "detect-providers",
      name: "Detect Available Providers",
      callback: async () => {
        new Notice("Detecting available LLM providers...");
        const available = await detectAvailableProviders();
        if (available.length === 0) {
          new Notice("No LLM CLI tools detected. Please install claude, opencode, codex, or gemini CLI.");
        } else {
          new Notice(`Available providers: ${available.join(", ")}`);
        }
      },
    });

    // Add settings tab
    this.addSettingTab(new LLMSettingTab(this.app, this));
  }

  onunload() {
    this.executor?.cancel();
    // Detach all chat view leaves
    this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
  }

  /**
   * Activate or reveal the chat view panel
   */
  async activateChatView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

    if (leaves.length > 0) {
      // View already exists, reveal it
      leaf = leaves[0];
    } else {
      // Create a new leaf in the right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData ?? {});

    // Migration: handle old systemPrompt string setting
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oldData = loadedData as any;
    if (oldData?.systemPrompt && typeof oldData.systemPrompt === "string" && oldData.systemPrompt.trim()) {
      // Old inline system prompt exists - show migration notice
      new Notice(
        "System prompt settings have changed. Please create a note with your system prompt and select it in settings.",
        10000
      );
    }

    // Migration: handle old per-provider timeout (ensure defaultTimeout exists)
    if (this.settings.defaultTimeout === undefined) {
      this.settings.defaultTimeout = 120;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Update executor with new settings
    this.executor?.updateSettings(this.settings);
    this.updateStatusBar();
  }

  /**
   * Insert LLM response into the editor based on settings
   */
  private insertResponse(editor: Editor, response: string) {
    const position = this.settings.insertPosition;

    switch (position) {
      case "cursor":
        editor.replaceRange(response, editor.getCursor());
        break;

      case "end":
        const lastLine = editor.lastLine();
        const lastLineContent = editor.getLine(lastLine);
        editor.replaceRange(
          "\n\n" + response,
          { line: lastLine, ch: lastLineContent.length }
        );
        break;

      case "replace-selection":
        editor.replaceSelection(response);
        break;
    }

    new Notice("LLM response inserted");
  }

  /**
   * Update the status bar with current provider info
   * @param provider Optional provider to display (uses default if not specified)
   */
  updateStatusBar(provider?: LLMProvider) {
    if (!this.statusBarEl) return;

    const displayProvider = provider ?? this.settings.defaultProvider;
    const providerNames: Record<string, string> = {
      claude: "Claude",
      opencode: "OpenCode",
      codex: "Codex",
      gemini: "Gemini",
    };

    this.statusBarEl.empty();

    const indicator = this.statusBarEl.createSpan({ cls: "llm-status-indicator" });
    this.statusBarEl.createSpan({ text: ` LLM: ${providerNames[displayProvider] || displayProvider}` });

    // Check if provider is enabled
    if (this.settings.providers[displayProvider]?.enabled) {
      indicator.addClass("active");
    }
  }
}
