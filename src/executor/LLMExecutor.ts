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
  claude: ["claude", "--verbose", "--output-format", "stream-json"],
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
   * Log a debug message if debug mode is enabled
   */
  private debug(message: string, ...args: unknown[]): void {
    if (this.settings.debugMode) {
      console.log(`[LLM Plugin] ${message}`, ...args);
    }
  }

  /**
   * Update settings (called when settings change)
   */
  updateSettings(settings: LLMPluginSettings): void {
    this.settings = settings;
  }

  /**
   * Execute a prompt with the specified provider
   * @param prompt The prompt to send
   * @param provider The provider to use (defaults to settings.defaultProvider)
   * @param onStream Callback for streaming text updates
   * @param onProgress Callback for progress events
   * @param cwd Working directory for the CLI process (e.g., vault path)
   */
  async execute(
    prompt: string,
    provider?: LLMProvider,
    onStream?: StreamCallback,
    onProgress?: ProgressCallback,
    cwd?: string
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
        onProgress,
        cwd
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
    onProgress?: ProgressCallback,
    cwd?: string
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

      const timeoutSeconds = config.timeout ?? this.settings.defaultTimeout;

      this.debug("Executing command:", cmd, args[0] || "");
      this.debug("Working directory:", cwd || "(default)");
      this.debug("Timeout:", timeoutSeconds, "seconds");
      this.debug("Prompt length:", prompt.length, "chars");
      this.debug("Allow file writes:", this.settings.allowFileWrites);

      const child = spawn(cmd, args, {
        cwd: cwd || undefined,
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
        this.debug("stdout chunk:", chunk.slice(0, 500) + (chunk.length > 500 ? "..." : ""));

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
        const chunk = data.toString();
        stderr += chunk;
        this.debug("stderr:", chunk);
      });

      child.on("error", (error) => {
        this.activeProcess = null;
        this.debug("Process error:", error.message);
        reject(new Error(`Failed to spawn ${cmd}: ${error.message}`));
      });

      child.on("close", (code) => {
        this.activeProcess = null;
        this.debug("Process closed with code:", code);
        this.debug("Total stdout length:", stdout.length);
        this.debug("Total stderr length:", stderr.length);

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
      const timeoutMs = timeoutSeconds * 1000;
      const timeout = setTimeout(() => {
        if (this.activeProcess === child) {
          this.debug("TIMEOUT! Killing process after", timeoutSeconds, "seconds");
          this.debug("Stdout so far:", stdout.slice(-500));
          this.debug("Stderr so far:", stderr);
          child.kill("SIGTERM");
          reject(new Error(`Timeout after ${timeoutSeconds} seconds. Enable debug mode and check console for details.`));
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

    // Add permission flags based on settings
    if (provider === "claude" && this.settings.allowFileWrites) {
      // Skip interactive permission prompts since we can't respond to them
      defaultCmd.push("--dangerously-skip-permissions");
    }

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
   * Parse Claude CLI streaming JSON events
   *
   * Claude CLI with --verbose --output-format stream-json outputs:
   * - {"type":"system","subtype":"init",...} - initialization
   * - {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{...}}]}} - tool call
   * - {"type":"user","tool_use_result":{...}} - tool result
   * - {"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}} - text response
   * - {"type":"result","subtype":"success",...} - final result
   */
  private parseClaudeEvent(obj: Record<string, unknown>): ProgressEvent | null {
    const eventType = obj.type as string;

    this.debug("Claude event type:", eventType, "subtype:", obj.subtype);

    // System init - show that we're starting
    if (eventType === "system" && obj.subtype === "init") {
      this.debug("Claude: returning system init status");
      return { type: "status", message: "Connected to Claude..." };
    }

    // Assistant message with tool use or text
    if (eventType === "assistant") {
      const message = obj.message as Record<string, unknown> | undefined;
      const content = message?.content as Array<Record<string, unknown>> | undefined;

      this.debug("Claude assistant message, content blocks:", content?.length || 0);

      if (content && content.length > 0) {
        for (const block of content) {
          this.debug("Claude content block type:", block.type);

          if (block.type === "tool_use") {
            const toolName = block.name as string;
            const input = block.input as Record<string, unknown> | undefined;

            // Extract meaningful info from tool input
            let inputSummary: string | undefined;
            if (input) {
              if (input.file_path) {
                inputSummary = input.file_path as string;
              } else if (input.pattern) {
                inputSummary = input.pattern as string;
              } else if (input.command) {
                inputSummary = (input.command as string).slice(0, 50);
              } else if (input.query) {
                inputSummary = (input.query as string).slice(0, 50);
              }
            }

            this.debug("Claude tool_use:", toolName, inputSummary);
            return {
              type: "tool_use",
              tool: toolName,
              input: inputSummary,
              status: "started",
            };
          }

          if (block.type === "text") {
            const text = block.text as string;
            if (text) {
              this.debug("Claude text block, length:", text.length);
              return { type: "text", content: text };
            }
          }
        }
      }
    }

    // User message with tool result - tool completed
    if (eventType === "user") {
      const toolResult = obj.tool_use_result as Record<string, unknown> | undefined;
      if (toolResult) {
        const file = toolResult.file as Record<string, unknown> | undefined;
        if (file?.filePath) {
          return { type: "status", message: `Read: ${file.filePath}` };
        }
        return { type: "status", message: "Tool completed" };
      }
    }

    // Final result
    if (eventType === "result") {
      const numTurns = obj.num_turns as number | undefined;
      if (numTurns && numTurns > 1) {
        return { type: "status", message: `Completed (${numTurns} turns)` };
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
   *
   * OpenCode outputs events like:
   * - {"type":"step_start","part":{"id":"...","metadata":{"provider":"..."}}} - step beginning
   * - {"type":"text","part":{"id":"...","content":"..."}} - text content
   * - {"type":"tool_use","part":{"name":"...","input":{...}}} - tool call
   * - {"type":"tool_result","part":{"output":"..."}} - tool result
   * - {"type":"step_finish",...} - step complete
   */
  private parseOpenCodeEvent(obj: Record<string, unknown>): ProgressEvent | null {
    const type = obj.type as string;
    const part = obj.part as Record<string, unknown> | undefined;

    // Debug log all events with key fields
    this.debug("OpenCode event type:", type, "part keys:", part ? Object.keys(part).join(", ") : "none");

    // Step start - indicates processing has begun
    if (type === "step_start") {
      const metadata = part?.metadata as Record<string, unknown> | undefined;
      const provider = metadata?.provider as string | undefined;
      const model = metadata?.model as string | undefined;
      const stepType = obj.step_type as string | undefined;

      if (provider || model) {
        return { type: "status", message: `Using ${model || provider}...` };
      }
      if (stepType) {
        return { type: "status", message: `Starting ${stepType}...` };
      }
      return { type: "status", message: "Processing..." };
    }

    // Step finish - can show token usage if available
    if (type === "step_finish") {
      const tokens = part?.tokens as Record<string, unknown> | undefined;
      if (tokens) {
        const input = tokens.input as number | undefined;
        const output = tokens.output as number | undefined;
        if (input && output) {
          return { type: "status", message: `Tokens: ${input} in / ${output} out` };
        }
      }
      return null;
    }

    // Text output - check multiple possible locations for content
    if (type === "text") {
      const textContent = (part?.text || part?.content || part?.value || obj.text || obj.content) as string | undefined;
      if (textContent) {
        return { type: "text", content: textContent };
      }
      // If we have a part but no text found, log it for debugging
      if (part) {
        this.debug("OpenCode text event - part contents:", JSON.stringify(part).slice(0, 300));
      }
    }

    // Thinking/reasoning content
    if (type === "thinking" || type === "reasoning") {
      const content = (part?.thinking || part?.content || obj.thinking) as string | undefined;
      if (content) {
        return { type: "thinking", content };
      }
      return { type: "status", message: "Thinking..." };
    }

    // Tool use events - OpenCode structure: part.tool, part.state.input, part.state.status
    if (type === "tool_use" || type === "tool_call" || type === "tool_start") {
      const toolName = (part?.tool || part?.name || obj.tool || obj.name) as string | undefined;
      const state = part?.state as Record<string, unknown> | undefined;
      const stateInput = state?.input as Record<string, unknown> | undefined;
      const stateStatus = state?.status as string | undefined;
      const input = (stateInput || part?.input || obj.input) as Record<string, unknown> | undefined;

      this.debug("OpenCode tool_use - tool:", toolName, "state.input:", JSON.stringify(stateInput)?.slice(0, 100));

      // Extract meaningful info from tool input
      let inputSummary: string | undefined;
      if (input) {
        // OpenCode skill calls have "name" in input
        if (input.name) {
          inputSummary = input.name as string;
        } else if (input.filePath || input.file_path || input.path || input.file) {
          // OpenCode uses camelCase filePath
          const fullPath = (input.filePath || input.file_path || input.path || input.file) as string;
          // Show just the filename for brevity
          inputSummary = fullPath.split("/").pop() || fullPath;
        } else if (input.pattern || input.glob) {
          inputSummary = (input.pattern || input.glob) as string;
        } else if (input.command || input.cmd) {
          inputSummary = ((input.command || input.cmd) as string).slice(0, 50);
        } else if (input.query || input.search) {
          inputSummary = ((input.query || input.search) as string).slice(0, 50);
        } else if (input.url) {
          inputSummary = input.url as string;
        }
      }

      // If state shows completed, report as completed
      const status = stateStatus === "completed" ? "completed" : "started";

      this.debug("OpenCode tool_use - returning:", toolName, inputSummary, status);
      return {
        type: "tool_use",
        tool: toolName || "tool",
        input: inputSummary,
        status,
      };
    }

    // Tool result - show completion with relevant info
    if (type === "tool_result" || type === "tool_end") {
      const toolName = (part?.tool || part?.name || obj.name) as string | undefined;
      if (toolName) {
        return { type: "tool_use", tool: toolName, status: "completed" };
      }
      return null;
    }

    // Content block events (some LLMs use this pattern)
    if (type === "content_block_start" || type === "content_block_delta") {
      const contentType = (obj.content_block as Record<string, unknown>)?.type as string | undefined;
      if (contentType === "tool_use") {
        const name = (obj.content_block as Record<string, unknown>)?.name as string;
        return { type: "tool_use", tool: name || "tool", status: "started" };
      }
    }

    // Message events
    if (type === "message_start" || type === "message.start") {
      return { type: "status", message: "Generating response..." };
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
