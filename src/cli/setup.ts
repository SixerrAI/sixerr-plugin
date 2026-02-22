import {
  intro,
  outro,
  text,
  password,
  select,
  confirm,
  spinner,
  note,
  cancel,
  isCancel,
  log,
} from "@clack/prompts";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encryptKeystore } from "../wallet/keystore.js";
import { createCdpSigner, type CdpCredentials } from "../wallet/cdp-signer.js";
import {
  saveConfig,
  saveKeystore,
  getServerUrl,
  loadConfig,
} from "../config/store.js";
import type { SixerrConfig } from "../config/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleCancel(value: unknown): asserts value is string | boolean {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Setup Wizard
// ---------------------------------------------------------------------------

export async function runSetup(): Promise<void> {
  intro("Sixerr Plugin Setup");

  // Check for existing config
  const existing = await loadConfig();
  if (existing) {
    const overwrite = await confirm({
      message: "Existing configuration found. Overwrite?",
    });
    handleCancel(overwrite);
    if (!overwrite) {
      cancel("Setup cancelled.");
      process.exit(0);
    }
  }

  // -------------------------------------------------------------------------
  // Wallet type selection
  // -------------------------------------------------------------------------

  const walletType = await select({
    message: "How would you like to set up your wallet?",
    options: [
      {
        value: "coinbase" as const,
        label: "Coinbase Agent Wallet",
        hint: "recommended",
      },
      { value: "local" as const, label: "Generate New Local Wallet" },
      { value: "imported" as const, label: "Import Existing Private Key" },
    ],
  });
  handleCancel(walletType);

  let walletAddress: string = "";
  let cdpApiKeyId: string | undefined;
  let cdpApiKeySecret: string | undefined;
  let cdpWalletSecret: string | undefined;

  // -------------------------------------------------------------------------
  // Branch: Coinbase Agent Wallet
  // -------------------------------------------------------------------------

  if (walletType === "coinbase") {
    const apiKeyId = await text({ message: "CDP API Key ID:" });
    handleCancel(apiKeyId);

    const apiKeySecret = await password({ message: "CDP API Key Secret:" });
    handleCancel(apiKeySecret);

    const walletSecret = await password({ message: "CDP Wallet Secret:" });
    handleCancel(walletSecret);

    const s = spinner();
    s.start("Validating credentials and creating wallet...");

    try {
      const signer = await createCdpSigner({
        apiKeyId,
        apiKeySecret,
        walletSecret,
      });
      walletAddress = signer.address;
      cdpApiKeyId = apiKeyId;
      cdpApiKeySecret = apiKeySecret;
      cdpWalletSecret = walletSecret;
      s.stop(`Wallet ready: ${signer.address}`);
    } catch (err) {
      s.stop("Failed to validate credentials");
      log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  // -------------------------------------------------------------------------
  // Branch: Generate New Local Wallet
  // -------------------------------------------------------------------------

  if (walletType === "local") {
    const pwd = await password({
      message: "Enter a password to encrypt your wallet:",
      validate: (v) =>
        !v || v.length < 8
          ? "Password must be at least 8 characters"
          : undefined,
    });
    handleCancel(pwd);

    const confirmPwd = await password({ message: "Confirm password:" });
    handleCancel(confirmPwd);

    if (pwd !== confirmPwd) {
      log.error("Passwords do not match.");
      process.exit(1);
    }

    const s = spinner();
    s.start("Generating and encrypting wallet...");

    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const keystore = encryptKeystore(pk, pwd, account.address);
    await saveKeystore(keystore);

    walletAddress = account.address;
    s.stop(`Wallet generated: ${account.address}`);
  }

  // -------------------------------------------------------------------------
  // Branch: Import Existing Private Key
  // -------------------------------------------------------------------------

  if (walletType === "imported") {
    const pk = await password({
      message: "Enter private key (0x-prefixed):",
      validate: (v) => {
        if (!v) return "Private key is required";
        if (!v.startsWith("0x") || v.length !== 66)
          return "Must be a 0x-prefixed 64-character hex string (66 chars total)";
        return undefined;
      },
    });
    handleCancel(pk);

    const account = privateKeyToAccount(pk as `0x${string}`);
    walletAddress = account.address;

    const pwd = await password({
      message: "Enter a password to encrypt your wallet:",
      validate: (v) =>
        !v || v.length < 8
          ? "Password must be at least 8 characters"
          : undefined,
    });
    handleCancel(pwd);

    const confirmPwd = await password({ message: "Confirm password:" });
    handleCancel(confirmPwd);

    if (pwd !== confirmPwd) {
      log.error("Passwords do not match.");
      process.exit(1);
    }

    const s = spinner();
    s.start("Encrypting wallet...");

    const keystore = encryptKeystore(pk as `0x${string}`, pwd, account.address);
    await saveKeystore(keystore);

    s.stop(`Wallet imported: ${account.address}`);
  }

  // -------------------------------------------------------------------------
  // Agent Identity
  // -------------------------------------------------------------------------

  let agentId = walletAddress;
  let agentName = "";
  let agentDescription = "";
  let identitySource: "erc8004" | "local" = "local";

  const serverUrl = getServerUrl();
  let detectResult: { hasAgent: boolean; agentIds?: string[] } | null = null;

  try {
    const detectRes = await fetch(
      `${serverUrl}/auth/detect?address=${walletAddress}`,
    );
    if (detectRes.ok) {
      detectResult = (await detectRes.json()) as {
        hasAgent: boolean;
        agentIds?: string[];
      };
    }
  } catch {
    // Server unreachable — fall through to local profile
  }

  if (detectResult?.hasAgent && detectResult.agentIds?.length) {
    const agentOptions = [
      ...detectResult.agentIds.map((id) => ({
        value: id,
        label: `ERC-8004 Agent: ${id}`,
      })),
      { value: "__local__", label: "Create local profile instead" },
    ];

    const selectedAgent = await select({
      message: "Select your agent identity:",
      options: agentOptions,
    });
    handleCancel(selectedAgent);

    if (selectedAgent !== "__local__") {
      agentId = selectedAgent;
      identitySource = "erc8004";
    }
  } else {
    log.info("No on-chain agent identity found. Creating local profile.");
  }

  const nameInput = await text({
    message: "Agent display name:",
    placeholder: "My Sixerr Supplier",
    validate: (v) => (!v ? "Name is required" : undefined),
  });
  handleCancel(nameInput);
  agentName = nameInput;

  const descInput = await text({
    message: "Agent description:",
    placeholder: "Fast inference supplier running Claude",
  });
  handleCancel(descInput);
  agentDescription = descInput;

  // -------------------------------------------------------------------------
  // Pricing
  // -------------------------------------------------------------------------

  const inputPrice = await text({
    message: "Input token price (atomic USDC per token):",
    placeholder: "1",
    validate: (v) =>
      !v || isNaN(Number(v)) || Number(v) < 0
        ? "Must be a non-negative number"
        : undefined,
  });
  handleCancel(inputPrice);

  const outputPrice = await text({
    message: "Output token price (atomic USDC per token):",
    placeholder: "3",
    validate: (v) =>
      !v || isNaN(Number(v)) || Number(v) < 0
        ? "Must be a non-negative number"
        : undefined,
  });
  handleCancel(outputPrice);

  // -------------------------------------------------------------------------
  // OpenClaw config
  // -------------------------------------------------------------------------

  const envToken = process.env.SIXERR_OPENCLAW_TOKEN;
  let openClawToken: string;
  if (envToken) {
    log.info(`Using gateway token from environment.`);
    openClawToken = envToken;
  } else {
    const tokenInput = await password({ message: "OpenClaw Gateway Token:" });
    handleCancel(tokenInput);
    openClawToken = tokenInput;
  }

  const openClawUrl = await text({
    message: "OpenClaw Gateway URL:",
    placeholder: "http://localhost:18789",
    defaultValue: "http://localhost:18789",
  });
  handleCancel(openClawUrl);

  // -------------------------------------------------------------------------
  // Build and save config
  // -------------------------------------------------------------------------

  const config: SixerrConfig = {
    version: 1,
    walletType,
    walletAddress,
    serverUrl: getServerUrl(),
    pricing: {
      inputTokenPrice: inputPrice,
      outputTokenPrice: outputPrice,
    },
    openClawToken,
    openClawUrl: openClawUrl || "http://localhost:18789",
    ...(walletType === "coinbase"
      ? {
          cdpCredentials: {
            apiKeyId: cdpApiKeyId!,
            apiKeySecret: cdpApiKeySecret!,
            walletSecret: cdpWalletSecret!,
          },
        }
      : {}),
    agentCard: {
      agentId,
      name: agentName,
      description: agentDescription,
      identitySource,
    },
  };

  await saveConfig(config);

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  note(
    `Agent:   ${agentName}\nWallet:  ${walletAddress}\nType:    ${walletType}\nServer:  ${config.serverUrl}\nPricing: ${inputPrice} input / ${outputPrice} output\nGateway: ${openClawUrl || "http://localhost:18789"}`,
    "Configuration saved",
  );

  outro("Setup complete! Run 'npx tsx src/cli/cli.ts start' to connect.");
}
