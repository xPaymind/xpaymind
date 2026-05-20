/**
 * Agent Leaderboard
 *
 * Aggregates CertificationResult records into a ranked leaderboard.
 * Supports filtering by tier, agent type, and date range.
 */

import type { CertificationResult, CertificationTier } from "./agent-studio/agent-certify-block";
import { TIER_THRESHOLDS } from "./agent-studio/agent-certify-block";

export type LeaderboardEntry = {
  rank:           number;
  agentId:        string;
  tier:           CertificationTier;
  overallScore:   number;
  successRate:    number;
  avgLatencyMs:   number;
  totalPayments:  number;
  certifiedAt:    string;
};

export type LeaderboardFilter = {
  tier?:         CertificationTier;
  minScore?:     number;
  certifiedAfter?: string;  // ISO 8601
  certifiedBefore?: string; // ISO 8601
  limit?:        number;
};

export type Leaderboard = {
  generatedAt:  string;
  totalAgents:  number;
  entries:      LeaderboardEntry[];
  filter:       LeaderboardFilter;
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Composite score weights latency improvement into the raw benchmark score.
 * Agents with sub-1000 ms average latency earn a small bonus.
 */
function compositeScore(cert: CertificationResult): number {
  const latencyBonus = cert.avgLatencyMs < 1000 ? 2 : 0;
  return Math.min(100, cert.overallScore + latencyBonus);
}

// ---------------------------------------------------------------------------
// Build leaderboard
// ---------------------------------------------------------------------------

export function buildLeaderboard(
  certifications: CertificationResult[],
  filter: LeaderboardFilter = {}
): Leaderboard {
  let results = [...certifications];

  // Apply filters
  if (filter.tier) {
    results = results.filter(c => c.tier === filter.tier);
  }
  if (filter.minScore !== undefined) {
    results = results.filter(c => c.overallScore >= (filter.minScore ?? 0));
  }
  if (filter.certifiedAfter) {
    const after = new Date(filter.certifiedAfter).getTime();
    results = results.filter(c => new Date(c.certifiedAt).getTime() >= after);
  }
  if (filter.certifiedBefore) {
    const before = new Date(filter.certifiedBefore).getTime();
    results = results.filter(c => new Date(c.certifiedAt).getTime() <= before);
  }

  // Sort by composite score descending, break ties by latency ascending
  results.sort((a, b) => {
    const scoreDiff = compositeScore(b) - compositeScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.avgLatencyMs - b.avgLatencyMs;
  });

  // Apply limit
  if (filter.limit) {
    results = results.slice(0, filter.limit);
  }

  const entries: LeaderboardEntry[] = results.map((cert, idx) => ({
    rank:          idx + 1,
    agentId:       cert.agentId,
    tier:          cert.tier,
    overallScore:  cert.overallScore,
    successRate:   cert.successRate,
    avgLatencyMs:  cert.avgLatencyMs,
    totalPayments: cert.totalPayments,
    certifiedAt:   cert.certifiedAt,
  }));

  return {
    generatedAt: new Date().toISOString(),
    totalAgents: certifications.length,
    entries,
    filter,
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export type LeaderboardStats = {
  topScore:        number;
  medianScore:     number;
  tierDistribution: Record<CertificationTier, number>;
  avgSuccessRate:  number;
  avgLatencyMs:    number;
};

export function computeStats(leaderboard: Leaderboard): LeaderboardStats {
  const entries = leaderboard.entries;
  if (entries.length === 0) {
    return {
      topScore: 0,
      medianScore: 0,
      tierDistribution: { unrated: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 },
      avgSuccessRate: 0,
      avgLatencyMs: 0,
    };
  }

  const scores  = entries.map(e => e.overallScore).sort((a, b) => b - a);
  const mid     = Math.floor(scores.length / 2);
  const median  = scores.length % 2 === 0
    ? (scores[mid - 1] + scores[mid]) / 2
    : scores[mid];

  const tierDist = { unrated: 0, bronze: 0, silver: 0, gold: 0, platinum: 0 } as Record<CertificationTier, number>;
  entries.forEach(e => { tierDist[e.tier]++; });

  const avgSuccessRate = Math.round(
    entries.reduce((s, e) => s + e.successRate, 0) / entries.length * 10
  ) / 10;

  const avgLatencyMs = Math.round(
    entries.reduce((s, e) => s + e.avgLatencyMs, 0) / entries.length
  );

  return {
    topScore:         scores[0],
    medianScore:      median,
    tierDistribution: tierDist,
    avgSuccessRate,
    avgLatencyMs,
  };
}

export function formatLeaderboard(lb: Leaderboard): string {
  const lines = [
    `╔═══ xPaymind Agent Leaderboard — ${lb.generatedAt.slice(0, 10)} ═══╗`,
    `  Total agents: ${lb.totalAgents}  ·  Showing: ${lb.entries.length}`,
    ``,
    `  Rank  Agent ID                Score   Tier       SuccessRate  AvgLatency`,
    `  ────  ──────────────────────  ──────  ─────────  ───────────  ──────────`,
  ];
  lb.entries.forEach(e => {
    lines.push(
      `  ${String(e.rank).padStart(4)}  ${e.agentId.slice(0, 22).padEnd(22)}  `
      + `${String(e.overallScore).padStart(5)}%  ${e.tier.padEnd(9)}  `
      + `${String(e.successRate).padStart(10)}%  ${String(e.avgLatencyMs).padStart(8)} ms`
    );
  });
  lines.push(`╚${"═".repeat(66)}╝`);
  return lines.join("\n");
}
