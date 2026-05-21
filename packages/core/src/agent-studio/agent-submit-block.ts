/**
 * Agent Studio — SUBMIT Block  v1.1.0
 *
 * Release notes (v1.1.0 — 2026-05-21):
 *  - Added SubmitOptions.dryRun: validates without enqueuing
 *  - Added SubmitOptions.priority: "low" | "normal" | "high"
 *  - Pre-flight now checks tool-coverage against scenario requirements
 *  - submitAgent() returns enriched SubmissionReceipt with queuePosition
 *  - Exported submitAgentDryRun() convenience wrapper
 *  - SubmissionReceipt includes schemaVersion for forward-compat
 */

import type { AgentConfiguration } from "./agent-configure-block";

export const SUBMIT_SCHEMA_VERSION = "1.1.0";

export type SubmissionStatus =
  | "queued"
  | "running"
  | "scoring"
  | "completed"
  | "failed";

export type SubmitPriority = "low" | "normal" | "high";

export type PreflightCheck = {
  name:   string;
  passed: boolean;
  detail?: string;
};

export type PreflightResult = {
  passed: boolean;
  checks: PreflightCheck[];
};

export type SubmissionReceipt = {
  schemaVersion:       string;
  submissionId:        string;
  agentId:             string;
  configHash:          string;
  submittedAt:         string;
  estimatedDurationMs: number;
  status:              SubmissionStatus;
  priority:            SubmitPriority;
  /** Approximate position in the benchmark queue (1 = next up) */
  queuePosition:       number;
  scenarioIds:         string[];
  /** True when submitted with dryRun — no actual benchmarking is queued */
  dryRun:              boolean;
};

// ---------------------------------------------------------------------------
// Pre-flight checks
// ---------------------------------------------------------------------------

const REQUIRED_TOOLS_BY_SCENARIO: Record<string, string[]> = {
  "x402-streaming-pay":  ["stream-session-manager"],
  "x402-kyc-gate":       ["kyc-verifier"],
  "x402-aml-flag":       ["sanctions-checker"],
  "x402-audit-trail":    ["audit-logger"],
  "x402-reconciliation": ["ledger-reader", "audit-logger"],
};

function checkModelSupport(cfg: AgentConfiguration): PreflightCheck {
  const supported = ["openai", "anthropic", "google", "mistral", "local"];
  const ok = supported.includes(cfg.modelProvider);
  return {
    name:   "model-provider-supported",
    passed: ok,
    detail: ok
      ? `${cfg.modelProvider} is supported`
      : `${cfg.modelProvider} is not a supported provider`,
  };
}

function checkPaymentScheme(cfg: AgentConfiguration): PreflightCheck {
  const ok = cfg.paymentLimits.allowedSchemes.length > 0;
  return {
    name:   "payment-scheme-present",
    passed: ok,
    detail: ok
      ? `schemes: ${cfg.paymentLimits.allowedSchemes.join(", ")}`
      : "at least one payment scheme must be declared",
  };
}

function checkContextWindow(cfg: AgentConfiguration): PreflightCheck {
  const ok = cfg.contextWindowTokens >= 8_192;
  return {
    name:   "context-window-adequate",
    passed: ok,
    detail: `${cfg.contextWindowTokens.toLocaleString()} tokens (min 8 192)`,
  };
}

function checkDailyBudget(cfg: AgentConfiguration): PreflightCheck {
  const ok = cfg.paymentLimits.dailyCapUsdCents >= 100;
  return {
    name:   "daily-budget-sufficient",
    passed: ok,
    detail: ok
      ? `$${(cfg.paymentLimits.dailyCapUsdCents / 100).toFixed(2)} daily cap`
      : "daily cap must be at least $1.00",
  };
}

function checkToolCoverage(
  cfg:         AgentConfiguration,
  scenarioIds: string[]
): PreflightCheck {
  const boundToolIds = new Set(cfg.tools.map(t => t.toolId));
  const missing: string[] = [];

  for (const sid of scenarioIds) {
    const required = REQUIRED_TOOLS_BY_SCENARIO[sid] ?? [];
    for (const tool of required) {
      if (!boundToolIds.has(tool)) missing.push(`${tool} (required by ${sid})`);
    }
  }

  return {
    name:   "tool-coverage",
    passed: missing.length === 0,
    detail: missing.length === 0
      ? "all scenario tool requirements satisfied"
      : `missing tools: ${missing.join("; ")}`,
  };
}

export function runPreflightChecks(
  cfg:         AgentConfiguration,
  scenarioIds: string[]
): PreflightResult {
  const checks: PreflightCheck[] = [
    checkModelSupport(cfg),
    checkPaymentScheme(cfg),
    checkContextWindow(cfg),
    checkDailyBudget(cfg),
    checkToolCoverage(cfg, scenarioIds),
  ];
  return { passed: checks.every(c => c.passed), checks };
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
  const prefix = cfg.agentId.split("-")[0] as keyof typeof SCENARIO_MAP;
  return SCENARIO_MAP[prefix] ?? SCENARIO_MAP["custom"];
}

// ---------------------------------------------------------------------------
// Queue simulation
// ---------------------------------------------------------------------------

const PRIORITY_POSITIONS: Record<SubmitPriority, () => number> = {
  high:   () => 1 + Math.floor(Math.random() * 3),
  normal: () => 4 + Math.floor(Math.random() * 8),
  low:    () => 12 + Math.floor(Math.random() * 20),
};

function generateSubmissionId(): string {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type SubmitOptions = {
  /** Skip pre-flight validation and queue immediately (use with caution) */
  skipPreflight?: boolean;
  /** Validate everything but do not actually enqueue the agent */
  dryRun?:        boolean;
  /** Controls queue position; defaults to "normal" */
  priority?:      SubmitPriority;
};

export function submitAgent(
  cfg:  AgentConfiguration,
  opts: SubmitOptions = {}
): { receipt: SubmissionReceipt; preflight: PreflightResult } {
  const priority    = opts.priority ?? "normal";
  const scenarioIds = selectScenarios(cfg);
  const preflight   = runPreflightChecks(cfg, scenarioIds);

  if (!opts.skipPreflight && !preflight.passed) {
    throw new Error(
      `Pre-flight failed: ${preflight.checks
        .filter(c => !c.passed)
        .map(c => c.detail)
        .join("; ")}`
    );
  }

  const queuePosition       = opts.dryRun ? 0 : PRIORITY_POSITIONS[priority]();
  const estimatedDurationMs = scenarioIds.length * 45_000;

  const receipt: SubmissionReceipt = {
    schemaVersion:       SUBMIT_SCHEMA_VERSION,
    submissionId:        generateSubmissionId(),
    agentId:             cfg.agentId,
    configHash:          cfg.configHash,
    submittedAt:         new Date().toISOString(),
    estimatedDurationMs,
    status:              opts.dryRun ? "queued" : "queued",
    priority,
    queuePosition,
    scenarioIds,
    dryRun:              opts.dryRun ?? false,
  };

  return { receipt, preflight };
}

/** Convenience wrapper — validates without enqueuing */
export function submitAgentDryRun(
  cfg:  AgentConfiguration,
  opts: Omit<SubmitOptions, "dryRun"> = {}
): { receipt: SubmissionReceipt; preflight: PreflightResult } {
  return submitAgent(cfg, { ...opts, dryRun: true });
}
