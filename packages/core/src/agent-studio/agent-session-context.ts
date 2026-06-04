/**
 * Agent Studio v2 — Session Context
 *
 * Lightweight, immutable context object passed through every stage of a
 * pipeline run.  Replaces ad-hoc parameter threading in v1 and provides
 * a single source of truth for per-session state that all components
 * (orchestrator, health monitor, audit logger, rate limiter) can read
 * without coupling to each other.
 *
 * Context includes:
 *   - Identity:  agentId, sessionId, runId
 *   - Config:    resolved StudioConfig snapshot for this run
 *   - Timing:    sessionStartedAt, wallClockMs()
 *   - Budget:    usedCents, limitCents, budgetRemaining(), budgetUtilPct()
 *   - Metadata:  arbitrary key-value bag for stage-to-stage data sharing
 *   - Derived:   isOverBudget(), elapsedMs(), formatSummary()
 *
 * The context is created once per pipeline run by `createSessionContext()`
 * and passed into every stage via StageContext.upstream.  It is read-only
 * except for the budget tracker and metadata bag which have explicit mutators.
 *
 * Usage:
 *
 *   import { createSessionContext } from
 *     "@workspace/core/agent-studio/agent-session-context";
 *
 *   const ctx = createSessionContext({
 *     agentId:    "agent-001",
 *     limitCents: 5_000,
 *     config:     studioConfig,
 *   });
 *
 *   ctx.spendCents(150);
 *   ctx.set("kycLevel", "standard");
 *
 *   console.log(ctx.budgetRemaining());  // 4850
 *   console.log(ctx.get("kycLevel"));    // "standard"
 *   console.log(ctx.formatSummary());
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionPhase =
  | "initialising"
  | "running"
  | "completed"
  | "failed"
  | "aborted";

export type SessionContextSnapshot = {
  sessionId:       string;
  agentId:         string;
  runId:           string;
  phase:           SessionPhase;
  sessionStartedAt: string;
  elapsedMs:       number;
  usedCents:       number;
  limitCents:      number;
  budgetUtilPct:   number;
  metadata:        Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SessionContextOptions = {
  agentId:     string;
  limitCents?: number;   // session budget cap; default 10 000 ($100)
  config?:     Record<string, unknown>;
  metadata?:   Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Session Context
// ---------------------------------------------------------------------------

export class AgentSessionContext {
  readonly sessionId:        string;
  readonly agentId:          string;
  readonly runId:            string;
  readonly sessionStartedAt: string;
  readonly config:           Readonly<Record<string, unknown>>;

  private _phase:      SessionPhase = "initialising";
  private _usedCents:  number       = 0;
  private _limitCents: number;
  private _metadata:   Map<string, unknown>;
  private _startTs:    number;

  constructor(opts: SessionContextOptions) {
    this._startTs          = Date.now();
    this.sessionId         = `sess_${this._startTs.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.runId             = `run_${this._startTs.toString(36)}`;
    this.agentId           = opts.agentId;
    this.sessionStartedAt  = new Date(this._startTs).toISOString();
    this._limitCents       = opts.limitCents ?? 10_000;
    this.config            = Object.freeze({ ...(opts.config ?? {}) });
    this._metadata         = new Map(Object.entries(opts.metadata ?? {}));
  }

  // ── Phase ─────────────────────────────────────────────────────────────────

  get phase(): SessionPhase { return this._phase; }

  start():   void { this._phase = "running"; }
  complete(): void { this._phase = "completed"; }
  fail():    void { this._phase = "failed"; }
  abort():   void { this._phase = "aborted"; }

  // ── Budget ────────────────────────────────────────────────────────────────

  get usedCents(): number  { return this._usedCents; }
  get limitCents(): number { return this._limitCents; }

  spendCents(amount: number): void {
    if (amount < 0) throw new Error("spendCents: amount must be ≥ 0");
    this._usedCents += amount;
  }

  budgetRemaining(): number {
    return Math.max(0, this._limitCents - this._usedCents);
  }

  budgetUtilPct(): number {
    return this._limitCents > 0
      ? Math.min(100, Math.round((this._usedCents / this._limitCents) * 100))
      : 0;
  }

  isOverBudget(): boolean {
    return this._usedCents >= this._limitCents;
  }

  // ── Timing ────────────────────────────────────────────────────────────────

  elapsedMs(): number {
    return Date.now() - this._startTs;
  }

  wallClockMs(): number { return this.elapsedMs(); }

  // ── Metadata bag ──────────────────────────────────────────────────────────

  set<T = unknown>(key: string, value: T): void {
    this._metadata.set(key, value);
  }

  get<T = unknown>(key: string): T | undefined {
    return this._metadata.get(key) as T | undefined;
  }

  has(key: string): boolean { return this._metadata.has(key); }

  delete(key: string): void { this._metadata.delete(key); }

  metadataKeys(): string[] { return [...this._metadata.keys()]; }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  snapshot(): SessionContextSnapshot {
    return {
      sessionId:        this.sessionId,
      agentId:          this.agentId,
      runId:            this.runId,
      phase:            this._phase,
      sessionStartedAt: this.sessionStartedAt,
      elapsedMs:        this.elapsedMs(),
      usedCents:        this._usedCents,
      limitCents:       this._limitCents,
      budgetUtilPct:    this.budgetUtilPct(),
      metadata:         Object.fromEntries(this._metadata),
    };
  }

  // ── Formatted summary ─────────────────────────────────────────────────────

  formatSummary(): string {
    const elapsed = this.elapsedMs();
    const budget  = `$${(this._usedCents / 100).toFixed(2)} / $${(this._limitCents / 100).toFixed(2)} (${this.budgetUtilPct()}%)`;
    const phaseIcon: Record<SessionPhase, string> = {
      initialising: "⏳", running: "▶", completed: "✓", failed: "✗", aborted: "⊘",
    };
    return [
      `Session  : ${this.sessionId}`,
      `Agent    : ${this.agentId}`,
      `Phase    : ${phaseIcon[this._phase]} ${this._phase}`,
      `Elapsed  : ${elapsed} ms`,
      `Budget   : ${budget}${this.isOverBudget() ? "  ⚠ OVER BUDGET" : ""}`,
      `Metadata : ${this._metadata.size} keys`,
    ].join("
");
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSessionContext(opts: SessionContextOptions): AgentSessionContext {
  return new AgentSessionContext(opts);
}
