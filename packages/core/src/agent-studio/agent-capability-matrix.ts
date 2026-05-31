/**
 * Agent Studio v2 — Capability Matrix
 *
 * Maps agent-declared capabilities to the x402 benchmark scenarios that
 * exercise each one.  Used by the PipelineOrchestrator to automatically
 * select the minimal set of stages needed for a given agent, and by the
 * BenchmarkReportGenerator to calculate scenario coverage percentages.
 *
 * Capability taxonomy (v2):
 *   payment          — basic x402 payment flow
 *   payment.retry    — retry on 402 / transient errors
 *   payment.budget   — budget enforcement and alerting
 *   kyc.basic        — name + DOB verification
 *   kyc.standard     — document scan
 *   kyc.enhanced     — liveness + address proof
 *   risk.scoring     — transaction risk evaluation
 *   risk.blocking    — block high-risk payments
 *   audit.trail      — append-only audit log
 *   audit.verify     — hash-chain verification
 *   ratelimit        — outbound rate limiting
 *   circuit.breaker  — circuit-breaker protection
 *   multi.currency   — normalise and convert currencies
 *   webhook          — receive and process webhook events
 *   direct.debit     — scheduled direct debit flows
 *
 * Usage:
 *
 *   import { AgentCapabilityMatrix } from
 *     "@workspace/core/agent-studio/agent-capability-matrix";
 *
 *   const matrix = new AgentCapabilityMatrix();
 *   matrix.register("agent-001", ["payment", "payment.retry", "kyc.standard"]);
 *
 *   const scenarios = matrix.scenariosFor("agent-001");
 *   const coverage  = matrix.coveragePct("agent-001");
 *   console.log(matrix.toMarkdown("agent-001"));
 */

// ---------------------------------------------------------------------------
// Capability taxonomy
// ---------------------------------------------------------------------------

export type AgentCapability =
  | "payment"
  | "payment.retry"
  | "payment.budget"
  | "kyc.basic"
  | "kyc.standard"
  | "kyc.enhanced"
  | "risk.scoring"
  | "risk.blocking"
  | "audit.trail"
  | "audit.verify"
  | "ratelimit"
  | "circuit.breaker"
  | "multi.currency"
  | "webhook"
  | "direct.debit";

export const ALL_CAPABILITIES: AgentCapability[] = [
  "payment", "payment.retry", "payment.budget",
  "kyc.basic", "kyc.standard", "kyc.enhanced",
  "risk.scoring", "risk.blocking",
  "audit.trail", "audit.verify",
  "ratelimit", "circuit.breaker", "multi.currency",
  "webhook", "direct.debit",
];

// ---------------------------------------------------------------------------
// Scenario → capability mapping
// ---------------------------------------------------------------------------

export type ScenarioMapping = {
  scenarioId:    string;
  scenarioName:  string;
  requires:      AgentCapability[];   // all must be present
  optional?:     AgentCapability[];   // any adds coverage bonus
  weight:        number;              // relative importance 1–5
};

const SCENARIO_REGISTRY: ScenarioMapping[] = [
  { scenarioId: "s001", scenarioName: "Basic x402 payment",              requires: ["payment"],                                    weight: 5 },
  { scenarioId: "s002", scenarioName: "Payment with retry on 402",       requires: ["payment", "payment.retry"],                   weight: 4 },
  { scenarioId: "s003", scenarioName: "Budget cap enforcement",          requires: ["payment", "payment.budget"],                  weight: 4 },
  { scenarioId: "s004", scenarioName: "KYC gate — basic",               requires: ["kyc.basic"],                                  weight: 3 },
  { scenarioId: "s005", scenarioName: "KYC gate — standard",            requires: ["kyc.standard"],                               weight: 3 },
  { scenarioId: "s006", scenarioName: "KYC gate — enhanced",            requires: ["kyc.enhanced"],                              weight: 2 },
  { scenarioId: "s007", scenarioName: "Risk scoring on payment",        requires: ["payment", "risk.scoring"],                   weight: 4 },
  { scenarioId: "s008", scenarioName: "High-risk payment blocked",      requires: ["payment", "risk.blocking"],                  weight: 4 },
  { scenarioId: "s009", scenarioName: "Audit trail integrity",          requires: ["audit.trail", "audit.verify"],               weight: 5 },
  { scenarioId: "s010", scenarioName: "Rate-limited payment burst",     requires: ["payment", "ratelimit"],                      weight: 3 },
  { scenarioId: "s011", scenarioName: "Circuit breaker on failure",     requires: ["payment", "circuit.breaker"],                weight: 4 },
  { scenarioId: "s012", scenarioName: "Multi-currency conversion",      requires: ["payment", "multi.currency"],                 weight: 3 },
  { scenarioId: "s013", scenarioName: "Webhook confirmation",           requires: ["payment", "webhook"],                        weight: 3 },
  { scenarioId: "s014", scenarioName: "Direct debit schedule",         requires: ["direct.debit"],                              weight: 2 },
  { scenarioId: "s015", scenarioName: "Full x402 compliance suite",    requires: ["payment", "payment.retry", "kyc.standard", "audit.trail", "risk.scoring"], weight: 5 },
];

// ---------------------------------------------------------------------------
// Coverage result
// ---------------------------------------------------------------------------

export type CapabilityCoverage = {
  agentId:          string;
  declared:         AgentCapability[];
  supportedScenarios: ScenarioMapping[];
  unsupportedScenarios: ScenarioMapping[];
  coveragePct:      number;   // weighted coverage 0–100
  missingCapabilities: AgentCapability[];
};

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

export class AgentCapabilityMatrix {
  private registry = new Map<string, Set<AgentCapability>>();

  // ── Registration ──────────────────────────────────────────────────────────

  register(agentId: string, capabilities: AgentCapability[]): void {
    this.registry.set(agentId, new Set(capabilities));
  }

  add(agentId: string, capability: AgentCapability): void {
    const s = this.registry.get(agentId) ?? new Set();
    s.add(capability);
    this.registry.set(agentId, s);
  }

  remove(agentId: string, capability: AgentCapability): void {
    this.registry.get(agentId)?.delete(capability);
  }

  capabilities(agentId: string): AgentCapability[] {
    return [...(this.registry.get(agentId) ?? [])];
  }

  // ── Scenario resolution ───────────────────────────────────────────────────

  scenariosFor(agentId: string): ScenarioMapping[] {
    const caps = this.registry.get(agentId) ?? new Set();
    return SCENARIO_REGISTRY.filter(s => s.requires.every(r => caps.has(r)));
  }

  unsupportedFor(agentId: string): ScenarioMapping[] {
    const caps = this.registry.get(agentId) ?? new Set();
    return SCENARIO_REGISTRY.filter(s => !s.requires.every(r => caps.has(r)));
  }

  // ── Coverage ──────────────────────────────────────────────────────────────

  coverage(agentId: string): CapabilityCoverage {
    const declared   = this.capabilities(agentId);
    const supported  = this.scenariosFor(agentId);
    const unsupported = this.unsupportedFor(agentId);

    const totalWeight   = SCENARIO_REGISTRY.reduce((n, s) => n + s.weight, 0);
    const coveredWeight = supported.reduce((n, s) => n + s.weight, 0);
    const coveragePct   = totalWeight > 0 ? (coveredWeight / totalWeight) * 100 : 0;

    // Missing capabilities: union of all required caps in unsupported scenarios not declared
    const caps = new Set(declared);
    const missing = new Set<AgentCapability>();
    for (const s of unsupported) {
      for (const r of s.requires) {
        if (!caps.has(r)) missing.add(r);
      }
    }

    return {
      agentId,
      declared,
      supportedScenarios:   supported,
      unsupportedScenarios: unsupported,
      coveragePct:          Math.round(coveragePct * 10) / 10,
      missingCapabilities:  [...missing],
    };
  }

  coveragePct(agentId: string): number {
    return this.coverage(agentId).coveragePct;
  }

  // ── Gap analysis ──────────────────────────────────────────────────────────

  /** Returns the capabilities that would unlock the most additional scenario weight */
  topGaps(agentId: string, n = 3): Array<{ capability: AgentCapability; unlocksWeight: number }> {
    const declared = this.registry.get(agentId) ?? new Set();
    const gains = new Map<AgentCapability, number>();

    for (const s of this.unsupportedFor(agentId)) {
      for (const r of s.requires) {
        if (!declared.has(r)) {
          gains.set(r, (gains.get(r) ?? 0) + s.weight);
        }
      }
    }

    return [...gains.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([capability, unlocksWeight]) => ({ capability, unlocksWeight }));
  }

  // ── Markdown report ───────────────────────────────────────────────────────

  toMarkdown(agentId: string): string {
    const cov = this.coverage(agentId);
    const gaps = this.topGaps(agentId);

    const icon = (ok: boolean) => ok ? "✅" : "❌";

    const lines = [
      `# Capability Matrix — \`${agentId}\``,
      ``,
      `**Coverage:** ${cov.coveragePct}%  |  **Scenarios supported:** ${cov.supportedScenarios.length} / ${SCENARIO_REGISTRY.length}`,
      ``,
      `## Declared Capabilities`,
      ``,
      ALL_CAPABILITIES.map(c =>
        `- ${icon(cov.declared.includes(c))} \`${c}\``
      ).join("
"),
      ``,
      `## Scenario Coverage`,
      ``,
      `| # | Scenario | Supported | Weight |`,
      `|---|----------|:---------:|-------:|`,
      ...SCENARIO_REGISTRY.map(s => {
        const ok = cov.supportedScenarios.some(x => x.scenarioId === s.scenarioId);
        return `| ${s.scenarioId} | ${s.scenarioName} | ${icon(ok)} | ${s.weight} |`;
      }),
      ``,
      `## Top Capability Gaps`,
      ``,
      gaps.length === 0
        ? "_No gaps — full coverage achieved._"
        : gaps.map(g => `- Add \`${g.capability}\` → unlocks **${g.unlocksWeight}** weight points`).join("
"),
    ];
    return lines.join("
");
  }
}
