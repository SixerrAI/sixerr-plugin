import { describe, it, expect, vi } from "vitest";
import { computeBackoff, DEFAULT_RECONNECT_POLICY, type BackoffPolicy } from "./reconnect.js";

describe("computeBackoff", () => {
  it("attempt 1 with default policy returns between 1000 and 1250", () => {
    // base = 1000 * 2^0 = 1000, jitter up to 250
    for (let i = 0; i < 20; i++) {
      const result = computeBackoff(DEFAULT_RECONNECT_POLICY, 1);
      expect(result).toBeGreaterThanOrEqual(1000);
      expect(result).toBeLessThanOrEqual(1250);
    }
  });

  it("attempt 2 returns between 2000 and 2500", () => {
    // base = 1000 * 2^1 = 2000, jitter up to 500
    for (let i = 0; i < 20; i++) {
      const result = computeBackoff(DEFAULT_RECONNECT_POLICY, 2);
      expect(result).toBeGreaterThanOrEqual(2000);
      expect(result).toBeLessThanOrEqual(2500);
    }
  });

  it("attempt 3 returns between 4000 and 5000", () => {
    // base = 1000 * 2^2 = 4000, jitter up to 1000
    for (let i = 0; i < 20; i++) {
      const result = computeBackoff(DEFAULT_RECONNECT_POLICY, 3);
      expect(result).toBeGreaterThanOrEqual(4000);
      expect(result).toBeLessThanOrEqual(5000);
    }
  });

  it("attempt 5+ is capped at maxMs (30000)", () => {
    // base = 1000 * 2^4 = 16000 at attempt 5, attempt 6 = 32000 > 30000
    for (let i = 0; i < 20; i++) {
      const result = computeBackoff(DEFAULT_RECONNECT_POLICY, 6);
      expect(result).toBeLessThanOrEqual(30000);
    }
    // Attempt 7 would be 64000 base, still capped
    for (let i = 0; i < 20; i++) {
      const result = computeBackoff(DEFAULT_RECONNECT_POLICY, 7);
      expect(result).toBeLessThanOrEqual(30000);
    }
  });

  it("attempt 0 (edge case) produces same as attempt 1", () => {
    // Math.max(0-1, 0) = 0, same as Math.max(1-1, 0) = 0
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const result0 = computeBackoff(DEFAULT_RECONNECT_POLICY, 0);
    const result1 = computeBackoff(DEFAULT_RECONNECT_POLICY, 1);
    expect(result0).toBe(result1);
    vi.restoreAllMocks();
  });

  it("respects custom policy values", () => {
    const custom: BackoffPolicy = {
      initialMs: 500,
      maxMs: 10_000,
      factor: 3,
      jitter: 0.1,
    };
    // attempt 1: base = 500 * 3^0 = 500, jitter up to 50
    vi.spyOn(Math, "random").mockReturnValue(0);
    const result = computeBackoff(custom, 1);
    expect(result).toBe(500);

    // attempt 2: base = 500 * 3^1 = 1500, jitter 0
    const result2 = computeBackoff(custom, 2);
    expect(result2).toBe(1500);

    vi.restoreAllMocks();
  });

  it("jitter=0 returns deterministic base values (no randomness)", () => {
    const noJitter: BackoffPolicy = {
      initialMs: 1000,
      maxMs: 30_000,
      factor: 2,
      jitter: 0,
    };
    // With jitter=0, base * 0 * Math.random() = 0 always
    const results = Array.from({ length: 10 }, () => computeBackoff(noJitter, 1));
    expect(new Set(results).size).toBe(1); // All identical
    expect(results[0]).toBe(1000);

    const results2 = Array.from({ length: 10 }, () => computeBackoff(noJitter, 2));
    expect(new Set(results2).size).toBe(1);
    expect(results2[0]).toBe(2000);

    const results3 = Array.from({ length: 10 }, () => computeBackoff(noJitter, 3));
    expect(new Set(results3).size).toBe(1);
    expect(results3[0]).toBe(4000);
  });
});
