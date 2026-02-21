import WebSocket from "ws";
import { ServerMessageSchema, SIXERR_PROTOCOL_VERSION } from "../schemas/protocol.js";
import type { InferenceConfig } from "../inference/types.js";
import { handleIncomingRequest } from "../inference/inference-handler.js";
import { rawDataToString } from "./raw-data.js";
import { computeBackoff, DEFAULT_RECONNECT_POLICY, type BackoffPolicy } from "./reconnect.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionStatus = "connecting" | "authenticating" | "connected" | "reconnecting" | "disconnected";

export interface PluginClientConfig {
  serverUrl: string; // ws://host:port
  jwt: string; // JWT token for auth
  onStatusChange: (status: ConnectionStatus, pluginId: string | null, requestCount: number) => void;
  onJwtRefresh?: (newJwt: string) => void; // callback when server sends a refresh
  onPriceUpdateAck?: (pricing: { inputTokenPrice: string; outputTokenPrice: string }) => void;
  reconnectPolicy?: BackoffPolicy; // defaults to DEFAULT_RECONNECT_POLICY
  inferenceConfig: InferenceConfig; // Direct LLM inference configuration
  /** Optional per-token pricing declaration (DISC-01). Sent in auth handshake. */
  pricing?: {
    inputTokenPrice: string;  // Atomic USDC per token
    outputTokenPrice: string; // Atomic USDC per token
  };
  /** Optional agent display name from setup (Phase 11). */
  agentName?: string;
  /** Optional agent description from setup (Phase 11). */
  agentDescription?: string;
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

  constructor(private config: PluginClientConfig) {
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

  /**
   * Send a dynamic price update to the server without reconnecting.
   * Server will respond with a price_update_ack.
   */
  updatePricing(inputTokenPrice: string, outputTokenPrice: string): void {
    this.sendMessage({
      type: "price_update",
      inputTokenPrice,
      outputTokenPrice,
    });
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
        jwt: this.config.jwt,
        protocol: SIXERR_PROTOCOL_VERSION,
        // Phase 7: Include pricing if configured (DISC-01)
        ...(this.config.pricing ? {
          inputTokenPrice: this.config.pricing.inputTokenPrice,
          outputTokenPrice: this.config.pricing.outputTokenPrice,
        } : {}),
        // Phase 11: Include agent identity if configured
        ...(this.config.agentName ? { agentName: this.config.agentName } : {}),
        ...(this.config.agentDescription ? { agentDescription: this.config.agentDescription } : {}),
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
        this.closed = true; // Do NOT reconnect — auth is invalid
        if (this.ws) {
          this.ws.close(1000, "auth failed");
          this.ws = null;
        }
        this.setStatus("disconnected");
        console.error(`Authentication failed: ${msg.message}`);
        break;

      case "jwt_refresh":
        // Update the JWT for future reconnections
        this.config = { ...this.config, jwt: msg.jwt };
        this.config.onJwtRefresh?.(msg.jwt);
        break;

      case "price_update_ack":
        // Update local pricing config for future reconnections
        this.config = {
          ...this.config,
          pricing: {
            inputTokenPrice: msg.inputTokenPrice,
            outputTokenPrice: msg.outputTokenPrice,
          },
        };
        this.config.onPriceUpdateAck?.({
          inputTokenPrice: msg.inputTokenPrice,
          outputTokenPrice: msg.outputTokenPrice,
        });
        break;

      case "ping":
        this.sendMessage({ type: "pong", ts: msg.ts });
        break;

      case "request": {
        // Forward to LLM asynchronously -- do not await in message handler
        handleIncomingRequest(
          msg.id,
          msg.body,
          this.config.inferenceConfig,
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
