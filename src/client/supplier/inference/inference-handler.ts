import * as crypto from "node:crypto";
import { streamSimple, completeSimple } from "@mariozechner/pi-ai";
import type {
  Api,
  AssistantMessage as PiAssistantMessage,
  Context,
  ImageContent,
  Message as PiMessage,
  Tool,
  ToolCall,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { InferenceConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Chat Completions types (local — matches schema)
// ---------------------------------------------------------------------------

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

interface ToolCallType {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content?: string | null; tool_calls?: ToolCallType[] }
  | { role: "tool"; content: string; tool_call_id: string };

interface ToolDefinition {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ---------------------------------------------------------------------------
// Tool conversion
// ---------------------------------------------------------------------------

function convertTools(tools: ToolDefinition[]): Tool[] {
  return tools.map((td) => ({
    name: td.function.name,
    description: td.function.description ?? "",
    parameters: (td.function.parameters ?? {}) as Tool["parameters"],
  }));
}

// ---------------------------------------------------------------------------
// Image extraction from multipart user content
// ---------------------------------------------------------------------------

function extractImages(content: ContentPart[]): ImageContent[] {
  const images: ImageContent[] = [];
  for (const part of content) {
    if (part.type === "image_url") {
      // data: URIs contain base64 inline; URL references are not supported by pi-ai
      const url = part.image_url.url;
      if (url.startsWith("data:")) {
        const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (match) {
          images.push({ type: "image", data: match[2], mimeType: match[1] });
        }
      }
    }
  }
  return images;
}

// ---------------------------------------------------------------------------
// buildContext — Chat Completions messages → pi-ai Context
// ---------------------------------------------------------------------------

function buildContext(
  messages: Message[],
  tools?: ToolDefinition[],
): { context: Context; images: ImageContent[] } {
  const systemParts: string[] = [];
  const piMessages: PiMessage[] = [];
  const images: ImageContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else if (msg.role === "user") {
      if (typeof msg.content === "string") {
        piMessages.push({ role: "user", content: msg.content, timestamp: Date.now() } as UserMessage);
      } else {
        // Multipart content
        const text = msg.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        const itemImages = extractImages(msg.content);
        if (itemImages.length > 0) images.push(...itemImages);
        piMessages.push({
          role: "user",
          content: text ? [{ type: "text" as const, text }] : "",
          timestamp: Date.now(),
        } as UserMessage);
      }
    } else if (msg.role === "assistant") {
      const content: (ToolCall | { type: "text"; text: string })[] = [];
      if (msg.content) {
        content.push({ type: "text" as const, text: msg.content });
      }
      let stopReason: "stop" | "toolUse" = "stop";
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        stopReason = "toolUse";
        for (const tc of msg.tool_calls) {
          let parsedArgs: Record<string, unknown> = {};
          try { parsedArgs = JSON.parse(tc.function.arguments); } catch { parsedArgs = { _raw: tc.function.arguments }; }
          content.push({ type: "toolCall", id: tc.id, name: tc.function.name, arguments: parsedArgs });
        }
      }
      piMessages.push({
        role: "assistant",
        content,
        api: "openai-completions" as Api,
        provider: "",
        model: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason,
        timestamp: Date.now(),
      } as PiAssistantMessage);
    } else if (msg.role === "tool") {
      piMessages.push({
        role: "toolResult",
        toolCallId: msg.tool_call_id,
        toolName: "",
        content: [{ type: "text" as const, text: msg.content }],
        isError: false,
        timestamp: Date.now(),
      });
    }
  }

  // If no messages, add an empty user message to satisfy context requirements
  if (piMessages.length === 0) {
    piMessages.push({ role: "user", content: "", timestamp: Date.now() } as UserMessage);
  }

  return {
    context: {
      systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
      messages: piMessages,
      ...(tools && tools.length > 0 ? { tools: convertTools(tools) } : {}),
    },
    images,
  };
}

// ---------------------------------------------------------------------------
// Usage conversion
// ---------------------------------------------------------------------------

function toChatCompletionsUsage(piUsage: PiAssistantMessage["usage"]): ChatCompletionUsage {
  return {
    prompt_tokens: piUsage.input,
    completion_tokens: piUsage.output,
    total_tokens: piUsage.totalTokens,
  };
}

// ---------------------------------------------------------------------------
// handleIncomingRequest
// ---------------------------------------------------------------------------

/**
 * Handle an incoming request from the Sixerr server by calling the LLM
 * directly via pi-ai SDK.
 *
 * 1. Parses Chat Completions body to extract messages and images
 * 2. Calls the LLM using streamSimple/completeSimple
 * 3. Converts output to Chat Completions format → WS messages
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
    const messages = forwardBody.messages as Message[];
    const tools = forwardBody.tools as ToolDefinition[] | undefined;

    const { context, images } = buildContext(messages, tools);
    const { resolvedModel, modelRegistry } = inferenceConfig;

    const apiKey = await modelRegistry.getApiKey(resolvedModel);

    const timeoutMs = inferenceConfig.timeoutMs ?? 120_000;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    const completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const modelName = `${inferenceConfig.provider}/${inferenceConfig.model}`;

    try {
      if (isStreaming) {
        await handleStreaming(
          requestId,
          completionId,
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
          completionId,
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
  completionId: string,
  modelName: string,
  model: ReturnType<typeof Object>,
  context: Context,
  images: ImageContent[],
  apiKey: string | undefined,
  signal: AbortSignal,
  sendMessage: (msg: unknown) => void,
): Promise<void> {
  let accumulatedText = "";
  let usage: ChatCompletionUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const created = Math.floor(Date.now() / 1000);

  // Track tool calls
  const completedToolCalls: ToolCallType[] = [];
  let currentToolCallIndex = 0;

  // Helper to emit a chunk
  function emitChunk(delta: Record<string, unknown>, finishReason: string | null) {
    sendMessage({
      type: "stream_event",
      id: requestId,
      event: {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: modelName,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      },
    });
  }

  // Initial chunk: role announcement
  emitChunk({ role: "assistant" }, null);

  try {
    const eventStream = streamSimple(model as any, context, {
      apiKey,
      signal,
      ...(images.length > 0 ? { images } : {}),
    } as any);

    for await (const event of eventStream) {
      if (event.type === "text_delta") {
        accumulatedText += event.delta;
        emitChunk({ content: event.delta }, null);
      } else if (event.type === "toolcall_start") {
        currentToolCallIndex = completedToolCalls.length;
        emitChunk({
          tool_calls: [{
            index: currentToolCallIndex,
            id: "", // filled on toolcall_end
            type: "function",
            function: { name: "", arguments: "" },
          }],
        }, null);
      } else if (event.type === "toolcall_delta") {
        emitChunk({
          tool_calls: [{
            index: currentToolCallIndex,
            function: { arguments: event.delta },
          }],
        }, null);
      } else if (event.type === "toolcall_end") {
        const tc = event.toolCall;
        const argsString = JSON.stringify(tc.arguments);
        // Emit final chunk with id and name filled in
        emitChunk({
          tool_calls: [{
            index: currentToolCallIndex,
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: argsString },
          }],
        }, null);
        completedToolCalls.push({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: argsString },
        });
      } else if (event.type === "done") {
        usage = toChatCompletionsUsage(event.message.usage);
      } else if (event.type === "error") {
        usage = toChatCompletionsUsage(event.error.usage);
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

  // Final chunk with finish_reason
  const finishReason = completedToolCalls.length > 0 ? "tool_calls" : "stop";
  emitChunk({}, finishReason);

  // Send stream_end with usage
  sendMessage({ type: "stream_end", id: requestId, usage });
}

// ---------------------------------------------------------------------------
// Non-streaming path
// ---------------------------------------------------------------------------

async function handleNonStreaming(
  requestId: string,
  completionId: string,
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

  // Extract text
  const text = result.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");

  // Extract tool calls
  const toolCalls = result.content.filter(
    (c): c is ToolCall => c.type === "toolCall",
  );

  // Build tool_calls array if present
  const toolCallItems: ToolCallType[] = toolCalls.map((tc) => ({
    id: tc.id,
    type: "function" as const,
    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
  }));

  // Determine finish_reason
  let finishReason: "stop" | "length" | "tool_calls" = "stop";
  if (toolCallItems.length > 0) {
    finishReason = "tool_calls";
  } else if (result.stopReason === "length") {
    finishReason = "length";
  }

  const usage = toChatCompletionsUsage(result.usage);

  const response = {
    id: completionId,
    object: "chat.completion" as const,
    created: Math.floor(Date.now() / 1000),
    model: modelName,
    choices: [{
      index: 0,
      message: {
        role: "assistant" as const,
        content: text || null,
        ...(toolCallItems.length > 0 ? { tool_calls: toolCallItems } : {}),
      },
      finish_reason: finishReason,
    }],
    usage,
  };

  sendMessage({
    type: "response",
    id: requestId,
    body: response,
  });
}
