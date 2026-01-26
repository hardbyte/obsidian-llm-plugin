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
 * Updated January 2026 - see each provider's documentation for latest models
 */
export const PROVIDER_MODELS: Record<LLMProvider, { value: string; label: string }[]> = {
  claude: [
    { value: "", label: "Default (CLI default)" },
    { value: "claude-opus-4-5-20251101", label: "Claude 4.5 Opus (most capable)" },
    { value: "claude-sonnet-4-5-20250929", label: "Claude 4.5 Sonnet" },
    { value: "claude-haiku-4-5-20251001", label: "Claude 4.5 Haiku (fast)" },
    { value: "claude-sonnet-4-20250514", label: "Claude 4 Sonnet" },
    { value: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
  ],
  gemini: [
    { value: "", label: "Default (CLI default)" },
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro (preview)" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview, fast)" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (fast)" },
  ],
  opencode: [
    { value: "", label: "Default (CLI default)" },
    { value: "anthropic/claude-sonnet-4-5", label: "Claude 4.5 Sonnet" },
    { value: "anthropic/claude-opus-4-5", label: "Claude 4.5 Opus" },
    { value: "anthropic/claude-haiku-4-5", label: "Claude 4.5 Haiku (fast)" },
    { value: "github-copilot/gpt-5", label: "GPT-5 (Copilot)" },
    { value: "github-copilot/gpt-5-mini", label: "GPT-5 Mini (Copilot, fast)" },
  ],
  codex: [
    { value: "", label: "Default (CLI default)" },
    { value: "o3", label: "o3 (reasoning)" },
    { value: "o4-mini", label: "o4-mini (reasoning, fast)" },
    { value: "gpt-5", label: "GPT-5" },
    { value: "gpt-5-mini", label: "GPT-5 Mini (fast)" },
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
