import { spawn, ChildProcess } from "child_process";
import type { LLMProvider, LLMResponse, ProviderConfig, LLMPluginSettings } from "../types";

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
 * Based on patterns from deliberate tool
 */
const DEFAULT_COMMANDS: Record<LLMProvider, string[]> = {
  claude: ["claude"],
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
 * Parse Claude CLI JSON output
 * Claude outputs JSON with "result" or "content" fields
 */
function parseClaudeOutput(output: string): ParsedResponse {
  try {
    const parsed = JSON.parse(output);
    const content =
      parsed.result ||
      parsed.content ||
      (typeof parsed.structured_output === "string"
        ? parsed.structured_output
        : JSON.stringify(parsed.structured_output, null, 2)) ||
      JSON.stringify(parsed, null, 2);

    const tokens: TokenUsage | undefined = parsed.usage
      ? {
          input: parsed.usage.input_tokens || 0,
          output: parsed.usage.output_tokens || 0,
        }
      : undefined;

    return { content, tokens, cost: parsed.total_cost_usd || parsed.cost_usd };
  } catch {
    // Not JSON, return raw output
    return { content: output };
  }
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
 * Callback for streaming output updates
 */
export type StreamCallback = (chunk: string) => void;

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
    onStream?: StreamCallback
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
        onStream
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
    onStream?: StreamCallback
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

      child.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        if (onStream) {
          // Try to extract partial content for streaming
          const partial = this.extractPartialContent(provider, chunk);
          if (partial) {
            onStream(partial);
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
   * Extract partial content from streaming output for real-time display
   */
  private extractPartialContent(
    provider: LLMProvider,
    chunk: string
  ): string | null {
    // For JSON-based providers, try to extract text events
    if (provider === "codex" || provider === "opencode") {
      const lines = chunk.split("\n");
      const textParts: string[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (provider === "codex") {
            if (obj.type === "item.completed" && obj.item?.text) {
              textParts.push(obj.item.text);
            }
          } else if (provider === "opencode") {
            if (obj.type === "text" && obj.part?.text) {
              textParts.push(obj.part.text);
            }
          }
        } catch {
          // Not complete JSON yet
        }
      }

      return textParts.length > 0 ? textParts.join("") : null;
    }

    // For claude/gemini, the output may not be streamable from CLI
    // Return null and let the full response be parsed at the end
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
