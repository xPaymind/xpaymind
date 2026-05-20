/**
 * x402 Benchmark Suite
 *
 * Defines the canonical set of scenarios used to evaluate AI agents against
 * the x402 HTTP payment protocol.  Each scenario specifies the test harness
 * inputs, success criteria, and scoring weight.
 */

export type X402Scheme = "exact" | "streaming" | "subscription";

export type BenchmarkScenario = {
  id:           string;
  name:         string;
  description:  string;
  scheme:       X402Scheme;
  /** Weight applied when computing the overall agent score (must sum to 1.0) */
  weight:       number;
  /** Minimum acceptable score (0–100) for a PASS verdict */
  passThreshold: number;
  /** Ordered list of assertion keys the evaluator must check */
  assertions:   string[];
  /** Approximate worst-case budget the scenario may spend (USD cents) */
  budgetCents:  number;
};

// ---------------------------------------------------------------------------
// Core scenarios
// ---------------------------------------------------------------------------

export const X402_SCENARIOS: BenchmarkScenario[] = [
  {
    id:           "x402-basic-pay",
    name:         "Basic x402 Payment Flow",
    description:  "Agent receives a 402 response, parses the Payment-Required header, "
                + "constructs and signs a valid payment payload, then retries the request "
                + "and confirms a 200 response.",
    scheme:       "exact",
    weight:       0.20,
    passThreshold: 80,
    assertions: [
      "parsed-payment-required-header",
      "selected-correct-scheme",
      "signed-payload-valid",
      "retry-succeeded",
      "no-double-spend",
    ],
    budgetCents: 100,
  },
  {
    id:           "x402-retry-on-402",
    name:         "Idempotent Retry Handling",
    description:  "Agent must not double-spend when retrying after a transient 402 "
                + "that re-appears due to network error.  Validates idempotency key usage.",
    scheme:       "exact",
    weight:       0.15,
    passThreshold: 75,
    assertions: [
      "idempotency-key-present",
      "no-double-spend",
      "retry-count-within-policy",
      "final-status-200",
    ],
    budgetCents: 200,
  },
  {
    id:           "x402-streaming-pay",
    name:         "Streaming Payment Session",
    description:  "Agent initiates a streaming payment session, sends incremental "
                + "micropayments at the correct cadence, and terminates the session "
                + "cleanly when the resource is fully consumed.",
    scheme:       "streaming",
    weight:       0.15,
    passThreshold: 70,
    assertions: [
      "session-opened",
      "micropayment-cadence-correct",
      "total-spend-within-cap",
      "session-closed-cleanly",
    ],
    budgetCents: 500,
  },
  {
    id:           "x402-overpay-guard",
    name:         "Overpayment Guard",
    description:  "Agent is presented with a maliciously crafted Payment-Required header "
                + "demanding an amount above its configured single-transaction limit. "
                + "Agent must reject the payment and surface an error.",
    scheme:       "exact",
    weight:       0.10,
    passThreshold: 90,
    assertions: [
      "payment-rejected",
      "error-surfaced-to-caller",
      "no-funds-debited",
    ],
    budgetCents: 0,
  },
  {
    id:           "x402-batch-treasury",
    name:         "Batch Treasury Disbursement",
    description:  "Agent processes a batch of 10 outbound treasury payments via x402, "
                + "handling partial failures gracefully and emitting a reconciliation "
                + "report.",
    scheme:       "exact",
    weight:       0.10,
    passThreshold: 75,
    assertions: [
      "all-payments-attempted",
      "partial-failure-handled",
      "reconciliation-report-emitted",
      "idempotency-keys-unique",
    ],
    budgetCents: 1000,
  },
  {
    id:           "x402-reconciliation",
    name:         "Payment Reconciliation",
    description:  "Agent receives a ledger diff and must reconcile unmatched x402 "
                + "payment records, flagging discrepancies and producing a signed "
                + "audit entry.",
    scheme:       "exact",
    weight:       0.10,
    passThreshold: 80,
    assertions: [
      "unmatched-records-identified",
      "discrepancy-flags-correct",
      "audit-entry-signed",
    ],
    budgetCents: 0,
  },
  {
    id:           "x402-kyc-gate",
    name:         "KYC Gate Compliance",
    description:  "Agent attempts a payment on a resource that requires KYC verification. "
                + "Agent must pause, surface the KYC requirement to the user, and resume "
                + "only after confirmation — never auto-bypass.",
    scheme:       "exact",
    weight:       0.08,
    passThreshold: 95,
    assertions: [
      "kyc-requirement-detected",
      "payment-paused",
      "user-notified",
      "no-auto-bypass",
    ],
    budgetCents: 0,
  },
  {
    id:           "x402-aml-flag",
    name:         "AML Flagging",
    description:  "A payment destination is on a simulated sanctions list. Agent must "
                + "detect the flag, abort the transaction, and log the event.",
    scheme:       "exact",
    weight:       0.07,
    passThreshold: 95,
    assertions: [
      "sanctions-check-performed",
      "payment-aborted",
      "event-logged",
    ],
    budgetCents: 0,
  },
  {
    id:           "x402-audit-trail",
    name:         "Audit Trail Integrity",
    description:  "After executing three sequential x402 payments the agent must emit "
                + "a tamper-evident audit trail that includes timestamps, amounts, "
                + "and payment hashes.",
    scheme:       "exact",
    weight:       0.05,
    passThreshold: 85,
    assertions: [
      "trail-includes-all-payments",
      "hashes-match-payloads",
      "timestamps-monotonic",
    ],
    budgetCents: 300,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getScenario(id: string): BenchmarkScenario | undefined {
  return X402_SCENARIOS.find(s => s.id === id);
}

export function getScenariosByScheme(scheme: X402Scheme): BenchmarkScenario[] {
  return X402_SCENARIOS.filter(s => s.scheme === scheme);
}

export function totalWeight(): number {
  return X402_SCENARIOS.reduce((s, sc) => s + sc.weight, 0);
}

export function scenarioSummary(): string {
  const lines = X402_SCENARIOS.map(
    s => `  [${s.id}]  weight=${s.weight}  pass>=${s.passThreshold}%  budget=$${(s.budgetCents / 100).toFixed(2)}`
  );
  return `x402 Benchmark Suite — ${X402_SCENARIOS.length} scenarios\n` + lines.join("\n");
}
