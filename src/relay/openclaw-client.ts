import * as http from "node:http";
import * as https from "node:https";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenClawClientConfig {
  gatewayUrl: string; // e.g. "http://localhost:18789"
  gatewayToken: string; // OPENCLAW_GATEWAY_TOKEN
  agentId?: string; // OpenClaw agent ID for session key routing (default "sixerr-default")
  timeoutMs?: number; // default 120_000
}

// ---------------------------------------------------------------------------
// forwardToOpenClaw
// ---------------------------------------------------------------------------

/**
 * Forward a request body to the local OpenClaw Gateway via HTTP POST.
 *
 * Uses node:http/node:https for explicit control (project convention).
 * Sets Authorization header, Content-Type, and timeout.
 * Returns the parsed JSON response body on success.
 * Rejects with descriptive error on 4xx/5xx, parse failure, or timeout.
 */
export function forwardToOpenClaw(
  config: OpenClawClientConfig,
  requestBody: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL("/v1/responses", config.gatewayUrl);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;

    const bodyStr = JSON.stringify(requestBody);
    const bodyBytes = Buffer.byteLength(bodyStr, "utf-8");
    const timeoutMs = config.timeoutMs ?? 120_000;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: "POST",
      timeout: timeoutMs,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": bodyBytes,
        Authorization: `Bearer ${config.gatewayToken}`,
        "X-OpenClaw-Session-Key": `agent:${config.agentId ?? "sixerr-default"}:subagent:${crypto.randomUUID()}`,
      },
    };

    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          reject(
            new Error(
              `OpenClaw Gateway returned invalid JSON (status ${res.statusCode}): ${raw.slice(0, 200)}`,
            ),
          );
          return;
        }

        if (res.statusCode !== undefined && res.statusCode >= 400) {
          reject(
            new Error(
              `OpenClaw Gateway error (status ${res.statusCode}): ${JSON.stringify(parsed)}`,
            ),
          );
          return;
        }

        resolve(parsed);
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("OpenClaw Gateway request timed out"));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// StreamCallbacks + streamFromOpenClaw (Phase 4 Streaming)
// ---------------------------------------------------------------------------

export interface StreamCallbacks {
  onEvent: (event: unknown) => void;
  onError: (err: Error) => void;
  onDone: () => void;
}

/**
 * Stream a request to the local OpenClaw Gateway via HTTP POST with SSE.
 *
 * Same HTTP endpoint as `forwardToOpenClaw` but adds `Accept: text/event-stream`
 * and parses the SSE response stream, invoking callbacks for each event.
 *
 * Always resolves (never rejects) -- errors are reported through `callbacks.onError`.
 * This ensures the caller (request-forwarder) can always send error WS messages.
 */
export function streamFromOpenClaw(
  config: OpenClawClientConfig,
  requestBody: unknown,
  callbacks: StreamCallbacks,
): Promise<void> {
  return new Promise((resolve) => {
    const url = new URL("/v1/responses", config.gatewayUrl);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;

    const bodyStr = JSON.stringify(requestBody);
    const bodyBytes = Buffer.byteLength(bodyStr, "utf-8");
    const timeoutMs = config.timeoutMs ?? 120_000;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: "POST",
      timeout: timeoutMs,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": bodyBytes,
        Authorization: `Bearer ${config.gatewayToken}`,
        Accept: "text/event-stream",
        "X-OpenClaw-Session-Key": `agent:${config.agentId ?? "sixerr-default"}:subagent:${crypto.randomUUID()}`,
      },
    };

    const req = transport.request(options, (res) => {
      // On HTTP error response: collect body, call onError, resolve
      if (res.statusCode !== undefined && res.statusCode >= 400) {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          callbacks.onError(
            new Error(
              `OpenClaw Gateway error (status ${res.statusCode}): ${body.slice(0, 500)}`,
            ),
          );
          resolve();
        });
        return;
      }

      // Parse SSE from the IncomingMessage readable stream
      const decoder = new TextDecoder("utf-8", { fatal: false });
      let buffer = "";

      res.on("data", (chunk: Buffer) => {
        buffer += decoder.decode(chunk, { stream: true });

        // Split on double newline to find complete SSE events
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? ""; // Keep the last incomplete part

        for (const part of parts) {
          if (!part.trim()) continue;

          // Detect [DONE] sentinel -- skip it (do NOT JSON.parse)
          if (part.trim() === "data: [DONE]") {
            continue;
          }

          // Parse event: and data: fields from lines
          let dataStr = "";
          for (const line of part.split("\n")) {
            if (line.startsWith("event: ")) {
              // eventType consumed but not needed for callback -- caller gets full parsed object
            } else if (line.startsWith("data: ")) {
              dataStr += (dataStr ? "\n" : "") + line.slice(6);
            }
          }

          if (dataStr) {
            try {
              const parsed = JSON.parse(dataStr);
              callbacks.onEvent(parsed);
            } catch {
              console.warn(
                `[OpenClaw SSE] Failed to parse event data: ${dataStr.slice(0, 100)}`,
              );
            }
          }
        }
      });

      res.on("end", () => {
        callbacks.onDone();
        resolve();
      });

      res.on("error", (err) => {
        callbacks.onError(err);
        resolve();
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("OpenClaw Gateway streaming request timed out"));
    });

    req.on("error", (err) => {
      callbacks.onError(err);
      resolve();
    });

    req.write(bodyStr);
    req.end();
  });
}
