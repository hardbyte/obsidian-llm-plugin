import { App, PluginSettingTab, Setting } from "obsidian";
import type LLMPlugin from "../../main";
import type { LLMProvider } from "../types";

const PROVIDER_DISPLAY_NAMES: Record<LLMProvider, string> = {
  claude: "Claude (Anthropic)",
  opencode: "OpenCode",
  codex: "Codex (OpenAI)",
  gemini: "Gemini (Google)",
};

export class LLMSettingTab extends PluginSettingTab {
  plugin: LLMPlugin;

  constructor(app: App, plugin: LLMPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "LLM Integration Settings" });

    // Default provider dropdown
    new Setting(containerEl)
      .setName("Default Provider")
      .setDesc("Which LLM provider to use by default")
      .addDropdown((dropdown) => {
        const providers: LLMProvider[] = ["claude", "opencode", "codex", "gemini"];
        providers.forEach((provider) => {
          dropdown.addOption(provider, PROVIDER_DISPLAY_NAMES[provider]);
        });
        dropdown.setValue(this.plugin.settings.defaultProvider);
        dropdown.onChange(async (value) => {
          this.plugin.settings.defaultProvider = value as LLMProvider;
          await this.plugin.saveSettings();
        });
      });

    // Insert position
    new Setting(containerEl)
      .setName("Response Insert Position")
      .setDesc("Where to insert LLM responses in the document")
      .addDropdown((dropdown) => {
        dropdown.addOption("cursor", "At cursor position");
        dropdown.addOption("end", "At end of document");
        dropdown.addOption("replace-selection", "Replace selection");
        dropdown.setValue(this.plugin.settings.insertPosition);
        dropdown.onChange(async (value) => {
          this.plugin.settings.insertPosition = value as "cursor" | "end" | "replace-selection";
          await this.plugin.saveSettings();
        });
      });

    // Streaming output toggle
    new Setting(containerEl)
      .setName("Stream Output")
      .setDesc("Show LLM response as it streams in (when supported)")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.streamOutput);
        toggle.onChange(async (value) => {
          this.plugin.settings.streamOutput = value;
          await this.plugin.saveSettings();
        });
      });

    // System prompt
    new Setting(containerEl)
      .setName("Default System Prompt")
      .setDesc("System prompt to use for all LLM interactions (optional)")
      .addTextArea((textarea) => {
        textarea.setValue(this.plugin.settings.systemPrompt);
        textarea.inputEl.rows = 4;
        textarea.inputEl.cols = 50;
        textarea.onChange(async (value) => {
          this.plugin.settings.systemPrompt = value;
          await this.plugin.saveSettings();
        });
      });

    // Provider-specific settings
    containerEl.createEl("h3", { text: "Provider Settings" });

    const providers: LLMProvider[] = ["claude", "opencode", "codex", "gemini"];
    providers.forEach((provider) => {
      this.addProviderSettings(containerEl, provider);
    });

    // Conversation history settings
    containerEl.createEl("h3", { text: "Conversation History" });

    new Setting(containerEl)
      .setName("Enable Conversation History")
      .setDesc("Maintain context across multiple prompts in a session")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.conversationHistory.enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.conversationHistory.enabled = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Max History Messages")
      .setDesc("Maximum number of previous messages to include as context")
      .addSlider((slider) => {
        slider.setLimits(1, 50, 1);
        slider.setValue(this.plugin.settings.conversationHistory.maxMessages);
        slider.setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.conversationHistory.maxMessages = value;
          await this.plugin.saveSettings();
        });
      });
  }

  private addProviderSettings(containerEl: HTMLElement, provider: LLMProvider): void {
    const providerConfig = this.plugin.settings.providers[provider];
    const displayName = PROVIDER_DISPLAY_NAMES[provider];

    const detailsEl = containerEl.createEl("details", {
      cls: "llm-provider-details",
    });
    detailsEl.createEl("summary", { text: displayName });

    const settingsContainer = detailsEl.createDiv({ cls: "llm-provider-settings" });

    new Setting(settingsContainer)
      .setName("Enabled")
      .setDesc(`Enable ${displayName} as an available provider`)
      .addToggle((toggle) => {
        toggle.setValue(providerConfig.enabled);
        toggle.onChange(async (value) => {
          this.plugin.settings.providers[provider].enabled = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(settingsContainer)
      .setName("Custom Command")
      .setDesc("Override the default CLI command (leave empty for default)")
      .addText((text) => {
        text.setPlaceholder(this.getDefaultCommand(provider));
        text.setValue(providerConfig.customCommand ?? "");
        text.onChange(async (value) => {
          this.plugin.settings.providers[provider].customCommand = value || undefined;
          await this.plugin.saveSettings();
        });
      });

    new Setting(settingsContainer)
      .setName("Timeout (seconds)")
      .setDesc("Maximum time to wait for a response")
      .addSlider((slider) => {
        slider.setLimits(10, 600, 10);
        slider.setValue(providerConfig.timeout);
        slider.setDynamicTooltip();
        slider.onChange(async (value) => {
          this.plugin.settings.providers[provider].timeout = value;
          await this.plugin.saveSettings();
        });
      });
  }

  private getDefaultCommand(provider: LLMProvider): string {
    switch (provider) {
      case "claude":
        return "claude";
      case "opencode":
        return "opencode";
      case "codex":
        return "codex";
      case "gemini":
        return "gemini";
    }
  }
}
