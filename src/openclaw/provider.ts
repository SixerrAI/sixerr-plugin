// ---------------------------------------------------------------------------
// OpenClaw plugin entry point — registers Sixerr as a model provider
// ---------------------------------------------------------------------------

import { loadConfig } from "../config/store.js";
import { fetchSupplierCatalog, buildModelList } from "./discovery.js";

// ---------------------------------------------------------------------------
// Types (minimal OpenClaw plugin API surface)
// ---------------------------------------------------------------------------

export interface OpenClawModelConfig {
  baseUrl: string;
  apiKey: string;
  api: string;
  models: Array<{ id: string; name: string }>;
}

export interface OpenClawProviderRegistration {
  id: string;
  label: string;
  models: OpenClawModelConfig;
  auth: unknown[];
}

export interface OpenClawPluginApi {
  registerProvider(registration: OpenClawProviderRegistration): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the HTTP base URL for Chat Completions API calls from the config's
 * server URL (which may be WS or HTTP).
 */
function httpUrlFromConfig(serverUrl: string): string {
  return serverUrl
    .replace(/^wss:/, "https:")
    .replace(/^ws:/, "http:")
    .replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

/**
 * Register Sixerr as an OpenClaw model provider.
 *
 * Reads config from ~/.sixerr/config.json. If no JWT is present
 * (plugin hasn't authenticated yet), silently skips registration.
 *
 * Model list is fetched best-effort from GET /v1/suppliers. Stale data
 * only affects autocomplete — OpenClaw sends any model string and the
 * server returns 404 for unknown agents.
 */
export async function register(api: OpenClawPluginApi): Promise<void> {
  const config = await loadConfig();
  if (!config?.jwt) return;

  const serverUrl = httpUrlFromConfig(config.serverUrl);
  const suppliers = await fetchSupplierCatalog(serverUrl);
  const models = buildModelList(suppliers);

  // Point OpenClaw at the local proxy which handles x402 payment signing
  // transparently. The server URL would return 402s that OpenClaw can't handle.
  const proxyPort = config.proxyPort ?? 6166;
  const baseUrl = `http://127.0.0.1:${proxyPort}`;

  api.registerProvider({
    id: "sixerr",
    label: "Sixerr",
    models: {
      baseUrl,
      apiKey: "proxy-managed",
      api: "openai-responses",
      models,
    },
    auth: [],
  });
}
