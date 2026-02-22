import { describe, it, expect } from "vitest";
import {
  ChatCompletionRequestSchema,
  ServerMessageSchema,
  PluginMessageSchema,
  SCHEMA_VERSION,
  SIXERR_PROTOCOL_VERSION,
} from "./index.js";

// ---------------------------------------------------------------------------
// Schema copy integrity
// ---------------------------------------------------------------------------

describe("Schema copy integrity", () => {
  it("SCHEMA_VERSION equals 1 (matches server)", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("SIXERR_PROTOCOL_VERSION equals 2 (matches server)", () => {
    expect(SIXERR_PROTOCOL_VERSION).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Plugin receives server messages (ServerMessageSchema)
// ---------------------------------------------------------------------------

describe("Plugin receives server messages (ServerMessageSchema)", () => {
  it("parses a request message", () => {
    const result = ServerMessageSchema.safeParse({
      type: "request",
      id: "req-1",
      body: { model: "test", messages: [{ role: "user", content: "Hello" }] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("request");
    }
  });

  it("parses a ping message", () => {
    const result = ServerMessageSchema.safeParse({
      type: "ping",
      ts: Date.now(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("ping");
    }
  });

  it("parses an auth_ok message", () => {
    const result = ServerMessageSchema.safeParse({
      type: "auth_ok",
      pluginId: "p-1",
      protocol: 2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("auth_ok");
    }
  });

  it("parses an auth_error message", () => {
    const result = ServerMessageSchema.safeParse({
      type: "auth_error",
      message: "Invalid token",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("auth_error");
    }
  });

  it("parses a jwt_refresh message", () => {
    const result = ServerMessageSchema.safeParse({
      type: "jwt_refresh",
      jwt: "eyJhbGciOiJFUzI1NiJ9.new-token",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("jwt_refresh");
    }
  });

  it("rejects invalid message with unknown type", () => {
    const result = ServerMessageSchema.safeParse({
      type: "unknown",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Plugin sends messages (PluginMessageSchema)
// ---------------------------------------------------------------------------

describe("Plugin sends messages (PluginMessageSchema)", () => {
  it("parses auth message with JWT", () => {
    const result = PluginMessageSchema.safeParse({
      type: "auth",
      jwt: "eyJhbGciOiJFUzI1NiJ9.test-token",
      protocol: 2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("auth");
    }
  });

  it("parses response message", () => {
    const result = PluginMessageSchema.safeParse({
      type: "response",
      id: "req-1",
      body: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("response");
    }
  });

  it("parses stream_event message", () => {
    const result = PluginMessageSchema.safeParse({
      type: "stream_event",
      id: "req-1",
      event: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("stream_event");
    }
  });

  it("parses stream_end message with usage", () => {
    const result = PluginMessageSchema.safeParse({
      type: "stream_end",
      id: "req-1",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("stream_end");
    }
  });

  it("parses error message", () => {
    const result = PluginMessageSchema.safeParse({
      type: "error",
      id: "req-1",
      code: "internal_error",
      message: "Something went wrong",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("error");
    }
  });

  it("parses pong message", () => {
    const result = PluginMessageSchema.safeParse({
      type: "pong",
      ts: Date.now(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("pong");
    }
  });

  it("rejects auth with wrong protocol version", () => {
    const result = PluginMessageSchema.safeParse({
      type: "auth",
      jwt: "token",
      protocol: 999,
    });
    expect(result.success).toBe(false);
  });

  it("rejects auth with old apiKey field", () => {
    const result = PluginMessageSchema.safeParse({
      type: "auth",
      apiKey: "sb_plugin_test123",
      protocol: 2,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ChatCompletionRequestSchema in plugin context
// ---------------------------------------------------------------------------

describe("ChatCompletionRequestSchema in plugin context", () => {
  it("accepts minimal valid request", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "anthropic/claude-sonnet-4-5-20250929",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("anthropic/claude-sonnet-4-5-20250929");
      expect(result.data.messages).toHaveLength(1);
    }
  });

  it("accepts request with system message", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "default",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.messages).toHaveLength(2);
    }
  });

  it("accepts request with tools", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "default",
      messages: [{ role: "user", content: "What is the weather?" }],
      tools: [{
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the weather",
          parameters: { type: "object", properties: { location: { type: "string" } } },
        },
      }],
      tool_choice: "auto",
    });
    expect(result.success).toBe(true);
  });

  it("accepts request with tool results", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "default",
      messages: [
        { role: "user", content: "What is the weather?" },
        { role: "assistant", content: null, tool_calls: [{ id: "tc1", type: "function", function: { name: "get_weather", arguments: '{"location":"NYC"}' } }] },
        { role: "tool", content: '{"temp":72}', tool_call_id: "tc1" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts request with max_tokens", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "default",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_tokens).toBe(1024);
    }
  });

  it("accepts request with Sixerr marketplace extensions", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "default",
      messages: [{ role: "user", content: "Hello" }],
      routing: "cheapest",
      max_input_token_price: "100",
      max_output_token_price: "200",
      bid_timeout_seconds: 30,
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed request (missing model)", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed request (missing messages)", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "default",
    });
    expect(result.success).toBe(false);
  });

  it("rejects old OpenResponses format (input field)", () => {
    const result = ChatCompletionRequestSchema.safeParse({
      model: "default",
      input: "Hello",
    });
    expect(result.success).toBe(false);
  });
});
