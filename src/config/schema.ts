import { z } from "zod";

export const ConfigSchema = z.object({
  version: z.literal(1),
  walletType: z.enum(["coinbase", "local", "imported"]),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),

  // CDP credentials (only when walletType === "coinbase")
  cdpCredentials: z
    .object({
      apiKeyId: z.string(),
      apiKeySecret: z.string(),
      walletSecret: z.string(),
    })
    .optional(),

  // Server URL (hardcoded default with env var override)
  serverUrl: z.string().url(),

  // Pricing (atomic USDC per token, stored as strings to avoid float precision)
  pricing: z.object({
    inputTokenPrice: z.string(),
    outputTokenPrice: z.string(),
  }),

  // OpenClaw Gateway
  openClawToken: z.string().min(1),
  openClawUrl: z.string().url().default("http://localhost:18789"),

  // JWT for OpenClaw provider registration (persisted after auth)
  jwt: z.string().optional(),

  // Default model name for OpenClaw forwarding (optional override)
  defaultModel: z.string().optional(),
});

export type SixerrConfig = z.infer<typeof ConfigSchema>;
