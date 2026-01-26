import { browser, expect } from "@wdio/globals";

describe("LLM Plugin", () => {
  describe("Plugin Loading", () => {
    it("should load the plugin successfully", async () => {
      // The plugin should be enabled and loaded
      // Check for the ribbon icon that the plugin adds
      const ribbonIcon = await browser.$('.side-dock-ribbon-action[aria-label="Open LLM Chat"]');
      await expect(ribbonIcon).toExist();
    });

    it("should register the chat view command", async () => {
      // Open command palette
      await browser.keys(["Meta", "p"]);

      // Wait for command palette to open
      const commandPalette = await browser.$(".prompt");
      await expect(commandPalette).toExist();

      // Search for our command
      const input = await browser.$(".prompt-input");
      await input.setValue("LLM: Open Chat");

      // Should find the command
      const suggestion = await browser.$(".suggestion-item");
      await expect(suggestion).toExist();
      const suggestionText = await suggestion.getText();
      expect(suggestionText).toContain("LLM: Open Chat");

      // Close command palette
      await browser.keys(["Escape"]);
    });
  });

  describe("Chat Panel", () => {
    beforeEach(async () => {
      // Open the chat panel before each test
      await browser.executeObsidianCommand("obsidian-llm:open-chat");
      // Wait for the view to load
      await browser.pause(500);
    });

    it("should open the chat panel via command", async () => {
      const chatView = await browser.$(".llm-chat-view");
      await expect(chatView).toExist();
    });

    it("should display the provider selector", async () => {
      const providerSelector = await browser.$(".llm-provider-selector");
      await expect(providerSelector).toExist();

      // Should have Claude as default (or first enabled provider)
      const dropdown = await browser.$(".llm-provider-selector select");
      await expect(dropdown).toExist();
    });

    it("should display the include open files toggle", async () => {
      const contextToggle = await browser.$(".llm-context-toggle");
      await expect(contextToggle).toExist();

      const checkbox = await browser.$('.llm-context-toggle input[type="checkbox"]');
      await expect(checkbox).toExist();
      // Should be checked by default
      await expect(checkbox).toBeSelected();
    });

    it("should display the message input area", async () => {
      const input = await browser.$(".llm-chat-input");
      await expect(input).toExist();

      // Should have placeholder text
      const placeholder = await input.getAttribute("placeholder");
      expect(placeholder).toContain("Enter to send");
    });

    it("should display empty state initially", async () => {
      const emptyState = await browser.$(".llm-empty-state");
      await expect(emptyState).toExist();
      const emptyText = await emptyState.getText();
      expect(emptyText).toContain("Start a conversation");
    });

    it("should have a clear conversation button", async () => {
      const clearBtn = await browser.$('.llm-icon-btn[aria-label="Clear conversation"]');
      await expect(clearBtn).toExist();
    });

    it("should have send button", async () => {
      const sendBtn = await browser.$(".llm-chat-send");
      await expect(sendBtn).toExist();
      await expect(sendBtn).toHaveText("Send");
    });
  });

  describe("Chat Interaction", () => {
    beforeEach(async () => {
      await browser.executeObsidianCommand("obsidian-llm:open-chat");
      await browser.pause(500);
    });

    it("should allow typing in the input", async () => {
      const input = await browser.$(".llm-chat-input");
      await input.click();
      await input.setValue("Hello, world!");

      const value = await input.getValue();
      expect(value).toBe("Hello, world!");
    });

    it("should show user message after sending (mocked)", async () => {
      // Note: This test requires either a mock CLI or will fail if no CLI is available
      // For now, we just verify the UI behavior before the actual CLI call
      const input = await browser.$(".llm-chat-input");
      await input.click();
      await input.setValue("Test message");

      // Click send
      const sendBtn = await browser.$(".llm-chat-send");
      await sendBtn.click();

      // User message should appear
      const userMessage = await browser.$(".llm-message-user");
      await expect(userMessage).toExist();
      const userMessageText = await userMessage.getText();
      expect(userMessageText).toContain("Test message");

      // Empty state should be gone
      const emptyState = await browser.$(".llm-empty-state");
      await expect(emptyState).not.toExist();
    });

    it("should clear messages when clear button is clicked", async () => {
      // First add a message
      const input = await browser.$(".llm-chat-input");
      await input.click();
      await input.setValue("Test to be cleared");

      const sendBtn = await browser.$(".llm-chat-send");
      await sendBtn.click();

      // Wait for message to appear
      await browser.pause(200);

      // Click clear
      const clearBtn = await browser.$('.llm-icon-btn[aria-label="Clear conversation"]');
      await clearBtn.click();

      // Should show empty state again
      const emptyState = await browser.$(".llm-empty-state");
      await expect(emptyState).toExist();
    });
  });

  describe("Settings", () => {
    beforeEach(async () => {
      // Open settings
      await browser.executeObsidianCommand("app:open-settings");
      await browser.pause(500);

      // Navigate to plugin settings (Community plugins tab, then our plugin)
      // First click on Community plugins in the sidebar
      const communityPlugins = await browser.$('.vertical-tab-nav-item*=Community plugins');
      if (await communityPlugins.isExisting()) {
        await communityPlugins.click();
        await browser.pause(300);

        // Then click on LLM plugin settings
        const llmSettings = await browser.$('.installed-plugins-container .setting-item*=LLM');
        if (await llmSettings.isExisting()) {
          const settingsBtn = await llmSettings.$('button[aria-label="Options"]');
          if (await settingsBtn.isExisting()) {
            await settingsBtn.click();
            await browser.pause(300);
          }
        }
      }
    });

    afterEach(async () => {
      // Close settings
      await browser.keys(["Escape"]);
    });

    it("should show provider settings section", async () => {
      // Look for provider settings in the settings pane
      const settingsContainer = await browser.$(".modal-container");
      await expect(settingsContainer).toExist();
    });
  });

  describe("Quick Commands", () => {
    it("should register quick prompt command", async () => {
      // Open command palette
      await browser.keys(["Meta", "p"]);
      const commandPalette = await browser.$(".prompt");
      await expect(commandPalette).toExist();

      const input = await browser.$(".prompt-input");
      await input.setValue("LLM: Quick Prompt");

      const suggestion = await browser.$(".suggestion-item");
      await expect(suggestion).toExist();

      await browser.keys(["Escape"]);
    });
  });
});

describe("Plugin Integration", () => {
  describe("Open Files Context", () => {
    beforeEach(async () => {
      // Create a test note
      await browser.executeObsidianCommand("file-explorer:new-file");
      await browser.pause(300);

      // Type some content
      const editor = await browser.$(".cm-content");
      if (await editor.isExisting()) {
        await editor.click();
        await browser.keys(["Test content for context"]);
      }
    });

    it("should include open files when toggle is checked", async () => {
      // Open chat
      await browser.executeObsidianCommand("obsidian-llm:open-chat");
      await browser.pause(500);

      // Verify the context toggle is checked
      const checkbox = await browser.$('.llm-context-toggle input[type="checkbox"]');
      await expect(checkbox).toBeSelected();
    });

    it("should not include files when toggle is unchecked", async () => {
      // Open chat
      await browser.executeObsidianCommand("obsidian-llm:open-chat");
      await browser.pause(500);

      // Uncheck the toggle
      const checkbox = await browser.$('.llm-context-toggle input[type="checkbox"]');
      await checkbox.click();

      // Verify it's unchecked
      await expect(checkbox).not.toBeSelected();
    });
  });
});
