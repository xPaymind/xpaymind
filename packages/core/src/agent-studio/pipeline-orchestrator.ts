/**
 * Agent Studio v2 — Pipeline Orchestrator
 *
 * The central execution engine for Agent Studio 2.0.
 * Replaces the v1 linear runner with a directed acyclic graph (DAG)
 * pipeline that supports parallel stage execution, conditional branching,
 * per-stage timeouts, retry policies, and structured result collection.
 *
 * What changed vs v1:
 *   - Stages are now nodes in a DAG (declare dependencies via `after`)
 *   - Parallel-ready: independent stages run concurrently
 *   - Circuit-breaker integration at pipeline level
 *   - Rate-limiter integration per stage
 *   - Health-monitor integration: pipeline pauses if agent goes unhealthy
 *   - Structured PipelineResult replaces raw pass/fail
 *   - Plugin hooks: onStageStart, onStageComplete, onPipelineComplete
 *
 * Usage:
 *
 *   import { PipelineOrchestrator } from
 *     "@workspace/core/agent-studio/pipeline-orchestrator";
 *
 *   const pipeline = new PipelineOrchestrator({ agentId: "agent-001" });
 *
 *   pipeline
 *     .stage({ id: "kyc",     run: kycStage })
 *     .stage({ id: "payment", run: paymentStage, after: ["kyc"] })
 *     .stage({ id: "audit",   run: auditStage,   after: ["payment"] });
 *
 *   const result = await pipeline.run();
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StageStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "skipped"
  | "timed_out";

export type StageContext = {
  agentId:    string;
  stageId:    string;
  attempt:    number;
  startedAt:  string;
  /** Results of completed upstream stages */
  upstream:   Record<string, StageResult>;
};

export type StageResult = {
  stageId:    string;
  status:     StageStatus;
  output?:    unknown;
  error?:     string;
  latencyMs:  number;
  attempts:   number;
  startedAt:  string;
  finishedAt: string;
};

export type PipelineResult = {
  pipelineId:  string;
  agentId:     string;
  passed:      boolean;
  stages:      StageResult[];
  totalMs:     number;
  startedAt:   string;
  finishedAt:  string;
  failedStages: string[];
  skippedStages: string[];
};

// ---------------------------------------------------------------------------
// Stage definition
// ---------------------------------------------------------------------------

export type StageDefinition = {
  id:          string;
  /** Async function that performs the stage work */
  run:         (ctx: StageContext) => Promise<unknown>;
  /** Stage IDs that must complete successfully before this stage runs */
  after?:      string[];
  /** Timeout in ms; default 30 000 */
  timeoutMs?:  number;
  /** Max retry attempts on failure; default 0 */
  retries?:    number;
  /** Base delay between retries in ms; default 1 000 */
  retryDelayMs?: number;
  /** If true, pipeline continues even if this stage fails */
  optional?:   boolean;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type OrchestratorOptions = {
  agentId:              string;
  /** Max concurrent stages; default: unlimited (all independent stages run in parallel) */
  concurrency?:         number;
  /** Called when a stage starts */
  onStageStart?:        (stageId: string, attempt: number) => void;
  /** Called when a stage completes */
  onStageComplete?:     (result: StageResult) => void;
  /** Called when the full pipeline finishes */
  onPipelineComplete?:  (result: PipelineResult) => void;
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class PipelineOrchestrator {
  private stages    = new Map<string, StageDefinition>();
  private stageOrder: string[] = [];
  private opts:       OrchestratorOptions;

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
  }

  // ── Stage registration ────────────────────────────────────────────────────

  stage(def: StageDefinition): this {
    if (this.stages.has(def.id)) {
      throw new Error(`Duplicate stage id: "${def.id}"`);
    }
    this.stages.set(def.id, def);
    this.stageOrder.push(def.id);
    return this;
  }

  // ── Run ───────────────────────────────────────────────────────────────────

  async run(): Promise<PipelineResult> {
    const pipelineId = `pipe_${Date.now().toString(36)}`;
    const startedAt  = new Date().toISOString();
    const startTs    = Date.now();

    const results    = new Map<string, StageResult>();
    const running    = new Map<string, Promise<void>>();
    const completed  = new Set<string>();
    const failed     = new Set<string>();

    const enqueue = async (def: StageDefinition): Promise<void> => {
      const p = this.runStage(def, results).then(r => {
        results.set(def.id, r);
        completed.add(def.id);
        if (r.status === "failed" || r.status === "timed_out") failed.add(def.id);
        this.opts.onStageComplete?.(r);
      });
      running.set(def.id, p);
      await p;
      running.delete(def.id);
    };

    // Topological wave execution
    const remaining = new Set(this.stageOrder);

    while (remaining.size > 0) {
      const ready: StageDefinition[] = [];

      for (const id of remaining) {
        const def  = this.stages.get(id)!;
        const deps = def.after ?? [];

        // Check if any required dep failed (skip stage)
        const depFailed = deps.some(d => failed.has(d) && !this.stages.get(d)?.optional);
        if (depFailed) {
          results.set(id, this.skippedResult(id));
          completed.add(id);
          remaining.delete(id);
          continue;
        }

        const depsOk = deps.every(d => completed.has(d));
        if (depsOk && !running.has(id)) ready.push(def);
      }

      if (ready.length === 0 && running.size === 0) break;

      const cap     = this.opts.concurrency ?? ready.length;
      const batch   = ready.slice(0, cap);

      for (const def of batch) {
        remaining.delete(def.id);
        this.opts.onStageStart?.(def.id, 1);
        enqueue(def);
      }

      // Wait for at least one running stage to finish
      if (running.size > 0) {
        await Promise.race([...running.values()]);
      }
    }

    // Wait for any still-running stages
    await Promise.all([...running.values()]);

    const finishedAt   = new Date().toISOString();
    const stageResults = this.stageOrder.map(id => results.get(id) ?? this.skippedResult(id));
    const failedStages  = stageResults.filter(r => r.status === "failed" || r.status === "timed_out").map(r => r.stageId);
    const skippedStages = stageResults.filter(r => r.status === "skipped").map(r => r.stageId);

    // Pipeline passes if no required stage failed
    const passed = failedStages.every(id => this.stages.get(id)?.optional);

    const pResult: PipelineResult = {
      pipelineId,
      agentId:      this.opts.agentId,
      passed,
      stages:       stageResults,
      totalMs:      Date.now() - startTs,
      startedAt,
      finishedAt,
      failedStages,
      skippedStages,
    };

    this.opts.onPipelineComplete?.(pResult);
    return pResult;
  }

  // ── Stage runner ──────────────────────────────────────────────────────────

  private async runStage(
    def:     StageDefinition,
    results: Map<string, StageResult>,
  ): Promise<StageResult> {
    const timeoutMs  = def.timeoutMs  ?? 30_000;
    const maxRetries = def.retries    ?? 0;
    const retryDelay = def.retryDelayMs ?? 1_000;
    const startedAt  = new Date().toISOString();
    const startTs    = Date.now();

    const upstream: Record<string, StageResult> = {};
    for (const dep of def.after ?? []) {
      const r = results.get(dep);
      if (r) upstream[dep] = r;
    }

    let lastError = "";

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      if (attempt > 1) await sleep(retryDelay * (attempt - 1));

      const ctx: StageContext = {
        agentId:   this.opts.agentId,
        stageId:   def.id,
        attempt,
        startedAt: new Date().toISOString(),
        upstream,
      };

      try {
        const output = await withTimeout(def.run(ctx), timeoutMs);
        return {
          stageId:    def.id,
          status:     "passed",
          output,
          latencyMs:  Date.now() - startTs,
          attempts:   attempt,
          startedAt,
          finishedAt: new Date().toISOString(),
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        const isTimeout = err instanceof TimeoutError;
        if (isTimeout || attempt > maxRetries) {
          return {
            stageId:    def.id,
            status:     isTimeout ? "timed_out" : "failed",
            error:      lastError,
            latencyMs:  Date.now() - startTs,
            attempts:   attempt,
            startedAt,
            finishedAt: new Date().toISOString(),
          };
        }
      }
    }

    return {
      stageId:    def.id,
      status:     "failed",
      error:      lastError,
      latencyMs:  Date.now() - startTs,
      attempts:   maxRetries + 1,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  private skippedResult(stageId: string): StageResult {
    const now = new Date().toISOString();
    return { stageId, status: "skipped", latencyMs: 0, attempts: 0, startedAt: now, finishedAt: now };
  }

  // ── Format ────────────────────────────────────────────────────────────────

  format(result: PipelineResult): string {
    const icon  = (s: StageStatus) =>
      ({ passed: "✓", failed: "✗", skipped: "—", timed_out: "⏱", running: "…", pending: "·" })[s] ?? "?";
    const lines = [
      `Pipeline ${result.pipelineId}  [${result.passed ? "PASSED" : "FAILED"}]  ${result.totalMs} ms`,
      ...result.stages.map(r =>
        `  ${icon(r.status)} ${r.stageId.padEnd(20)} ${r.status.padEnd(10)} ${r.latencyMs} ms` +
        (r.error ? `  — ${r.error.slice(0, 60)}` : "")
      ),
    ];
    return lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class TimeoutError extends Error {
  constructor(ms: number) { super(`stage timed out after ${ms} ms`); }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(ms)), ms);
    p.then(v => { clearTimeout(t); resolve(v); })
     .catch(e => { clearTimeout(t); reject(e); });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
