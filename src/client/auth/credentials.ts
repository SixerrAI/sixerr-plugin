import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const CREDENTIALS_DIR = join(homedir(), ".sixerr");
export const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredCredentials {
  jwt: string;
  agentId: string;
  serverUrl: string;
  issuedAt: string; // ISO 8601 timestamp
}

// ---------------------------------------------------------------------------
// Save / Load
// ---------------------------------------------------------------------------

/**
 * Persist JWT credentials to ~/.sixerr/credentials.json with 0600 perms.
 */
export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), "utf-8");
  await chmod(CREDENTIALS_FILE, 0o600);
}

/**
 * Load stored credentials. Returns null if file missing or unparseable.
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await readFile(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
}
