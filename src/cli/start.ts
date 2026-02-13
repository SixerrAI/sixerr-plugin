import {
  intro,
  password,
  spinner,
  cancel,
  isCancel,
  log,
  outro,
} from "@clack/prompts";
import { loadConfig, loadKeystore } from "../config/store.js";
import { createCdpSigner } from "../wallet/cdp-signer.js";
import { createLocalSigner } from "../wallet/local-signer.js";
import { decryptKeystore } from "../wallet/keystore.js";
import type { KeystoreV3 } from "../wallet/keystore.js";
import { authenticateProgrammatic } from "../auth/programmatic.js";
import { startPlugin } from "../plugin.js";
import type { WalletSigner } from "../wallet/types.js";

// ---------------------------------------------------------------------------
// Start Command
// ---------------------------------------------------------------------------

/**
 * Start the Switchboard Plugin:
 *   1. Load config from ~/.switchboard/config.json
 *   2. Resolve wallet signer (Coinbase auto-connect, or local/imported with password)
 *   3. Authenticate with the Switchboard server (challenge-sign-verify)
 *   4. Launch WebSocket client
 *
 * Password is prompted BEFORE fetching the challenge to avoid nonce expiry
 * (5-minute TTL on server challenges).
 */
export async function runStart(): Promise<void> {
  intro("Switchboard Plugin");

  // -------------------------------------------------------------------------
  // 1. Load config
  // -------------------------------------------------------------------------

  const config = await loadConfig();
  if (!config) {
    log.error("No configuration found. Run 'npx tsx src/cli/cli.ts setup' first.");
    process.exit(1);
  }
  log.info(`Server: ${config.serverUrl}`);

  // -------------------------------------------------------------------------
  // 2. Resolve wallet signer (BEFORE challenge fetch — nonce expiry safe)
  // -------------------------------------------------------------------------

  let signer: WalletSigner;

  if (config.walletType === "coinbase") {
    const s = spinner();
    s.start("Connecting to Coinbase wallet...");
    try {
      signer = await createCdpSigner(config.cdpCredentials!);
      s.stop(`Connected: ${signer.address}`);
    } catch (err) {
      s.stop("Failed to connect wallet");
      log.error((err as Error).message);
      process.exit(1);
    }
  } else {
    // Local or imported wallet — prompt for password
    const pwd = await password({ message: "Enter wallet password:" });
    if (isCancel(pwd)) {
      cancel("Cancelled.");
      process.exit(0);
    }

    const s = spinner();
    s.start("Decrypting wallet...");
    const keystore = await loadKeystore();
    if (!keystore) {
      s.stop("No keystore found");
      log.error("Keystore file missing. Run 'npx tsx src/cli/cli.ts setup' again.");
      process.exit(1);
    }
    try {
      const privateKey = decryptKeystore(keystore as KeystoreV3, pwd);
      signer = createLocalSigner(privateKey);
      s.stop(`Wallet unlocked: ${signer.address}`);
    } catch (err) {
      s.stop("Failed to decrypt wallet");
      log.error((err as Error).message);
      process.exit(1);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Authenticate with server (AFTER wallet is resolved)
  // -------------------------------------------------------------------------

  let authJwt: string;

  const authSpinner = spinner();
  authSpinner.start("Authenticating with server...");
  try {
    const authResult = await authenticateProgrammatic(config.serverUrl, signer);
    authJwt = authResult.jwt;
    authSpinner.stop(`Authenticated as ${authResult.identitySource} identity`);
    log.info(`Wallet: ${authResult.walletAddress}`);
    if (authResult.agentId && authResult.agentId !== authResult.walletAddress) {
      log.info(`Agent ID: ${authResult.agentId}`);
    }
  } catch (err) {
    authSpinner.stop("Authentication failed");
    log.error((err as Error).message);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 4. Launch WebSocket client
  // -------------------------------------------------------------------------

  // Convert HTTP/S server URL to WS/S
  const wsUrl = config.serverUrl.replace(/^https?/, (m) =>
    m === "https" ? "wss" : "ws",
  );

  log.info("Connecting to Switchboard...");
  const handle = startPlugin({
    serverUrl: wsUrl,
    jwt: authJwt,
    openClawToken: config.openClawToken,
    openClawUrl: config.openClawUrl,
    pricing: config.pricing,
  });

  outro("Plugin is online. Press Ctrl+C to stop.");

  // -------------------------------------------------------------------------
  // 5. Shutdown handling
  // -------------------------------------------------------------------------

  const shutdown = () => {
    log.info("Shutting down...");
    handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
