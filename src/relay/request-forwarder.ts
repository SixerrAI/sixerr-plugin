import { forwardToOpenClaw, streamFromOpenClaw, type OpenClawClientConfig } from "./openclaw-client.js";

// ---------------------------------------------------------------------------
// handleIncomingRequest
// ---------------------------------------------------------------------------

/**
 * Handle an incoming request from the Sixerr server.
 *
 * 1. Clones the body to avoid mutation
 * 2. Converts tools to clientTools format (RELAY-03 defense-in-depth)
 * 3. Branches on stream: true vs stream: false
 *    - Streaming: calls streamFromOpenClaw, forwards events as stream_event WS messages
 *    - Non-streaming: calls forwardToOpenClaw, sends response WS message
 * 4. Sends error WS message on failure
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

    // Handle "default" model sentinel: remove model field so OpenClaw uses
    // the agent's configured default model
    if (forwardBody.model === "default") {
      delete forwardBody.model;
    }

    const isStreaming = forwardBody.stream === true;

    // NOTE: tools are passed through as-is. The sixerr-default agent has
    // tools deny [*] configured in OpenClaw, which prevents execution on
    // the plugin owner's machine. clientTools conversion is handled by
    // the OpenClaw gateway based on agent config.

    if (isStreaming) {
      // Streaming path: consume SSE from OpenClaw, forward events over WS
      let usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

      await streamFromOpenClaw(openClawConfig, forwardBody, {
        onEvent(event: unknown) {
          sendMessage({ type: "stream_event", id: requestId, event });

          // Extract usage from response.completed event
          const evt = event as { type?: string; response?: { usage?: typeof usage } };
          if (evt.type === "response.completed" && evt.response?.usage) {
            usage = evt.response.usage;
          }
        },
        onError(err: Error) {
          sendMessage({
            type: "error",
            id: requestId,
            code: "plugin_error",
            message: err.message,
          });
        },
        onDone() {
          sendMessage({ type: "stream_end", id: requestId, usage });
        },
      });
    } else {
      // Non-streaming path (existing behavior)
      forwardBody.stream = false;

      // Forward to OpenClaw Gateway
      const response = await forwardToOpenClaw(openClawConfig, forwardBody);

      // Send success response back to server
      sendMessage({
        type: "response",
        id: requestId,
        body: response,
      });
    }
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
