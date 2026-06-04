/**
 * x402 Compliance Scorer
 *
 * Grades AI agent behaviour against the x402 protocol specification
 * using a weighted rubric of compliance criteria.  Produces a structured
 * ComplianceReport used by the leaderboard and certification pipeline.
 *
 * Rubric categories:
 *   protocol   — correct HTTP 402 / WWW-Authenticate / Payment-Payload headers
 *   security   — signature validation, replay protection, nonce handling
 *   resilience — retry logic, circuit-breaker respect, timeout handling
 *   kyc        — identity verification gate adherence
 *   audit      — complete and valid audit trail
 *   budget     — budget enforcement and alert responsiveness
 *   latency    — response time within tier thresholds
 *
 * Scoring model:
 *   Each criterion scores 0 – 10 and is multiplied by its weight.
 *   Final score = weighted sum / max possible × 100 (0 – 100).
 *   Certification tiers:  Bronze ≥ 60 | Silver ≥ 75 | Gold ≥ 90
 *
 * Usage:
 *
 *   import { X402ComplianceScorer } from
 *     "@workspace/evaluator/x402-compliance-scorer";
 *
 *   const scorer = new X402ComplianceScorer();
 *   scorer.record(runObservation);
 *
 *   const report = scorer.score("agent-001");
 *   console.log(report.tier, report.totalScore);
 *   console.log(scorer.toMarkdown("agent-001"));
 */

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

export type ComplianceCriteria =
  | "protocol.headers"
  | "protocol.status_codes"
  | "protocol.payment_payload"
  | "security.signature"
  | "security.replay_protection"
  | "security.nonce"
  | "resilience.retry"
  | "resilience.circuit_breaker"
  | "resilience.timeout"
  | "kyc.gate"
  | "audit.completeness"
  | "audit.integrity"
  | "budget.enforcement"
  | "budget.alerting"
  | "latency.p50"
  | "latency.p95";

const CRITERIA_WEIGHTS: Record<ComplianceCriteria, number> = {
  "protocol.headers":          5,
  "protocol.status_codes":     4,
  "protocol.payment_payload":  5,
  "security.signature":        5,
  "security.replay_protection": 5,
  "security.nonce":            4,
  "resilience.retry":          3,
  "resilience.circuit_breaker": 3,
  "resilience.timeout":        3,
  "kyc.gate":                  4,
  "audit.completeness":        4,
  "audit.integrity":           5,
  "budget.enforcement":        4,
  "budget.alerting":           3,
  "latency.p50":               3,
  "latency.p95":               3,
};

export type CertificationTier = "none" | "bronze" | "silver" | "gold";

const TIER_THRESHOLDS: Record<CertificationTier, number> = {
  none: 0, bronze: 60, silver: 75, gold: 90,
};

// ---------------------------------------------------------------------------
// Observation — raw input from a benchmark run
// ---------------------------------------------------------------------------

export type RunObservation = {
  agentId:            string;
  runId:              string;
  observedAt:         string;
  // Protocol
  correctHeaders:     boolean;
  correctStatusCodes: boolean;
  validPayload:       boolean;
  // Security
  signatureValid:     boolean;
  replayBlocked:      boolean;
  nonceUnique:        boolean;
  // Resilience
  retriedOn402:       boolean;
  respectsCircuitOpen: boolean;
  handledTimeout:     boolean;
  // KYC
  kycGateEnforced:    boolean;
  // Audit
  auditComplete:      boolean;
  auditChainValid:    boolean;
  // Budget
  budgetEnforced:     boolean;
  budgetAlertFired:   boolean;
  // Latency
  p50LatencyMs:       number;
  p95LatencyMs:       number;
};

// ---------------------------------------------------------------------------
// Criterion score
// ---------------------------------------------------------------------------

export type CriterionScore = {
  criterion:  ComplianceCriteria;
  rawScore:   number;      // 0 – 10
  weight:     number;
  weighted:   number;      // rawScore × weight
  passed:     boolean;     // rawScore ≥ 6
};

export type ComplianceReport = {
  agentId:       string;
  generatedAt:   string;
  observations:  number;
  criteria:      CriterionScore[];
  totalScore:    number;        // 0 – 100
  tier:          CertificationTier;
  weakest:       ComplianceCriteria[];   // bottom-3 criteria
  strongest:     ComplianceCriteria[];   // top-3 criteria
};

// ---------------------------------------------------------------------------
// Latency scoring helper
// ---------------------------------------------------------------------------

function scoreLatencyP50(ms: number): number {
  if (ms <= 150) return 10;
  if (ms <= 300) return 8;
  if (ms <= 500) return 6;
  if (ms <= 800) return 4;
  if (ms <= 1200) return 2;
  return 0;
}

function scoreLatencyP95(ms: number): number {
  if (ms <= 400) return 10;
  if (ms <= 700) return 8;
  if (ms <= 1000) return 6;
  if (ms <= 1500) return 4;
  if (ms <= 2500) return 2;
  return 0;
}

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

export class X402ComplianceScorer {
  private observations = new Map<string, RunObservation[]>();

  // ── Ingest ────────────────────────────────────────────────────────────────

  record(obs: RunObservation): void {
    const list = this.observations.get(obs.agentId) ?? [];
    list.push(obs);
    this.observations.set(obs.agentId, list);
  }

  // ── Score ─────────────────────────────────────────────────────────────────

  score(agentId: string): ComplianceReport {
    const obs = this.observations.get(agentId) ?? [];
    const n   = obs.length || 1;

    // Average each boolean metric across all observations
    const avg = (fn: (o: RunObservation) => boolean): number =>
      Math.round((obs.reduce((s, o) => s + (fn(o) ? 1 : 0), 0) / n) * 10);

    const avgNum = (fn: (o: RunObservation) => number): number =>
      obs.reduce((s, o) => s + fn(o), 0) / n;

    const rawScores: Record<ComplianceCriteria, number> = {
      "protocol.headers":          avg(o => o.correctHeaders),
      "protocol.status_codes":     avg(o => o.correctStatusCodes),
      "protocol.payment_payload":  avg(o => o.validPayload),
      "security.signature":        avg(o => o.signatureValid),
      "security.replay_protection": avg(o => o.replayBlocked),
      "security.nonce":            avg(o => o.nonceUnique),
      "resilience.retry":          avg(o => o.retriedOn402),
      "resilience.circuit_breaker": avg(o => o.respectsCircuitOpen),
      "resilience.timeout":        avg(o => o.handledTimeout),
      "kyc.gate":                  avg(o => o.kycGateEnforced),
      "audit.completeness":        avg(o => o.auditComplete),
      "audit.integrity":           avg(o => o.auditChainValid),
      "budget.enforcement":        avg(o => o.budgetEnforced),
      "budget.alerting":           avg(o => o.budgetAlertFired),
      "latency.p50":               scoreLatencyP50(avgNum(o => o.p50LatencyMs)),
      "latency.p95":               scoreLatencyP95(avgNum(o => o.p95LatencyMs)),
    };

    const maxPossible = Object.entries(CRITERIA_WEIGHTS)
      .reduce((s, [, w]) => s + w * 10, 0);

    const criteria: CriterionScore[] = (Object.keys(rawScores) as ComplianceCriteria[]).map(c => ({
      criterion: c,
      rawScore:  rawScores[c],
      weight:    CRITERIA_WEIGHTS[c],
      weighted:  rawScores[c] * CRITERIA_WEIGHTS[c],
      passed:    rawScores[c] >= 6,
    }));

    const totalWeighted = criteria.reduce((s, c) => s + c.weighted, 0);
    const totalScore    = Math.round((totalWeighted / maxPossible) * 100);

    const tier: CertificationTier =
      totalScore >= TIER_THRESHOLDS.gold   ? "gold"   :
      totalScore >= TIER_THRESHOLDS.silver ? "silver" :
      totalScore >= TIER_THRESHOLDS.bronze ? "bronze" : "none";

    const sorted    = [...criteria].sort((a, b) => a.rawScore - b.rawScore);
    const weakest   = sorted.slice(0, 3).map(c => c.criterion);
    const strongest = sorted.slice(-3).reverse().map(c => c.criterion);

    return {
      agentId, generatedAt: new Date().toISOString(),
      observations: obs.length, criteria,
      totalScore, tier, weakest, strongest,
    };
  }

  // ── Markdown report ───────────────────────────────────────────────────────

  toMarkdown(agentId: string): string {
    const r    = this.score(agentId);
    const tierIcon = { gold: "🥇", silver: "🥈", bronze: "🥉", none: "—" }[r.tier];

    const lines = [
      `# x402 Compliance Report — \`${agentId}\``,
      ``,
      `**Score:** ${r.totalScore} / 100  |  **Tier:** ${tierIcon} ${r.tier.toUpperCase()}  |  **Observations:** ${r.observations}`,
      ``,
      `## Criteria Breakdown`,
      ``,
      `| Criterion | Raw (0-10) | Weight | Weighted | Status |`,
      `|-----------|:----------:|-------:|---------:|--------|`,
      ...r.criteria.map(c =>
        `| \`${c.criterion}\` | ${c.rawScore} | ×${c.weight} | ${c.weighted} | ${c.passed ? "✅" : "❌"} |`
      ),
      ``,
      `## Highlights`,
      ``,
      `**Strongest:** ${r.strongest.map(c => `\`${c}\``).join(", ")}`,
      `**Weakest:**   ${r.weakest.map(c => `\`${c}\``).join(", ")}`,
    ];
    return lines.join("
");
  }
}
