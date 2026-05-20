/**
 * Agent Studio — CONFIGURE Block
 *
 * Binds model, tools, payment limits, and retry policy to a defined agent.
 * Produces a sealed AgentConfiguration that the SUBMIT block consumes.
 */

export type ModelProvider = "openai" | "anthropic" | "google" | "mistral" | "local";

export type ToolBinding = {
  toolId: string;
  /** Human-readable label shown in the Studio UI */
  label: string;
  /** Whether the tool is required for the agent type */
  required: boolean;
  /** Optional static parameters injected at runtime */
  params?: Record<string, unknown>;
};

export type PaymentLimits = {
  /** Maximum single-transaction amount in USD cents */
  maxSingleTxUsdCents: number;
  /** Maximum daily cumulative spend in USD cents */
  dailyCapUsdCents: number;
  /** Allowed x402 payment schemes */
  allowedSchemes: Array<"exact" | "streaming" | "subscription">;
  /** Whether the agent may auto-approve payments under the single-tx limit */
  autoApproveBelow: boolean;
};

export type RetryPolicy = {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  /** HTTP status codes that should trigger a retry */
  retryOn: number[];
};

export type AgentConfiguration = {
  agentId: string;
  modelProvider: ModelProvider;
  modelId: string;
  contextWindowTokens: number;
  tools: ToolBinding[];
  paymentLimits: PaymentLimits;
  retryPolicy: RetryPolicy;
  /** ISO 8601 timestamp when this configuration was sealed */
  configuredAt: string;
  /** Opaque hash of the configuration for audit trails */
  configHash: string;
};

const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: 500,
  backoffMultiplier: 2,
  retryOn: [429, 500, 502, 503, 504],
};

const DEFAULT_PAYMENT_LIMITS: PaymentLimits = {
  maxSingleTxUsdCents: 1000,   // $10.00
  dailyCapUsdCents:    50000,  // $500.00
  allowedSchemes:      ["exact", "streaming"],
  autoApproveBelow:    true,
};

function hashConfig(obj: object): string {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  let h = 0x811c9dc5;
  for (const ch of str) {
    h ^= ch.charCodeAt(0);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function configureAgent(
  agentId: string,
  opts: {
    modelProvider: ModelProvider;
    modelId: string;
    contextWindowTokens?: number;
    tools?: ToolBinding[];
    paymentLimits?: Partial<PaymentLimits>;
    retryPolicy?: Partial<RetryPolicy>;
  }
): AgentConfiguration {
  const limits: PaymentLimits = {
    ...DEFAULT_PAYMENT_LIMITS,
    ...(opts.paymentLimits ?? {}),
    allowedSchemes: opts.paymentLimits?.allowedSchemes ?? DEFAULT_PAYMENT_LIMITS.allowedSchemes,
  };

  const retry: RetryPolicy = {
    ...DEFAULT_RETRY,
    ...(opts.retryPolicy ?? {}),
    retryOn: opts.retryPolicy?.retryOn ?? DEFAULT_RETRY.retryOn,
  };

  const core = {
    agentId,
    modelProvider: opts.modelProvider,
    modelId:       opts.modelId,
    contextWindowTokens: opts.contextWindowTokens ?? 128_000,
    tools:         opts.tools ?? [],
    paymentLimits: limits,
    retryPolicy:   retry,
  };

  return {
    ...core,
    configuredAt: new Date().toISOString(),
    configHash:   hashConfig(core),
  };
}

export function validateConfiguration(cfg: AgentConfiguration): string[] {
  const errs: string[] = [];

  if (!cfg.agentId)   errs.push("agentId is required");
  if (!cfg.modelId)   errs.push("modelId is required");
  if (cfg.paymentLimits.maxSingleTxUsdCents > cfg.paymentLimits.dailyCapUsdCents)
    errs.push("maxSingleTxUsdCents cannot exceed dailyCapUsdCents");
  if (cfg.retryPolicy.maxAttempts < 1 || cfg.retryPolicy.maxAttempts > 10)
    errs.push("retryPolicy.maxAttempts must be between 1 and 10");
  if (cfg.contextWindowTokens < 4096)
    errs.push("contextWindowTokens must be at least 4 096");

  const requiredMissing = cfg.tools
    .filter(t => t.required)
    .filter(t => !t.toolId)
    .map(t => `required tool "${t.label}" has no toolId`);
  errs.push(...requiredMissing);

  return errs;
}
