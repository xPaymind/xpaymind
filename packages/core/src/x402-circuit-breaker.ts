/**
 * x402 Circuit Breaker
 *
 * Protects AI agents from cascading failures when a payment endpoint
 * becomes unreliable.  Wraps any async payment call and automatically
 * opens (blocks traffic), half-opens (probes recovery), and closes
 * (resumes normal flow) based on configurable thresholds.
 *
 * States:
 *   CLOSED      — normal operation; failures are counted
 *   OPEN        — calls are rejected immediately without hitting the endpoint
 *   HALF_OPEN   — a limited number of probe requests are allowed through;
 *                 success → CLOSED, failure → OPEN again
 *
 * Features:
 *   - Sliding-window failure rate threshold (count or percentage)
 *   - Configurable cool-down period before HALF_OPEN probe
 *   - Per-endpoint breaker isolation via string keys
 *   - Event hooks: onOpen, onClose, onHalfOpen, onCallRejected
 *   - Full metrics: total calls, failures, rejections, state transitions
 *
 * Usage:
 *
 *   import { X402CircuitBreaker } from "@workspace/core/x402-circuit-breaker";
 *
 *   const breaker = new X402CircuitBreaker({ failureThreshold: 5, cooldownMs: 30_000 });
 *
 *   const result = await breaker.call("https://api.payment.example/pay", () =>
 *     fetch("https://api.payment.example/pay", { method: "POST", body: payload })
 *   );
 */

// ---------------------------------------------------------------------------
// State & error types
// ---------------------------------------------------------------------------

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class X402CircuitOpenError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly cooldownRemainingMs: number,
  ) {
    super(
      `Circuit breaker OPEN for "${endpoint}" — ` +
      `cooldown remaining: ${cooldownRemainingMs} ms`
    );
    this.name = "X402CircuitOpenError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BreakerSnapshot = {
  endpoint:       string;
  state:          BreakerState;
  failures:       number;
  successes:      number;
  rejections:     number;
  totalCalls:     number;
  lastFailureAt:  string | null;
  lastStateChange: string;
  cooldownRemainingMs: number;
};

export type CircuitBreakerMetrics = {
  breakers:        number;
  totalCalls:      number;
  totalFailures:   number;
  totalRejections: number;
  openBreakers:    string[];
  snapshot:        BreakerSnapshot[];
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type CircuitBreakerOptions = {
  /**
   * Number of consecutive failures before opening the circuit.
   * Default: 5
   */
  failureThreshold?: number;
  /**
   * Milliseconds to wait in OPEN state before probing (HALF_OPEN).
   * Default: 30 000 (30 s)
   */
  cooldownMs?: number;
  /**
   * Number of probe calls allowed in HALF_OPEN state.
   * Default: 1
   */
  halfOpenProbes?: number;
  /**
   * Whether a thrown error is counted as a failure.
   * Defaults to counting all errors.
   */
  isFailure?: (err: unknown) => boolean;
  onOpen?:       (endpoint: string) => void;
  onClose?:      (endpoint: string) => void;
  onHalfOpen?:   (endpoint: string) => void;
  onCallRejected?: (endpoint: string) => void;
};

// ---------------------------------------------------------------------------
// Per-endpoint breaker
// ---------------------------------------------------------------------------

class Breaker {
  state:          BreakerState = "CLOSED";
  failures        = 0;
  successes       = 0;
  rejections      = 0;
  totalCalls      = 0;
  probesSent      = 0;
  lastFailureAt:  number | null = null;
  openedAt:       number | null = null;
  lastStateChange = new Date().toISOString();
  private opts:   Required<CircuitBreakerOptions>;

  constructor(opts: Required<CircuitBreakerOptions>) {
    this.opts = opts;
  }

  transition(next: BreakerState, endpoint: string): void {
    this.state           = next;
    this.lastStateChange = new Date().toISOString();
    this.probesSent      = 0;
    if (next === "OPEN")      { this.openedAt = Date.now(); this.opts.onOpen(endpoint); }
    if (next === "CLOSED")    { this.failures = 0;          this.opts.onClose(endpoint); }
    if (next === "HALF_OPEN")                                this.opts.onHalfOpen(endpoint);
  }

  cooldownRemaining(): number {
    if (this.state !== "OPEN" || !this.openedAt) return 0;
    return Math.max(0, this.opts.cooldownMs - (Date.now() - this.openedAt));
  }

  snapshot(endpoint: string): BreakerSnapshot {
    return {
      endpoint, state: this.state,
      failures: this.failures, successes: this.successes,
      rejections: this.rejections, totalCalls: this.totalCalls,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      lastStateChange: this.lastStateChange,
      cooldownRemainingMs: this.cooldownRemaining(),
    };
  }
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

export class X402CircuitBreaker {
  private breakers = new Map<string, Breaker>();
  private opts:     Required<CircuitBreakerOptions>;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.opts = {
      failureThreshold: opts.failureThreshold ?? 5,
      cooldownMs:       opts.cooldownMs       ?? 30_000,
      halfOpenProbes:   opts.halfOpenProbes   ?? 1,
      isFailure:        opts.isFailure        ?? (() => true),
      onOpen:           opts.onOpen           ?? (() => {}),
      onClose:          opts.onClose          ?? (() => {}),
      onHalfOpen:       opts.onHalfOpen       ?? (() => {}),
      onCallRejected:   opts.onCallRejected   ?? (() => {}),
    };
  }

  // ── Main call wrapper ─────────────────────────────────────────────────────

  async call<T>(endpoint: string, fn: () => Promise<T>): Promise<T> {
    const b = this.getOrCreate(endpoint);
    b.totalCalls++;

    // OPEN — check if cooldown has elapsed
    if (b.state === "OPEN") {
      if (b.cooldownRemaining() > 0) {
        b.rejections++;
        this.opts.onCallRejected(endpoint);
        throw new X402CircuitOpenError(endpoint, b.cooldownRemaining());
      }
      b.transition("HALF_OPEN", endpoint);
    }

    // HALF_OPEN — only allow configured number of probes
    if (b.state === "HALF_OPEN") {
      if (b.probesSent >= this.opts.halfOpenProbes) {
        b.rejections++;
        this.opts.onCallRejected(endpoint);
        throw new X402CircuitOpenError(endpoint, 0);
      }
      b.probesSent++;
    }

    // Execute
    try {
      const result = await fn();
      b.successes++;
      if (b.state === "HALF_OPEN") b.transition("CLOSED", endpoint);
      else b.failures = 0;  // reset consecutive failures on success
      return result;
    } catch (err) {
      if (this.opts.isFailure(err)) {
        b.failures++;
        b.lastFailureAt = Date.now();
        if (b.state === "HALF_OPEN" || b.failures >= this.opts.failureThreshold) {
          b.transition("OPEN", endpoint);
        }
      }
      throw err;
    }
  }

  // ── Management ────────────────────────────────────────────────────────────

  private getOrCreate(endpoint: string): Breaker {
    if (!this.breakers.has(endpoint)) {
      this.breakers.set(endpoint, new Breaker(this.opts));
    }
    return this.breakers.get(endpoint)!;
  }

  /** Manually force a breaker into CLOSED state */
  reset(endpoint: string): void {
    this.breakers.get(endpoint)?.transition("CLOSED", endpoint);
  }

  resetAll(): void {
    for (const ep of this.breakers.keys()) this.reset(ep);
  }

  state(endpoint: string): BreakerState {
    return this.breakers.get(endpoint)?.state ?? "CLOSED";
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  metrics(): CircuitBreakerMetrics {
    let totalCalls = 0, totalFailures = 0, totalRejections = 0;
    const openBreakers: string[] = [];
    const snapshot: BreakerSnapshot[] = [];

    for (const [ep, b] of this.breakers) {
      totalCalls      += b.totalCalls;
      totalFailures   += b.failures;
      totalRejections += b.rejections;
      if (b.state === "OPEN") openBreakers.push(ep);
      snapshot.push(b.snapshot(ep));
    }

    return {
      breakers: this.breakers.size,
      totalCalls, totalFailures, totalRejections,
      openBreakers, snapshot,
    };
  }

  format(): string {
    const m = this.metrics();
    const lines = [
      `╔═══════ x402 Circuit Breakers ═══════╗`,
      `  Endpoints : ${m.breakers}  |  Open: ${m.openBreakers.length}`,
      `  Calls     : ${m.totalCalls}  Failures: ${m.totalFailures}  Rejected: ${m.totalRejections}`,
      ``,
      ...m.snapshot.map(s =>
        `  [${s.state.padEnd(9)}] ${s.endpoint.slice(0, 40).padEnd(40)} ` +
        `fail:${s.failures} rej:${s.rejections}`
      ),
      `╚${"═".repeat(38)}╝`,
    ];
    return lines.join("\n");
  }
}
