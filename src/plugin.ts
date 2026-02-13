import { fileURLToPath } from "node:url";
import { PluginClient } from "./ws/ws-client.js";
import { createStatusDisplay } from "./ws/display.js";
import { loadCredentials, saveCredentials } from "./auth/credentials.js";
import { authenticatePlugin } from "./auth/setup.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginConfig {
  serverUrl: string; // ws://host:port or wss://host:port
  jwt: string; // JWT token for WebSocket auth
  switchboardServerUrl?: string; // HTTPS URL for setup flow (e.g. "https://switchboard.example.com")
  openClawUrl?: string; // default "http://localhost:18789"
  openClawToken: string; // OPENCLAW_GATEWAY_TOKEN (required)
  openClawTimeoutMs?: number; // default 120_000
  /** Optional per-token pricing for marketplace discovery (DISC-01). */
  pricing?: {
    inputTokenPrice: string;  // Atomic USDC per token
    outputTokenPrice: string; // Atomic USDC per token
  };
}

export interface PluginHandle {
  client: PluginClient;
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
    onJwtRefresh: async (newJwt) => {
      try {
        await saveCredentials({
          jwt: newJwt,
          agentId: "", // Will be populated from stored creds
          serverUrl: config.serverUrl,
          issuedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error("Failed to save refreshed JWT:", err);
      }
    },
    openClawConfig: {
      gatewayUrl: config.openClawUrl ?? "http://localhost:18789",
      gatewayToken: config.openClawToken,
      timeoutMs: config.openClawTimeoutMs,
    },
    // Phase 7: Pass pricing config if provided
    pricing: config.pricing,
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
  const serverUrl = process.env["SWITCHBOARD_SERVER_URL"];
  const openClawToken = process.env["OPENCLAW_GATEWAY_TOKEN"];
  const openClawUrl = process.env["OPENCLAW_GATEWAY_URL"] ?? "http://localhost:18789";

  if (!serverUrl || !openClawToken) {
    console.error(
      "Usage: SWITCHBOARD_SERVER_URL=ws://... OPENCLAW_GATEWAY_TOKEN=... npx tsx src/plugin.ts",
    );
    console.error("Optional: SWITCHBOARD_JWT=... (or stored credentials will be used)");
    process.exit(1);
  }

  const display = createStatusDisplay();
  display.log("Switchboard Plugin v0.1.0");
  display.log(`Server: ${serverUrl}`);
  display.log(`OpenClaw Gateway: ${openClawUrl}`);

  // Phase 7: Optional pricing from env vars (DISC-01)
  const inputTokenPrice = process.env["INPUT_TOKEN_PRICE"];
  const outputTokenPrice = process.env["OUTPUT_TOKEN_PRICE"];
  if ((inputTokenPrice && !outputTokenPrice) || (!inputTokenPrice && outputTokenPrice)) {
    display.log("Warning: Both INPUT_TOKEN_PRICE and OUTPUT_TOKEN_PRICE must be set. Ignoring partial pricing.");
  }
  const pricing = (inputTokenPrice && outputTokenPrice)
    ? { inputTokenPrice, outputTokenPrice }
    : undefined;
  if (pricing) {
    display.log(`Pricing: ${pricing.inputTokenPrice} input / ${pricing.outputTokenPrice} output (atomic USDC/token)`);
  }

  // Try loading stored credentials
  const creds = await loadCredentials();
  let jwt = process.env["SWITCHBOARD_JWT"];

  if (!jwt && creds) {
    jwt = creds.jwt;
    display.log("Loaded JWT from stored credentials");
  }

  if (!jwt) {
    // No JWT available -- run setup flow
    const switchboardUrl = process.env["SWITCHBOARD_SERVER_URL"];
    if (!switchboardUrl) {
      console.error("No JWT found. Set SWITCHBOARD_JWT or run setup.");
      process.exit(1);
    }
    // Convert ws:// to http:// for the auth URL
    const httpUrl = switchboardUrl.replace(/^ws/, "http");
    display.log("No JWT found. Starting browser authentication...");
    jwt = await authenticatePlugin(httpUrl);
    await saveCredentials({
      jwt,
      agentId: "unknown", // Server doesn't echo agentId in callback
      serverUrl,
      issuedAt: new Date().toISOString(),
    });
    display.log("Authentication successful. JWT saved.");
  }

  const handle = startPlugin({ serverUrl, jwt, openClawToken, openClawUrl, pricing });

  const shutdown = () => {
    display.log("Shutting down...");
    handle.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
