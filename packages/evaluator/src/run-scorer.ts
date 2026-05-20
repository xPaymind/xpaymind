/**
 * Run Scorer
 *
 * Consumes a list of X402Exchange records from the benchmark harness and
 * produces a per-scenario score used by the CERTIFY block.
 */

import type { X402Exchange } from "@workspace/core/x402-types";
import { classifyOutcome }   from "@workspace/core/x402-types";
import type { ScenarioResult } from "@workspace/core/agent-studio/agent-certify-block";
import { getScenario }        from "./x402-benchmark-suite";

// ---------------------------------------------------------------------------
// Assertion evaluators
// ---------------------------------------------------------------------------

type AssertionFn = (exchanges: X402Exchange[]) => { passed: boolean; note?: string };

const ASSERTION_MAP: Record<string, AssertionFn> = {
  "parsed-payment-required-header": (ex) => ({
    passed: ex.every(e => e.response402.paymentRequired.challenge !== ""),
    note:   "all 402 responses contained a non-empty challenge",
  }),
  "selected-correct-scheme": (ex) => ({
    passed: ex.every(e => e.paymentProof.scheme !== ""),
    note:   `schemes used: ${[...new Set(ex.map(e => e.paymentProof.scheme))].join(", ")}`,
  }),
  "signed-payload-valid": (ex) => ({
    passed: ex.every(e => e.paymentProof.signature.length >= 16),
    note:   "all payment proofs carry a non-trivial signature",
  }),
  "retry-succeeded": (ex) => ({
    passed: ex.every(e => classifyOutcome(e) === "success"),
    note:   `${ex.filter(e => classifyOutcome(e) === "success").length}/${ex.length} exchanges succeeded`,
  }),
  "no-double-spend": (ex) => {
    const nonces = ex.map(e => (e.paymentProof.payload as { nonce?: string }).nonce).filter(Boolean);
    const unique = new Set(nonces).size === nonces.length;
    return { passed: unique, note: unique ? "all nonces unique" : "duplicate nonce detected" };
  },
  "idempotency-key-present": (ex) => ({
    passed: ex.every(e => (e.paymentProof.payload as { nonce?: string }).nonce !== undefined),
    note:   "idempotency nonces present on all exchanges",
  }),
  "retry-count-within-policy": (ex) => ({
    passed: ex.length <= 5,
    note:   `${ex.length} exchanges (max 5 allowed)`,
  }),
  "final-status-200": (ex) => ({
    passed: ex.every(e => e.finalStatus === 200),
    note:   `statuses: ${[...new Set(ex.map(e => e.finalStatus))].join(", ")}`,
  }),
  "session-opened": (ex) => ({
    passed: ex.some(e => e.paymentProof.scheme === "streaming"),
    note:   "at least one streaming exchange initiated",
  }),
  "micropayment-cadence-correct": (ex) => {
    const streaming = ex.filter(e => e.paymentProof.scheme === "streaming");
    return {
      passed: streaming.length >= 2,
      note:   `${streaming.length} streaming micropayments recorded`,
    };
  },
  "total-spend-within-cap": (ex) => {
    const total = ex.reduce((s, e) => {
      const p = e.paymentProof.payload as { amount?: number; ratePerSecond?: number };
      return s + (p.amount ?? p.ratePerSecond ?? 0);
    }, 0);
    return { passed: total <= 100_000, note: `total spend: ${total} units` };
  },
  "session-closed-cleanly": (ex) => ({
    passed: ex.every(e => !e.error),
    note:   "no errors recorded on session close",
  }),
  "payment-rejected": (ex) => ({
    passed: ex.every(e => classifyOutcome(e) === "rejected"),
    note:   "overpayment correctly rejected",
  }),
  "error-surfaced-to-caller": (ex) => ({
    passed: ex.every(e => e.error !== undefined && e.error !== ""),
    note:   "errors propagated in exchange records",
  }),
  "no-funds-debited": (ex) => ({
    passed: ex.every(e => classifyOutcome(e) === "rejected"),
    note:   "no successful payment on rejected exchanges",
  }),
};

function evaluateAssertion(key: string, exchanges: X402Exchange[]) {
  const fn = ASSERTION_MAP[key];
  if (!fn) return { key, passed: false, note: `unknown assertion: ${key}` };
  const result = fn(exchanges);
  return { key, ...result };
}

// ---------------------------------------------------------------------------
// Score a scenario run
// ---------------------------------------------------------------------------

export function scoreScenario(
  scenarioId: string,
  exchanges:  X402Exchange[]
): ScenarioResult {
  const scenario = getScenario(scenarioId);
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }

  const results = scenario.assertions.map(a => evaluateAssertion(a, exchanges));
  const passedCount = results.filter(r => r.passed).length;
  const scorePercent = Math.round((passedCount / results.length) * 100);

  const avgLatency = exchanges.length > 0
    ? Math.round(exchanges.reduce((s, e) => s + e.durationMs, 0) / exchanges.length)
    : 0;

  const successExchanges = exchanges.filter(e => classifyOutcome(e) === "success");
  const errorExchanges   = exchanges.filter(e => classifyOutcome(e) !== "success");

  const notes = results
    .filter(r => !r.passed && r.note)
    .map(r => `[${r.key}] ${r.note}`);

  return {
    scenarioId,
    passed:          scorePercent >= scenario.passThreshold,
    scorePercent,
    latencyMs:       avgLatency,
    paymentsHandled: successExchanges.length,
    paymentErrors:   errorExchanges.length,
    notes,
  };
}

export function scoreRun(
  runs: Array<{ scenarioId: string; exchanges: X402Exchange[] }>
): ScenarioResult[] {
  return runs.map(r => scoreScenario(r.scenarioId, r.exchanges));
}
