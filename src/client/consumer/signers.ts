import { privateKeyToAccount } from "viem/accounts";
import type { PaymentSigner, Permit2TypedData } from "./types.js";

// ---------------------------------------------------------------------------
// Local Key Signer
// ---------------------------------------------------------------------------

/**
 * Create a PaymentSigner from a raw private key.
 * Uses viem's signTypedData for EIP-712 Permit2 signatures.
 */
export function createLocalPaymentSigner(
  privateKey: `0x${string}`,
): PaymentSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    async signTypedData(data: Permit2TypedData) {
      return account.signTypedData(data);
    },
  };
}

// ---------------------------------------------------------------------------
// CDP (Coinbase Agent Wallet) Signer
// ---------------------------------------------------------------------------

/**
 * Create a PaymentSigner backed by a Coinbase Agent Wallet.
 * Uses the CDP SDK's EVM signTypedData for Permit2 signatures.
 */
export async function createCdpPaymentSigner(credentials: {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
  accountName?: string;
}): Promise<PaymentSigner> {
  // Dynamic import to avoid requiring @coinbase/cdp-sdk when not used
  const { CdpClient } = await import("@coinbase/cdp-sdk");
  const cdp = new CdpClient({
    apiKeyId: credentials.apiKeyId,
    apiKeySecret: credentials.apiKeySecret,
    walletSecret: credentials.walletSecret,
  });
  const account = await cdp.evm.getOrCreateAccount({
    name: credentials.accountName ?? "sixerr-client",
  });

  return {
    address: account.address as `0x${string}`,
    async signTypedData(data: Permit2TypedData) {
      // CDP SDK supports signTypedData on EVM accounts
      const result = await (cdp.evm as any).signTypedData({
        address: account.address,
        domain: data.domain,
        types: data.types,
        primaryType: data.primaryType,
        message: {
          permitted: {
            token: data.message.permitted.token,
            amount: data.message.permitted.amount.toString(),
          },
          spender: data.message.spender,
          nonce: data.message.nonce.toString(),
          deadline: data.message.deadline.toString(),
        },
      });
      return (result.signature ?? result) as `0x${string}`;
    },
  };
}
