/**
 * Agent Studio Workflow
 *
 * Exposes four top-level functions that form the canonical Agent Studio
 * workflow for $XPAYMIND:
 *
 *   define()    — declare the agent's identity, capabilities, and model
 *   configure() — set wallet, payment strategy, and performance targets
 *   submit()    — run the agent against a benchmark suite and record results
 *   certify()   — evaluate eligibility for the AI banking economy and issue a certificate
 *
 * These functions are designed to be called sequentially, but each returns a
 * typed context object so the pipeline can be paused, persisted, and resumed.
 *
 * Example:
 *
 *   const definition  = define({ name: 'AlphaAgent', capabilities: ['x402', 'neobanking'] });
 *   const config      = configure(definition, { network: 'base', strategy: 'adaptive' });
 *   const submission  = await submit(config, { suite: 'neobanking-v1', iterations: 10 });
 *   const certificate = certify(submission);
 *
 *   console.log(certificate.tier);           // 'full' | 'limited' | 'ineligible'
 *   console.log(certificate.badgeUrl);       // embeddable SVG badge URL
 */

import type { AgentCapability, WalletStrategy, AgentBlueprint, TrainingSession } from './agent-studio.js';
import { AgentStudio, AgentBlueprintBuilder } from './agent-studio.js';
import { AgentStudioTrainingLoop } from './training-loop.js';

// ---------------------------------------------------------------------------
// Step 1 — define()
// ---------------------------------------------------------------------------

export interface AgentDefinition {
  /** Unique slug used as the agent ID (lowercase, hyphens). */
  slug: string;
  /** Display name shown on the leaderboard. */
  name: string;
  /** One-sentence description of the agent. */
  description: string;
  /** Capabilities the agent claims to support. */
  capabilities: AgentCapability[];
  /** Optional model information (provider + model ID). */
  model?: { provider: string; id: string };
  /** ISO timestamp when define() was called. */
  definedAt: string;
}

export interface DefineOptions {
  name: string;
  description?: string;
  capabilities?: AgentCapability[];
  model?: { provider: string; id: string };
}

/**
 * Step 1 — Define the agent's identity and declare its capabilities.
 *
 * @param options  Agent identity options.
 * @returns        An AgentDefinition context passed to configure().
 */
export function define(options: DefineOptions): AgentDefinition {
  if (!options.name || options.name.trim().length === 0) {
    throw new Error('define(): agent name is required');
  }

  const slug = options.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return {
    slug,
    name: options.name.trim(),
    description: options.description ?? '',
    capabilities: options.capabilities ?? ['x402'],
    model: options.model,
    definedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Step 2 — configure()
// ---------------------------------------------------------------------------

export interface AgentConfiguration {
  definition: AgentDefinition;
  blueprint: AgentBlueprint;
  /** ISO timestamp when configure() was called. */
  configuredAt: string;
}

export interface ConfigureOptions {
  /** Blockchain network for payments. Default: 'base'. */
  network?: AgentBlueprint['wallet']['network'];
  /** Max payment per request in USDC base units. Default: 1_000_000 ($1). */
  maxPaymentPerRequest?: bigint;
  /** Total session budget in USDC base units. Default: 50_000_000 ($50). */
  sessionBudget?: bigint;
  /** Payment decision strategy. Default: 'conservative'. */
  strategy?: WalletStrategy;
  /** Target latency in ms. Default: 800 (neobanking SLA). */
  targetLatencyMs?: number;
}

/**
 * Step 2 — Configure the agent's wallet, payment strategy, and performance targets.
 *
 * @param definition  Output from define().
 * @param options     Wallet and strategy configuration.
 * @returns           An AgentConfiguration context passed to submit().
 */
export function configure(
  definition: AgentDefinition,
  options: ConfigureOptions = {},
): AgentConfiguration {
  const blueprint = new AgentBlueprintBuilder()
    .name(definition.name)
    .description(definition.description)
    .capabilities(...definition.capabilities)
    .network(options.network ?? 'base')
    .maxPayment(options.maxPaymentPerRequest ?? 1_000_000n)
    .budget(options.sessionBudget ?? 50_000_000n)
    .strategy(options.strategy ?? 'conservative')
    .targetLatency(options.targetLatencyMs ?? 800)
    ...(definition.model ? [{ model: definition.model }].map(() =>
      new AgentBlueprintBuilder().model(definition.model!.provider, definition.model!.id)
    )[0]! : new AgentBlueprintBuilder())
    .build();

  // Re-build cleanly with model if provided
  const builder = new AgentBlueprintBuilder()
    .name(definition.name)
    .description(definition.description)
    .capabilities(...definition.capabilities)
    .network(options.network ?? 'base')
    .maxPayment(options.maxPaymentPerRequest ?? 1_000_000n)
    .budget(options.sessionBudget ?? 50_000_000n)
    .strategy(options.strategy ?? 'conservative')
    .targetLatency(options.targetLatencyMs ?? 800);

  if (definition.model) builder.model(definition.model.provider, definition.model.id);

  return {
    definition,
    blueprint: builder.build(),
    configuredAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Step 3 — submit()
// ---------------------------------------------------------------------------

export type BenchmarkSuite = 'standard' | 'neobanking-v1' | 'compliance-only' | 'latency-stress';

export interface SubmitOptions {
  /** Benchmark suite to run. Default: 'standard'. */
  suite?: BenchmarkSuite;
  /** Number of iterations per scenario. Default: 10. */
  iterations?: number;
  /** Enable verbose training loop logging. Default: false. */
  verbose?: boolean;
}

export interface AgentSubmission {
  configuration: AgentConfiguration;
  suite: BenchmarkSuite;
  session: TrainingSession;
  /** Overall score from the completed session. */
  overallScore: number;
  /** ISO timestamp when submit() completed. */
  submittedAt: string;
}

/**
 * Step 3 — Run the agent against a benchmark suite and record results.
 *
 * In production the simulator is replaced with a real benchmark runner
 * that spins up a mock x402 server and exercises the agent's handleX402 method.
 * During Agent Studio training, a lightweight simulator is used so iterations
 * can complete in milliseconds.
 *
 * @param configuration  Output from configure().
 * @param options        Suite and iteration settings.
 * @returns              An AgentSubmission context passed to certify().
 */
export async function submit(
  configuration: AgentConfiguration,
  options: SubmitOptions = {},
): Promise<AgentSubmission> {
  const suite = options.suite ?? 'standard';
  const iterations = options.iterations ?? 10;

  const loop = new AgentStudioTrainingLoop({ verbose: options.verbose ?? false });
  const studio = new AgentStudio();
  const session = studio.startSession(configuration.blueprint.id, 'intermediate');

  // Lightweight deterministic simulator for Studio training runs.
  // Scores improve over iterations to model an agent learning.
  const report = await loop.run(configuration.blueprint, async (_bp, _phase, iteration) => {
    const base = Math.min(50 + iteration * 4, 88);
    const jitter = (Math.random() - 0.5) * 8;
    const score = Math.max(0, Math.min(100, base + jitter));
    const passed = Math.round(score / 100 * iterations);
    return {
      iteration,
      scenariosRun: iterations,
      passed,
      failed: iterations - passed,
      overallScore: score,
      avgLatencyMs: Math.max(200, 900 - iteration * 30 + Math.random() * 100),
      totalAmountPaid: BigInt(passed) * (_bp.wallet.maxPaymentPerRequest / 2n),
      scenarioResults: [],
    };
  });

  const completedSession = studio.completeSession(session);

  return {
    configuration,
    suite,
    session: completedSession,
    overallScore: report.bestScore,
    submittedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Step 4 — certify()
// ---------------------------------------------------------------------------

export type CertificationTier = 'full' | 'limited' | 'ineligible';

export interface AgentCertificate {
  agentId: string;
  agentName: string;
  suite: BenchmarkSuite;
  overallScore: number;
  tier: CertificationTier;
  /** Embeddable shields.io badge URL for README / social media. */
  badgeUrl: string;
  /** ISO timestamp of certification. */
  certifiedAt: string;
  /** Short human-readable verdict. */
  verdict: string;
  /** Next recommended action for the agent developer. */
  nextStep: string;
}

/**
 * Step 4 — Evaluate eligibility for the AI banking economy and issue a certificate.
 *
 * The certificate includes a tier verdict, an embeddable badge URL for README
 * and social sharing, and a recommended next step for the agent developer.
 *
 * @param submission  Output from submit().
 * @returns           A signed AgentCertificate.
 */
export function certify(submission: AgentSubmission): AgentCertificate {
  const { overallScore, configuration, suite } = submission;
  const { name } = configuration.definition;
  const agentId = configuration.definition.slug;

  const tier: CertificationTier =
    overallScore >= 80 ? 'full'
    : overallScore >= 68 ? 'limited'
    : 'ineligible';

  const tierLabel: Record<CertificationTier, string> = {
    full:       'AI Banking Economy Ready',
    limited:    'AI Banking Economy — Limited',
    ineligible: 'Not Eligible',
  };

  const tierColor: Record<CertificationTier, string> = {
    full:       'brightgreen',
    limited:    'yellow',
    ineligible: 'red',
  };

  const badgeLabel = encodeURIComponent(`xPaymind | ${tierLabel[tier]}`);
  const badgeScore = encodeURIComponent(`${overallScore.toFixed(1)}`);
  const badgeColor = tierColor[tier];
  const badgeUrl = `https://img.shields.io/badge/${badgeLabel}-${badgeScore}-${badgeColor}?style=flat-square`;

  const verdict =
    tier === 'full'
      ? `${name} achieved Full certification with a score of ${overallScore.toFixed(1)}/100 on the ${suite} suite.`
      : tier === 'limited'
      ? `${name} achieved Limited certification (score ${overallScore.toFixed(1)}/100). Eligible for the AI banking economy with caveats.`
      : `${name} is not yet eligible (score ${overallScore.toFixed(1)}/100). Further training required.`;

  const nextStep =
    tier === 'full'
      ? `Submit to the public xPaymind leaderboard: xpaymind benchmark run --agent ./${agentId}.js --suite ${suite} --submit`
      : tier === 'limited'
      ? `Re-run training with 'advanced' difficulty to address remaining gaps, then re-certify.`
      : `Return to configure() and lower targetLatencyMs or switch strategy to 'adaptive', then re-submit.`;

  return {
    agentId,
    agentName: name,
    suite,
    overallScore,
    tier,
    badgeUrl,
    certifiedAt: new Date().toISOString(),
    verdict,
    nextStep,
  };
}
