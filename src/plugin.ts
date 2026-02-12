import { fileURLToPath } from "node:url";
import { PluginClient } from "./ws/ws-client.js";
import { createStatusDisplay } from "./ws/display.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginConfig {
  serverUrl: string; // ws://host:port or wss://host:port
  apiKey: string; // sb_plugin_... API key
  openClawUrl?: string; // default "http://localhost:18789"
  openClawToken: string; // OPENCLAW_GATEWAY_TOKEN (required)
  openClawTimeoutMs?: number; // default 120_000
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
  if (!config.apiKey.startsWith("sb_plugin_")) {
    throw new Error("apiKey must start with 'sb_plugin_'");
  }

  const display = createStatusDisplay();

  const client = new PluginClient({
    serverUrl: config.serverUrl,
    apiKey: config.apiKey,
    onStatusChange: display.update,
    openClawConfig: {
      gatewayUrl: config.openClawUrl ?? "http://localhost:18789",
      gatewayToken: config.openClawToken,
      timeoutMs: config.openClawTimeoutMs,
    },
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
  const apiKey = process.env["SWITCHBOARD_PLUGIN_KEY"];
  const openClawToken = process.env["OPENCLAW_GATEWAY_TOKEN"];
  const openClawUrl = process.env["OPENCLAW_GATEWAY_URL"] ?? "http://localhost:18789";

  if (!serverUrl || !apiKey || !openClawToken) {
    console.error(
      "Usage: SWITCHBOARD_SERVER_URL=ws://... SWITCHBOARD_PLUGIN_KEY=sb_plugin_... OPENCLAW_GATEWAY_TOKEN=... npx tsx src/plugin.ts",
    );
    process.exit(1);
  }

  const display = createStatusDisplay();
  display.log("Switchboard Plugin v0.1.0");
  display.log(`Server: ${serverUrl}`);
  display.log(`OpenClaw Gateway: ${openClawUrl}`);

  const handle = startPlugin({ serverUrl, apiKey, openClawToken, openClawUrl });

  const shutdown = () => {
    display.log("Shutting down...");
    handle.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
