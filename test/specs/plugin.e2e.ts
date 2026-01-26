import { browser, expect } from "@wdio/globals";

describe("LLM Plugin", () => {
  // Wait for Obsidian to fully initialize before running tests
  before(async () => {
    // Wait for the workspace to be ready
    await browser.waitUntil(
      async () => {
        const workspace = await browser.$(".workspace");
        return workspace.isExisting();
      },
      { timeout: 30000, timeoutMsg: "Obsidian workspace did not load" }
    );
    // Give plugins time to initialize
    await browser.pause(2000);
  });

  describe("Plugin Loading", () => {
    it("should load the plugin successfully", async () => {
      // The plugin should be enabled and loaded
      // Check for the ribbon icon that the plugin adds
      const ribbonIcon = await browser.$(
        '.side-dock-ribbon-action[aria-label="Open LLM Chat"]'
      );
      await expect(ribbonIcon).toExist();
    });

    it("should register the chat view command", async () => {
      // Use executeObsidianCommand to verify the command exists and works
      // This is more reliable than keyboard shortcuts in the test environment
      await browser.executeObsidianCommand("obsidian-llm:open-llm-chat");
      await browser.pause(500);

      // Verify the chat view opened
      const chatView = await browser.$(".llm-chat-view");
      await expect(chatView).toExist();
    });
  });

  describe("Chat Panel", () => {
    beforeEach(async () => {
      // Open the chat panel before each test using the correct command ID
      await browser.executeObsidianCommand("obsidian-llm:open-llm-chat");
      // Wait for the view to load
      await browser.pause(1000);
    });

    afterEach(async () => {
      // Close any open modals
      await browser.keys(["Escape"]);
      await browser.pause(200);
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

      const checkbox = await browser.$(
        '.llm-context-toggle input[type="checkbox"]'
      );
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
      const clearBtn = await browser.$(
        '.llm-icon-btn[aria-label="Clear conversation"]'
      );
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
      await browser.executeObsidianCommand("obsidian-llm:open-llm-chat");
      await browser.pause(1000);
    });

    afterEach(async () => {
      await browser.keys(["Escape"]);
      await browser.pause(200);
    });

    it("should allow typing in the input", async () => {
      const input = await browser.$(".llm-chat-input");
      await input.click();
      await input.setValue("Hello, world!");

      const value = await input.getValue();
      expect(value).toBe("Hello, world!");
    });

    it("should show user message after clicking send", async () => {
      const input = await browser.$(".llm-chat-input");
      await input.click();
      await input.setValue("Test message");

      // Click send
      const sendBtn = await browser.$(".llm-chat-send");
      await sendBtn.click();

      // User message should appear
      await browser.pause(500);
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
      await browser.pause(500);

      // Click clear
      const clearBtn = await browser.$(
        '.llm-icon-btn[aria-label="Clear conversation"]'
      );
      await clearBtn.click();

      // Should show empty state again
      await browser.pause(300);
      const emptyState = await browser.$(".llm-empty-state");
      await expect(emptyState).toExist();
    });
  });

  describe("Quick Commands", () => {
    it("should register quick prompt command", async () => {
      // Use executeObsidianCommand to verify the command exists
      // This opens the quick prompt modal
      await browser.executeObsidianCommand("obsidian-llm:quick-llm-prompt");
      await browser.pause(500);

      // The quick prompt modal should be open
      const modal = await browser.$(".modal-container");
      await expect(modal).toExist();

      // Close the modal
      await browser.keys(["Escape"]);
      await browser.pause(300);
    });
  });
});

describe("Plugin Integration", () => {
  describe("Open Files Context", () => {
    it("should toggle context inclusion", async () => {
      // Open chat
      await browser.executeObsidianCommand("obsidian-llm:open-llm-chat");
      await browser.pause(1000);

      // Verify the context toggle exists and is checked
      const checkbox = await browser.$(
        '.llm-context-toggle input[type="checkbox"]'
      );
      await expect(checkbox).toExist();
      await expect(checkbox).toBeSelected();

      // Uncheck the toggle
      await checkbox.click();
      await browser.pause(200);

      // Verify it's unchecked
      await expect(checkbox).not.toBeSelected();

      // Check it again
      await checkbox.click();
      await browser.pause(200);
      await expect(checkbox).toBeSelected();
    });
  });
});
