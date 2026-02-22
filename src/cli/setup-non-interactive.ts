import {
  setupProgrammatic,
  type ProgrammaticSetupOptions,
} from "../config/setup-programmatic.js";

// ---------------------------------------------------------------------------
// Non-Interactive Setup (reads from env vars)
// ---------------------------------------------------------------------------

/**
 * Run plugin setup without interactive prompts.
 *
 * Required env vars:
 *   SIXERR_WALLET_TYPE          — "coinbase" | "local" | "imported"
 *   SIXERR_AGENT_NAME           — Display name for the supplier
 *
 * Conditional env vars:
 *   CDP_API_KEY_ID               — Required when walletType=coinbase
 *   CDP_API_KEY_SECRET           — Required when walletType=coinbase
 *   CDP_WALLET_SECRET            — Required when walletType=coinbase
 *   SIXERR_PRIVATE_KEY           — Required when walletType=imported
 *   SIXERR_KEYSTORE_PASSWORD     — Required when walletType=local|imported
 *
 * Optional env vars:
 *   SIXERR_AGENT_DESCRIPTION     — Supplier description
 *   SIXERR_AGENT_ID              — Explicit agentId (defaults to wallet address)
 *   SIXERR_IDENTITY_SOURCE       — "erc8004" | "local" (default: "local")
 *   SIXERR_INPUT_TOKEN_PRICE     — Atomic USDC per input token (default: "1")
 *   SIXERR_OUTPUT_TOKEN_PRICE    — Atomic USDC per output token (default: "3")
 *   SIXERR_OPENCLAW_TOKEN        — OpenClaw gateway token
 *   SIXERR_OPENCLAW_URL          — OpenClaw gateway URL (default: http://localhost:18789)
 *   SIXERR_SERVER_URL            — Server URL (default: https://sixerr.ai)
 */
export async function runSetupNonInteractive(): Promise<void> {
  const walletType = requireEnv("SIXERR_WALLET_TYPE") as ProgrammaticSetupOptions["walletType"];
  if (!["coinbase", "local", "imported"].includes(walletType)) {
    console.error(`Invalid SIXERR_WALLET_TYPE: "${walletType}". Must be coinbase, local, or imported.`);
    process.exit(1);
  }

  const agentName = requireEnv("SIXERR_AGENT_NAME");

  const options: ProgrammaticSetupOptions = {
    walletType,
    agentName,
    agentDescription: process.env.SIXERR_AGENT_DESCRIPTION,
    agentId: process.env.SIXERR_AGENT_ID,
    identitySource: (process.env.SIXERR_IDENTITY_SOURCE as "erc8004" | "local") ?? undefined,
    inputTokenPrice: process.env.SIXERR_INPUT_TOKEN_PRICE,
    outputTokenPrice: process.env.SIXERR_OUTPUT_TOKEN_PRICE,
    openClawToken: process.env.SIXERR_OPENCLAW_TOKEN,
    openClawUrl: process.env.SIXERR_OPENCLAW_URL,
    serverUrl: process.env.SIXERR_SERVER_URL,
  };

  if (walletType === "coinbase") {
    options.cdpCredentials = {
      apiKeyId: requireEnv("CDP_API_KEY_ID"),
      apiKeySecret: requireEnv("CDP_API_KEY_SECRET"),
      walletSecret: requireEnv("CDP_WALLET_SECRET"),
    };
  }

  if (walletType === "imported") {
    options.privateKey = requireEnv("SIXERR_PRIVATE_KEY") as `0x${string}`;
  }

  if (walletType === "local" || walletType === "imported") {
    options.keystorePassword = requireEnv("SIXERR_KEYSTORE_PASSWORD");
  }

  try {
    const result = await setupProgrammatic(options);
    console.log(`Sixerr plugin configured successfully.`);
    console.log(`  Wallet:  ${result.walletAddress}`);
    console.log(`  Agent:   ${agentName}`);
    console.log(`  Server:  ${result.config.serverUrl}`);
    console.log(`  Pricing: ${result.config.pricing.inputTokenPrice} input / ${result.config.pricing.outputTokenPrice} output`);
  } catch (err) {
    console.error(`Setup failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}
