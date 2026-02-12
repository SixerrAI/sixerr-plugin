// SOURCE OF TRUTH: switchboard-server/src/schemas/protocol.ts

import { z } from "zod";

// ---------------------------------------------------------------------------
// Protocol Version (PROT-03)
// ---------------------------------------------------------------------------

export const SWITCHBOARD_PROTOCOL_VERSION = 1 as const;

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
  protocol: z.literal(SWITCHBOARD_PROTOCOL_VERSION),
});

export const ServerAuthErrorMessageSchema = z.strictObject({
  type: z.literal("auth_error"),
  message: z.string(),
});

export const ServerMessageSchema = z.discriminatedUnion("type", [
  ServerRequestMessageSchema,
  ServerPingMessageSchema,
  ServerAuthOkMessageSchema,
  ServerAuthErrorMessageSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type ServerRequestMessage = z.infer<typeof ServerRequestMessageSchema>;
export type ServerPingMessage = z.infer<typeof ServerPingMessageSchema>;
export type ServerAuthOkMessage = z.infer<typeof ServerAuthOkMessageSchema>;
export type ServerAuthErrorMessage = z.infer<typeof ServerAuthErrorMessageSchema>;

// ---------------------------------------------------------------------------
// Plugin -> Server Messages
// ---------------------------------------------------------------------------

export const PluginAuthMessageSchema = z.strictObject({
  type: z.literal("auth"),
  apiKey: z.string().min(1),
  protocol: z.literal(SWITCHBOARD_PROTOCOL_VERSION),
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

export const PluginMessageSchema = z.discriminatedUnion("type", [
  PluginAuthMessageSchema,
  PluginResponseMessageSchema,
  PluginStreamEventMessageSchema,
  PluginStreamEndMessageSchema,
  PluginErrorMessageSchema,
  PluginPongMessageSchema,
]);

export type PluginMessage = z.infer<typeof PluginMessageSchema>;
export type PluginAuthMessage = z.infer<typeof PluginAuthMessageSchema>;
export type PluginResponseMessage = z.infer<typeof PluginResponseMessageSchema>;
export type PluginStreamEventMessage = z.infer<typeof PluginStreamEventMessageSchema>;
export type PluginStreamEndMessage = z.infer<typeof PluginStreamEndMessageSchema>;
export type PluginErrorMessage = z.infer<typeof PluginErrorMessageSchema>;
export type PluginPongMessage = z.infer<typeof PluginPongMessageSchema>;
