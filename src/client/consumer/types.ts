// ---------------------------------------------------------------------------
// Client Types
// ---------------------------------------------------------------------------

/** Permit2 payment requirements returned by the server in 402 responses. */
export interface Permit2PaymentRequirements {
  scheme: "permit2";
  network: string;
  asset: string;
  payTo: string;
  permit2Terminal: string;
  maxCost: string;
  inputTokenPrice: string;
  outputTokenPrice: string;
  platformFeeBps: number;
  maxTimeoutSeconds: number;
}

/** Parsed 402 response body. */
export interface PaymentRequiredResponse {
  x402Version: number;
  error: string;
  accepts: Permit2PaymentRequirements[];
}

/** EIP-712 typed data for Permit2 PermitTransferFrom. */
export interface Permit2TypedData {
  domain: {
    name: "Permit2";
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: {
    PermitTransferFrom: readonly [
      { name: "permitted"; type: "TokenPermissions" },
      { name: "spender"; type: "address" },
      { name: "nonce"; type: "uint256" },
      { name: "deadline"; type: "uint256" },
    ];
    TokenPermissions: readonly [
      { name: "token"; type: "address" },
      { name: "amount"; type: "uint256" },
    ];
  };
  primaryType: "PermitTransferFrom";
  message: {
    permitted: { token: `0x${string}`; amount: bigint };
    spender: `0x${string}`;
    nonce: bigint;
    deadline: bigint;
  };
}

/** Wallet that can sign EIP-712 typed data (required for x402 Permit2 payments). */
export interface PaymentSigner {
  readonly address: `0x${string}`;
  signTypedData(data: Permit2TypedData): Promise<`0x${string}`>;
}

/** Options for creating a SixerrClient. */
export interface SixerrClientConfig {
  /** Sixerr server URL. Defaults to "https://sixerr.ai". */
  serverUrl?: string;
  /** Wallet that signs Permit2 payments. */
  signer: PaymentSigner;
  /** Max USDC to authorize per request in atomic units. Defaults to "10000000" (10 USDC). */
  maxAmount?: string;
}

/** Options for a respond() call. */
export interface RespondOptions {
  /** Model identifier. Defaults to "default". */
  model?: string;
  /** Input text or message array (OpenResponses format). */
  input: unknown;
  /** Enable SSE streaming. */
  stream?: boolean;
  /** Target a specific agent by ID. */
  agentId?: string;
  /** Routing strategy: "cheapest" or "fastest". */
  routing?: "cheapest" | "fastest";
  /** Override max USDC for this request. */
  maxAmount?: string;
}
