/**
 * Agent Studio v2 — Configuration Schema
 *
 * Centralises and validates all runtime configuration for Agent Studio 2.0
 * components.  Based on plain TypeScript types with a lightweight Zod-style
 * validation layer (no external dependencies — uses guard functions).
 *
 * Config sections:
 *   pipeline   — orchestrator concurrency, timeouts, retry defaults
 *   rateLimit  — token-bucket defaults, per-currency and per-agent overrides
 *   circuitBreaker — failure threshold, cooldown, probe count
 *   budget     — session budget cap, alert threshold
 *   health     — stale threshold, success-rate thresholds, latency drift cap
 *   audit      — max entries, hash algorithm selection
 *   scoreboard — half-life, domain weights, leaderboard top-N
 *   plugins    — list of plugin IDs to auto-install
 *
 * Usage:
 *
 *   import { parseStudioConfig } from
 *     "@workspace/core/agent-studio/studio-config-schema";
 *
 *   const config = parseStudioConfig({
 *     pipeline: { concurrency: 4, defaultTimeoutMs: 15_000 },
 *     budget:   { limitCents: 5_000, alertAtPct: 75 },
 *   });
 */

// ---------------------------------------------------------------------------
// Sub-configs
// ---------------------------------------------------------------------------

export type PipelineConfig = {
  /** Max concurrent stages; undefined = unlimited */
  concurrency?:        number;
  defaultTimeoutMs?:   number;   // default: 30 000
  defaultRetries?:     number;   // default: 0
  defaultRetryDelayMs?: number;  // default: 1 000
};

export type RateLimitConfig = {
  defaultRate?:         number;   // tokens/s; default: 10
  defaultBurst?:        number;   // default: 25
  maxWaitMs?:           number;   // default: 2 000
  currencyOverrides?:   Record<string, { rate: number; burst: number }>;
  agentOverrides?:      Record<string, { rate: number; burst: number }>;
};

export type CircuitBreakerConfig = {
  failureThreshold?:   number;   // default: 5
  cooldownMs?:         number;   // default: 30 000
  halfOpenProbes?:     number;   // default: 1
};

export type BudgetConfig = {
  /** Max total spending per agent session in USD cents */
  limitCents?:         number;   // default: 10 000 ($100)
  /** Emit budget.alert when usage exceeds this percentage */
  alertAtPct?:         number;   // default: 80
};

export type HealthConfig = {
  staleThresholdMs?:     number;  // default: 60 000
  degradedSuccessRate?:  number;  // default: 0.90
  unhealthySuccessRate?: number;  // default: 0.70
  degradedLatencyDrift?: number;  // % drift; default: 50
  degradedEpm?:          number;  // errors/min; default: 5
  degradedBudgetUtil?:   number;  // % budget; default: 80
};

export type AuditConfig = {
  maxEntries?:   number;   // default: 10 000
  /** "fnv1a" (fast, built-in) | "sha256" (secure, requires crypto) */
  hashAlgorithm?: "fnv1a" | "sha256";
};

export type ScoreboardConfig = {
  halfLifeMs?:  number;   // score decay half-life; default: 7 days
  domainWeights?: Record<string, number>;
  topN?:        number;   // leaderboard size; default: 25
};

export type PluginsConfig = {
  /** Plugin IDs to auto-install on boot; default: ["logging"] */
  autoInstall?: string[];
  logging?:     { prefix?: string; verbose?: boolean };
  metrics?:     Record<string, never>;
};

// ---------------------------------------------------------------------------
// Root config
// ---------------------------------------------------------------------------

export type StudioConfig = {
  agentId?:       string;
  version?:       string;   // semver of the agent being configured
  pipeline?:      PipelineConfig;
  rateLimit?:     RateLimitConfig;
  circuitBreaker?: CircuitBreakerConfig;
  budget?:        BudgetConfig;
  health?:        HealthConfig;
  audit?:         AuditConfig;
  scoreboard?:    ScoreboardConfig;
  plugins?:       PluginsConfig;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: Required<StudioConfig> = {
  agentId:  "default-agent",
  version:  "2.0.0",
  pipeline: {
    concurrency:         undefined,
    defaultTimeoutMs:    30_000,
    defaultRetries:      0,
    defaultRetryDelayMs: 1_000,
  },
  rateLimit: {
    defaultRate:       10,
    defaultBurst:      25,
    maxWaitMs:         2_000,
    currencyOverrides: {},
    agentOverrides:    {},
  },
  circuitBreaker: {
    failureThreshold: 5,
    cooldownMs:       30_000,
    halfOpenProbes:   1,
  },
  budget: {
    limitCents: 10_000,
    alertAtPct: 80,
  },
  health: {
    staleThresholdMs:     60_000,
    degradedSuccessRate:  0.90,
    unhealthySuccessRate: 0.70,
    degradedLatencyDrift: 50,
    degradedEpm:          5,
    degradedBudgetUtil:   80,
  },
  audit: {
    maxEntries:    10_000,
    hashAlgorithm: "fnv1a",
  },
  scoreboard: {
    halfLifeMs:    7 * 24 * 60 * 60 * 1_000,
    domainWeights: {},
    topN:          25,
  },
  plugins: {
    autoInstall: ["logging"],
    logging:     {},
    metrics:     {},
  },
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ConfigError = { path: string; message: string };

export type ParseResult =
  | { ok: true;  config: Required<StudioConfig> }
  | { ok: false; errors: ConfigError[] };

function err(path: string, message: string): ConfigError {
  return { path, message };
}

export function validateStudioConfig(raw: StudioConfig): ConfigError[] {
  const errors: ConfigError[] = [];

  if (raw.pipeline?.concurrency !== undefined && raw.pipeline.concurrency < 1) {
    errors.push(err("pipeline.concurrency", "must be ≥ 1"));
  }
  if (raw.pipeline?.defaultTimeoutMs !== undefined && raw.pipeline.defaultTimeoutMs < 100) {
    errors.push(err("pipeline.defaultTimeoutMs", "must be ≥ 100 ms"));
  }
  if (raw.rateLimit?.defaultRate !== undefined && raw.rateLimit.defaultRate <= 0) {
    errors.push(err("rateLimit.defaultRate", "must be > 0"));
  }
  if (raw.rateLimit?.defaultBurst !== undefined && raw.rateLimit.defaultBurst < 1) {
    errors.push(err("rateLimit.defaultBurst", "must be ≥ 1"));
  }
  if (raw.circuitBreaker?.failureThreshold !== undefined && raw.circuitBreaker.failureThreshold < 1) {
    errors.push(err("circuitBreaker.failureThreshold", "must be ≥ 1"));
  }
  if (raw.budget?.limitCents !== undefined && raw.budget.limitCents < 0) {
    errors.push(err("budget.limitCents", "must be ≥ 0"));
  }
  if (raw.budget?.alertAtPct !== undefined && (raw.budget.alertAtPct < 0 || raw.budget.alertAtPct > 100)) {
    errors.push(err("budget.alertAtPct", "must be 0–100"));
  }
  if (raw.health?.degradedSuccessRate !== undefined && (raw.health.degradedSuccessRate < 0 || raw.health.degradedSuccessRate > 1)) {
    errors.push(err("health.degradedSuccessRate", "must be 0–1"));
  }
  if (raw.scoreboard?.topN !== undefined && raw.scoreboard.topN < 1) {
    errors.push(err("scoreboard.topN", "must be ≥ 1"));
  }

  return errors;
}

export function parseStudioConfig(raw: StudioConfig): Required<StudioConfig> {
  const errors = validateStudioConfig(raw);
  if (errors.length > 0) {
    const messages = errors.map(e => `  ${e.path}: ${e.message}`).join("\n");
    throw new Error(`Invalid StudioConfig:\n${messages}`);
  }
  return deepMerge(DEFAULT_CONFIG, raw) as Required<StudioConfig>;
}

export function parseStudioConfigSafe(raw: StudioConfig): ParseResult {
  const errors = validateStudioConfig(raw);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: deepMerge(DEFAULT_CONFIG, raw) as Required<StudioConfig> };
}

// ---------------------------------------------------------------------------
// Deep merge helper
// ---------------------------------------------------------------------------

function deepMerge(base: unknown, override: unknown): unknown {
  if (typeof base !== "object" || typeof override !== "object" || !base || !override) {
    return override ?? base;
  }
  const result: Record<string, unknown> = { ...(base as object) };
  for (const [k, v] of Object.entries(override as object)) {
    result[k] = deepMerge(result[k], v);
  }
  return result;
}
