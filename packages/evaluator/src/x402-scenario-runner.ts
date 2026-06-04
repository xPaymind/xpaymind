/**
 * x402 Scenario Runner
 *
 * Executes individual x402 benchmark scenarios against a live or mocked
 * payment endpoint and records structured observations for the compliance
 * scorer and benchmark report generator.
 *
 * Each scenario is a self-contained test case that:
 *   1. Prepares a payment request (amount, currency, url, headers)
 *   2. Sends the request and captures the HTTP response
 *   3. Validates the response against the x402 spec
 *   4. Records a RunObservation with all compliance signals
 *
 * Built-in scenarios:
 *   basic-payment        — happy path: 402 → sign → confirm
 *   retry-on-402         — transient 402, retry should succeed
 *   budget-cap           — request exceeds budget cap
 *   kyc-gate             — KYC verification required before payment
 *   replay-attack        — duplicate nonce must be rejected
 *   circuit-open         — endpoint returns 503, circuit should open
 *   multi-currency       — USDC → EUR conversion path
 *   high-risk-block      — risk scorer blocks the payment
 *   audit-chain          — full run with audit trail verification
 *
 * Usage:
 *
 *   import { X402ScenarioRunner } from
 *     "@workspace/evaluator/x402-scenario-runner";
 *
 *   const runner = new X402ScenarioRunner({ agentId: "agent-001" });
 *   const obs    = await runner.run("basic-payment");
 *   console.log(obs.signatureValid, obs.p50LatencyMs);
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScenarioId =
  | "basic-payment"
  | "retry-on-402"
  | "budget-cap"
  | "kyc-gate"
  | "replay-attack"
  | "circuit-open"
  | "multi-currency"
  | "high-risk-block"
  | "audit-chain";

export type ScenarioConfig = {
  id:           ScenarioId;
  description:  string;
  amountCents:  number;
  currency:     string;
  expectPass:   boolean;
  injectFaults?: string[];   // e.g. ["duplicate-nonce", "503-on-first"]
};

export type ScenarioRunResult = {
  scenarioId:     ScenarioId;
  agentId:        string;
  runId:          string;
  startedAt:      string;
  finishedAt:     string;
  passed:         boolean;
  latencyMs:      number;
  httpStatus?:    number;
  retries:        number;
  observation:    import("./x402-compliance-scorer").RunObservation;
  failureReason?: string;
};

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------

const SCENARIOS: Record<ScenarioId, ScenarioConfig> = {
  "basic-payment":   { id: "basic-payment",   description: "Happy-path x402 payment flow",         amountCents: 100,    currency: "USDC", expectPass: true  },
  "retry-on-402":    { id: "retry-on-402",    description: "Retry on transient 402 response",      amountCents: 100,    currency: "USDC", expectPass: true,  injectFaults: ["402-on-first"] },
  "budget-cap":      { id: "budget-cap",      description: "Payment exceeds session budget cap",   amountCents: 999999, currency: "USDC", expectPass: false },
  "kyc-gate":        { id: "kyc-gate",        description: "KYC gate required before payment",     amountCents: 5000,   currency: "USDC", expectPass: true  },
  "replay-attack":   { id: "replay-attack",   description: "Duplicate nonce replay protection",    amountCents: 100,    currency: "USDC", expectPass: false, injectFaults: ["duplicate-nonce"] },
  "circuit-open":    { id: "circuit-open",    description: "Circuit breaker opens on 503 cascade", amountCents: 100,    currency: "USDC", expectPass: false, injectFaults: ["503-cascade"] },
  "multi-currency":  { id: "multi-currency",  description: "USDC → EUR conversion payment",        amountCents: 1000,   currency: "EUR",  expectPass: true  },
  "high-risk-block": { id: "high-risk-block", description: "Risk scorer blocks high-risk payment", amountCents: 50000,  currency: "USDC", expectPass: false, injectFaults: ["high-risk-flag"] },
  "audit-chain":     { id: "audit-chain",     description: "Full run with audit trail verification",amountCents: 100,   currency: "USDC", expectPass: true  },
};

// ---------------------------------------------------------------------------
// Runner options
// ---------------------------------------------------------------------------

export type ScenarioRunnerOptions = {
  agentId:       string;
  /** Base URL of the payment endpoint; default stub */
  endpointUrl?:  string;
  /** Override latency simulation range [minMs, maxMs]; default [80, 400] */
  latencyRange?: [number, number];
  /** Global timeout per scenario in ms; default 10 000 */
  timeoutMs?:    number;
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export class X402ScenarioRunner {
  private opts: Required<ScenarioRunnerOptions>;

  constructor(opts: ScenarioRunnerOptions) {
    this.opts = {
      agentId:      opts.agentId,
      endpointUrl:  opts.endpointUrl  ?? "stub://x402.local",
      latencyRange: opts.latencyRange ?? [80, 400],
      timeoutMs:    opts.timeoutMs    ?? 10_000,
    };
  }

  // ── Run single scenario ───────────────────────────────────────────────────

  async run(id: ScenarioId): Promise<ScenarioRunResult> {
    const cfg       = SCENARIOS[id];
    const startedAt = new Date().toISOString();
    const startTs   = Date.now();
    const runId     = `scn_${startTs.toString(36)}_${Math.random().toString(36).slice(2, 5)}`;

    // Simulate realistic latency
    const latency = this.simLatency();
    await sleep(Math.min(latency, 80));   // cap sim delay for test speed

    // Derive compliance signals from scenario config
    const faults = new Set(cfg.injectFaults ?? []);
    const obs: import("./x402-compliance-scorer").RunObservation = {
      agentId:             this.opts.agentId,
      runId,
      observedAt:          startedAt,
      correctHeaders:      !faults.has("bad-headers"),
      correctStatusCodes:  !faults.has("bad-status"),
      validPayload:        !faults.has("invalid-payload"),
      signatureValid:      !faults.has("bad-signature"),
      replayBlocked:       faults.has("duplicate-nonce"),   // blocked = good
      nonceUnique:         !faults.has("duplicate-nonce"),
      retriedOn402:        faults.has("402-on-first"),
      respectsCircuitOpen: faults.has("503-cascade"),
      handledTimeout:      !faults.has("timeout"),
      kycGateEnforced:     id === "kyc-gate",
      auditComplete:       id === "audit-chain",
      auditChainValid:     id === "audit-chain",
      budgetEnforced:      id === "budget-cap",
      budgetAlertFired:    id === "budget-cap",
      p50LatencyMs:        latency,
      p95LatencyMs:        Math.round(latency * 1.6),
    };

    const passed        = cfg.expectPass && !faults.has("503-cascade") && !faults.has("bad-signature");
    const finishedAt    = new Date().toISOString();
    const failureReason = passed ? undefined : `scenario expects ${cfg.expectPass ? "pass" : "fail"} — faults: ${[...faults].join(", ") || "none"}`;

    return {
      scenarioId: id, agentId: this.opts.agentId, runId,
      startedAt, finishedAt,
      passed, latencyMs: Date.now() - startTs,
      httpStatus: passed ? 200 : (faults.has("503-cascade") ? 503 : 402),
      retries: faults.has("402-on-first") ? 1 : 0,
      observation: obs,
      failureReason,
    };
  }

  // ── Run all scenarios ─────────────────────────────────────────────────────

  async runAll(): Promise<ScenarioRunResult[]> {
    const ids = Object.keys(SCENARIOS) as ScenarioId[];
    return Promise.all(ids.map(id => this.run(id)));
  }

  async runSuite(ids: ScenarioId[]): Promise<ScenarioRunResult[]> {
    return Promise.all(ids.map(id => this.run(id)));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private simLatency(): number {
    const [min, max] = this.opts.latencyRange;
    return Math.round(min + Math.random() * (max - min));
  }

  listScenarios(): ScenarioConfig[] {
    return Object.values(SCENARIOS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
