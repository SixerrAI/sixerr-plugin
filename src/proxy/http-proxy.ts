import * as http from "node:http";
import { Readable } from "node:stream";
import type { SixerrClient } from "../client/consumer/sixerr-client.js";

// ---------------------------------------------------------------------------
// Local HTTP Proxy
// ---------------------------------------------------------------------------

/**
 * Create a local HTTP proxy that handles x402 Permit2 signing transparently.
 *
 * OpenClaw (or any HTTP client) can POST OpenResponses requests to
 * `http://127.0.0.1:{port}/v1/responses` — the proxy forwards them to the
 * Sixerr server with payment signatures injected automatically.
 *
 * Binds to 127.0.0.1 only — no network exposure.
 */
export function createHttpProxy(config: {
  port: number;
  client: SixerrClient;
}): Promise<http.Server> {
  const { port, client } = config;

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(client, req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: "Internal proxy error" }));
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(
  client: SixerrClient,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // GET /v1/providers
  if (method === "GET" && url === "/v1/providers") {
    try {
      const providers = await client.listProviders();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(providers));
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  // POST /v1/responses or /v1/responses/:agentId
  const responsesMatch = method === "POST" && url.match(/^\/v1\/responses(?:\/([^/?]+))?$/);
  if (responsesMatch) {
    const agentId = responsesMatch[1]; // undefined if no segment
    await handleResponses(client, req, res, agentId);
    return;
  }

  // 404 for everything else
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
}

// ---------------------------------------------------------------------------
// POST /v1/responses handler
// ---------------------------------------------------------------------------

async function handleResponses(
  client: SixerrClient,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  agentId: string | undefined,
): Promise<void> {
  // Read request body
  let rawBody: Record<string, unknown>;
  try {
    const bodyText = await readBody(req);
    rawBody = JSON.parse(bodyText);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  // Forward to Sixerr via the client (handles x402 automatically)
  let upstream: Response;
  try {
    upstream = await client.respondRaw(rawBody, agentId);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: (err as Error).message }));
    return;
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json";

  // Streaming (SSE) — pipe response body through
  if (contentType.includes("text/event-stream") && upstream.body) {
    res.writeHead(upstream.status, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const nodeStream = Readable.fromWeb(upstream.body as any);
    nodeStream.pipe(res);
    return;
  }

  // Non-streaming — forward body and status
  const body = await upstream.text();
  res.writeHead(upstream.status, { "Content-Type": contentType });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
