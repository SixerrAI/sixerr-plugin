import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  randomUUID,
} from "node:crypto";
import { keccak256, hexToBytes } from "viem";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeystoreV3 {
  version: 3;
  id: string;
  address: string; // lowercase, no 0x prefix
  crypto: {
    cipher: "aes-128-ctr";
    cipherparams: { iv: string };
    ciphertext: string;
    kdf: "scrypt";
    kdfparams: {
      n: number;
      r: number;
      p: number;
      dklen: number;
      salt: string;
    };
    mac: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DKLEN = 32;
const SCRYPT_N = 131072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
// Node.js default maxmem (32MB) is too low for N=131072, r=8.
// Required: 128 * N * r = 128 * 131072 * 8 = 128MB + overhead.
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R + 1024 * 1024; // ~129MB

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a private key into V3 keystore format.
 */
export function encryptKeystore(
  privateKey: `0x${string}`,
  password: string,
  address: string,
): KeystoreV3 {
  const salt = randomBytes(32);
  const iv = randomBytes(16);

  // Derive key via scrypt
  const derivedKey = scryptSync(
    Buffer.from(password, "utf-8"),
    salt,
    DKLEN,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
  );

  // Encrypt private key bytes with AES-128-CTR
  const keyBytes = hexToBytes(privateKey);
  const cipher = createCipheriv("aes-128-ctr", derivedKey.subarray(0, 16), iv);
  const ciphertext = Buffer.concat([cipher.update(keyBytes), cipher.final()]);

  // MAC = keccak256(derivedKey[16:32] + ciphertext)
  const macInput = Buffer.concat([derivedKey.subarray(16, 32), ciphertext]);
  const mac = keccak256(new Uint8Array(macInput)).slice(2); // strip 0x

  // Normalize address: lowercase, no 0x prefix
  const normalizedAddress = address.toLowerCase().replace(/^0x/, "");

  return {
    version: 3,
    id: randomUUID(),
    address: normalizedAddress,
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ciphertext.toString("hex"),
      kdf: "scrypt",
      kdfparams: {
        n: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        dklen: DKLEN,
        salt: salt.toString("hex"),
      },
      mac,
    },
  };
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

/**
 * Decrypt a V3 keystore and return the 0x-prefixed private key.
 * Throws on wrong password (MAC mismatch).
 */
export function decryptKeystore(
  keystore: KeystoreV3,
  password: string,
): `0x${string}` {
  const { kdfparams, ciphertext, cipherparams, mac } = keystore.crypto;

  const salt = Buffer.from(kdfparams.salt, "hex");
  const iv = Buffer.from(cipherparams.iv, "hex");
  const ciphertextBuf = Buffer.from(ciphertext, "hex");

  // Derive key
  const derivedKey = scryptSync(Buffer.from(password, "utf-8"), salt, DKLEN, {
    N: kdfparams.n,
    r: kdfparams.r,
    p: kdfparams.p,
    maxmem: 128 * kdfparams.n * kdfparams.r + 1024 * 1024,
  });

  // Verify MAC
  const macInput = Buffer.concat([derivedKey.subarray(16, 32), ciphertextBuf]);
  const computedMac = keccak256(new Uint8Array(macInput)).slice(2); // strip 0x

  if (computedMac !== mac) {
    throw new Error("Incorrect password (MAC mismatch)");
  }

  // Decrypt
  const decipher = createDecipheriv(
    "aes-128-ctr",
    derivedKey.subarray(0, 16),
    iv,
  );
  const decrypted = Buffer.concat([
    decipher.update(ciphertextBuf),
    decipher.final(),
  ]);

  return `0x${decrypted.toString("hex")}` as `0x${string}`;
}
