/**
 * Benchmark Report Generator
 *
 * Aggregates raw benchmark run results from the x402 benchmark suite
 * and produces structured reports in multiple formats:
 *
 *   - JSON  : machine-readable full report with per-scenario breakdown
 *   - Markdown : GitHub-ready table suitable for README / wiki
 *   - ANSI terminal summary : coloured pass/fail overview for CI logs
 *
 * Reports cover:
 *   - Overall pass rate and score distribution
 *   - Per-scenario timing (p50 / p95 / p99 latency)
 *   - Failure analysis grouped by error type
 *   - Regression delta vs. a previous baseline report
 *   - Badge eligibility summary (ties into AgentScoreboard)
 *
 * Usage:
 *
 *   import { BenchmarkReportGenerator } from
 *     "@workspace/evaluator/benchmark-report-generator";
 *
 *   const gen = new BenchmarkReportGenerator({ agentId: "agent-001" });
 *   gen.add(runResult);
 *   gen.add(runResult2);
 *
 *   console.log(gen.toMarkdown());
 *   fs.writeFileSync("report.json", gen.toJSON());
 */

// ---------------------------------------------------------------------------
// Input types (aligned with x402-benchmark-suite output)
// ---------------------------------------------------------------------------

export type ScenarioOutcome = {
  scenarioId:    string;
  scenarioName:  string;
  passed:        boolean;
  score:         number;        // 0 – 100
  latencyMs:     number;
  errorType?:    string;
  errorMessage?: string;
  retries:       number;
  budgetUsedCents: number;
};

export type BenchmarkRunResult = {
  runId:       string;
  agentId:     string;
  agentName:   string;
  version:     string;
  startedAt:   string;
  finishedAt:  string;
  scenarios:   ScenarioOutcome[];
  auditValid:  boolean;
};

// ---------------------------------------------------------------------------
// Internal aggregates
// ---------------------------------------------------------------------------

type ScenarioStats = {
  scenarioId:   string;
  scenarioName: string;
  runs:         number;
  passed:       number;
  scores:       number[];
  latencies:    number[];
  errorCounts:  Record<string, number>;
  totalRetries: number;
  totalBudgetCents: number;
};

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type ReportOptions = {
  agentId:       string;
  /** Optional baseline to compute regression delta */
  baseline?:     ReportSummary;
  /** Top-N slowest scenarios to highlight */
  topSlowN?:     number;
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type ScenarioReport = {
  scenarioId:    string;
  scenarioName:  string;
  runs:          number;
  passRate:      number;
  avgScore:      number;
  p50Ms:         number;
  p95Ms:         number;
  p99Ms:         number;
  topErrors:     Array<{ type: string; count: number }>;
  avgRetries:    number;
  avgBudgetCents: number;
};

export type ReportSummary = {
  agentId:       string;
  generatedAt:   string;
  totalRuns:     number;
  totalScenarios: number;
  overallPassRate: number;
  overallAvgScore: number;
  p50LatencyMs:  number;
  p95LatencyMs:  number;
  p99LatencyMs:  number;
  auditIntegrity: number;   // fraction of runs with valid audit trail
  scenarios:     ScenarioReport[];
  /** Delta vs baseline (positive = improvement) */
  scoreDelta?:   number;
  passRateDelta?: number;
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export class BenchmarkReportGenerator {
  private runs:  BenchmarkRunResult[] = [];
  private stats  = new Map<string, ScenarioStats>();
  private opts:  ReportOptions;

  constructor(opts: ReportOptions) {
    this.opts = opts;
  }

  // ── Ingest ────────────────────────────────────────────────────────────────

  add(run: BenchmarkRunResult): void {
    if (run.agentId !== this.opts.agentId) return;
    this.runs.push(run);
    for (const sc of run.scenarios) {
      this.accumulate(sc);
    }
  }

  private accumulate(sc: ScenarioOutcome): void {
    let s = this.stats.get(sc.scenarioId);
    if (!s) {
      s = {
        scenarioId: sc.scenarioId, scenarioName: sc.scenarioName,
        runs: 0, passed: 0, scores: [], latencies: [],
        errorCounts: {}, totalRetries: 0, totalBudgetCents: 0,
      };
      this.stats.set(sc.scenarioId, s);
    }
    s.runs++;
    if (sc.passed) s.passed++;
    s.scores.push(sc.score);
    s.latencies.push(sc.latencyMs);
    s.totalRetries     += sc.retries;
    s.totalBudgetCents += sc.budgetUsedCents;
    if (sc.errorType) {
      s.errorCounts[sc.errorType] = (s.errorCounts[sc.errorType] ?? 0) + 1;
    }
  }

  // ── Build summary ─────────────────────────────────────────────────────────

  summary(): ReportSummary {
    const allLatencies: number[] = [];
    const allScores:    number[] = [];
    let auditOk = 0;

    for (const r of this.runs) {
      if (r.auditValid) auditOk++;
      for (const sc of r.scenarios) {
        allLatencies.push(sc.latencyMs);
        allScores.push(sc.score);
      }
    }

    const sortedLat   = [...allLatencies].sort((a, b) => a - b);
    const sortedScore = [...allScores].sort((a, b) => a - b);

    const scenarioReports: ScenarioReport[] = [...this.stats.values()].map(s => {
      const sortedL = [...s.latencies].sort((a, b) => a - b);
      const topErrors = Object.entries(s.errorCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type, count]) => ({ type, count }));

      return {
        scenarioId:     s.scenarioId,
        scenarioName:   s.scenarioName,
        runs:           s.runs,
        passRate:       s.runs > 0 ? s.passed / s.runs : 0,
        avgScore:       s.scores.reduce((a, b) => a + b, 0) / (s.scores.length || 1),
        p50Ms:          pct(sortedL, 50),
        p95Ms:          pct(sortedL, 95),
        p99Ms:          pct(sortedL, 99),
        topErrors,
        avgRetries:     s.totalRetries / (s.runs || 1),
        avgBudgetCents: s.totalBudgetCents / (s.runs || 1),
      };
    });

    const totalScenarioRuns = allScores.length;
    const passedScenarios   = [...this.stats.values()].reduce((n, s) => n + s.passed, 0);

    const base = this.opts.baseline;
    const overallAvgScore = allScores.reduce((a, b) => a + b, 0) / (allScores.length || 1);
    const overallPassRate = totalScenarioRuns > 0 ? passedScenarios / totalScenarioRuns : 0;

    return {
      agentId:        this.opts.agentId,
      generatedAt:    new Date().toISOString(),
      totalRuns:      this.runs.length,
      totalScenarios: this.stats.size,
      overallPassRate,
      overallAvgScore,
      p50LatencyMs:   pct(sortedLat, 50),
      p95LatencyMs:   pct(sortedLat, 95),
      p99LatencyMs:   pct(sortedLat, 99),
      auditIntegrity: this.runs.length > 0 ? auditOk / this.runs.length : 1,
      scenarios:      scenarioReports,
      scoreDelta:     base ? overallAvgScore - base.overallAvgScore : undefined,
      passRateDelta:  base ? overallPassRate - base.overallPassRate : undefined,
    };
  }

  // ── Output formats ────────────────────────────────────────────────────────

  toJSON(): string {
    return JSON.stringify(this.summary(), null, 2);
  }

  toMarkdown(): string {
    const s = this.summary();
    const delta = s.scoreDelta !== undefined
      ? ` (Δ ${s.scoreDelta >= 0 ? "+" : ""}${s.scoreDelta.toFixed(1)})`
      : "";
    const lines = [
      `# x402 Benchmark Report`,
      ``,
      `**Agent:** \`${s.agentId}\`  |  **Generated:** ${s.generatedAt}`,
      ``,
      `## Summary`,
      ``,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total runs | ${s.totalRuns} |`,
      `| Scenarios | ${s.totalScenarios} |`,
      `| Pass rate | ${(s.overallPassRate * 100).toFixed(1)}%${s.passRateDelta !== undefined ? ` (Δ ${(s.passRateDelta * 100 >= 0 ? "+" : "")}${(s.passRateDelta * 100).toFixed(1)}pp)` : ""} |`,
      `| Avg score | ${s.overallAvgScore.toFixed(1)}${delta} |`,
      `| p50 latency | ${s.p50LatencyMs} ms |`,
      `| p95 latency | ${s.p95LatencyMs} ms |`,
      `| p99 latency | ${s.p99LatencyMs} ms |`,
      `| Audit integrity | ${(s.auditIntegrity * 100).toFixed(1)}% |`,
      ``,
      `## Scenarios`,
      ``,
      `| Scenario | Runs | Pass% | Avg Score | p50 | p95 | p99 | Avg Retries |`,
      `|----------|-----:|------:|----------:|----:|----:|----:|------------:|`,
      ...s.scenarios
        .sort((a, b) => b.avgScore - a.avgScore)
        .map(sc =>
          `| ${sc.scenarioName} | ${sc.runs} | ${(sc.passRate * 100).toFixed(0)}% ` +
          `| ${sc.avgScore.toFixed(1)} | ${sc.p50Ms} ms | ${sc.p95Ms} ms | ${sc.p99Ms} ms ` +
          `| ${sc.avgRetries.toFixed(2)} |`
        ),
    ];
    return lines.join("\n");
  }

  toANSI(): string {
    const s   = this.summary();
    const ok  = s.overallPassRate >= 0.95 ? "\x1b[32m✓ PASS\x1b[0m" : "\x1b[31m✗ FAIL\x1b[0m";
    const lines = [
      `\x1b[1m x402 Benchmark — ${s.agentId}\x1b[0m`,
      `  ${ok}  Pass: ${(s.overallPassRate * 100).toFixed(1)}%  Score: ${s.overallAvgScore.toFixed(1)}  p95: ${s.p95LatencyMs} ms`,
      `  Runs: ${s.totalRuns}  Scenarios: ${s.totalScenarios}  Audit: ${(s.auditIntegrity * 100).toFixed(0)}%`,
    ];
    return lines.join("\n");
  }
}
