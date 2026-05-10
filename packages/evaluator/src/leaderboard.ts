import type { EvaluationReport } from './scorer.js';

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  overallScore: number;
  grade: EvaluationReport['grade'];
  dimensions: { category: string; score: number }[];
  submittedAt: Date;
}

export interface LeaderboardSnapshot {
  suiteId: string;
  generatedAt: Date;
  totalEntries: number;
  entries: LeaderboardEntry[];
}

export class LeaderboardBuilder {
  private entries: Map<string, { report: EvaluationReport; agentName: string; submittedAt: Date }> = new Map();

  add(agentName: string, report: EvaluationReport, submittedAt: Date = new Date()): void {
    const existing = this.entries.get(report.agentId);
    if (!existing || report.overallScore > existing.report.overallScore) {
      this.entries.set(report.agentId, { report, agentName, submittedAt });
    }
  }

  build(suiteId: string): LeaderboardSnapshot {
    const sorted = [...this.entries.values()].sort((a, b) => b.report.overallScore - a.report.overallScore);
    const entries: LeaderboardEntry[] = sorted.map((e, idx) => ({ rank: idx + 1, agentId: e.report.agentId, agentName: e.agentName, overallScore: e.report.overallScore, grade: e.report.grade, dimensions: e.report.dimensions.map((d) => ({ category: d.category, score: d.rawScore })), submittedAt: e.submittedAt }));
    return { suiteId, generatedAt: new Date(), totalEntries: entries.length, entries };
  }

  getRank(agentId: string, suiteId: string): number | null {
    return this.build(suiteId).entries.find((e) => e.agentId === agentId)?.rank ?? null;
  }
}
