import type { BenchmarkResult, BenchmarkCategory, ScenarioResult } from '@xpaymind/core';

export interface ScoringWeights {
  'protocol-compliance': number;
  'payment-negotiation': number;
  latency: number;
  'cost-efficiency': number;
  'error-recovery': number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  'protocol-compliance': 0.30,
  'payment-negotiation': 0.25,
  latency: 0.20,
  'cost-efficiency': 0.15,
  'error-recovery': 0.10,
};

export interface DimensionScore {
  category: BenchmarkCategory;
  rawScore: number;
  weightedScore: number;
  weight: number;
  scenarioCount: number;
  passCount: number;
  avgLatencyMs: number;
}

export interface EvaluationReport {
  benchmarkId: string;
  agentId: string;
  overallScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  dimensions: DimensionScore[];
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  percentile: number | null;
}

export class BenchmarkScorer {
  constructor(private readonly weights: ScoringWeights = DEFAULT_WEIGHTS) {}

  evaluate(result: BenchmarkResult, historicalScores?: number[]): EvaluationReport {
    const dimensions = this.computeDimensions(result);
    const overallScore = this.computeOverallScore(dimensions);
    const grade = this.assignGrade(overallScore);
    const { strengths, weaknesses, recommendations } = this.generateInsights(dimensions);
    const percentile = historicalScores ? this.computePercentile(overallScore, historicalScores) : null;
    return { benchmarkId: result.id, agentId: result.agentId, overallScore, grade, dimensions, strengths, weaknesses, recommendations, percentile };
  }

  private computeDimensions(result: BenchmarkResult): DimensionScore[] {
    const grouped = new Map<BenchmarkCategory, ScenarioResult[]>();
    for (const sr of result.scenarioResults) {
      const cat = sr.scenario.category;
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(sr);
    }
    return (Object.keys(this.weights) as BenchmarkCategory[]).map((cat) => {
      const scenarios = grouped.get(cat) ?? [];
      const rawScore = scenarios.length > 0 ? scenarios.reduce((sum, s) => sum + s.score, 0) / scenarios.length : 0;
      const weight = this.weights[cat];
      return { category: cat, rawScore, weightedScore: rawScore * weight, weight, scenarioCount: scenarios.length, passCount: scenarios.filter((s) => s.successRate >= 0.8).length, avgLatencyMs: scenarios.length > 0 ? scenarios.reduce((sum, s) => sum + s.avgLatencyMs, 0) / scenarios.length : 0 };
    });
  }

  private computeOverallScore(dimensions: DimensionScore[]): number {
    return Math.round(dimensions.reduce((sum, d) => sum + d.weightedScore, 0) * 10) / 10;
  }

  private assignGrade(score: number): EvaluationReport['grade'] {
    if (score >= 95) return 'S';
    if (score >= 85) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 45) return 'D';
    return 'F';
  }

  private generateInsights(dimensions: DimensionScore[]): { strengths: string[]; weaknesses: string[]; recommendations: string[] } {
    const sorted = [...dimensions].sort((a, b) => b.rawScore - a.rawScore);
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];
    for (const d of sorted.slice(0, 2)) {
      if (d.rawScore >= 80) strengths.push(`Strong ${d.category} performance (${d.rawScore.toFixed(1)}/100)`);
    }
    for (const d of sorted.slice(-2)) {
      if (d.rawScore < 70) {
        weaknesses.push(`Weak ${d.category} score (${d.rawScore.toFixed(1)}/100)`);
        recommendations.push(this.getRecommendation(d.category, d.rawScore));
      }
    }
    return { strengths, weaknesses, recommendations };
  }

  private getRecommendation(category: BenchmarkCategory, _score: number): string {
    const recs: Record<BenchmarkCategory, string> = {
      'protocol-compliance': 'Ensure your agent strictly validates x402 headers and rejects expired requirements.',
      'payment-negotiation': 'Implement negotiation logic to reduce cost on high-value resources.',
      latency: 'Pre-warm wallet connections and use pre-signed transactions to reduce latency.',
      'cost-efficiency': 'Avoid overpaying by checking on-chain gas prices before submission.',
      'error-recovery': 'Add exponential backoff retry logic and fallback RPC providers.',
    };
    return recs[category];
  }

  private computePercentile(score: number, historical: number[]): number {
    return Math.round((historical.filter((s) => s < score).length / historical.length) * 100);
  }
}
