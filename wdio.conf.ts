import type { ObsidianServiceOptions } from "wdio-obsidian-service";
import * as path from "path";

const pluginDir = path.resolve(__dirname);
const vaultDir = path.resolve(__dirname, "test/vault");

export const config: WebdriverIO.Config = {
  //
  // ====================
  // Runner Configuration
  // ====================
  runner: "local",

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
      // Open the test vault
      "wdio:obsidianOptions": {
        vault: vaultDir,
        plugins: [pluginDir],
      },
    } as WebdriverIO.Capabilities,
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
        // Service options
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
