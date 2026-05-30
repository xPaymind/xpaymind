/**
 * Agent Studio v2 — Test Harness
 *
 * Lightweight test framework for validating Agent Studio 2.0 pipelines
 * without a live x402 network.  Provides scenario mocking, assertion
 * helpers, snapshot diffing, and structured test reports.
 *
 * Key capabilities:
 *   - Mock any pipeline stage with deterministic fixtures
 *   - Simulate payment success / failure / timeout scenarios
 *   - Assert on PipelineResult, StageResult, AuditTrail, and Scoreboard
 *   - Capture all EventBus emissions during a test run
 *   - Snapshot testing: save a baseline PipelineResult and diff against it
 *   - Structured test report: JUnit-compatible XML + Markdown summary
 *
 * Designed to run in any test runner (vitest, jest, plain Node.js).
 *
 * Usage:
 *
 *   import { StudioTestHarness } from
 *     "@workspace/core/agent-studio/studio-test-harness";
 *
 *   const harness = new StudioTestHarness({ agentId: "test-agent" });
 *
 *   harness.mockStage("kyc",     async () => ({ verified: true }));
 *   harness.mockStage("payment", async () => ({ txHash: "abc123" }));
 *
 *   const result = await harness.run(myPipeline);
 *
 *   harness.assertPassed();
 *   harness.assertStagePassed("payment");
 *   harness.assertEventEmitted("payment.confirmed");
 *   harness.assertLatencyBelow("payment", 500);
 *
 *   console.log(harness.toMarkdown());
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MockFn = (ctx: MockStageCtx) => Promise<unknown>;

export type MockStageCtx = {
  stageId:  string;
  attempt:  number;
  upstream: Record<string, unknown>;
};

export type AssertionResult = {
  name:    string;
  passed:  boolean;
  message: string;
};

export type TestReport = {
  agentId:     string;
  runId:       string;
  startedAt:   string;
  finishedAt:  string;
  passed:      boolean;
  assertions:  AssertionResult[];
  passCount:   number;
  failCount:   number;
  pipelineResult?: PipelineTestResult;
  capturedEvents:  CapturedEvent[];
};

export type PipelineTestResult = {
  passed:       boolean;
  totalMs:      number;
  stages:       StageTestResult[];
  failedStages: string[];
};

export type StageTestResult = {
  stageId:   string;
  status:    string;
  latencyMs: number;
  output?:   unknown;
  error?:    string;
  mocked:    boolean;
};

export type CapturedEvent = {
  type:      string;
  payload:   unknown;
  emittedAt: string;
};

export type SnapshotDiff = {
  field:    string;
  baseline: unknown;
  actual:   unknown;
};

// ---------------------------------------------------------------------------
// Harness options
// ---------------------------------------------------------------------------

export type TestHarnessOptions = {
  agentId:      string;
  /** Timeout per stage in ms; default 5 000 */
  stageTimeoutMs?: number;
  /** Whether to throw on first assertion failure; default false */
  failFast?:    boolean;
};

// ---------------------------------------------------------------------------
// Test Harness
// ---------------------------------------------------------------------------

export class StudioTestHarness {
  private mocks       = new Map<string, MockFn>();
  private assertions: AssertionResult[] = [];
  private events:     CapturedEvent[]   = [];
  private result?:    PipelineTestResult;
  private snapshots   = new Map<string, unknown>();
  private startedAt   = new Date().toISOString();
  private opts:       Required<TestHarnessOptions>;

  constructor(opts: TestHarnessOptions) {
    this.opts = {
      agentId:       opts.agentId,
      stageTimeoutMs: opts.stageTimeoutMs ?? 5_000,
      failFast:       opts.failFast       ?? false,
    };
  }

  // ── Stage mocking ─────────────────────────────────────────────────────────

  mockStage(stageId: string, fn: MockFn): this {
    this.mocks.set(stageId, fn);
    return this;
  }

  mockStageSuccess(stageId: string, output: unknown = {}): this {
    return this.mockStage(stageId, async () => output);
  }

  mockStageFailure(stageId: string, error = "mock failure"): this {
    return this.mockStage(stageId, async () => { throw new Error(error); });
  }

  mockStageTimeout(stageId: string, delayMs?: number): this {
    const delay = delayMs ?? this.opts.stageTimeoutMs + 100;
    return this.mockStage(stageId, () =>
      new Promise(resolve => setTimeout(resolve, delay))
    );
  }

  // ── Payment scenario helpers ──────────────────────────────────────────────

  mockPaymentSuccess(txHash = "mock_tx_abc123"): this {
    return this.mockStageSuccess("payment", { txHash, status: 200 });
  }

  mockPaymentFailure(reason = "insufficient funds"): this {
    return this.mockStageFailure("payment", reason);
  }

  mockPayment402(challenge = "mock_402_challenge"): this {
    return this.mockStage("payment", async () => {
      const err: any = new Error("402 Payment Required");
      err.status    = 402;
      err.challenge = challenge;
      throw err;
    });
  }

  // ── Run pipeline under test ───────────────────────────────────────────────

  async run(
    buildPipeline: (harness: StudioTestHarness) => Promise<PipelineTestResult>
  ): Promise<PipelineTestResult> {
    this.assertions = [];
    this.events     = [];

    const pResult = await buildPipeline(this);
    this.result   = pResult;
    return pResult;
  }

  /** Resolve a mock for a stage (used by PipelineOrchestrator integration) */
  resolveMock(stageId: string): MockFn | undefined {
    return this.mocks.get(stageId);
  }

  /** Capture an event emission (wire to StudioEventBus.on("*", ...)) */
  captureEvent(type: string, payload: unknown): void {
    this.events.push({ type, payload, emittedAt: new Date().toISOString() });
  }

  // ── Assertions ────────────────────────────────────────────────────────────

  private assert(name: string, passed: boolean, message: string): void {
    const r: AssertionResult = { name, passed, message };
    this.assertions.push(r);
    if (!passed && this.opts.failFast) {
      throw new Error(`[StudioTestHarness] assertion failed: ${name} — ${message}`);
    }
  }

  assertPassed(): this {
    const ok = this.result?.passed ?? false;
    this.assert("pipeline.passed", ok, ok ? "pipeline passed" : "pipeline failed");
    return this;
  }

  assertFailed(): this {
    const ok = !(this.result?.passed ?? true);
    this.assert("pipeline.failed", ok, ok ? "pipeline failed as expected" : "pipeline unexpectedly passed");
    return this;
  }

  assertStagePassed(stageId: string): this {
    const stage = this.result?.stages.find(s => s.stageId === stageId);
    const ok    = stage?.status === "passed";
    this.assert(`stage.${stageId}.passed`, ok,
      ok ? `stage "${stageId}" passed` : `stage "${stageId}" status: ${stage?.status ?? "not found"}`
    );
    return this;
  }

  assertStageFailed(stageId: string): this {
    const stage = this.result?.stages.find(s => s.stageId === stageId);
    const ok    = stage?.status === "failed" || stage?.status === "timed_out";
    this.assert(`stage.${stageId}.failed`, ok,
      ok ? `stage "${stageId}" failed as expected` : `stage "${stageId}" status: ${stage?.status ?? "not found"}`
    );
    return this;
  }

  assertStageSkipped(stageId: string): this {
    const stage = this.result?.stages.find(s => s.stageId === stageId);
    const ok    = stage?.status === "skipped";
    this.assert(`stage.${stageId}.skipped`, ok,
      ok ? `stage "${stageId}" skipped` : `stage "${stageId}" status: ${stage?.status ?? "not found"}`
    );
    return this;
  }

  assertLatencyBelow(stageId: string, maxMs: number): this {
    const stage  = this.result?.stages.find(s => s.stageId === stageId);
    const actual = stage?.latencyMs ?? Infinity;
    const ok     = actual < maxMs;
    this.assert(`stage.${stageId}.latency`,  ok,
      ok ? `${stageId} latency ${actual} ms < ${maxMs} ms` : `${stageId} latency ${actual} ms ≥ ${maxMs} ms`
    );
    return this;
  }

  assertEventEmitted(type: string): this {
    const ok = this.events.some(e => e.type === type);
    this.assert(`event.${type}`, ok,
      ok ? `event "${type}" was emitted` : `event "${type}" was NOT emitted (captured: ${[...new Set(this.events.map(e => e.type))].join(", ")})`
    );
    return this;
  }

  assertEventCount(type: string, expected: number): this {
    const count = this.events.filter(e => e.type === type).length;
    const ok    = count === expected;
    this.assert(`event.${type}.count`, ok,
      ok ? `event "${type}" emitted ${count} times` : `event "${type}" emitted ${count} times, expected ${expected}`
    );
    return this;
  }

  // ── Snapshots ─────────────────────────────────────────────────────────────

  saveSnapshot(key: string, value: unknown): void {
    this.snapshots.set(key, JSON.parse(JSON.stringify(value)));
  }

  diffSnapshot(key: string, actual: unknown): SnapshotDiff[] {
    const baseline = this.snapshots.get(key);
    if (!baseline) return [];
    return this.deepDiff("", baseline, actual);
  }

  private deepDiff(path: string, a: unknown, b: unknown): SnapshotDiff[] {
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    if (typeof a !== "object" || typeof b !== "object" || !a || !b) {
      return [{ field: path, baseline: a, actual: b }];
    }
    const diffs: SnapshotDiff[] = [];
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      diffs.push(...this.deepDiff(path ? `${path}.${k}` : k, (a as any)[k], (b as any)[k]));
    }
    return diffs;
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  report(): TestReport {
    const passCount = this.assertions.filter(a => a.passed).length;
    const failCount = this.assertions.filter(a => !a.passed).length;
    return {
      agentId:        this.opts.agentId,
      runId:          `test_${Date.now().toString(36)}`,
      startedAt:      this.startedAt,
      finishedAt:     new Date().toISOString(),
      passed:         failCount === 0,
      assertions:     this.assertions,
      passCount,
      failCount,
      pipelineResult: this.result,
      capturedEvents: this.events,
    };
  }

  toMarkdown(): string {
    const r = this.report();
    const lines = [
      `# Agent Studio Test Report`,
      ``,
      `**Agent:** \`${r.agentId}\`  |  **Status:** ${r.passed ? "✅ PASS" : "❌ FAIL"}`,
      `**Assertions:** ${r.passCount} passed, ${r.failCount} failed`,
      ``,
      `## Assertions`,
      ``,
      `| # | Assertion | Result | Message |`,
      `|---|-----------|--------|---------|`,
      ...r.assertions.map((a, i) =>
        `| ${i + 1} | \`${a.name}\` | ${a.passed ? "✅" : "❌"} | ${a.message} |`
      ),
      ``,
      `## Captured Events (${r.capturedEvents.length})`,
      ``,
      ...r.capturedEvents.map(e => `- \`${e.type}\`  ${e.emittedAt.slice(11, 19)}`),
    ];
    return lines.join("\n");
  }

  toJUnitXml(): string {
    const r    = this.report();
    const cases = r.assertions.map(a =>
      a.passed
        ? `    <testcase name="${a.name}" />`
        : `    <testcase name="${a.name}">\n      <failure message="${a.message}" />\n    </testcase>`
    ).join("\n");
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<testsuite name="AgentStudio" tests="${r.assertions.length}" failures="${r.failCount}" time="${r.pipelineResult?.totalMs ?? 0}">`,
      cases,
      `</testsuite>`,
    ].join("\n");
  }
}
