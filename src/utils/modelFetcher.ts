/**
 * Utility for dynamically fetching available models from CLI tools
 */
import { exec } from "child_process";
import { promisify } from "util";
import type { LLMProvider } from "../types";
import { PROVIDER_MODELS } from "../types";

const execAsync = promisify(exec);

export interface ModelOption {
  value: string;
  label: string;
}

// Cache fetched models to avoid repeated CLI calls
const modelCache: Map<LLMProvider, { models: ModelOption[]; timestamp: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get models for OpenCode by calling `opencode models`
 */
async function fetchOpenCodeModels(): Promise<ModelOption[]> {
  try {
    const { stdout } = await execAsync("opencode models", { timeout: 10000 });
    const models: ModelOption[] = [{ value: "", label: "Default (CLI default)" }];

    // Parse the output - each line has "provider/model" format
    // Skip lines that don't look like model IDs (e.g., INFO logs)
    const lines = stdout.trim().split("\n");
    for (const line of lines) {
      const model = line.trim();
      // Skip empty lines, INFO/WARN/ERROR logs, and lines without /
      if (!model || model.startsWith("INFO") || model.startsWith("WARN") || model.startsWith("ERROR")) {
        continue;
      }
      if (model.includes("/")) {
        // Create a friendly label from the model ID
        const [provider, name] = model.split("/", 2);
        const label = `${name} (${provider})`;
        models.push({ value: model, label });
      }
    }

    return models.length > 1 ? models : PROVIDER_MODELS.opencode;
  } catch {
    // CLI not available or failed - use static fallback
    return PROVIDER_MODELS.opencode;
  }
}

/**
 * Get models for Claude (currently static, could add `claude --list-models` if available)
 */
async function fetchClaudeModels(): Promise<ModelOption[]> {
  // Claude Code CLI doesn't have a list-models command yet
  // Return static list
  return PROVIDER_MODELS.claude;
}

/**
 * Get models for Gemini (currently static)
 */
async function fetchGeminiModels(): Promise<ModelOption[]> {
  // Gemini CLI doesn't have a list-models command that we know of
  return PROVIDER_MODELS.gemini;
}

/**
 * Get models for Codex (currently static)
 */
async function fetchCodexModels(): Promise<ModelOption[]> {
  return PROVIDER_MODELS.codex;
}

/**
 * Fetch available models for a provider
 * Uses caching to avoid repeated CLI calls
 */
export async function fetchModelsForProvider(provider: LLMProvider): Promise<ModelOption[]> {
  // Check cache first
  const cached = modelCache.get(provider);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.models;
  }

  let models: ModelOption[];
  switch (provider) {
    case "opencode":
      models = await fetchOpenCodeModels();
      break;
    case "claude":
      models = await fetchClaudeModels();
      break;
    case "gemini":
      models = await fetchGeminiModels();
      break;
    case "codex":
      models = await fetchCodexModels();
      break;
    default:
      models = [{ value: "", label: "Default" }];
  }

  // Update cache
  modelCache.set(provider, { models, timestamp: Date.now() });

  return models;
}

/**
 * Clear the model cache (useful after settings changes)
 */
export function clearModelCache(): void {
  modelCache.clear();
}
