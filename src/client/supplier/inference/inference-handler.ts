import * as crypto from "node:crypto";
import { streamSimple, completeSimple } from "@mariozechner/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  ImageContent,
  Message,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { InferenceConfig } from "./types.js";

// ---------------------------------------------------------------------------
// OpenResponses input types (subset needed for prompt building)
// ---------------------------------------------------------------------------

type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; source: { type: "url"; url: string } | { type: "base64"; data: string; media_type: string } }
  | { type: "input_file"; source: { type: "url"; url: string } | { type: "base64"; data: string; media_type: string } }
  | { type: "output_text"; text: string };

type ItemParam =
  | { type: "message"; role: "system" | "developer" | "user" | "assistant"; content: string | ContentPart[] }
  | { type: "function_call_output"; call_id: string; output: string }
  | { type: "reasoning"; content?: string; summary?: string };

// ---------------------------------------------------------------------------
// OpenResponses response types
// ---------------------------------------------------------------------------

interface Usage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

interface OutputItem {
  type: "message";
  id: string;
  role: "assistant";
  content: { type: "output_text"; text: string }[];
  status: "completed";
}

interface ResponseResource {
  id: string;
  object: "response";
  created_at: number;
  status: "completed" | "failed" | "incomplete";
  model: string;
  output: OutputItem[];
  usage: Usage;
}

// ---------------------------------------------------------------------------
// Prompt building (adapted from openclaw/src/gateway/openresponses-http.ts)
// ---------------------------------------------------------------------------

function extractTextContent(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "input_text") return part.text;
      if (part.type === "output_text") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractImages(content: string | ContentPart[]): ImageContent[] {
  if (typeof content === "string") return [];
  const images: ImageContent[] = [];
  for (const part of content) {
    if (part.type === "input_image" && part.source.type === "base64") {
      images.push({
        type: "image",
        data: part.source.data,
        mimeType: part.source.media_type,
      });
    }
  }
  return images;
}

/**
 * Convert OpenResponses input to pi-ai Context.
 */
function buildContext(
  input: string | ItemParam[],
  instructions?: string,
): { context: Context; images: ImageContent[] } {
  const systemParts: string[] = [];
  const messages: Message[] = [];
  const images: ImageContent[] = [];

  if (instructions) {
    systemParts.push(instructions);
  }

  if (typeof input === "string") {
    messages.push({
      role: "user",
      content: input,
      timestamp: Date.now(),
    } as UserMessage);
  } else {
    for (const item of input) {
      if (item.type === "message") {
        const text = extractTextContent(item.content).trim();
        if (!text) continue;

        if (item.role === "system" || item.role === "developer") {
          systemParts.push(text);
        } else if (item.role === "user") {
          const itemImages = extractImages(item.content);
          if (itemImages.length > 0) {
            images.push(...itemImages);
            messages.push({
              role: "user",
              content: [{ type: "text" as const, text }],
              timestamp: Date.now(),
            } as UserMessage);
          } else {
            messages.push({
              role: "user",
              content: text,
              timestamp: Date.now(),
            } as UserMessage);
          }
        } else if (item.role === "assistant") {
          messages.push({
            role: "assistant",
            content: [{ type: "text" as const, text }],
            api: "openai-responses" as Api,
            provider: "",
            model: "",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
            stopReason: "stop",
            timestamp: Date.now(),
          } as AssistantMessage);
        }
      } else if (item.type === "function_call_output") {
        messages.push({
          role: "toolResult",
          toolCallId: item.call_id,
          toolName: "",
          content: [{ type: "text" as const, text: item.output }],
          isError: false,
          timestamp: Date.now(),
        });
      }
      // Skip reasoning items
    }
  }

  // If no user messages, add an empty one to satisfy context requirements
  if (messages.length === 0) {
    messages.push({
      role: "user",
      content: "",
      timestamp: Date.now(),
    } as UserMessage);
  }

  return {
    context: {
      systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
      messages,
    },
    images,
  };
}

// ---------------------------------------------------------------------------
// Usage conversion
// ---------------------------------------------------------------------------

function toOpenResponsesUsage(piUsage: AssistantMessage["usage"]): Usage {
  return {
    input_tokens: piUsage.input,
    output_tokens: piUsage.output,
    total_tokens: piUsage.totalTokens,
  };
}

// ---------------------------------------------------------------------------
// Response building
// ---------------------------------------------------------------------------

function buildResponseResource(
  responseId: string,
  model: string,
  text: string,
  usage: Usage,
  status: "completed" | "failed" = "completed",
): ResponseResource {
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status,
    model,
    output: [
      {
        type: "message",
        id: `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        role: "assistant",
        content: [{ type: "output_text", text }],
        status: "completed",
      },
    ],
    usage,
  };
}

// ---------------------------------------------------------------------------
// handleIncomingRequest
// ---------------------------------------------------------------------------

/**
 * Handle an incoming request from the Sixerr server by calling the LLM
 * directly via pi-ai SDK.
 *
 * 1. Parses OpenResponses body to extract message text and images
 * 2. Calls the LLM using streamSimple/completeSimple
 * 3. Converts output to OpenResponses format → WS messages
 * 4. Sends error WS message on failure
 */
export async function handleIncomingRequest(
  requestId: string,
  body: unknown,
  inferenceConfig: InferenceConfig,
  sendMessage: (msg: unknown) => void,
): Promise<void> {
  try {
    const forwardBody = { ...(body as Record<string, unknown>) };
    const isStreaming = forwardBody.stream === true;
    const input = forwardBody.input as string | ItemParam[];
    const instructions = forwardBody.instructions as string | undefined;

    const { context, images } = buildContext(input, instructions);
    const { resolvedModel, modelRegistry } = inferenceConfig;

    // Resolve API key for this model
    const apiKey = await modelRegistry.getApiKey(resolvedModel);

    const timeoutMs = inferenceConfig.timeoutMs ?? 120_000;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    const responseId = `resp_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const outputItemId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const modelName = `${inferenceConfig.provider}/${inferenceConfig.model}`;

    try {
      if (isStreaming) {
        await handleStreaming(
          requestId,
          responseId,
          outputItemId,
          modelName,
          resolvedModel,
          context,
          images,
          apiKey,
          abortController.signal,
          sendMessage,
        );
      } else {
        await handleNonStreaming(
          requestId,
          responseId,
          modelName,
          resolvedModel,
          context,
          images,
          apiKey,
          abortController.signal,
          sendMessage,
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    sendMessage({
      type: "error",
      id: requestId,
      code: "plugin_error",
      message: (err as Error).message || String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Streaming path
// ---------------------------------------------------------------------------

async function handleStreaming(
  requestId: string,
  responseId: string,
  outputItemId: string,
  modelName: string,
  model: ReturnType<typeof Object>,
  context: Context,
  images: ImageContent[],
  apiKey: string | undefined,
  signal: AbortSignal,
  sendMessage: (msg: unknown) => void,
): Promise<void> {
  let accumulatedText = "";
  let usage: Usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  // Send initial response.created event
  const initialResponse = buildResponseResource(responseId, modelName, "", usage);
  initialResponse.status = "completed"; // will be overwritten

  sendMessage({
    type: "stream_event",
    id: requestId,
    event: {
      type: "response.created",
      response: { ...initialResponse, status: "in_progress" as const, output: [] },
    },
  });

  // Send output item added
  sendMessage({
    type: "stream_event",
    id: requestId,
    event: {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "message",
        id: outputItemId,
        role: "assistant",
        content: [],
        status: "in_progress",
      },
    },
  });

  // Send content part added
  sendMessage({
    type: "stream_event",
    id: requestId,
    event: {
      type: "response.content_part.added",
      item_id: outputItemId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "" },
    },
  });

  try {
    const eventStream = streamSimple(model as any, context, {
      apiKey,
      signal,
      ...(images.length > 0 ? { images } : {}),
    } as any);

    for await (const event of eventStream) {
      if (event.type === "text_delta") {
        accumulatedText += event.delta;
        sendMessage({
          type: "stream_event",
          id: requestId,
          event: {
            type: "response.output_text.delta",
            item_id: outputItemId,
            output_index: 0,
            content_index: 0,
            delta: event.delta,
          },
        });
      } else if (event.type === "done") {
        usage = toOpenResponsesUsage(event.message.usage);
      } else if (event.type === "error") {
        usage = toOpenResponsesUsage(event.error.usage);
        if (event.error.errorMessage) {
          sendMessage({
            type: "error",
            id: requestId,
            code: "plugin_error",
            message: event.error.errorMessage,
          });
        }
      }
    }
  } catch (err) {
    sendMessage({
      type: "error",
      id: requestId,
      code: "plugin_error",
      message: (err as Error).message || String(err),
    });
  }

  // Send text done
  sendMessage({
    type: "stream_event",
    id: requestId,
    event: {
      type: "response.output_text.done",
      item_id: outputItemId,
      output_index: 0,
      content_index: 0,
      text: accumulatedText,
    },
  });

  // Send response.completed
  const finalResponse = buildResponseResource(responseId, modelName, accumulatedText, usage);
  sendMessage({
    type: "stream_event",
    id: requestId,
    event: { type: "response.completed", response: finalResponse },
  });

  // Send stream_end
  sendMessage({ type: "stream_end", id: requestId, usage });
}

// ---------------------------------------------------------------------------
// Non-streaming path
// ---------------------------------------------------------------------------

async function handleNonStreaming(
  requestId: string,
  responseId: string,
  modelName: string,
  model: ReturnType<typeof Object>,
  context: Context,
  images: ImageContent[],
  apiKey: string | undefined,
  signal: AbortSignal,
  sendMessage: (msg: unknown) => void,
): Promise<void> {
  const result = await completeSimple(model as any, context, {
    apiKey,
    signal,
    ...(images.length > 0 ? { images } : {}),
  } as any);

  // Extract text from assistant message
  const text = result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");

  const usage = toOpenResponsesUsage(result.usage);
  const response = buildResponseResource(responseId, modelName, text, usage);

  sendMessage({
    type: "response",
    id: requestId,
    body: response,
  });
}
