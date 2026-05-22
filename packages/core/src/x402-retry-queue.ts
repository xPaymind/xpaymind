/**
 * x402 Retry Queue
 *
 * Queues failed x402 payment attempts for automatic retry with
 * exponential backoff.  Moves permanently failed jobs to a dead-letter
 * queue (DLQ) for manual inspection.
 *
 * Usage:
 *
 *   import { X402RetryQueue } from "@workspace/core/x402-retry-queue";
 *
 *   const queue = new X402RetryQueue({ maxAttempts: 5 });
 *
 *   queue.onRetry(async (job) => {
 *     const res = await x402Fetch(job.url, { wallet, ...job.fetchOptions });
 *     return res.ok;
 *   });
 *
 *   queue.enqueue({ url: "https://api.example.com/data", fetchOptions: {} });
 *   queue.start();
 */

import type { PaymentProof } from "./x402-types";

// ---------------------------------------------------------------------------
// Job types
// ---------------------------------------------------------------------------

export type RetryJobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "dead";

export type RetryJobAttempt = {
  attemptNumber: number;
  startedAt:     string;
  finishedAt:    string;
  succeeded:     boolean;
  error?:        string;
  /** Payment proof produced during this attempt, if any */
  proof?:        PaymentProof;
};

export type RetryJob = {
  jobId:          string;
  url:            string;
  fetchOptions:   Record<string, unknown>;
  status:         RetryJobStatus;
  attempts:       RetryJobAttempt[];
  nextRetryAt:    string | null;
  createdAt:      string;
  resolvedAt?:    string;
  /** Reason for DLQ placement */
  dlqReason?:     string;
};

// ---------------------------------------------------------------------------
// Queue options
// ---------------------------------------------------------------------------

export type RetryQueueOptions = {
  /** Maximum attempts before a job moves to DLQ; defaults to 4 */
  maxAttempts?:       number;
  /** Initial backoff in ms; doubles each attempt; defaults to 1 000 */
  initialBackoffMs?:  number;
  /** Cap on backoff in ms; defaults to 30 000 (30 s) */
  maxBackoffMs?:      number;
  /** Polling interval for the run loop in ms; defaults to 500 */
  pollIntervalMs?:    number;
  /** Max concurrent jobs; defaults to 3 */
  concurrency?:       number;
  onJobSucceeded?: (job: RetryJob) => void;
  onJobFailed?:    (job: RetryJob, error: Error) => void;
  onJobDead?:      (job: RetryJob) => void;
};

// ---------------------------------------------------------------------------
// Retry handler type
// ---------------------------------------------------------------------------

export type RetryHandler = (
  job: RetryJob
) => Promise<{ succeeded: boolean; proof?: PaymentProof; error?: string }>;

// ---------------------------------------------------------------------------
// Retry Queue
// ---------------------------------------------------------------------------

export class X402RetryQueue {
  private queue:   RetryJob[] = [];
  private dlq:     RetryJob[] = [];
  private running  = false;
  private timer:   ReturnType<typeof setInterval> | null = null;
  private handler: RetryHandler | null = null;
  private active   = new Set<string>();

  private maxAttempts:      number;
  private initialBackoffMs: number;
  private maxBackoffMs:     number;
  private pollIntervalMs:   number;
  private concurrency:      number;
  private opts:             RetryQueueOptions;

  constructor(opts: RetryQueueOptions = {}) {
    this.opts              = opts;
    this.maxAttempts       = opts.maxAttempts       ?? 4;
    this.initialBackoffMs  = opts.initialBackoffMs  ?? 1_000;
    this.maxBackoffMs      = opts.maxBackoffMs      ?? 30_000;
    this.pollIntervalMs    = opts.pollIntervalMs    ?? 500;
    this.concurrency       = opts.concurrency       ?? 3;
  }

  // ── Registration ─────────────────────────────────────────────────────────

  onRetry(handler: RetryHandler): this {
    this.handler = handler;
    return this;
  }

  // ── Enqueue ──────────────────────────────────────────────────────────────

  enqueue(opts: { url: string; fetchOptions?: Record<string, unknown> }): RetryJob {
    const job: RetryJob = {
      jobId:        `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      url:          opts.url,
      fetchOptions: opts.fetchOptions ?? {},
      status:       "pending",
      attempts:     [],
      nextRetryAt:  new Date().toISOString(),
      createdAt:    new Date().toISOString(),
    };
    this.queue.push(job);
    return job;
  }

  // ── Backoff calculation ───────────────────────────────────────────────────

  private backoffMs(attemptNumber: number): number {
    const ms = this.initialBackoffMs * Math.pow(2, attemptNumber - 1);
    return Math.min(ms, this.maxBackoffMs);
  }

  // ── Run loop ─────────────────────────────────────────────────────────────

  start(): this {
    if (this.running) return this;
    this.running = true;
    this.timer   = setInterval(() => void this.tick(), this.pollIntervalMs);
    return this;
  }

  stop(): this {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.running = false;
    return this;
  }

  private async tick(): Promise<void> {
    if (!this.handler) return;
    if (this.active.size >= this.concurrency) return;

    const now  = Date.now();
    const ready = this.queue.filter(
      j => j.status === "pending"
        && j.nextRetryAt !== null
        && new Date(j.nextRetryAt).getTime() <= now
        && !this.active.has(j.jobId)
    );

    for (const job of ready) {
      if (this.active.size >= this.concurrency) break;
      this.active.add(job.jobId);
      void this.runJob(job);
    }
  }

  private async runJob(job: RetryJob): Promise<void> {
    job.status = "running";
    const startedAt = new Date().toISOString();

    try {
      const result = await this.handler!(job);
      const finishedAt = new Date().toISOString();

      const attempt: RetryJobAttempt = {
        attemptNumber: job.attempts.length + 1,
        startedAt,
        finishedAt,
        succeeded:     result.succeeded,
        error:         result.error,
        proof:         result.proof,
      };
      job.attempts.push(attempt);

      if (result.succeeded) {
        job.status      = "succeeded";
        job.resolvedAt  = finishedAt;
        this.queue      = this.queue.filter(j => j.jobId !== job.jobId);
        this.opts.onJobSucceeded?.(job);
      } else {
        this.scheduleRetryOrDlq(job, result.error ?? "handler returned succeeded=false");
      }
    } catch (err) {
      const error      = err instanceof Error ? err.message : String(err);
      const finishedAt = new Date().toISOString();
      job.attempts.push({
        attemptNumber: job.attempts.length + 1,
        startedAt,
        finishedAt,
        succeeded:     false,
        error,
      });
      this.scheduleRetryOrDlq(job, error);
      this.opts.onJobFailed?.(job, err instanceof Error ? err : new Error(error));
    } finally {
      this.active.delete(job.jobId);
    }
  }

  private scheduleRetryOrDlq(job: RetryJob, reason: string): void {
    if (job.attempts.length >= this.maxAttempts) {
      job.status     = "dead";
      job.dlqReason  = reason;
      job.resolvedAt = new Date().toISOString();
      this.queue     = this.queue.filter(j => j.jobId !== job.jobId);
      this.dlq.push(job);
      this.opts.onJobDead?.(job);
    } else {
      const delayMs       = this.backoffMs(job.attempts.length);
      job.status          = "pending";
      job.nextRetryAt     = new Date(Date.now() + delayMs).toISOString();
    }
  }

  // ── Inspection ───────────────────────────────────────────────────────────

  pendingJobs(): RetryJob[]   { return this.queue.filter(j => j.status === "pending");   }
  runningJobs(): RetryJob[]   { return this.queue.filter(j => j.status === "running");   }
  deadLetterQueue(): RetryJob[] { return [...this.dlq]; }

  stats(): {
    pending: number;
    running: number;
    succeeded: number;
    dead: number;
  } {
    return {
      pending:   this.pendingJobs().length,
      running:   this.runningJobs().length,
      succeeded: 0,   // removed from queue on success; track externally if needed
      dead:      this.dlq.length,
    };
  }

  summary(): string {
    const s = this.stats();
    return (
      `X402RetryQueue — pending: ${s.pending}  running: ${s.running}  ` +
      `dead: ${s.dead}  concurrency: ${this.active.size}/${this.concurrency}`
    );
  }
}
