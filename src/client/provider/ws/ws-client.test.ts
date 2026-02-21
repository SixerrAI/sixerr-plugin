import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";
import { PluginClient, type ConnectionStatus, type PluginClientConfig } from "./ws-client.js";
import { SIXERR_PROTOCOL_VERSION } from "../schemas/protocol.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a minimal WS server on a random port. */
function createTestServer(): Promise<{ wss: WebSocketServer; port: number; url: string }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const addr = wss.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ wss, port, url: `ws://127.0.0.1:${port}` });
    });
  });
}

/** Wait until the server receives a client connection. */
function waitForConnection(wss: WebSocketServer): Promise<WsWebSocket> {
  return new Promise((resolve) => {
    wss.once("connection", (ws) => resolve(ws));
  });
}

/** Wait until a specific status is emitted. */
function waitForStatus(
  statusChanges: Array<{ status: ConnectionStatus; pluginId: string | null; requestCount: number }>,
  target: ConnectionStatus,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (statusChanges.some((s) => s.status === target)) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for status "${target}". Got: ${statusChanges.map((s) => s.status).join(", ")}`));
        return;
      }
      setTimeout(check, 20);
    };
    const start = Date.now();
    check();
  });
}

/** Wait for a message from the client on the server side. */
function waitForMessage(ws: WsWebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

/** Small helper to wait a number of ms. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PluginClient", () => {
  let wss: WebSocketServer;
  let port: number;
  let url: string;
  let client: PluginClient;
  let statusChanges: Array<{ status: ConnectionStatus; pluginId: string | null; requestCount: number }>;

  beforeEach(async () => {
    const server = await createTestServer();
    wss = server.wss;
    port = server.port;
    url = server.url;
    statusChanges = [];
  });

  afterEach(async () => {
    if (client) {
      client.stop();
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  function createClient(overrides?: Partial<PluginClientConfig>): PluginClient {
    client = new PluginClient({
      serverUrl: url,
      jwt: "eyJhbGciOiJFUzI1NiJ9.test-token",
      onStatusChange: (status, pluginId, requestCount) => {
        statusChanges.push({ status, pluginId, requestCount });
      },
      // Fast reconnect for tests
      reconnectPolicy: {
        initialMs: 50,
        maxMs: 200,
        factor: 2,
        jitter: 0,
      },
      inferenceConfig: {
        agentDir: "/tmp/test-agent",
        provider: "anthropic",
        model: "claude-opus-4-6",
        authStorage: {} as any,
        modelRegistry: {} as any,
        resolvedModel: {} as any,
      },
      ...overrides,
    });
    return client;
  }

  it("connects and sends auth message on open", async () => {
    const connPromise = waitForConnection(wss);
    createClient();
    client.start();

    const serverWs = await connPromise;
    const msg = await waitForMessage(serverWs) as { type: string; jwt: string; protocol: number };

    expect(msg.type).toBe("auth");
    expect(msg.jwt).toBe("eyJhbGciOiJFUzI1NiJ9.test-token");
    expect(msg.protocol).toBe(SIXERR_PROTOCOL_VERSION);
  });

  it("transitions: connecting -> authenticating -> connected on auth_ok", async () => {
    const connPromise = waitForConnection(wss);
    createClient();
    client.start();

    const serverWs = await connPromise;
    await waitForMessage(serverWs); // consume auth message

    // Send auth_ok
    serverWs.send(JSON.stringify({
      type: "auth_ok",
      pluginId: "plugin-abc",
      protocol: SIXERR_PROTOCOL_VERSION,
    }));

    await waitForStatus(statusChanges, "connected");

    const statuses = statusChanges.map((s) => s.status);
    expect(statuses).toContain("connecting");
    expect(statuses).toContain("authenticating");
    expect(statuses).toContain("connected");
  });

  it("stores pluginId from auth_ok", async () => {
    const connPromise = waitForConnection(wss);
    createClient();
    client.start();

    const serverWs = await connPromise;
    await waitForMessage(serverWs);

    serverWs.send(JSON.stringify({
      type: "auth_ok",
      pluginId: "plugin-xyz",
      protocol: SIXERR_PROTOCOL_VERSION,
    }));

    await waitForStatus(statusChanges, "connected");
    expect(client.getPluginId()).toBe("plugin-xyz");
  });

  it("responds to ping with matching pong timestamp", async () => {
    const connPromise = waitForConnection(wss);
    createClient();
    client.start();

    const serverWs = await connPromise;
    await waitForMessage(serverWs); // consume auth

    // Authenticate first
    serverWs.send(JSON.stringify({
      type: "auth_ok",
      pluginId: "p-1",
      protocol: SIXERR_PROTOCOL_VERSION,
    }));
    await waitForStatus(statusChanges, "connected");

    // Send ping
    const pingTs = Date.now();
    serverWs.send(JSON.stringify({ type: "ping", ts: pingTs }));

    // Expect pong back with same timestamp
    const pong = await waitForMessage(serverWs) as { type: string; ts: number };
    expect(pong.type).toBe("pong");
    expect(pong.ts).toBe(pingTs);
  });

  it("sets closed=true and does NOT reconnect on auth_error", async () => {
    const connPromise = waitForConnection(wss);
    createClient();
    client.start();

    const serverWs = await connPromise;
    await waitForMessage(serverWs);

    // Suppress expected error log
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    serverWs.send(JSON.stringify({
      type: "auth_error",
      message: "Invalid API key",
    }));

    await waitForStatus(statusChanges, "disconnected");

    // Give the close event handler time to fire (ws.close is async)
    await delay(100);

    expect(client.getStatus()).toBe("disconnected");

    // Wait and verify no reconnection attempt
    await delay(200);
    const statuses = statusChanges.map((s) => s.status);
    // After the last disconnected, there should be no "connecting" or "reconnecting"
    const disconnectedIndex = statuses.lastIndexOf("disconnected");
    const afterDisconnected = statuses.slice(disconnectedIndex + 1);
    expect(afterDisconnected).toEqual([]);

    errorSpy.mockRestore();
  });

  it("reconnects on unexpected close (close code other than 1000)", async () => {
    const connPromise = waitForConnection(wss);
    createClient();
    client.start();

    const serverWs = await connPromise;
    await waitForMessage(serverWs);

    // Suppress reconnect log
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Close unexpectedly (terminate simulates abnormal disconnection)
    serverWs.terminate();

    // Should transition to reconnecting then connecting again
    await waitForStatus(statusChanges, "reconnecting");
    await waitForStatus(statusChanges, "connecting");

    logSpy.mockRestore();
  });

  it("resets reconnectAttempt on close code 1012", async () => {
    const connPromise = waitForConnection(wss);
    createClient();
    client.start();

    const serverWs = await connPromise;
    await waitForMessage(serverWs);

    // Authenticate
    serverWs.send(JSON.stringify({
      type: "auth_ok",
      pluginId: "p-1",
      protocol: SIXERR_PROTOCOL_VERSION,
    }));
    await waitForStatus(statusChanges, "connected");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Server restart close code
    serverWs.close(1012, "service restart");

    // Should reconnect with attempt 1 (reset from 0, then incremented)
    await waitForStatus(statusChanges, "reconnecting");

    // Wait for the second connection
    const connPromise2 = waitForConnection(wss);
    const serverWs2 = await connPromise2;
    const msg = await waitForMessage(serverWs2) as { type: string };
    expect(msg.type).toBe("auth");

    logSpy.mockRestore();
  });

  it("stop() closes connection and does not reconnect", async () => {
    const connPromise = waitForConnection(wss);
    createClient();
    client.start();

    const serverWs = await connPromise;
    await waitForMessage(serverWs);

    // Authenticate
    serverWs.send(JSON.stringify({
      type: "auth_ok",
      pluginId: "p-1",
      protocol: SIXERR_PROTOCOL_VERSION,
    }));
    await waitForStatus(statusChanges, "connected");

    // Stop
    client.stop();
    expect(client.getStatus()).toBe("disconnected");

    // Wait and verify no reconnection
    await delay(200);
    const statuses = statusChanges.map((s) => s.status);
    const disconnectedIndex = statuses.lastIndexOf("disconnected");
    const afterDisconnected = statuses.slice(disconnectedIndex + 1);
    expect(afterDisconnected).toEqual([]);
  });

  it("status changes fire onStatusChange with correct values", async () => {
    const connPromise = waitForConnection(wss);
    createClient();
    client.start();

    const serverWs = await connPromise;
    await waitForMessage(serverWs);

    serverWs.send(JSON.stringify({
      type: "auth_ok",
      pluginId: "p-status",
      protocol: SIXERR_PROTOCOL_VERSION,
    }));

    await waitForStatus(statusChanges, "connected");

    // Verify the connected status change has correct values
    const connectedChange = statusChanges.find((s) => s.status === "connected");
    expect(connectedChange).toBeDefined();
    expect(connectedChange!.pluginId).toBe("p-status");
    expect(connectedChange!.requestCount).toBe(0);
  });
});
