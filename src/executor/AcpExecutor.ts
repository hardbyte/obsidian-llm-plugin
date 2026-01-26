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
} from "@agentclientprotocol/sdk";
import type { LLMPluginSettings, LLMProvider, ProgressEvent } from "../types";

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
  return new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        const ok = nodeStream.write(chunk, (err) => {
          if (err) reject(err);
          else resolve();
        });
        if (!ok) {
          nodeStream.once("drain", resolve);
        }
      });
    },
    close() {
      return new Promise((resolve) => {
        nodeStream.end(resolve);
      });
    },
    abort(err) {
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
    this.process = spawn(acpCommand.cmd, acpCommand.args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    if (!this.process.stdin || !this.process.stdout) {
      throw new Error("Failed to create stdio streams for ACP agent");
    }

    // Log stderr for debugging
    this.process.stderr?.on("data", (data: Buffer) => {
      this.debug("Agent stderr:", data.toString());
    });

    this.process.on("error", (err) => {
      this.debug("Agent process error:", err);
    });

    this.process.on("exit", (code, signal) => {
      this.debug("Agent process exited:", code, signal);
      this.connection = null;
      this.process = null;
      this.sessionId = null;
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

    // Initialize the connection
    this.debug("Initializing ACP connection...");
    const initResponse = await this.connection.initialize({
      protocolVersion: 1,
      clientInfo: {
        name: "obsidian-llm-plugin",
        version: "1.0.0",
      },
      clientCapabilities: {},
    });

    this.debug("ACP initialized:", initResponse);

    // Create a new session
    this.debug("Creating new session...");
    const sessionResponse = await this.connection.newSession({
      cwd,
      mcpServers: [],
    });

    this.sessionId = sessionResponse.sessionId;
    this.debug("Session created:", this.sessionId);

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
      } catch (err) {
        // Model selection is experimental - log but don't fail
        this.debug("Failed to set model (may not be supported):", err);
      }
    }
  }

  /**
   * Handle session update notifications and convert to ProgressEvents
   */
  private handleSessionUpdate(update: SessionUpdate) {
    if (!this.progressCallback) return;

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "user_message_chunk": {
        // ContentChunk has a single content block, not an array
        const chunk = update as ContentChunk & { sessionUpdate: string };
        if (chunk.content && chunk.content.type === "text") {
          const textContent = chunk.content as { type: "text"; text: string };
          this.progressCallback({
            type: "text",
            content: textContent.text,
          });
        }
        break;
      }

      case "agent_thought_chunk": {
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
        // ToolCall has title and toolCallId, not name/arguments
        const toolCall = update as ToolCall & { sessionUpdate: string };
        this.progressCallback({
          type: "tool_use",
          tool: toolCall.title ?? "unknown",
          input: toolCall.toolCallId,
        });
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
    if (!this.connection || !this.sessionId) {
      throw new Error("Not connected to an ACP agent. Call connect() first.");
    }

    // Update progress callback if provided
    if (options?.onProgress) {
      this.progressCallback = options.onProgress;
    }

    this.debug("Sending prompt:", message.slice(0, 100));

    try {
      const response = await this.connection.prompt({
        sessionId: this.sessionId,
        prompt: [{ type: "text", text: message }],
      });

      this.debug("Prompt response:", response);

      // The response indicates completion - actual content comes via sessionUpdate
      // Return empty content for now (content was streamed via callbacks)
      return { content: "" };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.debug("Prompt error:", error);
      return { content: "", error };
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
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection !== null && this.sessionId !== null;
  }

  /**
   * Get current provider
   */
  getProvider(): LLMProvider | null {
    return this.currentProvider;
  }
}
