import { loadConfig, loadKeystore, saveConfig } from "./config/store.js";
import { createCdpSigner } from "./wallet/cdp-signer.js";
import { createLocalSigner } from "./wallet/local-signer.js";
import { decryptKeystore } from "./wallet/keystore.js";
import type { KeystoreV3 } from "./wallet/keystore.js";
import { authenticateProgrammatic } from "./client/auth/programmatic.js";
import { startPlugin } from "./plugin.js";
import type { WalletSigner } from "./wallet/types.js";
import type { PluginHandle } from "./plugin.js";
import {
  SixerrClient,
  createLocalPaymentSigner,
  createCdpPaymentSigner,
} from "./client/consumer/index.js";
import { createHttpProxy } from "./proxy/http-proxy.js";
import type { PaymentSigner } from "./client/consumer/types.js";
import type { SixerrConfig } from "./config/schema.js";
import { resolveInferenceConfig } from "./client/provider/inference/model-resolver.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StartProgrammaticOptions {
  /** Config override. If not provided, loads from ~/.sixerr/config.json. */
  config?: SixerrConfig;

  /** Keystore password for local/imported wallets. Falls back to SIXERR_KEYSTORE_PASSWORD env var. */
  keystorePassword?: string;
}

// ---------------------------------------------------------------------------
// Programmatic Start
// ---------------------------------------------------------------------------

/**
 * Start the Sixerr plugin without any interactive UI.
 *
 * Loads config, resolves wallet, authenticates with the server, starts
 * the HTTP proxy and WebSocket client, and returns a PluginHandle.
 *
 * Designed for agents that need to self-start as Sixerr providers
 * without a TTY or human interaction.
 */
export async function startProgrammatic(
  options: StartProgrammaticOptions = {},
): Promise<PluginHandle> {
  // -------------------------------------------------------------------------
  // 1. Load config
  // -------------------------------------------------------------------------

  const config = options.config ?? (await loadConfig());
  if (!config) {
    throw new Error(
      "No configuration found. Run setup first (setupProgrammatic or CLI setup).",
    );
  }

  // -------------------------------------------------------------------------
  // 2. Resolve LLM inference configuration (fail fast before auth/connect)
  // -------------------------------------------------------------------------

  const inferenceConfig = resolveInferenceConfig();

  // -------------------------------------------------------------------------
  // 3. Resolve wallet signer
  // -------------------------------------------------------------------------

  let signer: WalletSigner;
  let paymentSigner: PaymentSigner;

  if (config.walletType === "coinbase") {
    if (!config.cdpCredentials) {
      throw new Error("cdpCredentials missing from config for coinbase wallet");
    }
    signer = await createCdpSigner(config.cdpCredentials);
    paymentSigner = await createCdpPaymentSigner(config.cdpCredentials);
  } else {
    const pwd =
      options.keystorePassword ?? process.env.SIXERR_KEYSTORE_PASSWORD;
    if (!pwd) {
      throw new Error(
        "keystorePassword required for local/imported wallets (or set SIXERR_KEYSTORE_PASSWORD)",
      );
    }
    const keystore = await loadKeystore();
    if (!keystore) {
      throw new Error("Keystore file missing. Run setup again.");
    }
    const privateKey = decryptKeystore(keystore as KeystoreV3, pwd);
    signer = createLocalSigner(privateKey);
    paymentSigner = createLocalPaymentSigner(privateKey);
  }

  // -------------------------------------------------------------------------
  // 3. Authenticate with server
  // -------------------------------------------------------------------------

  const agentId =
    config.agentCard?.identitySource === "erc8004"
      ? config.agentCard.agentId
      : undefined;
  const authResult = await authenticateProgrammatic(
    config.serverUrl,
    signer,
    agentId,
  );
  await saveConfig({ ...config, jwt: authResult.jwt });

  // -------------------------------------------------------------------------
  // 4. Start local HTTP proxy
  // -------------------------------------------------------------------------

  const sixerrClient = new SixerrClient({
    serverUrl: config.serverUrl,
    signer: paymentSigner,
  });

  const proxyPort = config.proxyPort ?? 6166;
  let proxyServer: import("node:http").Server | undefined;
  try {
    proxyServer = await createHttpProxy({
      port: proxyPort,
      client: sixerrClient,
    });
  } catch {
    // Proxy is optional — continue without it
  }

  // -------------------------------------------------------------------------
  // 5. Launch WebSocket client
  // -------------------------------------------------------------------------

  const wsUrl = config.serverUrl.replace(/^https?/, (m) =>
    m === "https" ? "wss" : "ws",
  );

  const handle = startPlugin({
    serverUrl: wsUrl,
    jwt: authResult.jwt,
    inferenceConfig,
    pricing: config.pricing,
    agentName: config.agentCard?.name,
    agentDescription: config.agentCard?.description,
  });
  handle.proxyServer = proxyServer;

  return handle;
}
