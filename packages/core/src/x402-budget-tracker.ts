/**
 * x402 Budget Tracker
 *
 * Centralised spend accounting for multiple agents and sessions.
 * Enforces per-agent, per-project, and global daily budgets and fires
 * threshold callbacks before limits are breached.
 *
 * Usage:
 *
 *   import { X402BudgetTracker } from "@workspace/core/x402-budget-tracker";
 *
 *   const tracker = new X402BudgetTracker({
 *     globalDailyCapCents: 100_000,   // $1 000 / day
 *     alertThresholdPct:   80,         // warn at 80 % used
 *     onAlert: ({ scope, usedPct }) =>
 *       console.warn(`Budget alert: ${scope} at ${usedPct}%`),
 *   });
 *
 *   tracker.setAgentCap("payment-agent-001", 5_000);   // $50 / day
 *   tracker.record("payment-agent-001", 120);           // 120 ¢
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BudgetScope = "global" | `agent:${string}` | `project:${string}`;

export type SpendEntry = {
  id:        string;
  agentId:   string;
  amountCents: number;
  currency:  string;
  recordedAt: string;
  note?:     string;
};

export type BudgetAlert = {
  scope:      BudgetScope;
  capCents:   number;
  usedCents:  number;
  usedPct:    number;
  triggeredAt: string;
};

export type BudgetStatus = {
  scope:       BudgetScope;
  capCents:    number;
  usedCents:   number;
  remainingCents: number;
  usedPct:     number;
  breached:    boolean;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type BudgetTrackerOptions = {
  globalDailyCapCents:  number;
  /** Fire alert when usage reaches this percentage of any cap; defaults to 80 */
  alertThresholdPct?:   number;
  /** Called when a scope crosses the alert threshold */
  onAlert?:             (alert: BudgetAlert) => void;
  /** Called when any cap is breached */
  onBreach?:            (status: BudgetStatus) => void;
  /** ISO 8601 date to treat as "today"; defaults to actual today */
  referenceDate?:       string;
};

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export class X402BudgetTracker {
  private entries:     SpendEntry[]         = [];
  private agentCaps:   Map<string, number>  = new Map();
  private projectCaps: Map<string, number>  = new Map();
  private alertedScopes: Set<string>        = new Set();

  private globalCap:      number;
  private alertThreshold: number;
  private opts:           BudgetTrackerOptions;

  constructor(opts: BudgetTrackerOptions) {
    this.opts           = opts;
    this.globalCap      = opts.globalDailyCapCents;
    this.alertThreshold = opts.alertThresholdPct ?? 80;
  }

  // ── Cap configuration ────────────────────────────────────────────────────

  setAgentCap(agentId: string, capCents: number): this {
    this.agentCaps.set(agentId, capCents);
    return this;
  }

  setProjectCap(projectId: string, capCents: number): this {
    this.projectCaps.set(projectId, capCents);
    return this;
  }

  // ── Recording ────────────────────────────────────────────────────────────

  record(
    agentId: string,
    amountCents: number,
    opts: { currency?: string; note?: string; projectId?: string } = {}
  ): SpendEntry {
    const entry: SpendEntry = {
      id:          `spe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      agentId,
      amountCents,
      currency:    opts.currency ?? "USD",
      recordedAt:  new Date().toISOString(),
      note:        opts.note,
    };

    this.entries.push(entry);

    // Check global
    this.checkScope("global", this.globalCap, this.globalUsed());

    // Check agent
    const agentCap = this.agentCaps.get(agentId);
    if (agentCap !== undefined) {
      this.checkScope(`agent:${agentId}`, agentCap, this.agentUsed(agentId));
    }

    // Check project
    if (opts.projectId) {
      const projectCap = this.projectCaps.get(opts.projectId);
      if (projectCap !== undefined) {
        this.checkScope(
          `project:${opts.projectId}`,
          projectCap,
          this.projectUsed(opts.projectId)
        );
      }
    }

    return entry;
  }

  // ── Scope checks ─────────────────────────────────────────────────────────

  private checkScope(scope: BudgetScope, capCents: number, usedCents: number): void {
    const usedPct = Math.round((usedCents / capCents) * 1000) / 10;

    if (usedCents > capCents) {
      this.opts.onBreach?.({
        scope, capCents, usedCents,
        remainingCents: 0,
        usedPct,
        breached: true,
      });
      return;
    }

    if (usedPct >= this.alertThreshold && !this.alertedScopes.has(scope)) {
      this.alertedScopes.add(scope);
      this.opts.onAlert?.({
        scope, capCents, usedCents, usedPct,
        triggeredAt: new Date().toISOString(),
      });
    }
  }

  // ── Aggregations ─────────────────────────────────────────────────────────

  private todayEntries(): SpendEntry[] {
    const today = (this.opts.referenceDate ?? new Date().toISOString()).slice(0, 10);
    return this.entries.filter(e => e.recordedAt.startsWith(today));
  }

  globalUsed(): number {
    return this.todayEntries().reduce((s, e) => s + e.amountCents, 0);
  }

  agentUsed(agentId: string): number {
    return this.todayEntries()
      .filter(e => e.agentId === agentId)
      .reduce((s, e) => s + e.amountCents, 0);
  }

  projectUsed(projectId: string): number {
    // Project entries are identified by note prefix "project:<id>"
    return this.todayEntries()
      .filter(e => e.note?.startsWith(`project:${projectId}`))
      .reduce((s, e) => s + e.amountCents, 0);
  }

  // ── Status ───────────────────────────────────────────────────────────────

  globalStatus(): BudgetStatus {
    const used = this.globalUsed();
    return {
      scope:          "global",
      capCents:       this.globalCap,
      usedCents:      used,
      remainingCents: Math.max(0, this.globalCap - used),
      usedPct:        Math.round((used / this.globalCap) * 1000) / 10,
      breached:       used > this.globalCap,
    };
  }

  agentStatus(agentId: string): BudgetStatus | null {
    const cap = this.agentCaps.get(agentId);
    if (cap === undefined) return null;
    const used = this.agentUsed(agentId);
    return {
      scope:          `agent:${agentId}`,
      capCents:       cap,
      usedCents:      used,
      remainingCents: Math.max(0, cap - used),
      usedPct:        Math.round((used / cap) * 1000) / 10,
      breached:       used > cap,
    };
  }

  allAgentStatuses(): BudgetStatus[] {
    return [...this.agentCaps.keys()].map(id => this.agentStatus(id)!);
  }

  // ── Report ───────────────────────────────────────────────────────────────

  report(): string {
    const g = this.globalStatus();
    const agents = this.allAgentStatuses();

    const bar = (pct: number, width = 20): string => {
      const filled = Math.round((pct / 100) * width);
      return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
    };

    const lines = [
      `╔══════════ x402 Budget Tracker ══════════╗`,
      `  Global  ${bar(g.usedPct)}  ${g.usedPct}%  $${(g.usedCents/100).toFixed(2)} / $${(g.capCents/100).toFixed(2)}`,
    ];

    if (agents.length > 0) {
      lines.push(``);
      lines.push(`  Agents:`);
      for (const a of agents) {
        const id = a.scope.replace("agent:", "").slice(0, 24).padEnd(24);
        lines.push(`    ${id}  ${bar(a.usedPct, 12)}  ${a.usedPct}%  ${a.breached ? "⚠ BREACHED" : ""}`);
      }
    }

    lines.push(`╚${"═".repeat(42)}╝`);
    return lines.join("\n");
  }
}
