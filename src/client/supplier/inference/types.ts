import type { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { Api, Model } from "@mariozechner/pi-ai";

export interface InferenceConfig {
  agentDir: string;          // from OPENCLAW_AGENT_DIR or ~/.openclaw/agents/default/agent/
  provider: string;          // e.g. "anthropic" — from OpenClaw config
  model: string;             // e.g. "claude-sonnet-4-5-20250929" — from OpenClaw config
  timeoutMs?: number;        // default 120_000
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  resolvedModel: Model<Api>;
}
