import { CdpClient } from "@coinbase/cdp-sdk";
import type { WalletSigner } from "./types.js";

export interface CdpCredentials {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
}

/**
 * Create a WalletSigner backed by a Coinbase Agent Wallet via CDP SDK.
 * Requires valid CDP credentials with an active API key.
 */
export async function createCdpSigner(
  credentials: CdpCredentials,
  accountName: string = "switchboard-plugin",
): Promise<WalletSigner> {
  const cdp = new CdpClient(credentials);
  const account = await cdp.evm.getOrCreateAccount({ name: accountName });
  return {
    address: account.address as `0x${string}`,
    async signMessage(message: string) {
      const result = await cdp.evm.signMessage({
        address: account.address,
        message,
      });
      return result.signature as `0x${string}`;
    },
  };
}
