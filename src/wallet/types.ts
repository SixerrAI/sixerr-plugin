export interface WalletSigner {
  /** Checksummed Ethereum address */
  readonly address: `0x${string}`;
  /** Sign a message using EIP-191 personal_sign */
  signMessage(message: string): Promise<`0x${string}`>;
}
