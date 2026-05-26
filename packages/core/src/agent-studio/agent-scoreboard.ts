/**
 * Agent Scoreboard
 *
 * Maintains a real-time ranked scoreboard of AI agents across all
 * benchmark runs.  Scores are derived from the benchmark suite results
 * and decay over time to favour recent performance.
 *
 * Key concepts:
 *   - Elo-style rating with time-decay (configurable half-life)
 *   - Separate sub-scores per capability domain:
 *       x402, kyc, risk, budget, retry, webhook
 *   - Badge system: "pioneer", "speed-demon", "iron-agent", "budget-master"
 *   - Leaderboard snapshots exportable as JSON or Markdown table
 *
 * Usage:
 *
 *   import { AgentScoreboard } from "@workspace/core/agent-studio/agent-scoreboard";
 *
 *   const board = new AgentScoreboard();
 *   board.record(benchmarkResult);
 *   console.log(board.toMarkdown());
 */

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type CapabilityDomain =
  | "x402"
  | "kyc"
  | "risk"
  | "budget"
  | "retry"
  | "webhook"
  | "direct_debit"
  | "audit";

export type Badge =
  | "pioneer"        // first agent registered on the board
  | "speed-demon"    // median latency < 200 ms
  | "iron-agent"     // 100 consecutive successful runs
  | "budget-master"  // never breached budget in 50+ runs
  | "all-rounder"    // top-10% in every domain
  | "chain-keeper";  // 100% audit trail integrity across all runs

export type DomainScore = {
  domain:     CapabilityDomain;
  score:      number;    // 0 – 1000
  runs:       number;
  passed:     number;
  lastRunAt:  string;
};

export type AgentEntry = {
  agentId:       string;
  agentName:     string;
  version:       string;
  totalScore:    number;   // weighted sum of domain scores
  rank:          number;
  domainScores:  DomainScore[];
  badges:        Badge[];
  totalRuns:     number;
  passRate:      number;   // 0 – 1
  medianLatencyMs: number;
  registeredAt:  string;
  lastActiveAt:  string;
};

// ---------------------------------------------------------------------------
// Benchmark result shape expected from the suite
// ---------------------------------------------------------------------------

export type BenchmarkResult = {
  agentId:       string;
  agentName:     string;
  version:       string;
  runId:         string;
  runAt:         string;
  passed:        boolean;
  domain:        CapabilityDomain;
  score:         number;           // 0 – 100 raw
  latencyMs:     number;
  budgetBreached: boolean;
  auditValid:    boolean;
  consecutiveOk: number;
};

// ---------------------------------------------------------------------------
// Scoreboard options
// ---------------------------------------------------------------------------

export type ScoreboardOptions = {
  /** Half-life for score decay in milliseconds; default 7 days */
  halfLifeMs?: number;
  /** Domain weight map; missing domains default to 1 */
  weights?:    Partial<Record<CapabilityDomain, number>>;
  /** Max entries shown in toMarkdown() */
  topN?:       number;
};

const DEFAULT_WEIGHTS: Record<CapabilityDomain, number> = {
  x402: 3, kyc: 2, risk: 2, budget: 2, retry: 1, webhook: 1, direct_debit: 1, audit: 2,
};

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

export class AgentScoreboard {
  private agents    = new Map<string, AgentEntry>();
  private history   = new Map<string, BenchmarkResult[]>();
  private opts:       Required<ScoreboardOptions>;
  private createdAt = new Date().toISOString();
  private pioneer:    string | null = null;

  constructor(opts: ScoreboardOptions = {}) {
    this.opts = {
      halfLifeMs: opts.halfLifeMs ?? 7 * 24 * 60 * 60 * 1000,
      weights:    { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) },
      topN:       opts.topN ?? 25,
    };
  }

  // ── Record a benchmark result ─────────────────────────────────────────────

  record(result: BenchmarkResult): void {
    const history = this.history.get(result.agentId) ?? [];
    history.push(result);
    this.history.set(result.agentId, history);

    const existing = this.agents.get(result.agentId);
    const entry    = existing ?? this.newEntry(result);

    // Update domain score
    this.updateDomain(entry, result);

    // Update aggregate stats
    const allRuns       = history;
    entry.totalRuns     = allRuns.length;
    entry.passRate      = allRuns.filter(r => r.passed).length / allRuns.length;
    entry.medianLatencyMs = this.median(allRuns.map(r => r.latencyMs));
    entry.lastActiveAt  = result.runAt;
    entry.totalScore    = this.computeTotal(entry);
    entry.badges        = this.computeBadges(entry, history);

    this.agents.set(result.agentId, entry);
    this.rerank();
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private newEntry(r: BenchmarkResult): AgentEntry {
    const entry: AgentEntry = {
      agentId:         r.agentId,
      agentName:       r.agentName,
      version:         r.version,
      totalScore:      0,
      rank:            0,
      domainScores:    [],
      badges:          [],
      totalRuns:       0,
      passRate:        0,
      medianLatencyMs: 0,
      registeredAt:    r.runAt,
      lastActiveAt:    r.runAt,
    };
    if (!this.pioneer) {
      this.pioneer = r.agentId;
      entry.badges.push("pioneer");
    }
    return entry;
  }

  private updateDomain(entry: AgentEntry, r: BenchmarkResult): void {
    let ds = entry.domainScores.find(d => d.domain === r.domain);
    if (!ds) {
      ds = { domain: r.domain, score: 0, runs: 0, passed: 0, lastRunAt: r.runAt };
      entry.domainScores.push(ds);
    }
    // Elo-lite: weighted moving average with time-decay
    const age    = Date.now() - new Date(r.runAt).getTime();
    const decay  = Math.pow(0.5, age / this.opts.halfLifeMs);
    const scaled = r.score * 10 * decay;   // 0–1000
    ds.score     = ds.runs === 0 ? scaled : (ds.score * 0.8 + scaled * 0.2);
    ds.runs     += 1;
    ds.passed   += r.passed ? 1 : 0;
    ds.lastRunAt = r.runAt;
  }

  private computeTotal(entry: AgentEntry): number {
    let num = 0, den = 0;
    for (const ds of entry.domainScores) {
      const w = (this.opts.weights as Record<string, number>)[ds.domain] ?? 1;
      num += ds.score * w;
      den += w;
    }
    return den === 0 ? 0 : Math.round(num / den);
  }

  private computeBadges(entry: AgentEntry, history: BenchmarkResult[]): Badge[] {
    const badges = new Set(entry.badges);

    if (entry.medianLatencyMs < 200)          badges.add("speed-demon");
    if (entry.passRate === 1 && entry.totalRuns >= 100) {
      const tail = history.slice(-100);
      if (tail.every(r => r.passed))           badges.add("iron-agent");
    }
    if (history.every(r => !r.budgetBreached) && history.length >= 50)
                                               badges.add("budget-master");
    if (history.every(r => r.auditValid))      badges.add("chain-keeper");

    const domainSet = new Set(entry.domainScores.map(d => d.domain));
    const top10 = this.topPercent(entry.totalScore, 0.1);
    if (domainSet.size >= 5 && top10)          badges.add("all-rounder");

    return [...badges];
  }

  private topPercent(score: number, pct: number): boolean {
    const scores = [...this.agents.values()].map(a => a.totalScore).sort((a, b) => b - a);
    const cutoff = Math.ceil(scores.length * pct);
    return scores.slice(0, cutoff).includes(score);
  }

  private rerank(): void {
    const sorted = [...this.agents.values()].sort((a, b) => b.totalScore - a.totalScore);
    sorted.forEach((a, i) => { a.rank = i + 1; });
  }

  private median(nums: number[]): number {
    if (nums.length === 0) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
  }

  // ── Public API ────────────────────────────────────────────────────────────

  leaderboard(n = this.opts.topN): AgentEntry[] {
    return [...this.agents.values()]
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, n);
  }

  get(agentId: string): AgentEntry | undefined {
    return this.agents.get(agentId);
  }

  toJSON(n = this.opts.topN): string {
    return JSON.stringify({ createdAt: this.createdAt, leaderboard: this.leaderboard(n) }, null, 2);
  }

  toMarkdown(n = this.opts.topN): string {
    const rows = this.leaderboard(n);
    const lines = [
      `# xPaymind Agent Leaderboard`,
      ``,
      `> Updated: ${new Date().toISOString()}  |  Total agents: ${this.agents.size}`,
      ``,
      `| Rank | Agent | Version | Score | Pass% | Median Latency | Badges |`,
      `|------|-------|---------|------:|------:|---------------:|--------|`,
      ...rows.map(a =>
        `| ${a.rank} | ${a.agentName} | ${a.version} | ${a.totalScore} ` +
        `| ${(a.passRate * 100).toFixed(1)}% | ${a.medianLatencyMs.toFixed(0)} ms ` +
        `| ${a.badges.join(", ") || "—"} |`
      ),
    ];
    return lines.join("\n");
  }
}
