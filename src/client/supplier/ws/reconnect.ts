export interface BackoffPolicy {
  initialMs: number;
  maxMs: number;
  factor: number;
  jitter: number; // 0 to 1, fraction of base delay added as random jitter
}

export const DEFAULT_RECONNECT_POLICY: BackoffPolicy = {
  initialMs: 1_000, // Start at 1 second
  maxMs: 30_000, // Cap at 30 seconds
  factor: 2, // Double each attempt
  jitter: 0.25, // Add up to 25% random jitter
};

export function computeBackoff(policy: BackoffPolicy, attempt: number): number {
  const base = policy.initialMs * policy.factor ** Math.max(attempt - 1, 0);
  const jitter = base * policy.jitter * Math.random();
  return Math.min(policy.maxMs, Math.round(base + jitter));
}
