import { createServer } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import open from "open";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTH_TIMEOUT_MS = 300_000; // 5 minutes

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><title>Sixerr Auth</title></head>
<body style="font-family:system-ui;text-align:center;padding:3em">
<h1>Authentication successful!</h1>
<p>You can close this window.</p>
</body></html>`;

// ---------------------------------------------------------------------------
// authenticatePlugin
// ---------------------------------------------------------------------------

/**
 * Open the Sixerr auth page in the default browser, start a local
 * callback server, and wait for the JWT to arrive.
 *
 * @param sixerrServerUrl  HTTPS base URL of the Sixerr server
 *                              (e.g. "https://sixerr.ai")
 * @returns the JWT string
 */
export function authenticatePlugin(sixerrServerUrl: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }

      const jwt = url.searchParams.get("jwt");
      if (!jwt) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing jwt parameter");
        return;
      }

      // Success — send response, clean up, resolve
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(SUCCESS_HTML);

      if (!settled) {
        settled = true;
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        server.close();
        resolve(jwt);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        if (!settled) {
          settled = true;
          reject(new Error("Failed to bind local callback server"));
        }
        return;
      }

      const port = addr.port;
      const authUrl = `${sixerrServerUrl}/auth?callback=http://127.0.0.1:${port}/callback`;

      // Open browser — errors are non-fatal (user can navigate manually)
      open(authUrl).catch(() => {
        console.log(`Open this URL in your browser:\n  ${authUrl}`);
      });

      // Timeout — reject if JWT never arrives
      timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close();
          reject(new Error("Authentication timed out"));
        }
      }, AUTH_TIMEOUT_MS);
    });

    server.on("error", (err) => {
      if (!settled) {
        settled = true;
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        reject(err);
      }
    });
  });
}
