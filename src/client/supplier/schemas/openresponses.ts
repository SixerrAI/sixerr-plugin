// SOURCE OF TRUTH: sixerr-server/src/schemas/openresponses.ts
// Adapted from openclaw/src/gateway/open-responses.schema.ts using Zod 4 z.strictObject()

import { z } from "zod";

// ---------------------------------------------------------------------------
// Content Parts
// ---------------------------------------------------------------------------

export const InputTextContentPartSchema = z.strictObject({
  type: z.literal("input_text"),
  text: z.string(),
});

export const OutputTextContentPartSchema = z.strictObject({
  type: z.literal("output_text"),
  text: z.string(),
});

// OpenResponses Image Content: Supports URL or base64 sources
export const InputImageSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("url"),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal("base64"),
    media_type: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
    data: z.string().min(1), // base64-encoded
  }),
]);

export const InputImageContentPartSchema = z.strictObject({
  type: z.literal("input_image"),
  source: InputImageSourceSchema,
});

// OpenResponses File Content: Supports URL or base64 sources
export const InputFileSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("url"),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal("base64"),
    media_type: z.string().min(1), // MIME type
    data: z.string().min(1), // base64-encoded
    filename: z.string().optional(),
  }),
]);

export const InputFileContentPartSchema = z.strictObject({
  type: z.literal("input_file"),
  source: InputFileSourceSchema,
});

export const ContentPartSchema = z.discriminatedUnion("type", [
  InputTextContentPartSchema,
  OutputTextContentPartSchema,
  InputImageContentPartSchema,
  InputFileContentPartSchema,
]);

export type ContentPart = z.infer<typeof ContentPartSchema>;

// ---------------------------------------------------------------------------
// Item Types (ItemParam)
// ---------------------------------------------------------------------------

export const MessageItemRoleSchema = z.enum(["system", "developer", "user", "assistant"]);

export type MessageItemRole = z.infer<typeof MessageItemRoleSchema>;

export const MessageItemSchema = z.strictObject({
  type: z.literal("message"),
  role: MessageItemRoleSchema,
  content: z.union([z.string(), z.array(ContentPartSchema)]),
});

export const FunctionCallItemSchema = z.strictObject({
  type: z.literal("function_call"),
  id: z.string().optional(),
  call_id: z.string().optional(),
  name: z.string(),
  arguments: z.string(),
});

export const FunctionCallOutputItemSchema = z.strictObject({
  type: z.literal("function_call_output"),
  call_id: z.string(),
  output: z.string(),
});

export const ReasoningItemSchema = z.strictObject({
  type: z.literal("reasoning"),
  content: z.string().optional(),
  encrypted_content: z.string().optional(),
  summary: z.string().optional(),
});

export const ItemReferenceItemSchema = z.strictObject({
  type: z.literal("item_reference"),
  id: z.string(),
});

export const ItemParamSchema = z.discriminatedUnion("type", [
  MessageItemSchema,
  FunctionCallItemSchema,
  FunctionCallOutputItemSchema,
  ReasoningItemSchema,
  ItemReferenceItemSchema,
]);

export type ItemParam = z.infer<typeof ItemParamSchema>;

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const FunctionToolDefinitionSchema = z.strictObject({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1, "Tool name cannot be empty"),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});

// OpenResponses tool definitions match internal ToolDefinition structure
export const ToolDefinitionSchema = FunctionToolDefinitionSchema;

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// ---------------------------------------------------------------------------
// Request Body
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

export const CreateResponseBodySchema = z.strictObject({
  model: z.string(),
  input: z.union([z.string(), z.array(ItemParamSchema)]),
  instructions: z.string().optional(),
  tools: z.array(ToolDefinitionSchema).optional(),
  tool_choice: ToolChoiceSchema.optional(),
  stream: z.boolean().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  max_tool_calls: z.number().int().positive().optional(),
  user: z.string().optional(),
  // Phase 1: ignore but accept these fields
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  store: z.boolean().optional(),
  previous_response_id: z.string().optional(),
  reasoning: z
    .strictObject({
      effort: z.enum(["low", "medium", "high"]).optional(),
      summary: z.enum(["auto", "concise", "detailed"]).optional(),
    })
    .optional(),
  truncation: z.enum(["auto", "disabled"]).optional(),
});

export type CreateResponseBody = z.infer<typeof CreateResponseBodySchema>;

// ---------------------------------------------------------------------------
// Response Resource
// ---------------------------------------------------------------------------

export const ResponseStatusSchema = z.enum([
  "in_progress",
  "completed",
  "failed",
  "cancelled",
  "incomplete",
]);

export type ResponseStatus = z.infer<typeof ResponseStatusSchema>;

export const OutputItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    id: z.string(),
    role: z.literal("assistant"),
    content: z.array(OutputTextContentPartSchema),
    status: z.enum(["in_progress", "completed"]).optional(),
  }),
  z.object({
    type: z.literal("function_call"),
    id: z.string(),
    call_id: z.string(),
    name: z.string(),
    arguments: z.string(),
    status: z.enum(["in_progress", "completed"]).optional(),
  }),
  z.object({
    type: z.literal("reasoning"),
    id: z.string(),
    content: z.string().optional(),
    summary: z.string().optional(),
  }),
]);

export type OutputItem = z.infer<typeof OutputItemSchema>;

export const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

export type Usage = z.infer<typeof UsageSchema>;

export const ResponseResourceSchema = z.object({
  id: z.string(),
  object: z.literal("response"),
  created_at: z.number().int(),
  status: ResponseStatusSchema,
  model: z.string(),
  output: z.array(OutputItemSchema),
  usage: UsageSchema,
  // Optional fields for future phases
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export type ResponseResource = z.infer<typeof ResponseResourceSchema>;

// ---------------------------------------------------------------------------
// Streaming Event Types
// ---------------------------------------------------------------------------

export const ResponseCreatedEventSchema = z.object({
  type: z.literal("response.created"),
  response: ResponseResourceSchema,
});

export const ResponseInProgressEventSchema = z.object({
  type: z.literal("response.in_progress"),
  response: ResponseResourceSchema,
});

export const ResponseCompletedEventSchema = z.object({
  type: z.literal("response.completed"),
  response: ResponseResourceSchema,
});

export const ResponseFailedEventSchema = z.object({
  type: z.literal("response.failed"),
  response: ResponseResourceSchema,
});

export const OutputItemAddedEventSchema = z.object({
  type: z.literal("response.output_item.added"),
  output_index: z.number().int().nonnegative(),
  item: OutputItemSchema,
});

export const OutputItemDoneEventSchema = z.object({
  type: z.literal("response.output_item.done"),
  output_index: z.number().int().nonnegative(),
  item: OutputItemSchema,
});

export const ContentPartAddedEventSchema = z.object({
  type: z.literal("response.content_part.added"),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  part: OutputTextContentPartSchema,
});

export const ContentPartDoneEventSchema = z.object({
  type: z.literal("response.content_part.done"),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  part: OutputTextContentPartSchema,
});

export const OutputTextDeltaEventSchema = z.object({
  type: z.literal("response.output_text.delta"),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  delta: z.string(),
});

export const OutputTextDoneEventSchema = z.object({
  type: z.literal("response.output_text.done"),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  content_index: z.number().int().nonnegative(),
  text: z.string(),
});

// Function call argument streaming events (OpenAI Responses API spec)
// Not currently emitted by OpenClaw but defined for forward compatibility

export const FunctionCallArgumentsDeltaEventSchema = z.object({
  type: z.literal("response.function_call_arguments.delta"),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  call_id: z.string(),
  delta: z.string(),
});

export const FunctionCallArgumentsDoneEventSchema = z.object({
  type: z.literal("response.function_call_arguments.done"),
  item_id: z.string(),
  output_index: z.number().int().nonnegative(),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string(),
});

export type StreamingEvent =
  | z.infer<typeof ResponseCreatedEventSchema>
  | z.infer<typeof ResponseInProgressEventSchema>
  | z.infer<typeof ResponseCompletedEventSchema>
  | z.infer<typeof ResponseFailedEventSchema>
  | z.infer<typeof OutputItemAddedEventSchema>
  | z.infer<typeof OutputItemDoneEventSchema>
  | z.infer<typeof ContentPartAddedEventSchema>
  | z.infer<typeof ContentPartDoneEventSchema>
  | z.infer<typeof OutputTextDeltaEventSchema>
  | z.infer<typeof OutputTextDoneEventSchema>
  | z.infer<typeof FunctionCallArgumentsDeltaEventSchema>
  | z.infer<typeof FunctionCallArgumentsDoneEventSchema>;
