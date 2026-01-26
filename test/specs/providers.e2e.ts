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

// Fast models for testing each provider
const FAST_MODELS = {
  claude: "claude-3-5-haiku-latest",
  gemini: "gemini-2.0-flash-lite",
  opencode: "gpt-4o-mini",
  codex: "gpt-5-nano",
};

/**
 * Helper to configure a provider's model via plugin settings
 */
async function setProviderModel(provider: string, model: string): Promise<void> {
  await browser.execute(
    (p, m) => {
      const plugin = (window as any).app?.plugins?.plugins?.["obsidian-llm"];
      if (plugin?.settings?.providers?.[p]) {
        plugin.settings.providers[p].model = m;
        plugin.settings.providers[p].enabled = true;
        plugin.saveSettings();
      }
    },
    provider,
    model
  );
  await browser.pause(200);
}

/**
 * Helper to enable a provider
 */
async function enableProvider(provider: string): Promise<void> {
  await browser.execute((p) => {
    const plugin = (window as any).app?.plugins?.plugins?.["obsidian-llm"];
    if (plugin?.settings?.providers?.[p]) {
      plugin.settings.providers[p].enabled = true;
      plugin.saveSettings();
    }
  }, provider);
  await browser.pause(200);
}

/**
 * Helper to get current model for a provider
 */
async function getProviderModel(provider: string): Promise<string | undefined> {
  return await browser.execute((p) => {
    const plugin = (window as any).app?.plugins?.plugins?.["obsidian-llm"];
    return plugin?.settings?.providers?.[p]?.model;
  }, provider);
}

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
    before(async () => {
      // Configure Claude with fast model for testing
      await setProviderModel("claude", FAST_MODELS.claude);
    });

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

    it("should have fast model configured", async () => {
      const model = await getProviderModel("claude");
      expect(model).toBe(FAST_MODELS.claude);
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
    before(async () => {
      // Enable and configure Gemini with fast model
      await setProviderModel("gemini", FAST_MODELS.gemini);
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

    it("should be able to select Gemini provider when enabled", async () => {
      const dropdown = await browser.$(".llm-provider-selector select");
      await expect(dropdown).toExist();

      // Check if Gemini is an option
      const options = await dropdown.$$("option");
      let hasGemini = false;
      for (const opt of options) {
        if ((await opt.getValue()) === "gemini") {
          hasGemini = true;
          break;
        }
      }

      expect(hasGemini).toBe(true);
      await dropdown.selectByAttribute("value", "gemini");
      await browser.pause(200);
    });

    it("should have fast model configured", async () => {
      const model = await getProviderModel("gemini");
      expect(model).toBe(FAST_MODELS.gemini);
    });

    it("should send message and receive response @slow", async () => {
      const dropdown = await browser.$(".llm-provider-selector select");
      await dropdown.selectByAttribute("value", "gemini");
      await browser.pause(200);

      const input = await browser.$(".llm-chat-input");
      await input.click();
      await input.setValue("Say 'hello' and nothing else.");

      const sendBtn = await browser.$(".llm-chat-send");
      await sendBtn.click();

      await browser.pause(500);
      const userMessage = await browser.$(".llm-message-user");
      await expect(userMessage).toExist();

      await browser.waitUntil(
        async () => {
          const assistantMessage = await browser.$(".llm-message-assistant");
          return assistantMessage.isExisting();
        },
        { timeout: 60000, timeoutMsg: "No response from Gemini within timeout" }
      );

      const assistantMessage = await browser.$(".llm-message-assistant");
      await expect(assistantMessage).toExist();
    });
  });

  describe("Model Switching Tests @models @provider", () => {
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

    it("should switch Claude model and verify setting persists", async () => {
      // Set to sonnet first
      await setProviderModel("claude", "claude-sonnet-4-20250514");
      let model = await getProviderModel("claude");
      expect(model).toBe("claude-sonnet-4-20250514");

      // Switch to haiku
      await setProviderModel("claude", "claude-3-5-haiku-latest");
      model = await getProviderModel("claude");
      expect(model).toBe("claude-3-5-haiku-latest");
    });

    it("should switch Gemini model and verify setting persists", async () => {
      // Set to pro first
      await setProviderModel("gemini", "gemini-2.5-pro");
      let model = await getProviderModel("gemini");
      expect(model).toBe("gemini-2.5-pro");

      // Switch to flash
      await setProviderModel("gemini", "gemini-2.5-flash");
      model = await getProviderModel("gemini");
      expect(model).toBe("gemini-2.5-flash");

      // Switch to flash lite (fastest)
      await setProviderModel("gemini", "gemini-2.0-flash-lite");
      model = await getProviderModel("gemini");
      expect(model).toBe("gemini-2.0-flash-lite");
    });

    it("should switch Codex model and verify setting persists", async () => {
      await enableProvider("codex");

      // Set to gpt-5
      await setProviderModel("codex", "gpt-5");
      let model = await getProviderModel("codex");
      expect(model).toBe("gpt-5");

      // Switch to gpt-5-mini
      await setProviderModel("codex", "gpt-5-mini");
      model = await getProviderModel("codex");
      expect(model).toBe("gpt-5-mini");

      // Switch to gpt-5-nano (fastest)
      await setProviderModel("codex", "gpt-5-nano");
      model = await getProviderModel("codex");
      expect(model).toBe("gpt-5-nano");
    });

    it("should switch OpenCode model and verify setting persists", async () => {
      await enableProvider("opencode");

      // Set to claude-sonnet
      await setProviderModel("opencode", "claude-sonnet");
      let model = await getProviderModel("opencode");
      expect(model).toBe("claude-sonnet");

      // Switch to gpt-4o-mini
      await setProviderModel("opencode", "gpt-4o-mini");
      model = await getProviderModel("opencode");
      expect(model).toBe("gpt-4o-mini");
    });

    it("should clear model to use CLI default", async () => {
      // Set a model first
      await setProviderModel("claude", "claude-3-5-haiku-latest");
      let model = await getProviderModel("claude");
      expect(model).toBe("claude-3-5-haiku-latest");

      // Clear to use default
      await setProviderModel("claude", "");
      model = await getProviderModel("claude");
      expect(model).toBe("");
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

    it("should navigate to plugin settings", async () => {
      await browser.executeObsidianCommand("app:open-settings");
      await browser.pause(500);

      // Click on Community plugins in the sidebar
      const settingsSidebar = await browser.$(".vertical-tab-nav-item");
      await expect(settingsSidebar).toExist();

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

    // Use fast model for progress tests
    await setProviderModel("claude", FAST_MODELS.claude);
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
