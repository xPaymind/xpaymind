/**
 * GET /v1/agents/:id/stats
 *
 * Returns aggregated scoring statistics for a single agent across all
 * submitted benchmark results — useful for rendering trend charts and
 * per-agent dashboards without requiring the client to aggregate raw results.
 *
 * Response shape:
 * {
 *   agentId: string
 *   totalRuns: number
 *   bestScore: number
 *   latestScore: number
 *   averageScore: number
 *   grade: string           // grade of the best run
 *   scoreHistory: Array<{ submittedAt: string; score: number }>
 *   categoryAverages: Record<string, number>
 * }
 */

import type { RequestHandler } from 'express';

interface ScoreHistoryPoint {
  submittedAt: string;
  score: number;
}

interface AgentStatsResponse {
  agentId: string;
  totalRuns: number;
  bestScore: number;
  latestScore: number;
  averageScore: number;
  grade: string;
  scoreHistory: ScoreHistoryPoint[];
  categoryAverages: Record<string, number>;
}

const GRADE_THRESHOLDS: Array<[number, string]> = [
  [95, 'S'],
  [85, 'A'],
  [75, 'B'],
  [60, 'C'],
  [45, 'D'],
];

function scoreToGrade(score: number): string {
  for (const [threshold, grade] of GRADE_THRESHOLDS) {
    if (score >= threshold) return grade;
  }
  return 'F';
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

interface StoredResult {
  agentId: string;
  overallScore: number;
  submittedAt: string;
  categoryScores: Record<string, number>;
}

const mockResults: Map<string, StoredResult[]> = new Map([
  [
    'demo-agent-v1',
    [
      {
        agentId: 'demo-agent-v1',
        overallScore: 72.4,
        submittedAt: '2026-05-01T10:00:00Z',
        categoryScores: {
          'protocol-compliance': 80,
          'payment-negotiation': 70,
          latency: 65,
          'cost-efficiency': 75,
          'error-recovery': 68,
        },
      },
      {
        agentId: 'demo-agent-v1',
        overallScore: 78.1,
        submittedAt: '2026-05-08T14:30:00Z',
        categoryScores: {
          'protocol-compliance': 85,
          'payment-negotiation': 75,
          latency: 72,
          'cost-efficiency': 78,
          'error-recovery': 70,
        },
      },
      {
        agentId: 'demo-agent-v1',
        overallScore: 81.6,
        submittedAt: '2026-05-16T09:00:00Z',
        categoryScores: {
          'protocol-compliance': 88,
          'payment-negotiation': 80,
          latency: 76,
          'cost-efficiency': 82,
          'error-recovery': 74,
        },
      },
    ],
  ],
]);

export const agentStatsHandler: RequestHandler<{ id: string }> = (req, res) => {
  const { id } = req.params;
  const results = mockResults.get(id);

  if (!results || results.length === 0) {
    res.status(404).json({ error: 'Agent not found or no benchmark results available' });
    return;
  }

  const scores = results.map((r) => r.overallScore);
  const bestScore = Math.max(...scores);
  const latestScore = scores[scores.length - 1] ?? 0;

  const categoryTotals: Record<string, number> = {};
  const categoryCount: Record<string, number> = {};
  for (const result of results) {
    for (const [cat, score] of Object.entries(result.categoryScores)) {
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + score;
      categoryCount[cat] = (categoryCount[cat] ?? 0) + 1;
    }
  }

  const categoryAverages: Record<string, number> = {};
  for (const cat of Object.keys(categoryTotals)) {
    categoryAverages[cat] =
      Math.round(((categoryTotals[cat] ?? 0) / (categoryCount[cat] ?? 1)) * 10) / 10;
  }

  const response: AgentStatsResponse = {
    agentId: id,
    totalRuns: results.length,
    bestScore,
    latestScore,
    averageScore: average(scores),
    grade: scoreToGrade(bestScore),
    scoreHistory: results.map((r) => ({ submittedAt: r.submittedAt, score: r.overallScore })),
    categoryAverages,
  };

  res.json(response);
};
