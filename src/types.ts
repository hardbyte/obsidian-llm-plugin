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
  /** Model to use (provider-specific, e.g., "claude-3-5-haiku-latest", "gemini-2.0-flash") */
  model?: string;
  /** Custom command to invoke (if different from default) */
  customCommand?: string;
  /** Additional CLI arguments */
  additionalArgs?: string[];
  /** Environment variables to set */
  envVars?: Record<string, string>;
  /** Timeout in seconds (optional - uses default if not set) */
  timeout?: number;
  /** Gemini: Enable yolo mode (auto-confirm dangerous operations) */
  yoloMode?: boolean;
  /** Use ACP (Agent Client Protocol) for persistent connection (supported: claude, opencode, gemini) */
  useAcp?: boolean;
}

/**
 * Providers that support ACP (Agent Client Protocol)
 */
export const ACP_SUPPORTED_PROVIDERS: LLMProvider[] = ["claude", "opencode", "gemini"];

/**
 * Common model options per provider
 */
export const PROVIDER_MODELS: Record<LLMProvider, { value: string; label: string }[]> = {
  claude: [
    { value: "", label: "Default (CLI default)" },
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-20250514", label: "Claude Opus 4" },
    { value: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
    { value: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (fast)" },
  ],
  gemini: [
    { value: "", label: "Default (CLI default)" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (fast)" },
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  opencode: [
    { value: "", label: "Default (CLI default)" },
    { value: "claude-sonnet", label: "Claude Sonnet" },
    { value: "claude-haiku", label: "Claude Haiku (fast)" },
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini (fast)" },
  ],
  codex: [
    { value: "", label: "Default (CLI default)" },
    { value: "gpt-5", label: "GPT-5" },
    { value: "gpt-5-mini", label: "GPT-5 Mini (fast)" },
    { value: "gpt-5-nano", label: "GPT-5 Nano (fastest)" },
    { value: "gpt-4.1", label: "GPT-4.1" },
  ],
};

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
  /** Allow LLM to write/edit files (requires dangerous permissions) */
  allowFileWrites: boolean;
  /** Enable debug logging to console */
  debugMode: boolean;
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
  allowFileWrites: false,
  debugMode: false,
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

/**
 * Progress event types emitted during LLM execution
 */
export type ProgressEvent =
  | { type: "thinking"; content: string }
  | { type: "tool_use"; tool: string; input?: string; status?: "started" | "completed" }
  | { type: "text"; content: string }
  | { type: "status"; message: string };
