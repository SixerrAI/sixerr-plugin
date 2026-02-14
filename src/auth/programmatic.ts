import type { WalletSigner } from "../wallet/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthResult {
  jwt: string;
  walletAddress: string;
  identitySource: string;
  agentId?: string;
}

// ---------------------------------------------------------------------------
// Programmatic Challenge-Sign-Verify Authentication
// ---------------------------------------------------------------------------

/**
 * Authenticate with the Sixerr server programmatically:
 *   1. GET /auth/challenge?address=0x... -> { nonce, message }
 *   2. Sign the message with the wallet signer (EIP-191)
 *   3. POST /auth/verify { address, nonce, signature } -> { jwt, ... }
 *
 * This avoids the browser-based auth flow entirely.
 */
export async function authenticateProgrammatic(
  serverUrl: string,
  signer: WalletSigner,
): Promise<AuthResult> {
  // Step 1: Get challenge
  const challengeRes = await fetch(
    `${serverUrl}/auth/challenge?address=${signer.address}`,
  );
  if (!challengeRes.ok) {
    const body = await challengeRes.text().catch(() => "");
    throw new Error(`Challenge request failed (${challengeRes.status}): ${body}`);
  }
  const { nonce, message } = (await challengeRes.json()) as {
    nonce: string;
    message: string;
  };

  // Step 2: Sign the challenge message
  const signature = await signer.signMessage(message);

  // Step 3: Verify with server
  const verifyRes = await fetch(`${serverUrl}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: signer.address, nonce, signature }),
  });

  if (!verifyRes.ok) {
    const err = (await verifyRes.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      err.error?.message ?? `Verification failed (${verifyRes.status})`,
    );
  }

  return verifyRes.json() as Promise<AuthResult>;
}
