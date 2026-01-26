/**
 * ACP (Agent Client Protocol) Executor
 *
 * Provides a long-lived connection to an ACP-compatible agent (OpenCode, Claude, Gemini)
 * instead of spawning a new process for each request.
 */

import { spawn, ChildProcess } from "child_process";
import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type Agent,
  type SessionNotification,
  type SessionUpdate,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ContentChunk,
  type ToolCall,
  type SessionConfigOption,
  type SessionModelState,
  type ModelInfo,
} from "@agentclientprotocol/sdk";
import type { LLMPluginSettings, LLMProvider, ProgressEvent } from "../types";

export interface ThinkingOption {
  id: string;
  name: string;
}

export interface CurrentModelInfo {
  id: string;
  name: string;
  description?: string;
}

// Convert Node streams to Web streams
function nodeToWebReadable(nodeStream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      nodeStream.on("end", () => {
        controller.close();
      });
      nodeStream.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      // Node streams don't have a standard destroy on the interface
      if ("destroy" in nodeStream && typeof nodeStream.destroy === "function") {
        nodeStream.destroy();
      }
    },
  });
}

function nodeToWebWritable(nodeStream: NodeJS.WritableStream): WritableStream<Uint8Array> {
  let streamClosed = false;

  // Track if stream closes
  nodeStream.on("close", () => {
    streamClosed = true;
  });
  nodeStream.on("error", () => {
    streamClosed = true;
  });

  return new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        if (streamClosed) {
          reject(new Error("Stream is closed"));
          return;
        }

        try {
          const ok = nodeStream.write(chunk, (err) => {
            if (err) {
              streamClosed = true;
              reject(err);
            } else {
              resolve();
            }
          });
          if (!ok) {
            nodeStream.once("drain", resolve);
          }
        } catch (err) {
          streamClosed = true;
          reject(err);
        }
      });
    },
    close() {
      return new Promise((resolve) => {
        if (streamClosed) {
          resolve();
          return;
        }
        nodeStream.end(resolve);
      });
    },
    abort(err) {
      streamClosed = true;
      if ("destroy" in nodeStream && typeof nodeStream.destroy === "function") {
        (nodeStream as NodeJS.WritableStream & { destroy: (err?: Error) => void }).destroy(err);
      }
    },
  });
}

export interface AcpExecutorOptions {
  onProgress?: (event: ProgressEvent) => void;
  onPermissionRequest?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
}

export class AcpExecutor {
  private settings: LLMPluginSettings;
  private connection: ClientSideConnection | null = null;
  private process: ChildProcess | null = null;
  private sessionId: string | null = null;
  private currentProvider: LLMProvider | null = null;
  private debug: (...args: unknown[]) => void;
  private progressCallback: ((event: ProgressEvent) => void) | null = null;
  private configOptions: SessionConfigOption[] = [];
  private modelState: SessionModelState | null = null;
  private accumulatedContent: string = ""; // Accumulate text content during prompt

  constructor(settings: LLMPluginSettings) {
    this.settings = settings;
    this.debug = (...args: unknown[]) => {
      if (settings.debugMode) {
        console.log("[AcpExecutor]", ...args);
      }
    };
  }

  updateSettings(settings: LLMPluginSettings) {
    this.settings = settings;
  }

  /**
   * Get the ACP command for a provider
   */
  private getAcpCommand(provider: LLMProvider): { cmd: string; args: string[] } | null {
    switch (provider) {
      case "opencode":
        return { cmd: "opencode", args: ["acp"] };
      case "claude":
        // Claude uses the ACP adapter package
        return { cmd: "npx", args: ["@zed-industries/claude-code-acp"] };
      case "gemini":
        return { cmd: "gemini", args: ["--experimental-acp"] };
      case "codex":
        // Codex doesn't have native ACP support yet
        return null;
      default:
        return null;
    }
  }

  /**
   * Connect to an ACP agent
   */
  async connect(
    provider: LLMProvider,
    workingDirectory?: string,
    options?: AcpExecutorOptions
  ): Promise<void> {
    // If already connected to same provider, reuse
    if (this.connection && this.currentProvider === provider) {
      this.debug("Reusing existing connection for", provider);
      return;
    }

    // Disconnect any existing connection
    await this.disconnect();

    const acpCommand = this.getAcpCommand(provider);
    if (!acpCommand) {
      throw new Error(`Provider ${provider} does not support ACP`);
    }

    const cwd = workingDirectory ?? process.cwd();
    this.debug("Spawning ACP agent:", acpCommand.cmd, acpCommand.args, "cwd:", cwd);

    // Spawn the ACP agent process
    // Use shell: true to ensure commands like npx are found via shell PATH
    this.process = spawn(acpCommand.cmd, acpCommand.args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      shell: true,
    });

    if (!this.process.stdin || !this.process.stdout) {
      throw new Error("Failed to create stdio streams for ACP agent");
    }

    // Collect stderr for error messages
    let stderrOutput = "";
    this.process.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrOutput += text;
      this.debug("Agent stderr:", text);
    });

    // Track initialization state to handle process exits appropriately
    let initializationComplete = false;

    // Create a promise that rejects if the process exits during initialization
    let processExitReject: ((err: Error) => void) | null = null;
    const processExitPromise = new Promise<never>((_, reject) => {
      processExitReject = reject;
    });

    // Create a timeout promise for slow-starting processes (like npx)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("ACP connection timeout - agent took too long to respond"));
      }, 30000); // 30 second timeout for initialization
    });

    this.process.on("error", (err) => {
      this.debug("Agent process error:", err);
      if (processExitReject) {
        processExitReject(new Error(`ACP process error: ${err.message}`));
      }
    });

    this.process.on("exit", (code, signal) => {
      this.debug("Agent process exited:", code, signal, "initComplete:", initializationComplete);

      // Only clear state during initialization phase
      // After initialization, let isConnected() detect exit via exitCode
      if (!initializationComplete) {
        this.connection = null;
        this.process = null;
        this.sessionId = null;
        this.configOptions = [];
        this.modelState = null;
        if (processExitReject) {
          const reason = stderrOutput.trim() || `exit code ${code}${signal ? `, signal ${signal}` : ""}`;
          processExitReject(new Error(`ACP process exited: ${reason}`));
        }
      }
      // After initialization, keep state intact so isConnected() can use exitCode
    });

    // Create the ACP stream from stdio
    const stream = ndJsonStream(
      nodeToWebWritable(this.process.stdin),
      nodeToWebReadable(this.process.stdout)
    );

    // Store the progress callback for use in session updates
    this.progressCallback = options?.onProgress ?? null;

    // Create the client handler
    const createClient = (_agent: Agent): Client => ({
      sessionUpdate: async (params: SessionNotification) => {
        this.debug("Session update:", params.update.sessionUpdate);
        this.handleSessionUpdate(params.update);
      },
      requestPermission: async (params: RequestPermissionRequest) => {
        this.debug("Permission request:", params);
        if (options?.onPermissionRequest) {
          return options.onPermissionRequest(params);
        }
        // Default: allow with first option selected
        return {
          outcome: {
            outcome: "selected",
            optionId: params.options?.[0]?.optionId ?? "allow",
          },
        };
      },
    });

    // Create the client-side connection
    this.connection = new ClientSideConnection(createClient, stream);
    this.currentProvider = provider;

    // Initialize the connection - race against process exit and timeout
    this.debug("Initializing ACP connection...");
    const initResponse = await Promise.race([
      this.connection.initialize({
        protocolVersion: 1,
        clientInfo: {
          name: "obsidian-llm-plugin",
          version: "1.0.0",
        },
        clientCapabilities: {},
      }),
      processExitPromise,
      timeoutPromise,
    ]);

    this.debug("ACP initialized:", initResponse);

    // Create a new session - race against process exit and timeout
    this.debug("Creating new session...");
    const sessionResponse = await Promise.race([
      this.connection.newSession({
        cwd,
        mcpServers: [],
      }),
      processExitPromise,
      timeoutPromise,
    ]);

    this.sessionId = sessionResponse.sessionId;
    this.debug("Session created:", this.sessionId);

    // Mark initialization as complete - after this, exit handler won't clear state
    initializationComplete = true;

    // Clear the exit rejection now that we're successfully connected
    // This prevents the rejection from being triggered on normal shutdown
    processExitReject = null;

    // Store config options from session response
    this.configOptions = sessionResponse.configOptions ?? [];
    this.debug("Config options available:", this.configOptions.map((o) => o.id));

    // Store model state from session response
    this.modelState = sessionResponse.models ?? null;
    if (this.modelState) {
      this.debug("Current model:", this.modelState.currentModelId);
      this.debug("Available models:", this.modelState.availableModels.map((m) => m.modelId));
    }

    // Set model if configured
    const providerConfig = this.settings.providers[provider];
    if (providerConfig.model) {
      this.debug("Setting model:", providerConfig.model);
      try {
        await this.connection.unstable_setSessionModel({
          sessionId: this.sessionId,
          modelId: providerConfig.model,
        });
        this.debug("Model set successfully");
        // Update local model state to reflect the change
        if (this.modelState) {
          this.modelState = {
            ...this.modelState,
            currentModelId: providerConfig.model,
          };
          this.debug("Updated model state, current:", this.modelState.currentModelId);
        }
      } catch (err) {
        // Model selection is experimental - log but don't fail
        this.debug("Failed to set model (may not be supported):", err);
      }
    }

    // Set thinking mode if configured and available
    if (providerConfig.thinkingMode) {
      await this.setThinkingMode(providerConfig.thinkingMode);
    }
  }

  /**
   * Handle session update notifications and convert to ProgressEvents
   */
  private handleSessionUpdate(update: SessionUpdate) {
    this.debug("handleSessionUpdate:", update.sessionUpdate, JSON.stringify(update).slice(0, 200));

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "user_message_chunk": {
        // ContentChunk has a single content block, not an array
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chunk = update as any;
        this.debug("Content chunk:", JSON.stringify(chunk));

        // Try to extract text content - different providers may have different structures
        let textToAdd = "";

        // Standard ACP format: chunk.content.type === "text" with chunk.content.text
        if (chunk.content && chunk.content.type === "text" && chunk.content.text) {
          textToAdd = chunk.content.text;
        }
        // Alternative format: chunk.content is the text directly
        else if (chunk.content && typeof chunk.content === "string") {
          textToAdd = chunk.content;
        }
        // Alternative format: chunk.text directly
        else if (chunk.text && typeof chunk.text === "string") {
          textToAdd = chunk.text;
        }
        // Alternative format: content array (like in some ACP implementations)
        else if (Array.isArray(chunk.content)) {
          for (const item of chunk.content) {
            if (item && item.type === "text" && item.text) {
              textToAdd += item.text;
            }
          }
        }

        if (textToAdd) {
          // Accumulate text content for the response (always, even without callback)
          this.accumulatedContent += textToAdd;
          this.debug("Accumulated content length:", this.accumulatedContent.length);

          // Notify progress callback if available
          this.progressCallback?.({
            type: "text",
            content: this.accumulatedContent, // Send cumulative content like CLI streaming
          });
        } else {
          this.debug("No text extracted from chunk");
        }
        break;
      }

      case "agent_thought_chunk": {
        if (!this.progressCallback) break;
        const chunk = update as ContentChunk & { sessionUpdate: string };
        if (chunk.content && chunk.content.type === "text") {
          const textContent = chunk.content as { type: "text"; text: string };
          this.progressCallback({
            type: "thinking",
            content: textContent.text,
          });
        }
        break;
      }

      case "tool_call": {
        if (!this.progressCallback) break;
        // ToolCall has title, status, locations (file paths), and more
        const toolCall = update as ToolCall & { sessionUpdate: string };

        // Extract file path from locations if available (useful for file operations)
        let input: string | undefined;
        if (toolCall.locations && toolCall.locations.length > 0) {
          const loc = toolCall.locations[0];
          input = loc.line ? `${loc.path}:${loc.line}` : loc.path;
        }

        // Map ACP status to our status type
        let status: "started" | "completed" | undefined;
        if (toolCall.status === "pending" || toolCall.status === "in_progress") {
          status = "started";
        } else if (toolCall.status === "completed" || toolCall.status === "failed") {
          status = "completed";
        }

        this.progressCallback({
          type: "tool_use",
          tool: toolCall.title ?? "unknown",
          input,
          status,
        });
        break;
      }

      case "tool_call_update": {
        if (!this.progressCallback) break;
        // Handle tool call status updates
        const toolUpdate = update as { toolCallId: string; status?: string; locations?: Array<{ path: string; line?: number | null }> };

        // Extract file path from locations if available
        let input: string | undefined;
        if (toolUpdate.locations && toolUpdate.locations.length > 0) {
          const loc = toolUpdate.locations[0];
          input = loc.line ? `${loc.path}:${loc.line}` : loc.path;
        }

        // Map ACP status to our status type
        let status: "started" | "completed" | undefined;
        if (toolUpdate.status === "completed" || toolUpdate.status === "failed") {
          status = "completed";
        }

        // Only emit if we have useful info to show
        if (status === "completed") {
          this.progressCallback({
            type: "tool_use",
            tool: input ?? toolUpdate.toolCallId,
            status,
          });
        }
        break;
      }

      default:
        this.debug("Unhandled session update type:", update.sessionUpdate);
    }
  }

  /**
   * Send a prompt to the agent
   */
  async prompt(
    message: string,
    options?: AcpExecutorOptions
  ): Promise<{ content: string; error?: string }> {
    // Use isConnected() which also checks if the process is still running
    if (!this.isConnected()) {
      throw new Error("Not connected to an ACP agent. Call connect() first.");
    }

    // Reset accumulated content for this prompt
    this.accumulatedContent = "";

    // Update progress callback if provided
    if (options?.onProgress) {
      this.progressCallback = options.onProgress;
    }

    this.debug("Sending prompt:", message.slice(0, 100));

    try {
      // Non-null assertions are safe here because isConnected() returned true
      const response = await this.connection!.prompt({
        sessionId: this.sessionId!,
        prompt: [{ type: "text", text: message }],
      });

      this.debug("Prompt response:", response);
      this.debug("Accumulated content length:", this.accumulatedContent.length);

      // Return accumulated content from sessionUpdate callbacks
      return { content: this.accumulatedContent };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.debug("Prompt error:", error);
      return { content: this.accumulatedContent, error };
    }
  }

  /**
   * Cancel any ongoing request
   */
  async cancel(): Promise<void> {
    if (this.connection && this.sessionId) {
      this.debug("Cancelling session:", this.sessionId);
      await this.connection.cancel({ sessionId: this.sessionId });
    }
  }

  /**
   * Get available thinking/reasoning options from the agent
   * Returns null if thinking mode is not supported
   */
  getThinkingOptions(): ThinkingOption[] | null {
    const thoughtLevelOption = this.configOptions.find(
      (opt) => opt.category === "thought_level"
    );

    if (!thoughtLevelOption) {
      return null;
    }

    // Extract options from the config (handles both flat options and groups)
    const options: ThinkingOption[] = [];
    const selectOptions = (thoughtLevelOption as { options?: unknown }).options;

    if (Array.isArray(selectOptions)) {
      for (const opt of selectOptions) {
        if (typeof opt === "object" && opt !== null) {
          // Could be a direct option or a group
          if ("group" in opt && "options" in opt) {
            // It's a group - extract options from it
            const groupOpts = (opt as { options: unknown[] }).options;
            for (const groupOpt of groupOpts) {
              if (typeof groupOpt === "object" && groupOpt !== null && "id" in groupOpt) {
                const typedOpt = groupOpt as { id: string; name?: string };
                options.push({
                  id: typedOpt.id,
                  name: typedOpt.name ?? typedOpt.id,
                });
              }
            }
          } else if ("id" in opt) {
            // Direct option
            const typedOpt = opt as { id: string; name?: string };
            options.push({
              id: typedOpt.id,
              name: typedOpt.name ?? typedOpt.id,
            });
          }
        }
      }
    }

    return options.length > 0 ? options : null;
  }

  /**
   * Get the current thinking mode value
   */
  getCurrentThinkingMode(): string | null {
    const thoughtLevelOption = this.configOptions.find(
      (opt) => opt.category === "thought_level"
    );

    if (!thoughtLevelOption) {
      return null;
    }

    return (thoughtLevelOption as { currentValue?: string }).currentValue ?? null;
  }

  /**
   * Set the thinking/reasoning mode
   */
  async setThinkingMode(value: string): Promise<boolean> {
    if (!this.connection || !this.sessionId) {
      this.debug("Cannot set thinking mode - not connected");
      return false;
    }

    const thoughtLevelOption = this.configOptions.find(
      (opt) => opt.category === "thought_level"
    );

    if (!thoughtLevelOption) {
      this.debug("Thinking mode not supported by this agent");
      return false;
    }

    try {
      this.debug("Setting thinking mode to:", value);
      const response = await this.connection.unstable_setSessionConfigOption({
        sessionId: this.sessionId,
        configId: thoughtLevelOption.id,
        value,
      });

      // Update local config options with response
      if (response.configOptions) {
        this.configOptions = response.configOptions;
      }

      this.debug("Thinking mode set successfully");
      return true;
    } catch (err) {
      this.debug("Failed to set thinking mode:", err);
      return false;
    }
  }

  /**
   * Check if thinking mode is supported
   */
  supportsThinkingMode(): boolean {
    return this.getThinkingOptions() !== null;
  }

  /**
   * Disconnect from the agent
   */
  async disconnect(): Promise<void> {
    this.debug("Disconnecting...");

    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.connection = null;
    this.sessionId = null;
    this.currentProvider = null;
    this.progressCallback = null;
    this.configOptions = [];
    this.modelState = null;
  }

  /**
   * Check if connected and the process is still running
   */
  isConnected(): boolean {
    // Check if we have a connection and session
    if (!this.connection || !this.sessionId) {
      return false;
    }

    // Check if the process is still running
    if (this.process && this.process.exitCode !== null) {
      // Process has exited - clean up
      this.debug("Process has exited, cleaning up connection state");
      this.connection = null;
      this.sessionId = null;
      this.process = null;
      this.configOptions = [];
      this.modelState = null;
      return false;
    }

    return true;
  }

  /**
   * Get current provider
   */
  getProvider(): LLMProvider | null {
    return this.currentProvider;
  }

  /**
   * Get current model information
   */
  getCurrentModel(): CurrentModelInfo | null {
    if (!this.modelState) {
      return null;
    }

    const currentId = this.modelState.currentModelId;
    const modelInfo = this.modelState.availableModels.find(
      (m) => m.modelId === currentId
    );

    if (modelInfo) {
      return {
        id: modelInfo.modelId,
        name: modelInfo.name,
        description: modelInfo.description ?? undefined,
      };
    }

    // Model ID exists but not in available models list - return just the ID
    return {
      id: currentId,
      name: currentId,
    };
  }

  /**
   * Get list of available models
   */
  getAvailableModels(): CurrentModelInfo[] {
    if (!this.modelState) {
      return [];
    }

    return this.modelState.availableModels.map((m) => ({
      id: m.modelId,
      name: m.name,
      description: m.description ?? undefined,
    }));
  }
}
