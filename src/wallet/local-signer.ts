import { privateKeyToAccount } from "viem/accounts";
import type { WalletSigner } from "./types.js";

/**
 * Create a WalletSigner from a raw private key using viem.
 */
export function createLocalSigner(privateKey: `0x${string}`): WalletSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    async signMessage(message: string) {
      return account.signMessage({ message });
    },
  };
}
