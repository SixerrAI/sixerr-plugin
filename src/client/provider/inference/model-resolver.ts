import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { InferenceConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Agent directory resolution
// ---------------------------------------------------------------------------

export function resolveAgentDir(): string {
  const envDir = process.env.OPENCLAW_AGENT_DIR;
  if (envDir) return envDir;
  return path.join(os.homedir(), ".openclaw", "agents", "default", "agent");
}

// ---------------------------------------------------------------------------
// Auth + model discovery (inlined from openclaw/src/agents/pi-model-discovery.ts)
// ---------------------------------------------------------------------------

function createAuthStorage(authPath: string): AuthStorage {
  // pi-coding-agent 0.50+ uses AuthStorage.create(path)
  const withFactory = AuthStorage as unknown as { create?: (p: string) => AuthStorage };
  if (typeof withFactory.create === "function") {
    return withFactory.create(authPath);
  }
  return new (AuthStorage as unknown as new (p: string) => AuthStorage)(authPath);
}

function discoverAuthStorage(agentDir: string): AuthStorage {
  return createAuthStorage(path.join(agentDir, "auth.json"));
}

function discoverModels(authStorage: AuthStorage, agentDir: string): ModelRegistry {
  return new ModelRegistry(authStorage, path.join(agentDir, "models.json"));
}

// ---------------------------------------------------------------------------
// OpenClaw config reading
// ---------------------------------------------------------------------------

interface OpenClawConfig {
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
        fallbacks?: string[];
      };
    };
  };
}

/**
 * Parse a "provider/model" string into its parts.
 * Splits on the first "/" only, so model IDs containing "/" are preserved.
 */
function parseModelSpec(spec: string): { provider: string; model: string } | null {
  const slashIdx = spec.indexOf("/");
  if (slashIdx === -1) {
    return null;
  }
  return {
    provider: spec.slice(0, slashIdx),
    model: spec.slice(slashIdx + 1),
  };
}

/**
 * Read the provider/model from openclaw.json in the agent directory.
 */
function readModelConfig(agentDir: string): { provider: string; model: string } {
  const configPath = path.join(agentDir, "openclaw.json");
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch {
    throw new Error(`Missing ${configPath} — cannot determine which model to use.`);
  }

  let config: OpenClawConfig;
  try {
    config = JSON.parse(raw) as OpenClawConfig;
  } catch {
    throw new Error(`Invalid JSON in ${configPath}`);
  }

  const primary = config.agents?.defaults?.model?.primary;
  if (!primary) {
    throw new Error(
      `No agents.defaults.model.primary in ${configPath}. ` +
      'Set it to e.g. "anthropic/claude-opus-4-6".',
    );
  }

  const parsed = parseModelSpec(primary);
  if (!parsed) {
    throw new Error(
      `Invalid model spec "${primary}" in ${configPath} — expected "provider/model" format.`,
    );
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/**
 * Discover auth storage and model registry from the agent directory,
 * then resolve the configured model for inference.
 */
export function resolveInferenceConfig(overrides?: {
  agentDir?: string;
  provider?: string;
  model?: string;
  timeoutMs?: number;
}): InferenceConfig {
  const agentDir = overrides?.agentDir ?? resolveAgentDir();

  const configModel = readModelConfig(agentDir);
  const provider = overrides?.provider ?? configModel.provider;
  const modelId = overrides?.model ?? configModel.model;

  // Discover auth + model registry from agent dir
  const authStorage = discoverAuthStorage(agentDir);
  const modelRegistry = discoverModels(authStorage, agentDir);

  // Look up the model in the registry — fail if not found
  const resolvedModel = modelRegistry.find(provider, modelId) as Model<Api> | undefined;
  if (!resolvedModel) {
    throw new Error(
      `Model "${provider}/${modelId}" not found in ${agentDir}/models.json.`,
    );
  }

  return {
    agentDir,
    provider,
    model: modelId,
    timeoutMs: overrides?.timeoutMs,
    authStorage,
    modelRegistry,
    resolvedModel,
  };
}
