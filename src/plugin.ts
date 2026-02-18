import * as http from "node:http";
import { fileURLToPath } from "node:url";
import { PluginClient } from "./ws/ws-client.js";
import { createStatusDisplay } from "./ws/display.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginConfig {
  serverUrl: string; // ws://host:port or wss://host:port
  jwt: string; // JWT token for WebSocket auth
  sixerrServerUrl?: string; // HTTPS URL for setup flow (e.g. "https://sixerr.ai")
  openClawUrl?: string; // default "http://localhost:18789"
  openClawToken: string; // OPENCLAW_GATEWAY_TOKEN (required)
  openClawTimeoutMs?: number; // default 120_000
  /** Optional per-token pricing for marketplace discovery (DISC-01). */
  pricing?: {
    inputTokenPrice: string;  // Atomic USDC per token
    outputTokenPrice: string; // Atomic USDC per token
  };
  /** Optional agent display name from setup (Phase 11). */
  agentName?: string;
  /** Optional agent description from setup (Phase 11). */
  agentDescription?: string;
}

export interface PluginHandle {
  client: PluginClient;
  proxyServer?: http.Server;
  stop: () => void;
}

// ---------------------------------------------------------------------------
// startPlugin
// ---------------------------------------------------------------------------

export function startPlugin(config: PluginConfig): PluginHandle {
  if (!config.serverUrl || typeof config.serverUrl !== "string") {
    throw new Error("serverUrl must be a non-empty string");
  }
  if (!config.jwt || typeof config.jwt !== "string") {
    throw new Error("jwt must be a non-empty string");
  }

  const display = createStatusDisplay();

  const client = new PluginClient({
    serverUrl: config.serverUrl,
    jwt: config.jwt,
    onStatusChange: display.update,
    onJwtRefresh: async (_newJwt) => {
      // JWT refresh is handled in-memory by the WS client.
      // No persistence needed -- the start command re-authenticates each session.
    },
    openClawConfig: {
      gatewayUrl: config.openClawUrl ?? "http://localhost:18789",
      gatewayToken: config.openClawToken,
      timeoutMs: config.openClawTimeoutMs,
    },
    // Phase 7: Pass pricing config if provided
    pricing: config.pricing,
    // Phase 11: Pass agent identity if provided
    agentName: config.agentName,
    agentDescription: config.agentDescription,
  });

  client.start();

  return {
    client,
    stop: () => client.stop(),
  };
}

// ---------------------------------------------------------------------------
// Direct execution (npx tsx src/plugin.ts)
// ---------------------------------------------------------------------------

const thisFile = fileURLToPath(import.meta.url);
const isDirectExecution = process.argv[1] && thisFile.endsWith(process.argv[1].replace(/\\/g, "/"));

if (isDirectExecution) {
  console.error("Direct execution is deprecated.");
  console.error("Use the CLI instead:");
  console.error("  npx tsx src/cli/cli.ts setup   — First-time configuration");
  console.error("  npx tsx src/cli/cli.ts start   — Connect to server");
  process.exit(1);
}
