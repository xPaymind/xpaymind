/**
 * Agent Health Monitor
 *
 * Continuously tracks the operational health of AI payment agents and
 * surfaces actionable status summaries for dashboards, alerting systems,
 * and the benchmark leaderboard.
 *
 * Health signals collected per agent:
 *   - Heartbeat liveness   : last-seen timestamp + configurable stale threshold
 *   - Payment success rate : rolling window (default 5 min)
 *   - Latency trend        : exponential moving average vs. baseline
 *   - Circuit breaker state: CLOSED / OPEN / HALF_OPEN from X402CircuitBreaker
 *   - Budget utilisation   : percentage of session budget consumed
 *   - Error rate           : errors per minute in rolling window
 *
 * Overall health is one of: healthy | degraded | unhealthy | unknown
 *
 * Usage:
 *
 *   import { AgentHealthMonitor } from "@workspace/core/agent-health-monitor";
 *
 *   const monitor = new AgentHealthMonitor({ staleThresholdMs: 60_000 });
 *
 *   monitor.heartbeat("agent-001");
 *   monitor.recordPayment("agent-001", { latencyMs: 320, success: true });
 *   monitor.recordError("agent-001", "timeout");
 *
 *   const status = monitor.status("agent-001");
 *   console.log(monitor.toMarkdown());
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthLevel = "healthy" | "degraded" | "unhealthy" | "unknown";

export type CircuitBreakerStateInput = "CLOSED" | "OPEN" | "HALF_OPEN";

export type AgentHealthStatus = {
  agentId:           string;
  health:            HealthLevel;
  lastHeartbeatAt:   string | null;
  staleSince:        string | null;
  successRate1m:     number;        // 0 – 1
  successRate5m:     number;        // 0 – 1
  emaLatencyMs:      number;
  latencyBaseline:   number;
  latencyDriftPct:   number;        // (ema - baseline) / baseline * 100
  errorsPerMinute:   number;
  circuitState:      CircuitBreakerStateInput | null;
  budgetUtilPct:     number;        // 0 – 100
  reasons:           string[];      // human-readable degradation causes
  updatedAt:         string;
};

export type PaymentEvent = {
  success:    boolean;
  latencyMs:  number;
  errorType?: string;
};

export type BudgetUpdate = {
  usedCents:  number;
  limitCents: number;
};

// ---------------------------------------------------------------------------
// Rolling window helpers
// ---------------------------------------------------------------------------

type TimestampedBool = { ts: number; value: boolean };
type TimestampedNum  = { ts: number; value: number };

function windowFilter<T extends { ts: number }>(items: T[], windowMs: number): T[] {
  const cutoff = Date.now() - windowMs;
  return items.filter(i => i.ts >= cutoff);
}

function successRate(events: TimestampedBool[]): number {
  if (events.length === 0) return 1;
  return events.filter(e => e.value).length / events.length;
}

// ---------------------------------------------------------------------------
// Per-agent state
// ---------------------------------------------------------------------------

type AgentState = {
  agentId:         string;
  lastHeartbeatTs: number | null;
  payments:        TimestampedBool[];
  errors:          TimestampedNum[];   // ts + 1 per error
  emaLatencyMs:    number;
  latencyBaseline: number;
  circuitState:    CircuitBreakerStateInput | null;
  budgetUsed:      number;
  budgetLimit:     number;
};

const EMA_ALPHA = 0.15;   // smoothing factor for latency EMA

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type HealthMonitorOptions = {
  /** ms without a heartbeat before the agent is considered stale; default 60 000 */
  staleThresholdMs?:      number;
  /** success rate below which agent is degraded; default 0.90 */
  degradedSuccessRate?:   number;
  /** success rate below which agent is unhealthy; default 0.70 */
  unhealthySuccessRate?:  number;
  /** latency drift % above which agent is degraded; default 50 */
  degradedLatencyDrift?:  number;
  /** errors/min above which agent is degraded; default 5 */
  degradedEpm?:           number;
  /** budget utilisation % above which agent is degraded; default 80 */
  degradedBudgetUtil?:    number;
};

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

export class AgentHealthMonitor {
  private states = new Map<string, AgentState>();
  private opts:   Required<HealthMonitorOptions>;

  constructor(opts: HealthMonitorOptions = {}) {
    this.opts = {
      staleThresholdMs:     opts.staleThresholdMs     ?? 60_000,
      degradedSuccessRate:  opts.degradedSuccessRate  ?? 0.90,
      unhealthySuccessRate: opts.unhealthySuccessRate ?? 0.70,
      degradedLatencyDrift: opts.degradedLatencyDrift ?? 50,
      degradedEpm:          opts.degradedEpm          ?? 5,
      degradedBudgetUtil:   opts.degradedBudgetUtil   ?? 80,
    };
  }

  // ── Inputs ────────────────────────────────────────────────────────────────

  heartbeat(agentId: string): void {
    this.ensure(agentId).lastHeartbeatTs = Date.now();
  }

  recordPayment(agentId: string, evt: PaymentEvent): void {
    const s   = this.ensure(agentId);
    const now = Date.now();
    s.payments.push({ ts: now, value: evt.success });

    // Update EMA latency
    if (s.emaLatencyMs === 0) {
      s.emaLatencyMs   = evt.latencyMs;
      s.latencyBaseline = evt.latencyMs;
    } else {
      s.emaLatencyMs = EMA_ALPHA * evt.latencyMs + (1 - EMA_ALPHA) * s.emaLatencyMs;
    }

    // Update baseline slowly
    s.latencyBaseline = 0.005 * evt.latencyMs + 0.995 * s.latencyBaseline;

    if (!evt.success && evt.errorType) {
      s.errors.push({ ts: now, value: 1 });
    }

    // Prune old events
    s.payments = windowFilter(s.payments, 5 * 60_000);
    s.errors   = windowFilter(s.errors,   60_000);
  }

  recordError(agentId: string, _errorType: string): void {
    this.ensure(agentId).errors.push({ ts: Date.now(), value: 1 });
  }

  setCircuitState(agentId: string, state: CircuitBreakerStateInput): void {
    this.ensure(agentId).circuitState = state;
  }

  setBudget(agentId: string, update: BudgetUpdate): void {
    const s     = this.ensure(agentId);
    s.budgetUsed  = update.usedCents;
    s.budgetLimit = update.limitCents;
  }

  // ── Status ────────────────────────────────────────────────────────────────

  status(agentId: string): AgentHealthStatus {
    const s = this.states.get(agentId);
    if (!s) {
      return this.unknownStatus(agentId);
    }

    const now        = Date.now();
    const reasons:   string[] = [];
    let   level:     HealthLevel = "healthy";

    // Heartbeat staleness
    const staleSince: string | null =
      s.lastHeartbeatTs !== null && now - s.lastHeartbeatTs > this.opts.staleThresholdMs
        ? new Date(s.lastHeartbeatTs).toISOString()
        : null;
    if (staleSince) {
      reasons.push(`no heartbeat since ${staleSince}`);
      level = "unhealthy";
    }

    // Success rates
    const win1m = windowFilter(s.payments, 60_000);
    const win5m = s.payments;
    const sr1m  = successRate(win1m);
    const sr5m  = successRate(win5m);

    if (sr5m < this.opts.unhealthySuccessRate) {
      reasons.push(`5m success rate ${(sr5m * 100).toFixed(1)}% < ${(this.opts.unhealthySuccessRate * 100).toFixed(0)}%`);
      level = "unhealthy";
    } else if (sr5m < this.opts.degradedSuccessRate) {
      reasons.push(`5m success rate ${(sr5m * 100).toFixed(1)}% < ${(this.opts.degradedSuccessRate * 100).toFixed(0)}%`);
      if (level === "healthy") level = "degraded";
    }

    // Latency drift
    const drift = s.latencyBaseline > 0
      ? ((s.emaLatencyMs - s.latencyBaseline) / s.latencyBaseline) * 100
      : 0;
    if (drift > this.opts.degradedLatencyDrift) {
      reasons.push(`latency drift +${drift.toFixed(0)}%`);
      if (level === "healthy") level = "degraded";
    }

    // Error rate
    const epm = windowFilter(s.errors, 60_000).length;
    if (epm > this.opts.degradedEpm) {
      reasons.push(`${epm} errors/min`);
      if (level === "healthy") level = "degraded";
    }

    // Circuit breaker
    if (s.circuitState === "OPEN") {
      reasons.push("circuit breaker OPEN");
      level = "unhealthy";
    } else if (s.circuitState === "HALF_OPEN") {
      reasons.push("circuit breaker HALF_OPEN");
      if (level === "healthy") level = "degraded";
    }

    // Budget
    const budgetUtil = s.budgetLimit > 0 ? (s.budgetUsed / s.budgetLimit) * 100 : 0;
    if (budgetUtil >= 100) {
      reasons.push("budget exhausted");
      level = "unhealthy";
    } else if (budgetUtil > this.opts.degradedBudgetUtil) {
      reasons.push(`budget at ${budgetUtil.toFixed(0)}%`);
      if (level === "healthy") level = "degraded";
    }

    return {
      agentId,
      health:          level,
      lastHeartbeatAt: s.lastHeartbeatTs ? new Date(s.lastHeartbeatTs).toISOString() : null,
      staleSince,
      successRate1m:   sr1m,
      successRate5m:   sr5m,
      emaLatencyMs:    Math.round(s.emaLatencyMs),
      latencyBaseline: Math.round(s.latencyBaseline),
      latencyDriftPct: Math.round(drift),
      errorsPerMinute: epm,
      circuitState:    s.circuitState,
      budgetUtilPct:   Math.round(budgetUtil),
      reasons,
      updatedAt:       new Date().toISOString(),
    };
  }

  all(): AgentHealthStatus[] {
    return [...this.states.keys()].map(id => this.status(id));
  }

  // ── Markdown output ───────────────────────────────────────────────────────

  toMarkdown(): string {
    const statuses = this.all().sort((a, b) =>
      ["unhealthy", "degraded", "healthy", "unknown"].indexOf(a.health) -
      ["unhealthy", "degraded", "healthy", "unknown"].indexOf(b.health)
    );

    const icon = (h: HealthLevel) =>
      ({ healthy: "🟢", degraded: "🟡", unhealthy: "🔴", unknown: "⚫" })[h];

    const lines = [
      `# Agent Health Monitor`,
      ``,
      `| Agent | Health | SR 5m | EMA Latency | Budget | Circuit | Notes |`,
      `|-------|--------|------:|------------:|-------:|---------|-------|`,
      ...statuses.map(s =>
        `| \`${s.agentId}\` | ${icon(s.health)} ${s.health} ` +
        `| ${(s.successRate5m * 100).toFixed(1)}% ` +
        `| ${s.emaLatencyMs} ms ` +
        `| ${s.budgetUtilPct}% ` +
        `| ${s.circuitState ?? "—"} ` +
        `| ${s.reasons.slice(0, 2).join("; ") || "—"} |`
      ),
    ];
    return lines.join("\n");
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private ensure(agentId: string): AgentState {
    if (!this.states.has(agentId)) {
      this.states.set(agentId, {
        agentId,
        lastHeartbeatTs:  null,
        payments:         [],
        errors:           [],
        emaLatencyMs:     0,
        latencyBaseline:  0,
        circuitState:     null,
        budgetUsed:       0,
        budgetLimit:      0,
      });
    }
    return this.states.get(agentId)!;
  }

  private unknownStatus(agentId: string): AgentHealthStatus {
    return {
      agentId, health: "unknown",
      lastHeartbeatAt: null, staleSince: null,
      successRate1m: 1, successRate5m: 1,
      emaLatencyMs: 0, latencyBaseline: 0, latencyDriftPct: 0,
      errorsPerMinute: 0, circuitState: null, budgetUtilPct: 0,
      reasons: ["no data"], updatedAt: new Date().toISOString(),
    };
  }
}
