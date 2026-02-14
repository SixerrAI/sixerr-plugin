import { describe, it, expect } from "vitest";
import {
  CreateResponseBodySchema,
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
      body: { model: "test", input: "Hello" },
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
        input_tokens: 10,
        output_tokens: 20,
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
// CreateResponseBodySchema in plugin context
// ---------------------------------------------------------------------------

describe("CreateResponseBodySchema in plugin context", () => {
  it("accepts minimal valid request", () => {
    const result = CreateResponseBodySchema.safeParse({
      model: "openclaw/main",
      input: "Hello",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("openclaw/main");
      expect(result.data.input).toBe("Hello");
    }
  });

  it("rejects malformed request (missing model)", () => {
    const result = CreateResponseBodySchema.safeParse({
      input: "Hello",
    });
    expect(result.success).toBe(false);
  });
});
