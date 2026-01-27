import { App, Modal } from "obsidian";
import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";

/**
 * Modal for handling ACP permission requests
 * Shows the user what action is being requested and lets them approve/deny
 */
export class PermissionModal extends Modal {
  private request: RequestPermissionRequest;
  private resolvePromise: ((response: RequestPermissionResponse) => void) | null = null;

  constructor(app: App, request: RequestPermissionRequest) {
    super(app);
    this.request = request;
  }

  /**
   * Show the modal and wait for user response
   */
  async prompt(): Promise<RequestPermissionResponse> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("llm-permission-modal");

    // Header
    const header = contentEl.createDiv({ cls: "llm-permission-header" });
    header.createEl("h2", { text: "Permission Required" });

    // Tool call info
    const toolInfo = contentEl.createDiv({ cls: "llm-permission-tool-info" });
    const toolCall = this.request.toolCall;

    // Extract tool name from metadata or title
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = toolCall as any;
    const toolName = meta?._meta?.claudeCode?.toolName ?? toolCall.title ?? "Unknown action";

    toolInfo.createEl("div", {
      text: `Action: ${toolName}`,
      cls: "llm-permission-action",
    });

    // Show file path if available
    if (toolCall.locations && toolCall.locations.length > 0) {
      const loc = toolCall.locations[0];
      const path = loc.line ? `${loc.path}:${loc.line}` : loc.path;
      toolInfo.createEl("div", {
        text: `File: ${path}`,
        cls: "llm-permission-file",
      });
    }

    // Show raw input details if available (query, pattern, etc.)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawInput = (toolCall as any).rawInput as Record<string, unknown> | undefined;
    if (rawInput) {
      const detailsEl = toolInfo.createDiv({ cls: "llm-permission-details" });

      // Common input fields to display
      const displayFields = ["query", "file_path", "path", "pattern", "url", "command"];
      for (const field of displayFields) {
        if (rawInput[field] && typeof rawInput[field] === "string") {
          const value = rawInput[field] as string;
          const truncated = value.length > 100 ? value.slice(0, 97) + "..." : value;
          detailsEl.createEl("div", {
            text: `${field}: ${truncated}`,
            cls: "llm-permission-detail-item",
          });
        }
      }
    }

    // Options section
    const optionsEl = contentEl.createDiv({ cls: "llm-permission-options" });
    optionsEl.createEl("p", {
      text: "Choose an action:",
      cls: "llm-permission-prompt",
    });

    // Create buttons for each option
    const buttonsEl = optionsEl.createDiv({ cls: "llm-permission-buttons" });

    for (const option of this.request.options) {
      const btn = buttonsEl.createEl("button", {
        text: option.name,
        cls: this.getButtonClass(option.kind),
      });

      btn.addEventListener("click", () => {
        this.selectOption(option.optionId);
      });
    }

    // Add cancel button
    const cancelBtn = buttonsEl.createEl("button", {
      text: "Cancel",
      cls: "llm-permission-btn llm-permission-btn-cancel",
    });

    cancelBtn.addEventListener("click", () => {
      this.cancel();
    });
  }

  private getButtonClass(kind: string): string {
    const base = "llm-permission-btn";
    switch (kind) {
      case "allow_once":
        return `${base} llm-permission-btn-allow`;
      case "allow_always":
        return `${base} llm-permission-btn-allow-always mod-cta`;
      case "reject_once":
        return `${base} llm-permission-btn-reject`;
      case "reject_always":
        return `${base} llm-permission-btn-reject-always mod-warning`;
      default:
        return base;
    }
  }

  private selectOption(optionId: string) {
    if (this.resolvePromise) {
      this.resolvePromise({
        outcome: {
          outcome: "selected",
          optionId,
        },
      });
    }
    this.close();
  }

  private cancel() {
    if (this.resolvePromise) {
      this.resolvePromise({
        outcome: {
          outcome: "cancelled",
        },
      });
    }
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();

    // If modal is closed without selection, treat as cancel
    if (this.resolvePromise) {
      this.resolvePromise({
        outcome: {
          outcome: "cancelled",
        },
      });
      this.resolvePromise = null;
    }
  }
}
