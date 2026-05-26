/**
 * x402 Rate Limiter
 *
 * Token-bucket rate limiter for outbound x402 payment requests.
 * Prevents agents from flooding payment endpoints, avoids triggering
 * anti-fraud circuit breakers on downstream providers, and enforces
 * per-agent, per-currency, and global throughput caps.
 *
 * Architecture:
 *   - One token bucket per key (agentId, currency, or "global")
 *   - Buckets refill at a configurable rate (tokens / second)
 *   - Burst capacity independent of sustained rate
 *   - Optional queue: requests that exceed the bucket wait up to maxWaitMs
 *   - Metrics: total allowed, throttled, queued, and queue-timeout counts
 *
 * Usage:
 *
 *   import { X402RateLimiter } from "@workspace/core/x402-rate-limiter";
 *
 *   const limiter = new X402RateLimiter({
 *     defaultRate:  10,       // 10 req/s sustained
 *     defaultBurst: 25,       // allow bursts up to 25
 *     maxWaitMs:    2_000,    // queue for up to 2 s before rejecting
 *   });
 *
 *   await limiter.acquire({ agentId: "agent-001", currency: "USDC" });
 *   // throws X402RateLimitError if budget exhausted and wait timed out
 */

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class X402RateLimitError extends Error {
  constructor(
    public readonly key:       string,
    public readonly waitedMs:  number,
  ) {
    super(`x402 rate limit exceeded for key "${key}" after waiting ${waitedMs} ms`);
    this.name = "X402RateLimitError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BucketKey = string;   // e.g. "agent:agent-001" | "currency:USDC" | "global"

export type BucketState = {
  key:          BucketKey;
  tokens:       number;
  capacity:     number;  // max burst
  refillRate:   number;  // tokens added per second
  lastRefillAt: number;  // Date.now()
  allowed:      number;
  throttled:    number;
  queued:       number;
  queueTimeout: number;
};

export type AcquireRequest = {
  agentId:   string;
  currency?: string;
  /** How many tokens to consume; default 1 */
  tokens?:   number;
};

export type AcquireResult = {
  key:       BucketKey;
  waitedMs:  number;
  remaining: number;
};

export type RateLimiterMetrics = {
  buckets:      number;
  totalAllowed: number;
  totalThrottled: number;
  totalQueued:  number;
  totalQueueTimeout: number;
  snapshot:     BucketState[];
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type RateLimiterOptions = {
  /** Sustained token refill rate (tokens / second); default 10 */
  defaultRate?:   number;
  /** Max burst capacity per bucket; default 25 */
  defaultBurst?:  number;
  /** Max ms to wait in queue before throwing; 0 = no queuing; default 2000 */
  maxWaitMs?:     number;
  /** Per-currency rate overrides */
  currencyRates?: Record<string, { rate: number; burst: number }>;
  /** Per-agent rate overrides */
  agentRates?:    Record<string, { rate: number; burst: number }>;
};

// ---------------------------------------------------------------------------
// Token bucket
// ---------------------------------------------------------------------------

class TokenBucket {
  tokens:       number;
  capacity:     number;
  refillRate:   number;
  lastRefillAt: number;
  allowed       = 0;
  throttled     = 0;
  queued        = 0;
  queueTimeout  = 0;

  constructor(rate: number, burst: number) {
    this.refillRate   = rate;
    this.capacity     = burst;
    this.tokens       = burst;
    this.lastRefillAt = Date.now();
  }

  private refill(): void {
    const now     = Date.now();
    const elapsed = (now - this.lastRefillAt) / 1_000;
    this.tokens   = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefillAt = now;
  }

  tryConsume(n: number): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      this.allowed++;
      return true;
    }
    return false;
  }

  /** Returns ms until `n` tokens are available */
  waitUntilAvailableMs(n: number): number {
    this.refill();
    const deficit = n - this.tokens;
    return deficit <= 0 ? 0 : Math.ceil((deficit / this.refillRate) * 1_000);
  }

  snapshot(key: BucketKey): BucketState {
    return {
      key, tokens: this.tokens, capacity: this.capacity,
      refillRate: this.refillRate, lastRefillAt: this.lastRefillAt,
      allowed: this.allowed, throttled: this.throttled,
      queued: this.queued, queueTimeout: this.queueTimeout,
    };
  }
}

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

export class X402RateLimiter {
  private buckets    = new Map<BucketKey, TokenBucket>();
  private defaultRate:  number;
  private defaultBurst: number;
  private maxWaitMs:    number;
  private opts:         RateLimiterOptions;

  constructor(opts: RateLimiterOptions = {}) {
    this.opts         = opts;
    this.defaultRate  = opts.defaultRate  ?? 10;
    this.defaultBurst = opts.defaultBurst ?? 25;
    this.maxWaitMs    = opts.maxWaitMs    ?? 2_000;
  }

  // ── Public acquire ────────────────────────────────────────────────────────

  async acquire(req: AcquireRequest): Promise<AcquireResult> {
    const n   = req.tokens ?? 1;
    const key = this.keyFor(req);
    const bkt = this.bucketFor(key, req);

    const start = Date.now();

    // Fast path
    if (bkt.tryConsume(n)) {
      return { key, waitedMs: 0, remaining: Math.floor(bkt.tokens) };
    }

    // Queue path
    if (this.maxWaitMs > 0) {
      bkt.queued++;
      const waitMs = bkt.waitUntilAvailableMs(n);
      if (waitMs <= this.maxWaitMs) {
        await sleep(waitMs);
        if (bkt.tryConsume(n)) {
          return { key, waitedMs: Date.now() - start, remaining: Math.floor(bkt.tokens) };
        }
      }
      bkt.queueTimeout++;
    } else {
      bkt.throttled++;
    }

    throw new X402RateLimitError(key, Date.now() - start);
  }

  // ── Bucket management ─────────────────────────────────────────────────────

  private keyFor(req: AcquireRequest): BucketKey {
    return req.currency
      ? `agent:${req.agentId}|currency:${req.currency}`
      : `agent:${req.agentId}`;
  }

  private bucketFor(key: BucketKey, req: AcquireRequest): TokenBucket {
    if (!this.buckets.has(key)) {
      const { rate, burst } = this.rateFor(req);
      this.buckets.set(key, new TokenBucket(rate, burst));
    }
    return this.buckets.get(key)!;
  }

  private rateFor(req: AcquireRequest): { rate: number; burst: number } {
    if (req.currency && this.opts.currencyRates?.[req.currency]) {
      return this.opts.currencyRates[req.currency];
    }
    if (this.opts.agentRates?.[req.agentId]) {
      return this.opts.agentRates[req.agentId];
    }
    return { rate: this.defaultRate, burst: this.defaultBurst };
  }

  /** Override rate/burst for a specific bucket key at runtime */
  configure(key: BucketKey, rate: number, burst: number): void {
    const existing = this.buckets.get(key);
    if (existing) {
      existing.refillRate = rate;
      existing.capacity   = burst;
    } else {
      this.buckets.set(key, new TokenBucket(rate, burst));
    }
  }

  reset(key: BucketKey): void {
    this.buckets.delete(key);
  }

  resetAll(): void {
    this.buckets.clear();
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  metrics(): RateLimiterMetrics {
    let totalAllowed = 0, totalThrottled = 0, totalQueued = 0, totalQueueTimeout = 0;
    const snapshot: BucketState[] = [];
    for (const [key, bkt] of this.buckets) {
      totalAllowed      += bkt.allowed;
      totalThrottled    += bkt.throttled;
      totalQueued       += bkt.queued;
      totalQueueTimeout += bkt.queueTimeout;
      snapshot.push(bkt.snapshot(key));
    }
    return {
      buckets: this.buckets.size,
      totalAllowed, totalThrottled, totalQueued, totalQueueTimeout,
      snapshot,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
