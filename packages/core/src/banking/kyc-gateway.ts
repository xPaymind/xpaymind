/**
 * Banking Integration — KYC Verification Gateway
 *
 * Orchestrates Know Your Customer (KYC) checks for AI agents before
 * high-value or regulated payment flows are executed.
 *
 * Supports tiered verification levels:
 *   - basic   : name + date of birth match
 *   - standard: basic + document scan (ID / passport)
 *   - enhanced: standard + liveness check + address proof
 *
 * Results are cached per identity and expire according to the provider's TTL.
 * The gateway integrates with the x402 KYC gate scenario in the benchmark suite.
 *
 * Usage:
 *
 *   import { KYCGateway } from "@workspace/core/banking/kyc-gateway";
 *
 *   const kyc = new KYCGateway({ requiredLevel: "standard" });
 *   const result = await kyc.verify({ agentId, identityId, level: "standard" });
 *   if (!result.passed) throw new Error(result.failureReason);
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KYCLevel = "basic" | "standard" | "enhanced";

export type KYCStatus =
  | "not_started"
  | "pending"
  | "passed"
  | "failed"
  | "expired"
  | "manual_review";

export type KYCCheck = {
  name:    string;
  passed:  boolean;
  detail?: string;
};

export type KYCResult = {
  verificationId: string;
  identityId:     string;
  agentId:        string;
  level:          KYCLevel;
  status:         KYCStatus;
  passed:         boolean;
  checks:         KYCCheck[];
  failureReason?: string;
  verifiedAt:     string;
  expiresAt:      string;
  /** Risk band produced by the KYC provider: low / medium / high */
  riskBand:       "low" | "medium" | "high";
};

export type KYCCacheEntry = {
  result:    KYCResult;
  cachedAt:  string;
  expiresAt: string;
};

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface KYCProvider {
  readonly providerId: string;
  /** Perform the KYC checks for a given level */
  verify(identityId: string, level: KYCLevel): Promise<KYCProviderResult>;
  /** TTL in ms for a passed result at each level */
  cacheTtlMs(level: KYCLevel): number;
}

export type KYCProviderResult = {
  passed:         boolean;
  checks:         KYCCheck[];
  failureReason?: string;
  riskBand:       "low" | "medium" | "high";
};

// ---------------------------------------------------------------------------
// Built-in stub provider (replace with real KYC vendor SDK in production)
// ---------------------------------------------------------------------------

class StubKYCProvider implements KYCProvider {
  readonly providerId = "stub";

  async verify(identityId: string, level: KYCLevel): Promise<KYCProviderResult> {
    const checks: KYCCheck[] = [
      {
        name:   "name-dob-match",
        passed: true,
        detail: "name and date of birth matched against registry",
      },
    ];

    if (level === "standard" || level === "enhanced") {
      checks.push({
        name:   "document-scan",
        passed: !identityId.includes("invalid"),
        detail: "government-issued ID scanned and verified",
      });
    }

    if (level === "enhanced") {
      checks.push(
        {
          name:   "liveness-check",
          passed: true,
          detail: "biometric liveness detection passed",
        },
        {
          name:   "address-proof",
          passed: true,
          detail: "utility bill dated within 90 days verified",
        }
      );
    }

    const passed        = checks.every(c => c.passed);
    const failureReason = passed
      ? undefined
      : checks.find(c => !c.passed)?.detail ?? "verification failed";

    return {
      passed,
      checks,
      failureReason,
      riskBand: passed ? "low" : "high",
    };
  }

  cacheTtlMs(level: KYCLevel): number {
    return { basic: 86_400_000, standard: 604_800_000, enhanced: 2_592_000_000 }[level];
  }
}

// ---------------------------------------------------------------------------
// Gateway options
// ---------------------------------------------------------------------------

export type KYCGatewayOptions = {
  /** Minimum KYC level required; requests below this level are auto-rejected */
  requiredLevel?: KYCLevel;
  /** Custom KYC provider; defaults to the built-in stub */
  provider?:      KYCProvider;
  onVerified?:    (result: KYCResult) => void;
  onFailed?:      (result: KYCResult) => void;
};

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

export class KYCGateway {
  private cache    = new Map<string, KYCCacheEntry>();
  private provider: KYCProvider;
  private required: KYCLevel;
  private opts:     KYCGatewayOptions;

  private readonly levelOrder: KYCLevel[] = ["basic", "standard", "enhanced"];

  constructor(opts: KYCGatewayOptions = {}) {
    this.opts     = opts;
    this.provider = opts.provider  ?? new StubKYCProvider();
    this.required = opts.requiredLevel ?? "basic";
  }

  // ── Verify ────────────────────────────────────────────────────────────────

  async verify(req: {
    agentId:    string;
    identityId: string;
    level:      KYCLevel;
  }): Promise<KYCResult> {
    // Reject if requested level is below gateway minimum
    if (this.levelOrder.indexOf(req.level) < this.levelOrder.indexOf(this.required)) {
      const result = this.buildResult(req, {
        passed:         false,
        checks:         [],
        failureReason:  `requested level "${req.level}" is below required "${this.required}"`,
        riskBand:       "high",
      }, "failed");
      this.opts.onFailed?.(result);
      return result;
    }

    // Cache hit
    const cacheKey = `${req.identityId}:${req.level}`;
    const cached   = this.cache.get(cacheKey);
    if (cached && new Date(cached.expiresAt).getTime() > Date.now()) {
      return cached.result;
    }

    // Call provider
    const providerResult = await this.provider.verify(req.identityId, req.level);
    const status: KYCStatus = providerResult.passed ? "passed" : "failed";
    const result = this.buildResult(req, providerResult, status);

    // Cache passed results
    if (providerResult.passed) {
      this.cache.set(cacheKey, {
        result,
        cachedAt:  new Date().toISOString(),
        expiresAt: result.expiresAt,
      });
      this.opts.onVerified?.(result);
    } else {
      this.opts.onFailed?.(result);
    }

    return result;
  }

  private buildResult(
    req:    { agentId: string; identityId: string; level: KYCLevel },
    pr:     KYCProviderResult,
    status: KYCStatus
  ): KYCResult {
    const now      = new Date();
    const ttl      = this.provider.cacheTtlMs(req.level);
    const expiresAt = new Date(now.getTime() + ttl).toISOString();

    return {
      verificationId: `kyc_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      identityId:     req.identityId,
      agentId:        req.agentId,
      level:          req.level,
      status,
      passed:         pr.passed,
      checks:         pr.checks,
      failureReason:  pr.failureReason,
      verifiedAt:     now.toISOString(),
      expiresAt,
      riskBand:       pr.riskBand,
    };
  }

  // ── Cache management ──────────────────────────────────────────────────────

  invalidate(identityId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(identityId)) this.cache.delete(key);
    }
  }

  cacheSize(): number { return this.cache.size; }

  // ── Report ────────────────────────────────────────────────────────────────

  formatResult(r: KYCResult): string {
    const icon   = r.passed ? "✓" : "✗";
    const lines  = [
      `${icon} KYC ${r.status.toUpperCase()}  [${r.level}]  risk: ${r.riskBand}`,
      `  Identity : ${r.identityId}`,
      `  Agent    : ${r.agentId}`,
      `  Verified : ${r.verifiedAt}`,
      `  Expires  : ${r.expiresAt}`,
      ...r.checks.map(c => `  ${c.passed ? "✓" : "✗"} ${c.name}${c.detail ? "  — " + c.detail : ""}`),
      r.failureReason ? `  Reason   : ${r.failureReason}` : "",
    ];
    return lines.filter(Boolean).join("\n");
  }
}
