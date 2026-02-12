import WebSocket from "ws";
import { ServerMessageSchema, SWITCHBOARD_PROTOCOL_VERSION } from "../schemas/protocol.js";
import type { OpenClawClientConfig } from "../relay/openclaw-client.js";
import { handleIncomingRequest } from "../relay/request-forwarder.js";
import { rawDataToString } from "./raw-data.js";
import { computeBackoff, DEFAULT_RECONNECT_POLICY, type BackoffPolicy } from "./reconnect.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionStatus = "connecting" | "authenticating" | "connected" | "reconnecting" | "disconnected";

export interface PluginClientConfig {
  serverUrl: string; // ws://host:port
  apiKey: string; // sb_plugin_... key
  onStatusChange: (status: ConnectionStatus, pluginId: string | null, requestCount: number) => void;
  reconnectPolicy?: BackoffPolicy; // defaults to DEFAULT_RECONNECT_POLICY
  openClawConfig: OpenClawClientConfig; // OpenClaw Gateway connection settings
}

// ---------------------------------------------------------------------------
// PluginClient
// ---------------------------------------------------------------------------

export class PluginClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "disconnected";
  private reconnectAttempt = 0;
  private closed = true; // true = intentional shutdown, no reconnect
  private requestCount = 0;
  private pluginId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly policy: BackoffPolicy;

  constructor(private readonly config: PluginClientConfig) {
    this.policy = config.reconnectPolicy ?? DEFAULT_RECONNECT_POLICY;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "plugin stopping");
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getPluginId(): string | null {
    return this.pluginId;
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private connect(): void {
    if (this.closed) return;

    this.setStatus("connecting");
    const ws = new WebSocket(this.config.serverUrl);
    this.ws = ws;

    ws.on("open", () => {
      this.setStatus("authenticating");
      this.sendMessage({
        type: "auth",
        apiKey: this.config.apiKey,
        protocol: SWITCHBOARD_PROTOCOL_VERSION,
      });
    });

    ws.on("message", (data) => {
      this.handleMessage(rawDataToString(data));
    });

    ws.on("close", (code, _reason) => {
      this.ws = null;
      if (code === 1012) {
        // Server restart — reconnect quickly with reset backoff
        this.reconnectAttempt = 0;
      }
      this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error(`Connection error: ${err.message}`);
      // error is always followed by close, so no reconnect here
    });
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Silently ignore parse failures
      return;
    }

    const result = ServerMessageSchema.safeParse(parsed);
    if (!result.success) {
      // Silently ignore validation failures
      return;
    }

    const msg = result.data;
    switch (msg.type) {
      case "auth_ok":
        this.pluginId = msg.pluginId;
        this.reconnectAttempt = 0;
        this.setStatus("connected");
        break;

      case "auth_error":
        this.closed = true; // Do NOT reconnect — key is wrong
        if (this.ws) {
          this.ws.close(1000, "auth failed");
          this.ws = null;
        }
        this.setStatus("disconnected");
        console.error(`Authentication failed: ${msg.message}`);
        break;

      case "ping":
        this.sendMessage({ type: "pong", ts: msg.ts });
        break;

      case "request": {
        // Forward to OpenClaw asynchronously -- do not await in message handler
        handleIncomingRequest(
          msg.id,
          msg.body,
          this.config.openClawConfig,
          (response) => this.sendMessage(response),
        ).then(() => {
          this.requestCount++;
          this.config.onStatusChange("connected", this.pluginId, this.requestCount);
        }).catch((err) => {
          // handleIncomingRequest already sends error via sendMessage,
          // but log unexpected errors
          console.error(`[Request ${msg.id}] Unexpected error:`, err);
        });
        break;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) {
      this.setStatus("disconnected");
      return;
    }

    this.setStatus("reconnecting");
    this.reconnectAttempt++;
    const delayMs = computeBackoff(this.policy, this.reconnectAttempt);
    this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
    console.log(`Reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempt})`);
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.config.onStatusChange(status, this.pluginId, this.requestCount);
  }

  private sendMessage(msg: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error(`Failed to send message: ${(err as Error).message}`);
    }
  }
}
