import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { ConfigSchema, type SixerrConfig } from "./schema.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const CONFIG_DIR = join(homedir(), ".sixerr");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const KEYSTORE_DIR = join(CONFIG_DIR, "keystores");
export const KEYSTORE_FILE = join(KEYSTORE_DIR, "wallet.json");

// ---------------------------------------------------------------------------
// Server URL
// ---------------------------------------------------------------------------

const DEFAULT_SERVER_URL = "https://sixerr.ai";

export function getServerUrl(): string {
  return process.env.SIXERR_SERVER_URL ?? DEFAULT_SERVER_URL;
}

// ---------------------------------------------------------------------------
// Config I/O
// ---------------------------------------------------------------------------

/**
 * Persist plugin config to ~/.sixerr/config.json with 0600 perms.
 */
export async function saveConfig(config: SixerrConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  await chmod(CONFIG_FILE, 0o600);
}

/**
 * Load and validate stored config. Returns null if missing or invalid.
 */
export async function loadConfig(): Promise<SixerrConfig | null> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return ConfigSchema.parse(parsed);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Keystore I/O
// ---------------------------------------------------------------------------

/**
 * Persist a V3 keystore JSON to ~/.sixerr/keystores/wallet.json
 * with 0600 file perms and 0700 directory perms.
 */
export async function saveKeystore(keystore: unknown): Promise<void> {
  await mkdir(KEYSTORE_DIR, { recursive: true });
  await chmod(KEYSTORE_DIR, 0o700);
  await writeFile(KEYSTORE_FILE, JSON.stringify(keystore, null, 2), "utf-8");
  await chmod(KEYSTORE_FILE, 0o600);
}

/**
 * Load a stored keystore. Returns null if missing or unparseable.
 */
export async function loadKeystore(): Promise<unknown | null> {
  try {
    const raw = await readFile(KEYSTORE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
