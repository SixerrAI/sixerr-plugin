import { createCdpSigner, type CdpCredentials } from "../wallet/cdp-signer.js";
import { encryptKeystore } from "../wallet/keystore.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { saveConfig, saveKeystore, getServerUrl } from "./store.js";
import type { SixerrConfig } from "./schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgrammaticSetupOptions {
  /** Wallet type: "coinbase" uses CDP SDK, "local" generates a new key, "imported" uses provided key. */
  walletType: "coinbase" | "local" | "imported";

  /** CDP credentials (required when walletType === "coinbase"). */
  cdpCredentials?: CdpCredentials;

  /** Private key to import (required when walletType === "imported"). */
  privateKey?: `0x${string}`;

  /** Keystore encryption password (required for "local" and "imported" wallet types). */
  keystorePassword?: string;

  /** Agent display name. */
  agentName: string;

  /** Agent description. */
  agentDescription?: string;

  /** Agent identity source. Defaults to "local". */
  identitySource?: "erc8004" | "local";

  /** Explicit agentId (e.g. ERC-8004 tokenId). Defaults to wallet address. */
  agentId?: string;

  /** Input token price in atomic USDC. Defaults to "1". */
  inputTokenPrice?: string;

  /** Output token price in atomic USDC. Defaults to "3". */
  outputTokenPrice?: string;

  /** OpenClaw gateway token. Falls back to SIXERR_OPENCLAW_TOKEN env var. */
  openClawToken?: string;

  /** OpenClaw gateway URL. Defaults to "http://localhost:18789". */
  openClawUrl?: string;

  /** Server URL override. Falls back to SIXERR_SERVER_URL env var or https://sixerr.ai. */
  serverUrl?: string;
}

export interface ProgrammaticSetupResult {
  walletAddress: string;
  config: SixerrConfig;
}

// ---------------------------------------------------------------------------
// Programmatic Setup
// ---------------------------------------------------------------------------

/**
 * Non-interactive plugin setup. Creates wallet, writes config to
 * ~/.sixerr/config.json, and returns the result.
 *
 * Designed for agents that need to self-provision as Sixerr suppliers
 * without human interaction.
 */
export async function setupProgrammatic(
  options: ProgrammaticSetupOptions,
): Promise<ProgrammaticSetupResult> {
  let walletAddress: string;
  let cdpCredentials: CdpCredentials | undefined;

  // -------------------------------------------------------------------------
  // Resolve wallet
  // -------------------------------------------------------------------------

  if (options.walletType === "coinbase") {
    if (!options.cdpCredentials) {
      throw new Error("cdpCredentials required for coinbase wallet type");
    }
    const signer = await createCdpSigner(options.cdpCredentials);
    walletAddress = signer.address;
    cdpCredentials = options.cdpCredentials;
  } else if (options.walletType === "imported") {
    if (!options.privateKey) {
      throw new Error("privateKey required for imported wallet type");
    }
    if (!options.keystorePassword) {
      throw new Error("keystorePassword required for imported wallet type");
    }
    const account = privateKeyToAccount(options.privateKey);
    walletAddress = account.address;
    const keystore = encryptKeystore(
      options.privateKey,
      options.keystorePassword,
      account.address,
    );
    await saveKeystore(keystore);
  } else {
    // local — generate new key
    if (!options.keystorePassword) {
      throw new Error("keystorePassword required for local wallet type");
    }
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    walletAddress = account.address;
    const keystore = encryptKeystore(pk, options.keystorePassword, account.address);
    await saveKeystore(keystore);
  }

  // -------------------------------------------------------------------------
  // Resolve OpenClaw token
  // -------------------------------------------------------------------------

  const openClawToken =
    options.openClawToken ?? process.env.SIXERR_OPENCLAW_TOKEN;
  if (!openClawToken) {
    throw new Error(
      "openClawToken is required (pass it or set SIXERR_OPENCLAW_TOKEN)",
    );
  }

  // -------------------------------------------------------------------------
  // Build config
  // -------------------------------------------------------------------------

  const config: SixerrConfig = {
    version: 1,
    walletType: options.walletType,
    walletAddress,
    serverUrl: options.serverUrl ?? getServerUrl(),
    pricing: {
      inputTokenPrice: options.inputTokenPrice ?? "1",
      outputTokenPrice: options.outputTokenPrice ?? "3",
    },
    openClawToken,
    openClawUrl: options.openClawUrl ?? "http://localhost:18789",
    ...(cdpCredentials ? { cdpCredentials } : {}),
    agentCard: {
      agentId: options.agentId ?? walletAddress,
      name: options.agentName,
      description: options.agentDescription ?? "",
      identitySource: options.identitySource ?? "local",
    },
  };

  await saveConfig(config);

  return { walletAddress, config };
}
