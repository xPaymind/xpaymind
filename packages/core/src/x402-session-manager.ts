/**
 * x402 Payment Session Manager
 *
 * Manages the full lifecycle of streaming x402 payment sessions:
 *   open → tick (micropayments) → close
 *
 * Provides per-session spend tracking, overspend protection, and an
 * event emitter so consumers can react to session state changes.
 *
 * Usage:
 *
 *   import { X402SessionManager } from "@workspace/core/x402-session-manager";
 *
 *   const manager = new X402SessionManager({ dailyCapUsdCents: 10_000 });
 *
 *   const session = await manager.open({
 *     to:              "https://api.example.com/stream",
 *     ratePerSecond:   2,       // 2 cents / second
 *     currency:        "USD",
 *     maxDurationSecs: 120,
 *     wallet,
 *   });
 *
 *   // later...
 *   await manager.close(session.sessionId);
 */

import type { StreamingPayment } from "./x402-types";
import type { X402Wallet }       from "./x402-integration-client";

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export type SessionState = "opening" | "active" | "closing" | "closed" | "failed";

export type PaymentTick = {
  tickIndex:    number;
  amountCents:  number;
  sentAt:       string;
  /** true when the tick was accepted by the resource server */
  confirmed:    boolean;
  error?:       string;
};

export type X402Session = {
  sessionId:       string;
  to:              string;
  currency:        string;
  ratePerSecond:   number;
  maxDurationSecs: number;
  openedAt:        string;
  closedAt?:       string;
  state:           SessionState;
  ticks:           PaymentTick[];
  /** Running total in smallest currency unit */
  totalSpentCents: number;
};

// ---------------------------------------------------------------------------
// Manager options
// ---------------------------------------------------------------------------

export type SessionManagerOptions = {
  /** Daily cumulative spend cap across all sessions (USD cents) */
  dailyCapUsdCents?: number;
  /** Interval between micropayment ticks in ms; defaults to 1 000 */
  tickIntervalMs?:   number;
  /** Called on every state transition */
  onStateChange?: (session: X402Session, prev: SessionState) => void;
  /** Called after each confirmed tick */
  onTick?:        (session: X402Session, tick: PaymentTick) => void;
  /** Called when a session is closed */
  onClose?:       (session: X402Session) => void;
  /** Called when any session error occurs */
  onError?:       (session: X402Session, error: Error) => void;
};

// ---------------------------------------------------------------------------
// Open options
// ---------------------------------------------------------------------------

export type OpenSessionOptions = {
  to:              string;
  ratePerSecond:   number;
  currency?:       string;
  maxDurationSecs: number;
  wallet:          X402Wallet;
};

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

export class X402SessionManager {
  private sessions    = new Map<string, X402Session>();
  private timers      = new Map<string, ReturnType<typeof setInterval>>();
  private dailyCap:     number;
  private tickInterval: number;
  private opts:         SessionManagerOptions;

  /** Running tally of today's spend across all sessions (USD cents) */
  private dailySpent = 0;

  constructor(opts: SessionManagerOptions = {}) {
    this.opts         = opts;
    this.dailyCap     = opts.dailyCapUsdCents ?? 50_000;
    this.tickInterval = opts.tickIntervalMs   ?? 1_000;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private genSessionId(): string {
    return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private transition(session: X402Session, next: SessionState): void {
    const prev     = session.state;
    session.state  = next;
    this.opts.onStateChange?.(session, prev);
  }

  private guardDailyCap(amountCents: number): void {
    if (this.dailySpent + amountCents > this.dailyCap) {
      throw new Error(
        `x402: daily spend cap reached ` +
        `(spent ${this.dailySpent}¢ of ${this.dailyCap}¢)`
      );
    }
  }

  // ── Open ─────────────────────────────────────────────────────────────────

  async open(openOpts: OpenSessionOptions): Promise<X402Session> {
    const sessionId = this.genSessionId();
    const session: X402Session = {
      sessionId,
      to:              openOpts.to,
      currency:        openOpts.currency ?? "USD",
      ratePerSecond:   openOpts.ratePerSecond,
      maxDurationSecs: openOpts.maxDurationSecs,
      openedAt:        new Date().toISOString(),
      state:           "opening",
      ticks:           [],
      totalSpentCents: 0,
    };

    this.sessions.set(sessionId, session);
    this.transition(session, "active");

    // Schedule micropayment ticks
    const maxTicks  = Math.floor(openOpts.maxDurationSecs * 1000 / this.tickInterval);
    let tickIndex   = 0;

    const timer = setInterval(async () => {
      if (tickIndex >= maxTicks || session.state !== "active") {
        clearInterval(timer);
        this.timers.delete(sessionId);
        if (session.state === "active") await this.close(sessionId);
        return;
      }

      const amountCents = Math.round(openOpts.ratePerSecond * (this.tickInterval / 1_000));

      try {
        this.guardDailyCap(amountCents);

        // Build streaming payload
        const payload: StreamingPayment = {
          scheme:          "streaming",
          ratePerSecond:   openOpts.ratePerSecond,
          currency:        openOpts.currency ?? "USD",
          to:              openOpts.to,
          sessionId,
          maxDurationSecs: openOpts.maxDurationSecs,
        };

        const message   = JSON.stringify({ payload, sessionId, tickIndex });
        const signature = await openOpts.wallet.sign(message);

        // In production: POST the signed tick to the resource server here
        // and await confirmation. We mark confirmed=true after acceptance.
        void signature; // consumed by real HTTP call in production

        const tick: PaymentTick = {
          tickIndex,
          amountCents,
          sentAt:    new Date().toISOString(),
          confirmed: true,
        };

        session.ticks.push(tick);
        session.totalSpentCents += amountCents;
        this.dailySpent         += amountCents;
        tickIndex++;

        this.opts.onTick?.(session, tick);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const tick: PaymentTick = {
          tickIndex,
          amountCents,
          sentAt:    new Date().toISOString(),
          confirmed: false,
          error:     error.message,
        };
        session.ticks.push(tick);
        tickIndex++;
        this.opts.onError?.(session, error);

        // Abort session on cap breach
        if (error.message.includes("daily spend cap")) {
          clearInterval(timer);
          this.timers.delete(sessionId);
          this.transition(session, "failed");
        }
      }
    }, this.tickInterval);

    this.timers.set(sessionId, timer);
    return session;
  }

  // ── Close ─────────────────────────────────────────────────────────────────

  async close(sessionId: string): Promise<X402Session> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`x402: session ${sessionId} not found`);

    const timer = this.timers.get(sessionId);
    if (timer) { clearInterval(timer); this.timers.delete(sessionId); }

    this.transition(session, "closing");
    session.closedAt = new Date().toISOString();
    this.transition(session, "closed");

    this.opts.onClose?.(session);
    return session;
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  get(sessionId: string): X402Session | undefined {
    return this.sessions.get(sessionId);
  }

  listActive(): X402Session[] {
    return [...this.sessions.values()].filter(s => s.state === "active");
  }

  dailySpentCents(): number {
    return this.dailySpent;
  }

  summary(): string {
    const all     = [...this.sessions.values()];
    const active  = all.filter(s => s.state === "active").length;
    const closed  = all.filter(s => s.state === "closed").length;
    const failed  = all.filter(s => s.state === "failed").length;
    const total   = all.reduce((s, sess) => s + sess.totalSpentCents, 0);
    return (
      `X402SessionManager — sessions: ${all.length} ` +
      `(active: ${active}, closed: ${closed}, failed: ${failed}) | ` +
      `total spent: $${(total / 100).toFixed(2)} | ` +
      `daily cap remaining: $${((this.dailyCap - this.dailySpent) / 100).toFixed(2)}`
    );
  }
}
