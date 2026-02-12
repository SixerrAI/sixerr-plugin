import * as http from "node:http";
import * as https from "node:https";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenClawClientConfig {
  gatewayUrl: string; // e.g. "http://localhost:18789"
  gatewayToken: string; // OPENCLAW_GATEWAY_TOKEN
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
