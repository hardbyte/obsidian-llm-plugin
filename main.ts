import { Plugin } from "obsidian";
import type { LLMPluginSettings } from "./src/types";
import { DEFAULT_SETTINGS } from "./src/types";
import { LLMSettingTab } from "./src/settings/SettingsTab";

export default class LLMPlugin extends Plugin {
  settings: LLMPluginSettings;

  async onload() {
    await this.loadSettings();

    // Add settings tab
    this.addSettingTab(new LLMSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
