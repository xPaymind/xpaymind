import type { EvaluationReport } from './scorer.js';

export interface ScoreTrend {
  agentId: string;
  direction: 'improving' | 'declining' | 'stable';
  deltaScore: number;
  snapshots: { score: number; grade: string; recordedAt: Date }[];
}

export function computeTrend(history: EvaluationReport[]): ScoreTrend | null {
  if (history.length < 2) return null;
  const sorted = [...history];
  const snapshots = sorted.map((r, i) => ({
    score: r.overallScore,
    grade: r.grade,
    recordedAt: new Date(Date.now() - (sorted.length - i) * 86_400_000),
  }));
  const first = snapshots[0]!.score;
  const last = snapshots[snapshots.length - 1]!.score;
  const deltaScore = Math.round((last - first) * 10) / 10;
  const direction =
    deltaScore > 1 ? 'improving' : deltaScore < -1 ? 'declining' : 'stable';
  return { agentId: history[0]!.agentId, direction, deltaScore, snapshots };
}
