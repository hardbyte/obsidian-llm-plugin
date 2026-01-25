import { spawn, ChildProcess } from "child_process";
import type { LLMProvider, LLMResponse, ProviderConfig, LLMPluginSettings, ProgressEvent } from "../types";

/**
 * Token usage information extracted from CLI responses
 */
interface TokenUsage {
  input: number;
  output: number;
}

/**
 * Parsed response from a CLI tool
 */
interface ParsedResponse {
  content: string;
  tokens?: TokenUsage;
  cost?: number;
}

/**
 * Default CLI commands for each provider
 * Use streaming JSON for Claude to get progress events
 */
const DEFAULT_COMMANDS: Record<LLMProvider, string[]> = {
  claude: ["claude", "--output-format", "stream-json"],
  gemini: ["gemini", "-y", "--output-format", "json"],
  codex: ["codex", "exec", "--skip-git-repo-check"],
  opencode: ["opencode", "run", "--format", "json"],
};

/**
 * Parser functions for each provider's output format
 */
const PARSERS: Record<LLMProvider, (output: string) => ParsedResponse> = {
  claude: parseClaudeOutput,
  gemini: parseGeminiOutput,
  codex: parseCodexOutput,
  opencode: parseOpenCodeOutput,
};

/**
 * Parse Claude CLI streaming JSON output
 * With stream-json format, Claude outputs one JSON object per line
 */
function parseClaudeOutput(output: string): ParsedResponse {
  const textParts: string[] = [];
  const tokens: TokenUsage = { input: 0, output: 0 };
  let cost = 0;

  for (const line of output.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);

      // Handle different event types
      if (obj.type === "assistant" && obj.message?.content) {
        // Final message content
        for (const block of obj.message.content) {
          if (block.type === "text") {
            textParts.push(block.text);
          }
        }
      } else if (obj.type === "content_block_delta" && obj.delta?.text) {
        textParts.push(obj.delta.text);
      } else if (obj.type === "result" && obj.result) {
        // Legacy format fallback
        textParts.push(obj.result);
      } else if (obj.type === "message_delta" && obj.usage) {
        tokens.output = obj.usage.output_tokens || 0;
      } else if (obj.type === "message_start" && obj.message?.usage) {
        tokens.input = obj.message.usage.input_tokens || 0;
      } else if (obj.result) {
        // Simple result format
        textParts.push(obj.result);
      } else if (obj.cost_usd) {
        cost = obj.cost_usd;
      }
    } catch {
      // Not JSON, might be plain text
      if (line.trim() && !line.startsWith("{")) {
        textParts.push(line);
      }
    }
  }

  const content = textParts.join("").trim() || output;
  return {
    content,
    tokens: tokens.input > 0 || tokens.output > 0 ? tokens : undefined,
    cost: cost > 0 ? cost : undefined,
  };
}

/**
 * Parse Gemini CLI JSON output
 * Gemini outputs JSON with "response" key and "stats.tokens" for usage
 */
function parseGeminiOutput(output: string): ParsedResponse {
  try {
    const parsed = JSON.parse(output);
    const content =
      parsed.response ||
      parsed.content ||
      parsed.text ||
      JSON.stringify(parsed, null, 2);

    const tokens: TokenUsage | undefined =
      parsed.stats?.tokens || parsed.tokens
        ? {
            input: (parsed.stats?.tokens || parsed.tokens)?.input || 0,
            output: (parsed.stats?.tokens || parsed.tokens)?.output || 0,
          }
        : undefined;

    return { content, tokens };
  } catch {
    return { content: output };
  }
}

/**
 * Parse Codex CLI JSON lines output
 * Codex outputs one JSON object per line with event types
 */
function parseCodexOutput(output: string): ParsedResponse {
  const textParts: string[] = [];
  const tokens: TokenUsage = { input: 0, output: 0 };
  let lastMessageContent: string | null = null;

  for (const line of output.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const eventType = obj.type || "";

      if (eventType === "message.completed") {
        const contentList = obj.message?.content || [];
        for (const item of contentList) {
          if (item.type === "text" && item.text) {
            lastMessageContent = item.text;
          }
        }
      } else if (eventType === "item.completed") {
        const item = obj.item || {};
        if (["text", "output_text"].includes(item.type) && item.text) {
          textParts.push(item.text);
        }
      } else if (eventType === "response.completed") {
        const usage = obj.response?.usage || {};
        tokens.input += usage.input_tokens || 0;
        tokens.output += usage.output_tokens || 0;
      }
    } catch {
      // Not JSON, skip line
    }
  }

  const content = lastMessageContent || textParts.join("").trim() || output;
  return {
    content,
    tokens: tokens.input > 0 || tokens.output > 0 ? tokens : undefined,
  };
}

/**
 * Parse OpenCode CLI JSON lines output
 * OpenCode outputs JSON lines with "type" field
 */
function parseOpenCodeOutput(output: string): ParsedResponse {
  const textParts: string[] = [];
  const tokens: TokenUsage = { input: 0, output: 0 };
  let cost = 0;

  for (const line of output.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const eventType = obj.type;
      const part = obj.part || {};

      if (eventType === "text" && part.text) {
        textParts.push(part.text);
      } else if (eventType === "step_finish") {
        const tokenData = part.tokens || {};
        tokens.input += tokenData.input || 0;
        tokens.output += tokenData.output || 0;
        cost += part.cost || 0;
      }
    } catch {
      // Not JSON, skip line
    }
  }

  const content = textParts.join("").trim() || output;
  return {
    content,
    tokens: tokens.input > 0 || tokens.output > 0 ? tokens : undefined,
    cost: cost > 0 ? cost : undefined,
  };
}

/**
 * Callback for streaming text updates (legacy)
 */
export type StreamCallback = (chunk: string) => void;

/**
 * Callback for progress events during execution
 */
export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * LLMExecutor wraps CLI tools for LLM interaction
 */
export class LLMExecutor {
  private settings: LLMPluginSettings;
  private activeProcess: ChildProcess | null = null;

  constructor(settings: LLMPluginSettings) {
    this.settings = settings;
  }

  /**
   * Update settings (called when settings change)
   */
  updateSettings(settings: LLMPluginSettings): void {
    this.settings = settings;
  }

  /**
   * Execute a prompt with the specified provider
   */
  async execute(
    prompt: string,
    provider?: LLMProvider,
    onStream?: StreamCallback,
    onProgress?: ProgressCallback
  ): Promise<LLMResponse> {
    const selectedProvider = provider || this.settings.defaultProvider;
    const providerConfig = this.settings.providers[selectedProvider];

    if (!providerConfig.enabled) {
      return {
        content: "",
        provider: selectedProvider,
        durationMs: 0,
        error: `Provider ${selectedProvider} is not enabled`,
      };
    }

    const startTime = Date.now();

    try {
      const output = await this.runCLI(
        selectedProvider,
        providerConfig,
        prompt,
        onStream,
        onProgress
      );
      const durationMs = Date.now() - startTime;

      const parser = PARSERS[selectedProvider];
      const parsed = parser(output);

      return {
        content: parsed.content,
        provider: selectedProvider,
        tokensUsed: parsed.tokens,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      return {
        content: "",
        provider: selectedProvider,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Cancel any running execution
   */
  cancel(): void {
    if (this.activeProcess) {
      this.activeProcess.kill("SIGTERM");
      this.activeProcess = null;
    }
  }

  /**
   * Run the CLI command for a provider
   */
  private runCLI(
    provider: LLMProvider,
    config: ProviderConfig,
    prompt: string,
    onStream?: StreamCallback,
    onProgress?: ProgressCallback
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const command = this.buildCommand(provider, config);
      const [cmd, ...args] = command;

      // Most LLM CLIs accept prompt via stdin or as final argument
      // We'll use stdin piping for claude/gemini, args for others
      const useStdin = provider === "claude" || provider === "gemini";

      if (!useStdin) {
        args.push(prompt);
      }

      const child = spawn(cmd, args, {
        env: {
          ...process.env,
          ...config.envVars,
        },
        shell: false,
        stdio: useStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      });

      this.activeProcess = child;

      let stdout = "";
      let stderr = "";
      let streamedText = "";

      child.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;

        // Parse streaming events
        const events = this.parseStreamingEvents(provider, chunk);
        for (const event of events) {
          if (onProgress) {
            onProgress(event);
          }
          // Also feed text events to legacy stream callback
          if (event.type === "text" && onStream) {
            streamedText += event.content;
            onStream(streamedText);
          }
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("error", (error) => {
        this.activeProcess = null;
        reject(new Error(`Failed to spawn ${cmd}: ${error.message}`));
      });

      child.on("close", (code) => {
        this.activeProcess = null;
        if (code === 0) {
          resolve(stdout);
        } else if (code === null) {
          reject(new Error("Process was killed"));
        } else {
          reject(
            new Error(
              `${cmd} exited with code ${code}${stderr ? `: ${stderr}` : ""}`
            )
          );
        }
      });

      // Set up timeout (use provider-specific or fall back to default)
      const timeoutSeconds = config.timeout ?? this.settings.defaultTimeout;
      const timeoutMs = timeoutSeconds * 1000;
      const timeout = setTimeout(() => {
        if (this.activeProcess === child) {
          child.kill("SIGTERM");
          reject(new Error(`Timeout after ${timeoutSeconds} seconds`));
        }
      }, timeoutMs);

      child.on("close", () => clearTimeout(timeout));

      // Write prompt to stdin if needed
      if (useStdin && child.stdin) {
        child.stdin.write(prompt);
        child.stdin.end();
      }
    });
  }

  /**
   * Build the CLI command array for a provider
   */
  private buildCommand(
    provider: LLMProvider,
    config: ProviderConfig
  ): string[] {
    if (config.customCommand) {
      const parts = config.customCommand.split(/\s+/);
      return [...parts, ...(config.additionalArgs || [])];
    }

    const defaultCmd = [...DEFAULT_COMMANDS[provider]];
    if (config.additionalArgs) {
      defaultCmd.push(...config.additionalArgs);
    }

    return defaultCmd;
  }

  /**
   * Parse streaming events from CLI output
   */
  private parseStreamingEvents(
    provider: LLMProvider,
    chunk: string
  ): ProgressEvent[] {
    const events: ProgressEvent[] = [];
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const obj = JSON.parse(line);
        const parsed = this.parseEventObject(provider, obj);
        if (parsed) {
          events.push(parsed);
        }
      } catch {
        // Not complete JSON yet, skip
      }
    }

    return events;
  }

  /**
   * Parse a single JSON event object into a ProgressEvent
   */
  private parseEventObject(
    provider: LLMProvider,
    obj: Record<string, unknown>
  ): ProgressEvent | null {
    switch (provider) {
      case "claude":
        return this.parseClaudeEvent(obj);
      case "codex":
        return this.parseCodexEvent(obj);
      case "opencode":
        return this.parseOpenCodeEvent(obj);
      default:
        return null;
    }
  }

  /**
   * Parse Claude streaming JSON events
   */
  private parseClaudeEvent(obj: Record<string, unknown>): ProgressEvent | null {
    const type = obj.type as string;

    // Text content streaming
    if (type === "content_block_delta") {
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (delta?.text) {
        return { type: "text", content: delta.text as string };
      }
    }

    // Tool use events
    if (type === "content_block_start") {
      const contentBlock = obj.content_block as Record<string, unknown> | undefined;
      if (contentBlock?.type === "tool_use") {
        return {
          type: "tool_use",
          tool: contentBlock.name as string,
          status: "started",
        };
      }
    }

    // Tool result/completion
    if (type === "content_block_stop") {
      const index = obj.index as number | undefined;
      // We don't have the tool name here, but we can signal completion
      if (index !== undefined) {
        return { type: "status", message: "Tool completed" };
      }
    }

    // Thinking content (if using extended thinking)
    if (type === "content_block_start") {
      const contentBlock = obj.content_block as Record<string, unknown> | undefined;
      if (contentBlock?.type === "thinking") {
        return { type: "thinking", content: "" };
      }
    }

    if (type === "content_block_delta") {
      const delta = obj.delta as Record<string, unknown> | undefined;
      if (delta?.type === "thinking_delta" && delta?.thinking) {
        return { type: "thinking", content: delta.thinking as string };
      }
    }

    return null;
  }

  /**
   * Parse Codex streaming JSON events
   */
  private parseCodexEvent(obj: Record<string, unknown>): ProgressEvent | null {
    const type = obj.type as string;

    // Text output
    if (type === "item.completed") {
      const item = obj.item as Record<string, unknown> | undefined;
      if (item?.text) {
        return { type: "text", content: item.text as string };
      }
    }

    // Tool/function calls
    if (type === "function_call" || type === "tool.run") {
      const name = (obj.name || obj.tool) as string | undefined;
      return {
        type: "tool_use",
        tool: name || "tool",
        input: obj.arguments as string | undefined,
        status: "started",
      };
    }

    // Message started (thinking)
    if (type === "message.started") {
      return { type: "status", message: "Thinking..." };
    }

    return null;
  }

  /**
   * Parse OpenCode streaming JSON events
   */
  private parseOpenCodeEvent(obj: Record<string, unknown>): ProgressEvent | null {
    const type = obj.type as string;
    const part = obj.part as Record<string, unknown> | undefined;

    // Text output
    if (type === "text" && part?.text) {
      return { type: "text", content: part.text as string };
    }

    // Thinking
    if (type === "thinking" && part?.thinking) {
      return { type: "thinking", content: part.thinking as string };
    }

    // Tool calls
    if (type === "tool_call" || type === "tool_start") {
      const toolName = (part?.tool || part?.name || obj.tool) as string | undefined;
      return {
        type: "tool_use",
        tool: toolName || "tool",
        input: part?.input as string | undefined,
        status: "started",
      };
    }

    if (type === "tool_result" || type === "tool_end") {
      return { type: "status", message: "Tool completed" };
    }

    return null;
  }
}

/**
 * Check if a CLI tool is available on the system
 */
export async function detectProvider(provider: LLMProvider): Promise<boolean> {
  const commands: Record<LLMProvider, string[]> = {
    claude: ["claude", "--version"],
    gemini: ["gemini", "--version"],
    codex: ["codex", "--version"],
    opencode: ["opencode", "--version"],
  };

  return new Promise((resolve) => {
    const [cmd, ...args] = commands[provider];
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));

    // Timeout after 5 seconds
    setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5000);
  });
}

/**
 * Detect all available providers
 */
export async function detectAvailableProviders(): Promise<LLMProvider[]> {
  const providers: LLMProvider[] = ["claude", "opencode", "codex", "gemini"];
  const results = await Promise.all(
    providers.map(async (p) => ({ provider: p, available: await detectProvider(p) }))
  );
  return results.filter((r) => r.available).map((r) => r.provider);
}
