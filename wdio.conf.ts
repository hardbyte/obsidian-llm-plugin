import type { ObsidianServiceOptions } from "wdio-obsidian-service";

export const config: WebdriverIO.Config = {
  //
  // ====================
  // Runner Configuration
  // ====================
  runner: "local",
  // Note: tsConfigPath removed as it causes issues with obsidian-launcher
  // Test files are compiled via tsx which auto-discovers tsconfig

  //
  // ==================
  // Specify Test Files
  // ==================
  specs: ["./test/specs/**/*.ts"],
  exclude: [],

  //
  // ============
  // Capabilities
  // ============
  maxInstances: 1,
  capabilities: [
    {
      browserName: "obsidian",
    },
  ],

  //
  // ===================
  // Test Configurations
  // ===================
  logLevel: "info",
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  //
  // Test runner services
  // ====================
  services: [
    [
      "obsidian",
      {
        // Path to the built plugin (will be installed into test vault)
        pluginDir: ".",
        // Path to test vault (will be created if it doesn't exist)
        vaultDir: "./test/vault",
        // Obsidian version to test against (default: latest)
        // obsidianVersion: "latest",
      } as ObsidianServiceOptions,
    ],
  ],

  //
  // Framework configuration
  // =======================
  framework: "mocha",

  //
  // Test reporters
  // ==============
  reporters: [
    [
      "obsidian",
      {
        // Use obsidian reporter which shows Obsidian version instead of Chromium
      },
    ],
  ],

  //
  // Mocha options
  // =============
  mochaOpts: {
    ui: "bdd",
    timeout: 120000, // Longer timeout for Obsidian startup and LLM operations
  },
};
