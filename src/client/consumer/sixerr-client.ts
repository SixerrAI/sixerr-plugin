import { signPermit2Payment } from "./permit2.js";
import type {
  SixerrClientConfig,
  RespondOptions,
  PaymentRequiredResponse,
  Permit2PaymentRequirements,
} from "./types.js";

// ---------------------------------------------------------------------------
// SixerrClient
// ---------------------------------------------------------------------------

/**
 * HTTP client for the Sixerr inference marketplace.
 *
 * Handles the x402 payment flow automatically:
 *   1. Sends request to server
 *   2. If 402, signs a Permit2 payment with the configured wallet
 *   3. Retries with X-PAYMENT header
 *
 * Usage:
 * ```ts
 * import { SixerrClient, createLocalPaymentSigner } from "sixerr-plugin/client";
 *
 * const client = new SixerrClient({
 *   signer: createLocalPaymentSigner("0x...privateKey"),
 * });
 *
 * const response = await client.respond({
 *   messages: [{ role: "user", content: "Hello, world!" }],
 * });
 * ```
 */
export class SixerrClient {
  private readonly serverUrl: string;
  private readonly config: SixerrClientConfig;

  constructor(config: SixerrClientConfig) {
    this.config = config;
    this.serverUrl = (config.serverUrl ?? "https://sixerr.ai").replace(/\/$/, "");
  }

  /**
   * Send an inference request, automatically handling x402 payment.
   * Returns the raw Response so callers can handle streaming or JSON as needed.
   */
  async respond(options: RespondOptions): Promise<Response> {
    const url = options.agentId
      ? `${this.serverUrl}/v1/chat/completions/${options.agentId}`
      : `${this.serverUrl}/v1/chat/completions`;

    const body: Record<string, unknown> = {
      model: options.model ?? "default",
      messages: options.messages,
    };
    if (options.stream) body.stream = true;
    if (options.routing) body.routing = options.routing;
    if (options.max_tokens) body.max_tokens = options.max_tokens;

    return this.postWith402Handling(url, JSON.stringify(body), options.maxAmount);
  }

  /**
   * Forward a full request body to the Sixerr server, handling x402 payment.
   * Unlike `respond()`, this passes the body through untouched — useful for
   * proxying Chat Completions requests that include fields like `tools`,
   * `max_tokens`, etc.
   */
  async respondRaw(
    rawBody: Record<string, unknown>,
    agentId?: string,
  ): Promise<Response> {
    const url = agentId
      ? `${this.serverUrl}/v1/chat/completions/${agentId}`
      : `${this.serverUrl}/v1/chat/completions`;

    return this.postWith402Handling(url, JSON.stringify(rawBody));
  }

  /**
   * POST to `url` with the given body string. If the server returns 402,
   * sign a Permit2 payment and retry once.
   */
  private async postWith402Handling(
    url: string,
    body: string,
    maxAmountOverride?: string,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // First attempt — without payment
    const firstRes = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    if (firstRes.status !== 402) {
      return firstRes;
    }

    // 402 — extract payment requirements and sign
    const paymentBody = (await firstRes.json()) as PaymentRequiredResponse;
    const requirements = paymentBody.accepts?.find(
      (a): a is Permit2PaymentRequirements => a.scheme === "permit2",
    );
    if (!requirements) {
      throw new Error("Server returned 402 but no Permit2 payment scheme found");
    }

    const maxAmount = maxAmountOverride ?? this.config.maxAmount ?? requirements.maxCost;
    const xPayment = await signPermit2Payment(
      this.config.signer,
      requirements,
      maxAmount,
    );

    // Retry with payment
    return fetch(url, {
      method: "POST",
      headers: {
        ...headers,
        "X-PAYMENT": xPayment,
      },
      body,
    });
  }

  /**
   * Send a request and return the parsed JSON response body.
   * For non-streaming requests only.
   */
  async respondJson(options: RespondOptions): Promise<unknown> {
    const res = await this.respond({ ...options, stream: false });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Sixerr request failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  /**
   * List available suppliers from the server catalog.
   */
  async listSuppliers(): Promise<unknown> {
    const res = await fetch(`${this.serverUrl}/v1/suppliers`);
    if (!res.ok) {
      throw new Error(`Failed to fetch suppliers (${res.status})`);
    }
    return res.json();
  }
}
