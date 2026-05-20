/**
 * Agent Studio — CERTIFY Block
 *
 * Consumes a completed benchmark run and produces a signed certification
 * result including tier assignment, badge, and per-scenario breakdown.
 */

import type { SubmissionReceipt } from "./agent-submit-block";

// ---------------------------------------------------------------------------
// Scoring types
// ---------------------------------------------------------------------------

export type ScenarioResult = {
  scenarioId:       string;
  passed:           boolean;
  scorePercent:     number;
  latencyMs:        number;
  /** Number of x402 payment flows the agent handled correctly */
  paymentsHandled:  number;
  /** Number of payment flows that errored or were rejected */
  paymentErrors:    number;
  notes:            string[];
};

export type CertificationTier =
  | "unrated"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum";

export const TIER_THRESHOLDS: Record<CertificationTier, number> = {
  unrated:  0,
  bronze:   50,
  silver:   70,
  gold:     85,
  platinum: 95,
};

export type CertificationBadge = {
  tier:         CertificationTier;
  label:        string;
  color:        string;
  svgIconSlug:  string;
};

const BADGES: Record<CertificationTier, CertificationBadge> = {
  unrated:  { tier: "unrated",  label: "Unrated",  color: "#9ca3af", svgIconSlug: "badge-unrated"  },
  bronze:   { tier: "bronze",   label: "Bronze",   color: "#b45309", svgIconSlug: "badge-bronze"   },
  silver:   { tier: "silver",   label: "Silver",   color: "#6b7280", svgIconSlug: "badge-silver"   },
  gold:     { tier: "gold",     label: "Gold",     color: "#d97706", svgIconSlug: "badge-gold"     },
  platinum: { tier: "platinum", label: "Platinum", color: "#7c3aed", svgIconSlug: "badge-platinum" },
};

// ---------------------------------------------------------------------------
// Certification result
// ---------------------------------------------------------------------------

export type CertificationResult = {
  certificationId:  string;
  submissionId:     string;
  agentId:          string;
  overallScore:     number;
  tier:             CertificationTier;
  badge:            CertificationBadge;
  scenarioResults:  ScenarioResult[];
  totalPayments:    number;
  successRate:      number;
  avgLatencyMs:     number;
  certifiedAt:      string;
  /** Set to true if the cert was issued from mocked / simulated results */
  simulated:        boolean;
};

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function assignTier(score: number): CertificationTier {
  const tiers = (Object.keys(TIER_THRESHOLDS) as CertificationTier[]).sort(
    (a, b) => TIER_THRESHOLDS[b] - TIER_THRESHOLDS[a]
  );
  for (const tier of tiers) {
    if (score >= TIER_THRESHOLDS[tier]) return tier;
  }
  return "unrated";
}

function generateCertId(): string {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CERT-${ts}-${rand}`;
}

// ---------------------------------------------------------------------------
// Simulate results (used during development / dry-run)
// ---------------------------------------------------------------------------

function simulateScenario(scenarioId: string): ScenarioResult {
  const baseScore  = 60 + Math.floor(Math.random() * 38);
  const payments   = 4 + Math.floor(Math.random() * 6);
  const errors     = Math.floor(Math.random() * 2);
  return {
    scenarioId,
    passed:          baseScore >= 70,
    scorePercent:    baseScore,
    latencyMs:       800 + Math.floor(Math.random() * 1200),
    paymentsHandled: payments,
    paymentErrors:   errors,
    notes:           baseScore >= 90 ? ["exceeded latency SLA"] : [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function certifyAgent(
  receipt: SubmissionReceipt,
  opts: {
    /** Provide real scenario results or omit to use simulated scores */
    scenarioResults?: ScenarioResult[];
    simulated?: boolean;
  } = {}
): CertificationResult {
  const results =
    opts.scenarioResults ?? receipt.scenarioIds.map(simulateScenario);

  const overallScore = Math.round(
    results.reduce((s, r) => s + r.scorePercent, 0) / results.length
  );

  const totalPayments = results.reduce((s, r) => s + r.paymentsHandled, 0);
  const totalErrors   = results.reduce((s, r) => s + r.paymentErrors,   0);
  const successRate   = totalPayments > 0
    ? Math.round(((totalPayments - totalErrors) / totalPayments) * 1000) / 10
    : 0;
  const avgLatencyMs  = Math.round(
    results.reduce((s, r) => s + r.latencyMs, 0) / results.length
  );

  const tier  = assignTier(overallScore);
  const badge = BADGES[tier];

  return {
    certificationId: generateCertId(),
    submissionId:    receipt.submissionId,
    agentId:         receipt.agentId,
    overallScore,
    tier,
    badge,
    scenarioResults: results,
    totalPayments,
    successRate,
    avgLatencyMs,
    certifiedAt:     new Date().toISOString(),
    simulated:       opts.simulated ?? !opts.scenarioResults,
  };
}

export function formatCertificationSummary(cert: CertificationResult): string {
  const lines = [
    `Certification ID : ${cert.certificationId}`,
    `Agent            : ${cert.agentId}`,
    `Tier             : ${cert.badge.label.toUpperCase()} (${cert.overallScore}%)`,
    `Success Rate     : ${cert.successRate}%  (${cert.totalPayments} payments)`,
    `Avg Latency      : ${cert.avgLatencyMs} ms`,
    `Scenarios run    : ${cert.scenarioResults.length}`,
    cert.simulated ? "[simulated run]" : "",
  ];
  return lines.filter(Boolean).join("\n");
}
