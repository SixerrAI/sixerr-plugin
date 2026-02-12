import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import * as http from "node:http";
import { forwardToOpenClaw, type OpenClawClientConfig } from "./openclaw-client.js";
import { convertToolsToClientTools } from "./tool-converter.js";
import { handleIncomingRequest } from "./request-forwarder.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a test HTTP server that responds with the given handler. */
function createMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/** Collect the full body from an incoming request. */
function collectBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

// ---------------------------------------------------------------------------
// forwardToOpenClaw tests
// ---------------------------------------------------------------------------

describe("forwardToOpenClaw", () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
    }
  });

  it("resolves with parsed JSON on 200 success", async () => {
    const responseBody = { id: "resp-1", object: "response", status: "completed" };
    const mock = await createMockServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(responseBody));
    });
    server = mock.server;

    const config: OpenClawClientConfig = {
      gatewayUrl: mock.url,
      gatewayToken: "test-token",
    };

    const result = await forwardToOpenClaw(config, { model: "test", input: "hello" });
    expect(result).toEqual(responseBody);
  });

  it("rejects with descriptive error on 500 response", async () => {
    const errorBody = { error: { code: "internal_error", message: "Something broke" } };
    const mock = await createMockServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify(errorBody));
    });
    server = mock.server;

    const config: OpenClawClientConfig = {
      gatewayUrl: mock.url,
      gatewayToken: "test-token",
    };

    await expect(forwardToOpenClaw(config, { model: "test", input: "hello" })).rejects.toThrow(
      /OpenClaw Gateway error \(status 500\)/,
    );
  });

  it("rejects with parse error on invalid JSON response", async () => {
    const mock = await createMockServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>not json</html>");
    });
    server = mock.server;

    const config: OpenClawClientConfig = {
      gatewayUrl: mock.url,
      gatewayToken: "test-token",
    };

    await expect(forwardToOpenClaw(config, { model: "test", input: "hello" })).rejects.toThrow(
      /OpenClaw Gateway returned invalid JSON/,
    );
  });

  it("rejects with timeout error when server does not respond", async () => {
    const mock = await createMockServer((_req, _res) => {
      // Intentionally never respond
    });
    server = mock.server;

    const config: OpenClawClientConfig = {
      gatewayUrl: mock.url,
      gatewayToken: "test-token",
      timeoutMs: 100,
    };

    await expect(forwardToOpenClaw(config, { model: "test", input: "hello" })).rejects.toThrow(
      /timed out/i,
    );
  });

  it("rejects with ECONNREFUSED on non-listening port", async () => {
    const config: OpenClawClientConfig = {
      gatewayUrl: "http://127.0.0.1:59999",
      gatewayToken: "test-token",
      timeoutMs: 2000,
    };

    await expect(forwardToOpenClaw(config, { model: "test", input: "hello" })).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it("sends correct headers and path", async () => {
    let capturedHeaders: http.IncomingHttpHeaders = {};
    let capturedUrl = "";
    const mock = await createMockServer((req, res) => {
      capturedHeaders = req.headers;
      capturedUrl = req.url ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    server = mock.server;

    const config: OpenClawClientConfig = {
      gatewayUrl: mock.url,
      gatewayToken: "my-secret-token",
    };

    await forwardToOpenClaw(config, { model: "test" });

    expect(capturedUrl).toBe("/v1/responses");
    expect(capturedHeaders["content-type"]).toBe("application/json; charset=utf-8");
    expect(capturedHeaders["authorization"]).toBe("Bearer my-secret-token");
    expect(capturedHeaders["content-length"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// convertToolsToClientTools tests
// ---------------------------------------------------------------------------

describe("convertToolsToClientTools", () => {
  it("converts valid tools to ClientToolDefinition[]", () => {
    const tools = [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather data",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      },
    ];

    const result = convertToolsToClientTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather data",
        parameters: { type: "object", properties: { city: { type: "string" } } },
      },
    });
  });

  it("strips extra fields not in ClientToolDefinition shape", () => {
    const tools = [
      {
        type: "function",
        function: {
          name: "foo",
          description: "bar",
          parameters: {},
          execute: "malicious",
        },
        extra: true,
      },
    ];

    const result = convertToolsToClientTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "function",
      function: {
        name: "foo",
        description: "bar",
        parameters: {},
      },
    });

    // Verify extra fields are NOT present
    const output = result[0] as unknown as Record<string, unknown>;
    expect(output).not.toHaveProperty("extra");
    const fn = output.function as Record<string, unknown>;
    expect(fn).not.toHaveProperty("execute");
  });

  it("skips invalid tools (wrong type or missing function.name)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const tools = [
      { type: "other" },
      { type: "function", function: {} }, // missing name
      { type: "function", function: { name: "valid_tool" } },
    ];

    const result = convertToolsToClientTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe("valid_tool");
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  it("returns empty array for empty input", () => {
    const result = convertToolsToClientTools([]);
    expect(result).toEqual([]);
  });

  it("handles tools with only name (no description, no parameters)", () => {
    const tools = [{ type: "function", function: { name: "simple_tool" } }];

    const result = convertToolsToClientTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "function",
      function: { name: "simple_tool" },
    });
    // Verify no undefined description or parameters
    expect(result[0].function).not.toHaveProperty("description");
    expect(result[0].function).not.toHaveProperty("parameters");
  });

  it("skips non-object entries", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const tools = ["not an object", 42, null, { type: "function", function: { name: "ok" } }];

    const result = convertToolsToClientTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe("ok");

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// handleIncomingRequest tests
// ---------------------------------------------------------------------------

describe("handleIncomingRequest", () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
    }
  });

  it("sends response message on successful OpenClaw call", async () => {
    const responseBody = { id: "resp-1", object: "response", status: "completed" };
    const mock = await createMockServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(responseBody));
    });
    server = mock.server;

    const messages: unknown[] = [];
    const sendMessage = (msg: unknown) => messages.push(msg);

    await handleIncomingRequest(
      "req-123",
      { model: "test", input: "hello" },
      { gatewayUrl: mock.url, gatewayToken: "tok" },
      sendMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: "response",
      id: "req-123",
      body: responseBody,
    });
  });

  it("sends error message when OpenClaw call fails", async () => {
    const mock = await createMockServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "fail" }));
    });
    server = mock.server;

    const messages: unknown[] = [];
    const sendMessage = (msg: unknown) => messages.push(msg);

    await handleIncomingRequest(
      "req-456",
      { model: "test", input: "hello" },
      { gatewayUrl: mock.url, gatewayToken: "tok" },
      sendMessage,
    );

    expect(messages).toHaveLength(1);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.type).toBe("error");
    expect(msg.id).toBe("req-456");
    expect(msg.code).toBe("plugin_error");
    expect(typeof msg.message).toBe("string");
  });

  it("enforces stream: false even if original body has stream: true", async () => {
    let capturedBody: Record<string, unknown> = {};
    const mock = await createMockServer(async (req, res) => {
      const raw = await collectBody(req);
      capturedBody = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    server = mock.server;

    const messages: unknown[] = [];
    const sendMessage = (msg: unknown) => messages.push(msg);

    await handleIncomingRequest(
      "req-stream",
      { model: "test", input: "hello", stream: true },
      { gatewayUrl: mock.url, gatewayToken: "tok" },
      sendMessage,
    );

    expect(capturedBody.stream).toBe(false);
  });

  it("converts tools to clientTools format before forwarding (strips extra fields)", async () => {
    let capturedBody: Record<string, unknown> = {};
    const mock = await createMockServer(async (req, res) => {
      const raw = await collectBody(req);
      capturedBody = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    server = mock.server;

    const messages: unknown[] = [];
    const sendMessage = (msg: unknown) => messages.push(msg);

    const bodyWithUnsanitizedTools = {
      model: "test",
      input: "hello",
      tools: [
        {
          type: "function",
          function: {
            name: "test_tool",
            description: "A test tool",
            parameters: { type: "object" },
            execute: "bad_payload",
          },
          extra: true,
        },
      ],
    };

    await handleIncomingRequest(
      "req-tools",
      bodyWithUnsanitizedTools,
      { gatewayUrl: mock.url, gatewayToken: "tok" },
      sendMessage,
    );

    // Verify the forwarded body has sanitized tools
    const forwardedTools = capturedBody.tools as Array<Record<string, unknown>>;
    expect(forwardedTools).toHaveLength(1);

    const tool = forwardedTools[0];
    expect(tool.type).toBe("function");
    expect(tool).not.toHaveProperty("extra");

    const fn = tool.function as Record<string, unknown>;
    expect(fn.name).toBe("test_tool");
    expect(fn.description).toBe("A test tool");
    expect(fn.parameters).toEqual({ type: "object" });
    expect(fn).not.toHaveProperty("execute");
  });
});
