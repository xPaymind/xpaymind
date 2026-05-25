/**
 * Banking Integration — Direct Debit Scheduler
 *
 * Manages recurring bank payment mandates (direct debits, standing orders,
 * subscription charges) for AI agents operating in the banking domain.
 *
 * Supports:
 *   - Mandate creation and cancellation
 *   - Flexible cadences: daily / weekly / monthly / custom-interval
 *   - Per-mandate spending caps with auto-pause on breach
 *   - Execution history and next-run forecasting
 *   - Integration hooks for x402 subscription scheme
 *
 * Usage:
 *
 *   import { DirectDebitScheduler } from "@workspace/core/banking/direct-debit-scheduler";
 *
 *   const scheduler = new DirectDebitScheduler();
 *
 *   const mandate = scheduler.create({
 *     agentId:        "treasury-agent-001",
 *     description:    "Monthly SaaS subscription",
 *     amountCents:    2999,
 *     currency:       "USD",
 *     destination:    "GB29NWBK60161331926819",
 *     cadence:        "monthly",
 *     startDate:      "2026-06-01",
 *     maxExecutions:  12,
 *   });
 *
 *   scheduler.start();
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Cadence = "daily" | "weekly" | "monthly" | "custom";

export type MandateStatus =
  | "active"
  | "paused"
  | "cancelled"
  | "completed"   // maxExecutions reached
  | "failed";     // terminal failure after retries

export type MandateExecution = {
  executionId:   string;
  mandateId:     string;
  scheduledAt:   string;
  executedAt:    string | null;
  amountCents:   number;
  status:        "pending" | "succeeded" | "failed" | "skipped";
  error?:        string;
};

export type DebitMandate = {
  mandateId:      string;
  agentId:        string;
  description:    string;
  amountCents:    number;
  currency:       string;
  destination:    string;
  cadence:        Cadence;
  /** Interval in ms when cadence = "custom" */
  customIntervalMs?: number;
  startDate:      string;    // ISO 8601 date
  endDate?:       string;    // ISO 8601 date; run indefinitely if omitted
  maxExecutions?: number;
  /** Cumulative spend cap in cents; mandate auto-pauses on breach */
  totalCapCents?: number;
  status:         MandateStatus;
  createdAt:      string;
  nextRunAt:      string | null;
  executionCount: number;
  totalSpentCents: number;
  executions:     MandateExecution[];
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type SchedulerOptions = {
  /** Polling interval in ms; defaults to 60 000 (1 min) */
  pollIntervalMs?: number;
  /** Called before each execution — return false to skip this run */
  onBeforeExecute?: (mandate: DebitMandate) => Promise<boolean>;
  /** Called after a successful execution */
  onExecuted?: (mandate: DebitMandate, exec: MandateExecution) => void;
  /** Called when a mandate is auto-paused (cap breach) or fails */
  onStatusChange?: (mandate: DebitMandate, prev: MandateStatus) => void;
  /** Pluggable executor — replace with real bank API call in production */
  executor?: (mandate: DebitMandate) => Promise<{ succeeded: boolean; error?: string }>;
};

export type CreateMandateOpts = Omit<
  DebitMandate,
  "mandateId" | "status" | "createdAt" | "nextRunAt" |
  "executionCount" | "totalSpentCents" | "executions"
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function addCadence(from: Date, cadence: Cadence, customMs?: number): Date {
  const d = new Date(from);
  switch (cadence) {
    case "daily":   d.setUTCDate(d.getUTCDate() + 1);   break;
    case "weekly":  d.setUTCDate(d.getUTCDate() + 7);   break;
    case "monthly": d.setUTCMonth(d.getUTCMonth() + 1); break;
    case "custom":  return new Date(d.getTime() + (customMs ?? 86_400_000)); break;
  }
  return d;
}

// Default executor stub — replace with Open Banking payment initiation API
async function defaultExecutor(
  _mandate: DebitMandate
): Promise<{ succeeded: boolean; error?: string }> {
  // Simulate 95 % success rate in stub mode
  const ok = Math.random() > 0.05;
  return ok
    ? { succeeded: true }
    : { succeeded: false, error: "simulated execution failure" };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class DirectDebitScheduler {
  private mandates = new Map<string, DebitMandate>();
  private timer:    ReturnType<typeof setInterval> | null = null;
  private running   = false;
  private opts:     SchedulerOptions;

  constructor(opts: SchedulerOptions = {}) {
    this.opts = opts;
  }

  // ── Mandate management ───────────────────────────────────────────────────

  create(opts: CreateMandateOpts): DebitMandate {
    const startDate = new Date(opts.startDate);
    const mandate: DebitMandate = {
      ...opts,
      mandateId:       generateId("mnd"),
      status:          "active",
      createdAt:       new Date().toISOString(),
      nextRunAt:       startDate.toISOString(),
      executionCount:  0,
      totalSpentCents: 0,
      executions:      [],
    };
    this.mandates.set(mandate.mandateId, mandate);
    return mandate;
  }

  cancel(mandateId: string): DebitMandate {
    const m = this.get(mandateId);
    this.transition(m, "cancelled");
    m.nextRunAt = null;
    return m;
  }

  pause(mandateId: string): DebitMandate {
    const m = this.get(mandateId);
    this.transition(m, "paused");
    return m;
  }

  resume(mandateId: string): DebitMandate {
    const m = this.get(mandateId);
    if (m.status !== "paused") throw new Error(`Mandate ${mandateId} is not paused`);
    this.transition(m, "active");
    m.nextRunAt = new Date().toISOString(); // run at next poll
    return m;
  }

  get(mandateId: string): DebitMandate {
    const m = this.mandates.get(mandateId);
    if (!m) throw new Error(`Mandate ${mandateId} not found`);
    return m;
  }

  listActive(): DebitMandate[] {
    return [...this.mandates.values()].filter(m => m.status === "active");
  }

  // ── Run loop ─────────────────────────────────────────────────────────────

  start(): this {
    if (this.running) return this;
    this.running = true;
    this.timer   = setInterval(() => void this.tick(), this.opts.pollIntervalMs ?? 60_000);
    return this;
  }

  stop(): this {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.running = false;
    return this;
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const mandate of this.listActive()) {
      if (!mandate.nextRunAt) continue;
      if (new Date(mandate.nextRunAt).getTime() > now) continue;
      await this.executeMandate(mandate);
    }
  }

  private async executeMandate(mandate: DebitMandate): Promise<void> {
    // Pre-execution hook
    if (this.opts.onBeforeExecute) {
      const proceed = await this.opts.onBeforeExecute(mandate);
      if (!proceed) {
        this.advanceNextRun(mandate);
        return;
      }
    }

    const exec: MandateExecution = {
      executionId: generateId("exc"),
      mandateId:   mandate.mandateId,
      scheduledAt: mandate.nextRunAt!,
      executedAt:  null,
      amountCents: mandate.amountCents,
      status:      "pending",
    };

    mandate.executions.push(exec);

    const executor = this.opts.executor ?? defaultExecutor;

    try {
      const result    = await executor(mandate);
      exec.executedAt = new Date().toISOString();

      if (result.succeeded) {
        exec.status              = "succeeded";
        mandate.executionCount++;
        mandate.totalSpentCents += mandate.amountCents;
        this.opts.onExecuted?.(mandate, exec);

        // Check total cap
        if (mandate.totalCapCents && mandate.totalSpentCents >= mandate.totalCapCents) {
          this.transition(mandate, "paused");
          mandate.nextRunAt = null;
          return;
        }

        // Check max executions
        if (mandate.maxExecutions && mandate.executionCount >= mandate.maxExecutions) {
          this.transition(mandate, "completed");
          mandate.nextRunAt = null;
          return;
        }

        this.advanceNextRun(mandate);
      } else {
        exec.status = "failed";
        exec.error  = result.error;
        this.advanceNextRun(mandate); // retry on next cycle
      }
    } catch (err) {
      exec.executedAt = new Date().toISOString();
      exec.status     = "failed";
      exec.error      = err instanceof Error ? err.message : String(err);
      this.advanceNextRun(mandate);
    }
  }

  private advanceNextRun(mandate: DebitMandate): void {
    if (!mandate.nextRunAt) return;
    const next = addCadence(
      new Date(mandate.nextRunAt),
      mandate.cadence,
      mandate.customIntervalMs
    );
    if (mandate.endDate && next > new Date(mandate.endDate)) {
      this.transition(mandate, "completed");
      mandate.nextRunAt = null;
    } else {
      mandate.nextRunAt = next.toISOString();
    }
  }

  private transition(mandate: DebitMandate, next: MandateStatus): void {
    const prev     = mandate.status;
    mandate.status = next;
    this.opts.onStatusChange?.(mandate, prev);
  }

  // ── Forecast ──────────────────────────────────────────────────────────────

  forecast(mandateId: string, runs: number = 5): string[] {
    const m = this.get(mandateId);
    if (!m.nextRunAt) return [];
    const dates: string[] = [];
    let current = new Date(m.nextRunAt);
    for (let i = 0; i < runs; i++) {
      dates.push(current.toISOString());
      current = addCadence(current, m.cadence, m.customIntervalMs);
      if (m.endDate && current > new Date(m.endDate)) break;
    }
    return dates;
  }

  summary(): string {
    const all     = [...this.mandates.values()];
    const active  = all.filter(m => m.status === "active").length;
    const paused  = all.filter(m => m.status === "paused").length;
    const done    = all.filter(m => ["completed","cancelled"].includes(m.status)).length;
    const total$  = (all.reduce((s, m) => s + m.totalSpentCents, 0) / 100).toFixed(2);
    return (
      `DirectDebitScheduler — mandates: ${all.length} ` +
      `(active: ${active}, paused: ${paused}, done: ${done}) | ` +
      `total disbursed: $${total$}`
    );
  }
}
