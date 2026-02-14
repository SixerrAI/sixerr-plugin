import type { ConnectionStatus } from "./ws-client.js";

// ---------------------------------------------------------------------------
// StatusDisplay
// ---------------------------------------------------------------------------

export interface StatusDisplay {
  update(status: ConnectionStatus, pluginId: string | null, requestCount: number): void;
  log(message: string): void;
}

export function createStatusDisplay(): StatusDisplay {
  return {
    update(status, pluginId, requestCount) {
      const statusText = formatStatus(status, pluginId, requestCount);
      // Write on new line (not overwriting) for cleaner log output
      console.log(`[sixerr-plugin] ${statusText}`);
    },
    log(message) {
      console.log(`[sixerr-plugin] ${message}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Format helpers (exported for testability)
// ---------------------------------------------------------------------------

export function formatStatus(status: ConnectionStatus, pluginId: string | null, requestCount: number): string {
  switch (status) {
    case "connecting":
      return "Connecting to server...";
    case "authenticating":
      return "Authenticating...";
    case "connected":
      return `Connected (id: ${pluginId ?? "?"}) | Requests served: ${requestCount}`;
    case "reconnecting":
      return "Connection lost. Reconnecting...";
    case "disconnected":
      return "Disconnected";
  }
}
