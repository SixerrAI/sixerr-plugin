import { forwardToOpenClaw, type OpenClawClientConfig } from "./openclaw-client.js";
import { convertToolsToClientTools } from "./tool-converter.js";

// ---------------------------------------------------------------------------
// handleIncomingRequest
// ---------------------------------------------------------------------------

/**
 * Handle an incoming request from the Switchboard server.
 *
 * 1. Clones the body to avoid mutation
 * 2. Enforces stream: false
 * 3. Converts tools to clientTools format (RELAY-03 defense-in-depth)
 * 4. Forwards to OpenClaw Gateway via HTTP POST
 * 5. Sends response or error back via sendMessage callback
 */
export async function handleIncomingRequest(
  requestId: string,
  body: unknown,
  openClawConfig: OpenClawClientConfig,
  sendMessage: (msg: unknown) => void,
): Promise<void> {
  try {
    // Clone the body to avoid mutating the original
    const forwardBody = { ...(body as Record<string, unknown>) };

    // Enforce stream: false (non-streaming relay)
    forwardBody.stream = false;

    // Convert tools to clientTools format (RELAY-03 defense-in-depth)
    if (Array.isArray(forwardBody.tools)) {
      forwardBody.tools = convertToolsToClientTools(forwardBody.tools);
    }

    // Forward to OpenClaw Gateway
    const response = await forwardToOpenClaw(openClawConfig, forwardBody);

    // Send success response back to server
    sendMessage({
      type: "response",
      id: requestId,
      body: response,
    });
  } catch (err) {
    // Send error back to server
    sendMessage({
      type: "error",
      id: requestId,
      code: "plugin_error",
      message: (err as Error).message || String(err),
    });
  }
}
