// SOURCE OF TRUTH: sixerr-server/src/schemas/protocol.ts

import { z } from "zod";

// ---------------------------------------------------------------------------
// Protocol Version (PROT-03)
// ---------------------------------------------------------------------------

export const SIXERR_PROTOCOL_VERSION = 2 as const;

// ---------------------------------------------------------------------------
// Server -> Plugin Messages
// ---------------------------------------------------------------------------

export const ServerRequestMessageSchema = z.strictObject({
  type: z.literal("request"),
  id: z.string().min(1),
  body: z.unknown(),
});

export const ServerPingMessageSchema = z.strictObject({
  type: z.literal("ping"),
  ts: z.number().int(),
});

export const ServerAuthOkMessageSchema = z.strictObject({
  type: z.literal("auth_ok"),
  pluginId: z.string().min(1),
  protocol: z.literal(SIXERR_PROTOCOL_VERSION),
});

export const ServerAuthErrorMessageSchema = z.strictObject({
  type: z.literal("auth_error"),
  message: z.string(),
});

export const ServerJwtRefreshMessageSchema = z.strictObject({
  type: z.literal("jwt_refresh"),
  jwt: z.string().min(1),
});

export const ServerPriceUpdateAckMessageSchema = z.strictObject({
  type: z.literal("price_update_ack"),
  inputTokenPrice: z.string().min(1),
  outputTokenPrice: z.string().min(1),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerRequestMessageSchema,
  ServerPingMessageSchema,
  ServerAuthOkMessageSchema,
  ServerAuthErrorMessageSchema,
  ServerJwtRefreshMessageSchema,
  ServerPriceUpdateAckMessageSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type ServerRequestMessage = z.infer<typeof ServerRequestMessageSchema>;
export type ServerPingMessage = z.infer<typeof ServerPingMessageSchema>;
export type ServerAuthOkMessage = z.infer<typeof ServerAuthOkMessageSchema>;
export type ServerAuthErrorMessage = z.infer<typeof ServerAuthErrorMessageSchema>;
export type ServerJwtRefreshMessage = z.infer<typeof ServerJwtRefreshMessageSchema>;
export type ServerPriceUpdateAckMessage = z.infer<typeof ServerPriceUpdateAckMessageSchema>;

// ---------------------------------------------------------------------------
// Plugin -> Server Messages
// ---------------------------------------------------------------------------

export const PluginAuthMessageSchema = z.strictObject({
  type: z.literal("auth"),
  jwt: z.string().min(1),
  protocol: z.literal(SIXERR_PROTOCOL_VERSION),
  // Phase 7: Optional pricing declaration (DISC-01)
  inputTokenPrice: z.string().optional(),   // Atomic USDC per token
  outputTokenPrice: z.string().optional(),  // Atomic USDC per token
  // Phase 11: Optional agent identity card
  agentName: z.string().optional(),
  agentDescription: z.string().optional(),
});

export const PluginResponseMessageSchema = z.strictObject({
  type: z.literal("response"),
  id: z.string().min(1),
  body: z.unknown(),
});

export const PluginStreamEventMessageSchema = z.strictObject({
  type: z.literal("stream_event"),
  id: z.string().min(1),
  event: z.unknown(),
});

export const PluginStreamEndMessageSchema = z.strictObject({
  type: z.literal("stream_end"),
  id: z.string().min(1),
  usage: z.strictObject({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }),
});

export const PluginErrorMessageSchema = z.strictObject({
  type: z.literal("error"),
  id: z.string().min(1),
  code: z.string(),
  message: z.string(),
});

export const PluginPongMessageSchema = z.strictObject({
  type: z.literal("pong"),
  ts: z.number().int(),
});

export const PluginPriceUpdateMessageSchema = z.strictObject({
  type: z.literal("price_update"),
  inputTokenPrice: z.string().min(1),
  outputTokenPrice: z.string().min(1),
});

export const PluginMessageSchema = z.discriminatedUnion("type", [
  PluginAuthMessageSchema,
  PluginResponseMessageSchema,
  PluginStreamEventMessageSchema,
  PluginStreamEndMessageSchema,
  PluginErrorMessageSchema,
  PluginPongMessageSchema,
  PluginPriceUpdateMessageSchema,
]);

export type PluginMessage = z.infer<typeof PluginMessageSchema>;
export type PluginAuthMessage = z.infer<typeof PluginAuthMessageSchema>;
export type PluginResponseMessage = z.infer<typeof PluginResponseMessageSchema>;
export type PluginStreamEventMessage = z.infer<typeof PluginStreamEventMessageSchema>;
export type PluginStreamEndMessage = z.infer<typeof PluginStreamEndMessageSchema>;
export type PluginErrorMessage = z.infer<typeof PluginErrorMessageSchema>;
export type PluginPongMessage = z.infer<typeof PluginPongMessageSchema>;
export type PluginPriceUpdateMessage = z.infer<typeof PluginPriceUpdateMessageSchema>;
