import { z } from "zod";

// ---------------------------------------------------------------------------
// Content Parts (reused from OpenResponses — multipart user messages)
// ---------------------------------------------------------------------------

export const TextContentPartSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string(),
});

export const ImageUrlContentPartSchema = z.strictObject({
  type: z.literal("image_url"),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(["auto", "low", "high"]).optional(),
  }),
});

export const ContentPartSchema = z.union([
  TextContentPartSchema,
  ImageUrlContentPartSchema,
]);

export type ContentPart = z.infer<typeof ContentPartSchema>;

// ---------------------------------------------------------------------------
// Tool Call (nested inside assistant messages)
// ---------------------------------------------------------------------------

export const ToolCallSchema = z.strictObject({
  id: z.string(),
  type: z.literal("function"),
  function: z.strictObject({
    name: z.string(),
    arguments: z.string(),
  }),
});

export type ToolCallType = z.infer<typeof ToolCallSchema>;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const SystemMessageSchema = z.strictObject({
  role: z.literal("system"),
  content: z.string(),
});

export const UserMessageSchema = z.strictObject({
  role: z.literal("user"),
  content: z.union([z.string(), z.array(ContentPartSchema)]),
});

export const AssistantMessageSchema = z.strictObject({
  role: z.literal("assistant"),
  content: z.string().nullable().optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
});

export const ToolMessageSchema = z.strictObject({
  role: z.literal("tool"),
  content: z.string(),
  tool_call_id: z.string(),
});

export const MessageSchema = z.discriminatedUnion("role", [
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

export type Message = z.infer<typeof MessageSchema>;

// ---------------------------------------------------------------------------
// Tool Definitions (same format as OpenResponses — unchanged)
// ---------------------------------------------------------------------------

export const FunctionToolDefinitionSchema = z.strictObject({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1, "Tool name cannot be empty"),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const ToolDefinitionSchema = FunctionToolDefinitionSchema;

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// ---------------------------------------------------------------------------
// Tool Choice (same format — unchanged)
// ---------------------------------------------------------------------------

export const ToolChoiceSchema = z.union([
  z.literal("auto"),
  z.literal("none"),
  z.literal("required"),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string() }),
  }),
]);

// ---------------------------------------------------------------------------
// Chat Completion Request
// ---------------------------------------------------------------------------

export const ChatCompletionRequestSchema = z.strictObject({
  model: z.string(),
  messages: z.array(MessageSchema),
  tools: z.array(ToolDefinitionSchema).optional(),
  tool_choice: ToolChoiceSchema.optional(),
  stream: z.boolean().optional(),
  max_tokens: z.number().int().positive().optional(),
  // Passthrough fields (accepted but not used by plugin)
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  user: z.string().optional(),
  // Sixerr marketplace extensions
  routing: z.enum(["cheapest", "fastest"]).optional(),
  max_input_token_price: z.string().optional(),
  max_output_token_price: z.string().optional(),
  bid_timeout_seconds: z.number().int().positive().optional(),
});

export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

// ---------------------------------------------------------------------------
// Chat Completion Response (non-streaming)
// ---------------------------------------------------------------------------

export const ChatCompletionUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

export type ChatCompletionUsage = z.infer<typeof ChatCompletionUsageSchema>;

export const ChatCompletionChoiceSchema = z.object({
  index: z.number().int().nonnegative(),
  message: AssistantMessageSchema,
  finish_reason: z.enum(["stop", "length", "tool_calls"]).nullable(),
});

export const ChatCompletionSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(ChatCompletionChoiceSchema),
  usage: ChatCompletionUsageSchema,
});

export type ChatCompletion = z.infer<typeof ChatCompletionSchema>;

// ---------------------------------------------------------------------------
// Chat Completion Chunk (streaming)
// ---------------------------------------------------------------------------

export const ChatCompletionChunkDeltaSchema = z.object({
  role: z.literal("assistant").optional(),
  content: z.string().nullable().optional(),
  tool_calls: z.array(z.object({
    index: z.number().int().nonnegative(),
    id: z.string().optional(),
    type: z.literal("function").optional(),
    function: z.object({
      name: z.string().optional(),
      arguments: z.string().optional(),
    }).optional(),
  })).optional(),
});

export const ChatCompletionChunkChoiceSchema = z.object({
  index: z.number().int().nonnegative(),
  delta: ChatCompletionChunkDeltaSchema,
  finish_reason: z.enum(["stop", "length", "tool_calls"]).nullable(),
});

export const ChatCompletionChunkSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion.chunk"),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(ChatCompletionChunkChoiceSchema),
  usage: ChatCompletionUsageSchema.nullable().optional(),
});

export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;
