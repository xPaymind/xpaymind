/**
 * Agent Studio — SUBMIT Block
 *
 * Runs pre-flight checks against a sealed AgentConfiguration, then enqueues
 * the agent for benchmark evaluation.  Returns a SubmissionReceipt that the
 * CERTIFY block polls until scoring is complete.
 */

import type { AgentConfiguration } from "./agent-configure-block";

export type SubmissionStatus =
  | "queued"
  | "running"
  | "scoring"
  | "completed"
  | "failed";

export type PreflightResult = {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
};

export type SubmissionReceipt = {
  submissionId: string;
  agentId: string;
  configHash: string;
  submittedAt: string;
  estimatedDurationMs: number;
  status: SubmissionStatus;
  /** Benchmark scenario IDs that will be executed */
  scenarioIds: string[];
};

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

function checkModelSupport(cfg: AgentConfiguration) {
  const supported = ["openai", "anthropic", "google", "mistral", "local"];
  return {
    name:   "model-provider-supported",
    passed: supported.includes(cfg.modelProvider),
    detail: supported.includes(cfg.modelProvider)
      ? `${cfg.modelProvider} is a supported provider`
      : `${cfg.modelProvider} is not yet supported`,
  };
}

function checkPaymentScheme(cfg: AgentConfiguration) {
  const passed = cfg.paymentLimits.allowedSchemes.length > 0;
  return {
    name:   "payment-scheme-present",
    passed,
    detail: passed
      ? `schemes: ${cfg.paymentLimits.allowedSchemes.join(", ")}`
      : "at least one payment scheme must be allowed",
  };
}

function checkContextWindow(cfg: AgentConfiguration) {
  const passed = cfg.contextWindowTokens >= 8_192;
  return {
    name:   "context-window-adequate",
    passed,
    detail: passed
      ? `${cfg.contextWindowTokens.toLocaleString()} tokens`
      : "x402 benchmarks require at least 8 192 context tokens",
  };
}

function checkDailyBudget(cfg: AgentConfiguration) {
  const passed = cfg.paymentLimits.dailyCapUsdCents >= 100; // min $1.00
  return {
    name:   "daily-budget-sufficient",
    passed,
    detail: passed
      ? `$${(cfg.paymentLimits.dailyCapUsdCents / 100).toFixed(2)} daily cap`
      : "daily cap must be at least $1.00 to run payment scenarios",
  };
}

export function runPreflightChecks(cfg: AgentConfiguration): PreflightResult {
  const checks = [
    checkModelSupport(cfg),
    checkPaymentScheme(cfg),
    checkContextWindow(cfg),
    checkDailyBudget(cfg),
  ];
  return {
    passed: checks.every(c => c.passed),
    checks,
  };
}

// ---------------------------------------------------------------------------
// Scenario selection
// ---------------------------------------------------------------------------

const SCENARIO_MAP: Record<string, string[]> = {
  payment:    ["x402-basic-pay", "x402-streaming-pay", "x402-retry-on-402", "x402-overpay-guard"],
  treasury:   ["x402-basic-pay", "x402-batch-treasury", "x402-reconciliation", "x402-sweep"],
  compliance: ["x402-kyc-gate", "x402-aml-flag", "x402-audit-trail", "x402-retry-on-402"],
  lending:    ["x402-basic-pay", "x402-instalment-plan", "x402-default-handling", "x402-streaming-pay"],
  custom:     ["x402-basic-pay", "x402-retry-on-402"],
};

function selectScenarios(cfg: AgentConfiguration): string[] {
  // Derive agent type from the first segment of the agentId (e.g. "payment-agent-001" → "payment")
  const prefix = cfg.agentId.split("-")[0] as keyof typeof SCENARIO_MAP;
  return SCENARIO_MAP[prefix] ?? SCENARIO_MAP["custom"];
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

function generateSubmissionId(): string {
  const ts   = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `sub_${ts}_${rand}`;
}

export function submitAgent(
  cfg: AgentConfiguration,
  opts: { skipPreflight?: boolean } = {}
): { receipt: SubmissionReceipt; preflight: PreflightResult } {
  const preflight = runPreflightChecks(cfg);

  if (!opts.skipPreflight && !preflight.passed) {
    throw new Error(
      `Pre-flight failed: ${preflight.checks
        .filter(c => !c.passed)
        .map(c => c.detail)
        .join("; ")}`
    );
  }

  const scenarioIds = selectScenarios(cfg);
  // ~45 s per scenario as a rough estimate
  const estimatedDurationMs = scenarioIds.length * 45_000;

  const receipt: SubmissionReceipt = {
    submissionId:        generateSubmissionId(),
    agentId:             cfg.agentId,
    configHash:          cfg.configHash,
    submittedAt:         new Date().toISOString(),
    estimatedDurationMs,
    status:              "queued",
    scenarioIds,
  };

  return { receipt, preflight };
}
