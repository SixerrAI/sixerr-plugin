import type {
  PaymentSigner,
  Permit2PaymentRequirements,
  Permit2TypedData,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical Permit2 contract address (same on all EVM chains). */
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

// ---------------------------------------------------------------------------
// Permit2 Signing
// ---------------------------------------------------------------------------

/**
 * Sign a Permit2 PermitTransferFrom payload and return the base64-encoded
 * X-PAYMENT header value expected by the Sixerr server.
 */
export async function signPermit2Payment(
  signer: PaymentSigner,
  requirements: Permit2PaymentRequirements,
  maxAmount: string,
): Promise<string> {
  // Parse chain ID from network string like "eip155:8453"
  const chainId = parseChainId(requirements.network);
  const nonce = BigInt(Date.now());
  const deadline = BigInt(Math.floor(Date.now() / 1000) + requirements.maxTimeoutSeconds);

  const typedData: Permit2TypedData = {
    domain: {
      name: "Permit2",
      chainId,
      verifyingContract: PERMIT2_ADDRESS,
    },
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
      TokenPermissions: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    },
    primaryType: "PermitTransferFrom",
    message: {
      permitted: {
        token: requirements.asset as `0x${string}`,
        amount: BigInt(maxAmount),
      },
      spender: requirements.permit2Terminal as `0x${string}`,
      nonce,
      deadline,
    },
  };

  const signature = await signer.signTypedData(typedData);

  const payload = {
    sender: signer.address,
    permit: {
      permitted: { token: requirements.asset, amount: maxAmount },
      nonce: nonce.toString(),
      deadline: Number(deadline),
    },
    signature,
  };

  return btoa(JSON.stringify(payload));
}

function parseChainId(network: string): number {
  // Formats: "eip155:8453" or just "8453"
  const parts = network.split(":");
  const id = Number(parts[parts.length - 1]);
  if (isNaN(id)) throw new Error(`Cannot parse chain ID from network: ${network}`);
  return id;
}
