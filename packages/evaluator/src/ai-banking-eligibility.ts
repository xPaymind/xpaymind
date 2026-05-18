/**
 * AI Banking Economy Eligibility Checker
 *
 * Determines whether a benchmarked agent meets the minimum bar to participate
 * in the AI banking economy — a growing ecosystem of neobanks, payment routers,
 * and financial data APIs that gate access behind x402 and require autonomous
 * AI agents to handle payments reliably, cheaply, and within strict latency SLAs.
 *
 * An agent that passes eligibility can be listed as "AI Banking Economy Ready"
 * on the xPaymind leaderboard and is eligible to receive $XPAYMIND incentives.
 *
 * Usage:
 *   const checker = new AIBankingEligibilityChecker();
 *   const result  = checker.check(report);
 *   console.log(result.eligible);        // true | false
 *   console.log(result.tier);            // 'full' | 'limited' | 'ineligible'
 *   console.log(result.failedCriteria);  // which gates the agent missed
 */

import type { EvaluationReport, DimensionScore } from './markdown-exporter.js';

// ---------------------------------------------------------------------------
// Eligibility criteria constants
// ---------------------------------------------------------------------------

/**
 * Minimum per-category scores an agent must achieve.
 * Based on the neobanking-v1 suite SLA requirements and market feedback.
 */
const MINIMUM_CATEGORY_SCORES: Record<string, number> = {
  'protocol-compliance': 80,   // must correctly implement the x402 handshake
  'payment-negotiation': 65,   // must handle at least basic negotiation
  'latency':             70,   // must meet sub-800 ms SLA in the majority of scenarios
  'cost-efficiency':     60,   // must not consistently overpay
  'error-recovery':      55,   // must not crash on malformed or expired requirements
};

/** Minimum overall score for any eligibility tier. */
const MINIMUM_OVERALL_SCORE = 68;

/** Thresholds that distinguish Full from Limited eligibility. */
const FULL_ELIGIBILITY_OVERALL  = 80;
const FULL_ELIGIBILITY_PROTOCOL = 88;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type EligibilityTier = 'full' | 'limited' | 'ineligible';

export interface CategoryGateResult {
  category: string;
  required: number;
  actual: number;
  passed: boolean;
}

export interface AIBankingEligibilityResult {
  /**
   * Whether the agent clears the minimum bar for the AI banking economy.
   * Equivalent to `tier !== 'ineligible'`.
   */
  eligible: boolean;

  /**
   * Eligibility tier:
   * - `full`       — agent meets all gates + overall ≥ 80; listed as "AI Banking Ready"
   * - `limited`    — agent clears the minimum bar but has category gaps; listed with caveats
   * - `ineligible` — agent fails one or more mandatory gates; not listed
   */
  tier: EligibilityTier;

  /** Overall score from the evaluated report. */
  overallScore: number;

  /** Grade from the evaluated report. */
  grade: string;

  /** Per-category gate results. */
  categoryGates: CategoryGateResult[];

  /** Categories that the agent failed to meet the minimum score for. */
  failedCriteria: string[];

  /**
   * Human-readable summary of the eligibility decision.
   * Suitable for display in CLI output or PR comments.
   */
  summary: string;

  /**
   * Actionable improvement hints for agents that are not fully eligible.
   * Empty when `tier === 'full'`.
   */
  hints: string[];
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

export class AIBankingEligibilityChecker {
  /**
   * Evaluate an agent's eligibility for the AI banking economy based on a
   * completed EvaluationReport (typically from the neobanking-v1 suite).
   */
  check(report: EvaluationReport): AIBankingEligibilityResult {
    const categoryGates = this.buildCategoryGates(report.dimensions);
    const failedCriteria = categoryGates.filter((g) => !g.passed).map((g) => g.category);

    const overallOk    = report.overallScore >= MINIMUM_OVERALL_SCORE;
    const allGatesPassed = failedCriteria.length === 0;

    // Determine tier
    let tier: EligibilityTier;
    if (!overallOk || failedCriteria.includes('protocol-compliance')) {
      // Failing the protocol gate or overall minimum is an immediate disqualifier
      tier = 'ineligible';
    } else if (
      allGatesPassed &&
      report.overallScore >= FULL_ELIGIBILITY_OVERALL &&
      this.categoryScore(report.dimensions, 'protocol-compliance') >= FULL_ELIGIBILITY_PROTOCOL
    ) {
      tier = 'full';
    } else {
      tier = 'limited';
    }

    const eligible = tier !== 'ineligible';
    const summary  = this.buildSummary(tier, report.overallScore, report.grade, failedCriteria);
    const hints    = tier === 'full' ? [] : this.buildHints(categoryGates, report.overallScore);

    return {
      eligible,
      tier,
      overallScore: report.overallScore,
      grade: report.grade,
      categoryGates,
      failedCriteria,
      summary,
      hints,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildCategoryGates(dimensions: DimensionScore[]): CategoryGateResult[] {
    return Object.entries(MINIMUM_CATEGORY_SCORES).map(([category, required]) => {
      const dim    = dimensions.find((d) => d.category === category);
      const actual = dim?.rawScore ?? 0;
      return { category, required, actual, passed: actual >= required };
    });
  }

  private categoryScore(dimensions: DimensionScore[], category: string): number {
    return dimensions.find((d) => d.category === category)?.rawScore ?? 0;
  }

  private buildSummary(
    tier: EligibilityTier,
    overallScore: number,
    grade: string,
    failedCriteria: string[],
  ): string {
    switch (tier) {
      case 'full':
        return (
          `✅ AI Banking Economy Ready (Full) — score ${overallScore.toFixed(1)}, grade ${grade}. ` +
          `This agent meets all xPaymind eligibility gates and is approved for AI banking economy listings.`
        );
      case 'limited':
        return (
          `⚠️ AI Banking Economy Ready (Limited) — score ${overallScore.toFixed(1)}, grade ${grade}. ` +
          `The agent clears the minimum bar but underperforms in: ${failedCriteria.join(', ')}. ` +
          `Listed with category caveats.`
        );
      case 'ineligible':
        return (
          `❌ Not Eligible — score ${overallScore.toFixed(1)}, grade ${grade}. ` +
          `The agent failed mandatory gates: ${failedCriteria.join(', ')}. ` +
          `Address the listed weaknesses and re-submit.`
        );
    }
  }

  private buildHints(gates: CategoryGateResult[], overallScore: number): string[] {
    const hints: string[] = [];

    for (const gate of gates.filter((g) => !g.passed)) {
      const gap = gate.required - gate.actual;
      switch (gate.category) {
        case 'protocol-compliance':
          hints.push(
            `Protocol Compliance is ${gap.toFixed(0)} pts below the 80-point gate. ` +
            `Ensure all x402 header fields are validated before payment and that ` +
            `expired requirements are rejected without attempting a transaction.`,
          );
          break;
        case 'payment-negotiation':
          hints.push(
            `Payment Negotiation is ${gap.toFixed(0)} pts below the 65-point gate. ` +
            `Implement basic amount negotiation: if the asking price is above a ` +
            `configured ceiling, the agent should counter-offer or decline.`,
          );
          break;
        case 'latency':
          hints.push(
            `Latency is ${gap.toFixed(0)} pts below the 70-point gate. ` +
            `Target sub-800 ms end-to-end for the neobanking suite. Use pre-warmed ` +
            `RPC connections and a local nonce cache to eliminate round-trips.`,
          );
          break;
        case 'cost-efficiency':
          hints.push(
            `Cost Efficiency is ${gap.toFixed(0)} pts below the 60-point gate. ` +
            `Audit gas price strategy — consider EIP-1559 maxFeePerGas caps and ` +
            `avoid overpaying during network congestion spikes.`,
          );
          break;
        case 'error-recovery':
          hints.push(
            `Error Recovery is ${gap.toFixed(0)} pts below the 55-point gate. ` +
            `Add handling for malformed x402 headers (missing fields, bad address format) ` +
            `and confirm that expired requirements are declined, not retried.`,
          );
          break;
      }
    }

    if (overallScore < FULL_ELIGIBILITY_OVERALL) {
      hints.push(
        `Overall score ${overallScore.toFixed(1)} is below the 80-point Full eligibility threshold. ` +
        `Improving latency and cost-efficiency categories typically yields the fastest gains.`,
      );
    }

    return hints;
  }
}
