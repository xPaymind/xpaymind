/**
 * BankingIntegrationScorecard
 *
 * Produces a structured scorecard summarising how well an AI agent integrates
 * with banking systems, derived from a completed neobanking-v1 benchmark run.
 *
 * The scorecard is designed for two audiences:
 *  - Bank partnerships teams — do they trust this agent with their APIs?
 *  - Agent developers — what must they fix before a bank will onboard them?
 *
 * Scoring dimensions (all 0–100):
 *  1. Reliability       — did the agent complete payments without errors?
 *  2. Latency SLA       — did the agent stay within the 800 ms neobank SLA?
 *  3. Cost Control      — did the agent avoid overpaying?
 *  4. Compliance        — did the agent correctly reject expired / invalid requirements?
 *  5. Concurrency       — did the agent handle parallel payment challenges without collisions?
 */

import type { EvaluationReport, DimensionScore } from './markdown-exporter.js';

export type ScorecardRating = 'excellent' | 'good' | 'acceptable' | 'poor' | 'failing';

export interface ScorecardDimension {
  name: string;
  score: number;
  rating: ScorecardRating;
  evidence: string;
}

export interface BankingIntegrationScorecard {
  agentId: string;
  overallScore: number;
  overallRating: ScorecardRating;
  bankApprovalLikelihood: 'high' | 'medium' | 'low' | 'very-low';
  dimensions: ScorecardDimension[];
  executiveSummary: string;
  onboardingBlockers: string[];
}

function toRating(score: number): ScorecardRating {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'acceptable';
  if (score >= 40) return 'poor';
  return 'failing';
}

function approvalLikelihood(
  overallScore: number,
  blockers: number,
): BankingIntegrationScorecard['bankApprovalLikelihood'] {
  if (blockers > 0) return overallScore >= 70 ? 'medium' : 'low';
  if (overallScore >= 85) return 'high';
  if (overallScore >= 70) return 'medium';
  return overallScore >= 55 ? 'low' : 'very-low';
}

export class BankingIntegrationScorecardBuilder {
  build(report: EvaluationReport): BankingIntegrationScorecard {
    const dim = (cat: string) => report.dimensions.find((d) => d.category === cat);

    const makeDim = (name: string, cat: string, evidenceFn: (d: DimensionScore) => string): ScorecardDimension => {
      const d = dim(cat);
      const score = d?.rawScore ?? 0;
      return { name, score, rating: toRating(score), evidence: d ? evidenceFn(d) : `No ${cat} data available` };
    };

    const dimensions: ScorecardDimension[] = [
      makeDim('Reliability',   'protocol-compliance', (d) => `${d.passCount}/${d.scenarioCount} protocol scenarios passed`),
      makeDim('Latency SLA',   'latency',             (d) => `Average ${d.avgLatencyMs.toFixed(0)} ms vs 800 ms neobanking SLA`),
      makeDim('Cost Control',  'cost-efficiency',     (d) => `Cost efficiency score ${d.rawScore.toFixed(1)} — ${toRating(d.rawScore)} gas/fee management`),
      makeDim('Compliance',    'error-recovery',      (d) => `${d.passCount}/${d.scenarioCount} error-recovery scenarios passed`),
      makeDim('Concurrency',   'payment-negotiation', (d) => `Negotiation/concurrency score ${d.rawScore.toFixed(1)} — ${d.passCount}/${d.scenarioCount} scenarios passed`),
    ];

    const overallScore = Math.round(dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length);
    const overallRating = toRating(overallScore);

    const onboardingBlockers: string[] = [];
    const reliability = dimensions[0]?.score ?? 0;
    const compliance  = dimensions[3]?.score ?? 0;
    const latency     = dimensions[1]?.score ?? 0;
    if (reliability < 75) onboardingBlockers.push('Reliability below 75 — agent fails too many protocol scenarios for production use');
    if (compliance  < 60) onboardingBlockers.push('Compliance below 60 — agent does not reliably reject expired or invalid payment requirements');
    if (latency     < 55) onboardingBlockers.push('Latency SLA below 55 — agent exceeds the 800 ms neobanking threshold in most scenarios');

    const likelihood = approvalLikelihood(overallScore, onboardingBlockers.length);

    const ratingLabel: Record<ScorecardRating, string> = { excellent: 'an excellent', good: 'a good', acceptable: 'an acceptable', poor: 'a poor', failing: 'a failing' };
    const likelihoodLabel: Record<string, string> = {
      high: 'Approval likelihood is high — recommended for production onboarding.',
      medium: 'Approval likelihood is medium — minor issues should be resolved before onboarding.',
      low: 'Approval likelihood is low — significant improvements required.',
      'very-low': 'Approval likelihood is very low — agent is not ready for banking integration.',
    };
    const blockerNote = onboardingBlockers.length > 0
      ? ` Key blockers: ${onboardingBlockers.length === 1 ? onboardingBlockers[0] : `${onboardingBlockers.length} issues identified`}.`
      : '';

    const executiveSummary =
      `Agent \`${report.agentId}\` achieved ${ratingLabel[overallRating]} banking integration score of ${overallScore}/100. ` +
      `${likelihoodLabel[likelihood]}${blockerNote}`;

    return { agentId: report.agentId, overallScore, overallRating, bankApprovalLikelihood: likelihood, dimensions, executiveSummary, onboardingBlockers };
  }
}
