import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import * as http from "node:http";
import { forwardToOpenClaw, streamFromOpenClaw, type OpenClawClientConfig, type StreamCallbacks } from "./openclaw-client.js";
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

  it("enforces stream: false on non-streaming path", async () => {
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

    // When stream is not true, the non-streaming path sets stream: false
    await handleIncomingRequest(
      "req-stream",
      { model: "test", input: "hello" },
      { gatewayUrl: mock.url, gatewayToken: "tok" },
      sendMessage,
    );

    expect(capturedBody.stream).toBe(false);
  });

  it("passes tools through as-is to OpenClaw (gateway handles security via agent config)", async () => {
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

    const bodyWithTools = {
      model: "test",
      input: "hello",
      tools: [
        {
          type: "function",
          function: {
            name: "test_tool",
            description: "A test tool",
            parameters: { type: "object" },
          },
        },
      ],
    };

    await handleIncomingRequest(
      "req-tools",
      bodyWithTools,
      { gatewayUrl: mock.url, gatewayToken: "tok" },
      sendMessage,
    );

    const forwardedTools = capturedBody.tools as Array<Record<string, unknown>>;
    expect(forwardedTools).toHaveLength(1);

    const tool = forwardedTools[0];
    expect(tool.type).toBe("function");

    const fn = tool.function as Record<string, unknown>;
    expect(fn.name).toBe("test_tool");
    expect(fn.description).toBe("A test tool");
    expect(fn.parameters).toEqual({ type: "object" });
  });
});

// ---------------------------------------------------------------------------
// streamFromOpenClaw tests
// ---------------------------------------------------------------------------

describe("streamFromOpenClaw", () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
    }
  });

  it("calls onEvent for each SSE event and onDone at end", async () => {
    const sseEvents = [
      { type: "response.created", response: { id: "resp-1", status: "in_progress" } },
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.output_text.delta", delta: " world" },
      { type: "response.completed", response: { id: "resp-1", status: "completed", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } },
    ];

    const mock = await createMockServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const evt of sseEvents) {
        res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
    server = mock.server;

    const config: OpenClawClientConfig = { gatewayUrl: mock.url, gatewayToken: "tok" };
    const events: unknown[] = [];
    let doneCalled = false;
    let errorCalled = false;

    await streamFromOpenClaw(config, { model: "test", stream: true }, {
      onEvent: (event) => events.push(event),
      onError: () => { errorCalled = true; },
      onDone: () => { doneCalled = true; },
    });

    expect(events).toHaveLength(4);
    expect(events[0]).toEqual(sseEvents[0]);
    expect(events[1]).toEqual(sseEvents[1]);
    expect(events[2]).toEqual(sseEvents[2]);
    expect(events[3]).toEqual(sseEvents[3]);
    expect(doneCalled).toBe(true);
    expect(errorCalled).toBe(false);
  });

  it("calls onError on HTTP error response", async () => {
    const mock = await createMockServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "internal_error", message: "Boom" } }));
    });
    server = mock.server;

    const config: OpenClawClientConfig = { gatewayUrl: mock.url, gatewayToken: "tok" };
    const events: unknown[] = [];
    let errorMsg = "";

    await streamFromOpenClaw(config, { model: "test", stream: true }, {
      onEvent: (event) => events.push(event),
      onError: (err) => { errorMsg = err.message; },
      onDone: () => {},
    });

    expect(events).toHaveLength(0);
    expect(errorMsg).toMatch(/status 500/);
  });

  it("handles chunked SSE (event split across chunks)", async () => {
    const fullEvent = { type: "response.output_text.delta", delta: "chunked data" };
    const sseStr = `event: ${fullEvent.type}\ndata: ${JSON.stringify(fullEvent)}\n\n`;

    // Split the SSE string roughly in the middle
    const splitPoint = Math.floor(sseStr.length / 2);
    const chunk1 = sseStr.slice(0, splitPoint);
    const chunk2 = sseStr.slice(splitPoint);

    const mock = await createMockServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      // Write the event in two separate chunks
      res.write(chunk1);
      // Small delay to ensure separate chunks
      setTimeout(() => {
        res.write(chunk2);
        res.end();
      }, 20);
    });
    server = mock.server;

    const config: OpenClawClientConfig = { gatewayUrl: mock.url, gatewayToken: "tok" };
    const events: unknown[] = [];
    let doneCalled = false;

    await streamFromOpenClaw(config, { model: "test", stream: true }, {
      onEvent: (event) => events.push(event),
      onError: () => {},
      onDone: () => { doneCalled = true; },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(fullEvent);
    expect(doneCalled).toBe(true);
  });

  it("skips [DONE] sentinel without calling onEvent", async () => {
    const sseEvent = { type: "response.created", response: { id: "resp-1" } };

    const mock = await createMockServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`event: ${sseEvent.type}\ndata: ${JSON.stringify(sseEvent)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
    server = mock.server;

    const config: OpenClawClientConfig = { gatewayUrl: mock.url, gatewayToken: "tok" };
    const events: unknown[] = [];

    await streamFromOpenClaw(config, { model: "test", stream: true }, {
      onEvent: (event) => events.push(event),
      onError: () => {},
      onDone: () => {},
    });

    // Only the actual event, not the [DONE] sentinel
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(sseEvent);
  });

  it("sends Accept: text/event-stream header", async () => {
    let capturedHeaders: http.IncomingHttpHeaders = {};
    const mock = await createMockServer((req, res) => {
      capturedHeaders = req.headers;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end();
    });
    server = mock.server;

    const config: OpenClawClientConfig = { gatewayUrl: mock.url, gatewayToken: "tok" };

    await streamFromOpenClaw(config, { model: "test", stream: true }, {
      onEvent: () => {},
      onError: () => {},
      onDone: () => {},
    });

    expect(capturedHeaders["accept"]).toBe("text/event-stream");
  });
});

// ---------------------------------------------------------------------------
// handleIncomingRequest - streaming tests
// ---------------------------------------------------------------------------

describe("handleIncomingRequest - streaming", () => {
  let server: http.Server;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
    }
  });

  it("streaming request: sends stream_event messages then stream_end", async () => {
    const sseEvents = [
      { type: "response.created", response: { id: "resp-1", status: "in_progress" } },
      { type: "response.output_text.delta", delta: "Hi" },
      { type: "response.completed", response: { id: "resp-1", status: "completed", usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } },
    ];

    const mock = await createMockServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const evt of sseEvents) {
        res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
    server = mock.server;

    const messages: unknown[] = [];
    const sendMessage = (msg: unknown) => messages.push(msg);

    await handleIncomingRequest(
      "req-stream-1",
      { model: "test", input: "hello", stream: true },
      { gatewayUrl: mock.url, gatewayToken: "tok" },
      sendMessage,
    );

    // Should have 3 stream_event messages + 1 stream_end
    expect(messages).toHaveLength(4);

    // First 3 are stream_event
    for (let i = 0; i < 3; i++) {
      const msg = messages[i] as Record<string, unknown>;
      expect(msg.type).toBe("stream_event");
      expect(msg.id).toBe("req-stream-1");
      expect(msg.event).toEqual(sseEvents[i]);
    }

    // Last is stream_end with usage extracted from response.completed
    const endMsg = messages[3] as Record<string, unknown>;
    expect(endMsg.type).toBe("stream_end");
    expect(endMsg.id).toBe("req-stream-1");
    expect(endMsg.usage).toEqual({ input_tokens: 10, output_tokens: 3, total_tokens: 13 });
  });

  it("streaming request preserves stream: true in forwarded body", async () => {
    let capturedBody: Record<string, unknown> = {};
    const mock = await createMockServer(async (req, res) => {
      const raw = await collectBody(req);
      capturedBody = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end();
    });
    server = mock.server;

    const messages: unknown[] = [];
    const sendMessage = (msg: unknown) => messages.push(msg);

    await handleIncomingRequest(
      "req-stream-2",
      { model: "test", input: "hello", stream: true },
      { gatewayUrl: mock.url, gatewayToken: "tok" },
      sendMessage,
    );

    expect(capturedBody.stream).toBe(true);
  });

  it("streaming request passes tools through as-is", async () => {
    let capturedBody: Record<string, unknown> = {};
    const mock = await createMockServer(async (req, res) => {
      const raw = await collectBody(req);
      capturedBody = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end();
    });
    server = mock.server;

    const messages: unknown[] = [];
    const sendMessage = (msg: unknown) => messages.push(msg);

    const bodyWithTools = {
      model: "test",
      input: "hello",
      stream: true,
      tools: [
        {
          type: "function",
          function: {
            name: "test_tool",
            description: "A test tool",
            parameters: { type: "object" },
          },
        },
      ],
    };

    await handleIncomingRequest(
      "req-stream-tools",
      bodyWithTools,
      { gatewayUrl: mock.url, gatewayToken: "tok" },
      sendMessage,
    );

    const forwardedTools = capturedBody.tools as Array<Record<string, unknown>>;
    expect(forwardedTools).toHaveLength(1);

    const tool = forwardedTools[0];
    expect(tool.type).toBe("function");

    const fn = tool.function as Record<string, unknown>;
    expect(fn.name).toBe("test_tool");
    expect(fn.description).toBe("A test tool");
  });

  it("streaming request sends error message on OpenClaw failure", async () => {
    const mock = await createMockServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "fail" }));
    });
    server = mock.server;

    const messages: unknown[] = [];
    const sendMessage = (msg: unknown) => messages.push(msg);

    await handleIncomingRequest(
      "req-stream-err",
      { model: "test", input: "hello", stream: true },
      { gatewayUrl: mock.url, gatewayToken: "tok" },
      sendMessage,
    );

    // Should have error message + stream_end message
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const errorMsg = messages.find((m) => (m as Record<string, unknown>).type === "error") as Record<string, unknown>;
    expect(errorMsg).toBeDefined();
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.id).toBe("req-stream-err");
    expect(errorMsg.code).toBe("plugin_error");
    expect(typeof errorMsg.message).toBe("string");
  });
});
