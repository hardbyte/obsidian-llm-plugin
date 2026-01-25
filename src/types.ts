/**
 * Supported LLM providers - CLI tools that can be invoked
 */
export type LLMProvider = "claude" | "opencode" | "codex" | "gemini";

/**
 * Configuration for a specific LLM provider
 */
export interface ProviderConfig {
  /** Whether this provider is enabled */
  enabled: boolean;
  /** Custom command to invoke (if different from default) */
  customCommand?: string;
  /** Additional CLI arguments */
  additionalArgs?: string[];
  /** Environment variables to set */
  envVars?: Record<string, string>;
  /** Timeout in seconds (optional - uses default if not set) */
  timeout?: number;
}

/**
 * Plugin settings
 */
export interface LLMPluginSettings {
  /** Default provider to use */
  defaultProvider: LLMProvider;
  /** Per-provider configurations */
  providers: Record<LLMProvider, ProviderConfig>;
  /** Where to insert LLM responses */
  insertPosition: "cursor" | "end" | "replace-selection";
  /** Whether to show streaming output */
  streamOutput: boolean;
  /** Path to system prompt file in vault (empty = none) */
  systemPromptFile: string;
  /** Default timeout in seconds for all providers */
  defaultTimeout: number;
  /** Conversation history settings */
  conversationHistory: {
    enabled: boolean;
    maxMessages: number;
  };
}

/**
 * Default provider configurations based on deliberate tool patterns
 */
export const DEFAULT_PROVIDER_CONFIGS: Record<LLMProvider, ProviderConfig> = {
  claude: {
    enabled: true,
  },
  opencode: {
    enabled: false,
  },
  codex: {
    enabled: false,
  },
  gemini: {
    enabled: false,
  },
};

/**
 * Default plugin settings
 */
export const DEFAULT_SETTINGS: LLMPluginSettings = {
  defaultProvider: "claude",
  providers: DEFAULT_PROVIDER_CONFIGS,
  insertPosition: "cursor",
  streamOutput: true,
  systemPromptFile: "",
  defaultTimeout: 120,
  conversationHistory: {
    enabled: true,
    maxMessages: 10,
  },
};

/**
 * Message in a conversation
 */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  provider: LLMProvider;
}

/**
 * Result from an LLM invocation
 */
export interface LLMResponse {
  content: string;
  provider: LLMProvider;
  tokensUsed?: {
    input: number;
    output: number;
  };
  durationMs: number;
  error?: string;
}
