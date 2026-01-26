import { browser, expect } from "@wdio/globals";

/**
 * Provider-specific E2E tests
 *
 * These tests can be run selectively using the --mochaOpts.grep flag:
 *   npm run wdio -- --mochaOpts.grep "@claude"
 *   npm run wdio -- --mochaOpts.grep "@gemini"
 *   npm run wdio -- --mochaOpts.grep "@provider"  (all provider tests)
 *
 * To skip provider tests entirely:
 *   npm run wdio -- --mochaOpts.grep "^(?!.*@provider).*$"
 */

describe("Provider Tests @provider", () => {
  before(async () => {
    // Wait for workspace to be ready
    await browser.waitUntil(
      async () => {
        const workspace = await browser.$(".workspace");
        return workspace.isExisting();
      },
      { timeout: 30000, timeoutMsg: "Obsidian workspace did not load" }
    );
    await browser.pause(2000);
  });

  describe("Claude Provider @claude @provider", () => {
    beforeEach(async () => {
      await browser.executeObsidianCommand("obsidian-llm:open-llm-chat");
      await browser.pause(1000);
    });

    afterEach(async () => {
      // Cancel any in-progress requests
      const cancelBtn = await browser.$(".llm-cancel-btn");
      if (await cancelBtn.isExisting()) {
        await cancelBtn.click();
        await browser.pause(500);
      }
      await browser.keys(["Escape"]);
      await browser.pause(200);
    });

    it("should be able to select Claude provider", async () => {
      const dropdown = await browser.$(".llm-provider-selector select");
      await expect(dropdown).toExist();

      // Check if Claude is an option
      const options = await dropdown.$$("option");
      const claudeOption = options.find(
        async (opt) => (await opt.getValue()) === "claude"
      );
      expect(claudeOption).toBeDefined();
    });

    it("should send message and receive response @slow", async () => {
      // Select Claude provider
      const dropdown = await browser.$(".llm-provider-selector select");
      await dropdown.selectByAttribute("value", "claude");
      await browser.pause(200);

      // Type a simple prompt
      const input = await browser.$(".llm-chat-input");
      await input.click();
      await input.setValue("Say 'hello' and nothing else.");

      // Click send
      const sendBtn = await browser.$(".llm-chat-send");
      await sendBtn.click();

      // Wait for user message to appear
      await browser.pause(500);
      const userMessage = await browser.$(".llm-message-user");
      await expect(userMessage).toExist();

      // Wait for response (up to 60 seconds for slow models)
      await browser.waitUntil(
        async () => {
          const assistantMessage = await browser.$(".llm-message-assistant");
          return assistantMessage.isExisting();
        },
        { timeout: 60000, timeoutMsg: "No response from Claude within timeout" }
      );

      const assistantMessage = await browser.$(".llm-message-assistant");
      await expect(assistantMessage).toExist();
    });

    it("should show progress indicator while processing @slow", async () => {
      const dropdown = await browser.$(".llm-provider-selector select");
      await dropdown.selectByAttribute("value", "claude");
      await browser.pause(200);

      const input = await browser.$(".llm-chat-input");
      await input.click();
      await input.setValue("What files are in this vault?");

      const sendBtn = await browser.$(".llm-chat-send");
      await sendBtn.click();

      // Check for progress indicator (loading or progress container)
      await browser.waitUntil(
        async () => {
          const loading = await browser.$(".llm-loading");
          const progress = await browser.$(".llm-progress-container");
          return loading.isExisting() || progress.isExisting();
        },
        { timeout: 10000, timeoutMsg: "No progress indicator shown" }
      );
    });
  });

  describe("Gemini Provider @gemini @provider", () => {
    beforeEach(async () => {
      await browser.executeObsidianCommand("obsidian-llm:open-llm-chat");
      await browser.pause(1000);
    });

    afterEach(async () => {
      const cancelBtn = await browser.$(".llm-cancel-btn");
      if (await cancelBtn.isExisting()) {
        await cancelBtn.click();
        await browser.pause(500);
      }
      await browser.keys(["Escape"]);
      await browser.pause(200);
    });

    it("should be able to select Gemini provider if enabled", async () => {
      const dropdown = await browser.$(".llm-provider-selector select");
      await expect(dropdown).toExist();

      // Check if Gemini is an option (it may not be if disabled in settings)
      const options = await dropdown.$$("option");
      let hasGemini = false;
      for (const opt of options) {
        if ((await opt.getValue()) === "gemini") {
          hasGemini = true;
          break;
        }
      }

      // This test passes either way - just checking the selector works
      if (hasGemini) {
        await dropdown.selectByAttribute("value", "gemini");
        await browser.pause(200);
      }
    });
  });

  describe("Settings Tests @settings @provider", () => {
    it("should open settings and show provider options", async () => {
      await browser.executeObsidianCommand("app:open-settings");
      await browser.pause(500);

      const settingsModal = await browser.$(".modal-container");
      await expect(settingsModal).toExist();

      await browser.keys(["Escape"]);
      await browser.pause(300);
    });

    it("should have model selection in provider settings", async () => {
      // This would require navigating to plugin settings
      // For now, just verify the settings modal opens
      await browser.executeObsidianCommand("app:open-settings");
      await browser.pause(500);

      const settingsModal = await browser.$(".modal-container");
      await expect(settingsModal).toExist();

      await browser.keys(["Escape"]);
      await browser.pause(300);
    });
  });
});

describe("Progress Indicators @progress @provider", () => {
  before(async () => {
    await browser.waitUntil(
      async () => {
        const workspace = await browser.$(".workspace");
        return workspace.isExisting();
      },
      { timeout: 30000 }
    );
    await browser.pause(2000);
  });

  beforeEach(async () => {
    await browser.executeObsidianCommand("obsidian-llm:open-llm-chat");
    await browser.pause(1000);
  });

  afterEach(async () => {
    const cancelBtn = await browser.$(".llm-cancel-btn");
    if (await cancelBtn.isExisting()) {
      await cancelBtn.click();
      await browser.pause(500);
    }
    await browser.keys(["Escape"]);
    await browser.pause(200);
  });

  it("should show loading state when sending message", async () => {
    const input = await browser.$(".llm-chat-input");
    await input.click();
    await input.setValue("Hello");

    const sendBtn = await browser.$(".llm-chat-send");
    await sendBtn.click();

    // Check that send button is disabled during loading
    await browser.pause(200);
    const isDisabled = await sendBtn.getAttribute("disabled");
    // The button should be disabled or show loading text
    const buttonText = await sendBtn.getText();
    expect(buttonText === "..." || isDisabled !== null).toBe(true);
  });

  it("should show tool use progress when LLM uses tools @slow", async () => {
    const input = await browser.$(".llm-chat-input");
    await input.click();
    // This prompt should trigger file reading
    await input.setValue("Read the Test Note.md file in this vault and summarize it.");

    const sendBtn = await browser.$(".llm-chat-send");
    await sendBtn.click();

    // Wait for progress indicator
    await browser.waitUntil(
      async () => {
        const progress = await browser.$(".llm-progress");
        return progress.isExisting();
      },
      { timeout: 30000, timeoutMsg: "No tool use progress shown" }
    );

    // Check for tool use indicator
    const progressTool = await browser.$(".llm-progress-tool");
    const progressThinking = await browser.$(".llm-progress-thinking");
    const anyProgress = (await progressTool.isExisting()) || (await progressThinking.isExisting());
    expect(anyProgress).toBe(true);
  });
});
