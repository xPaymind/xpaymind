/**
 * Agent Studio
 *
 * Agent Studio is the xPaymind environment for creating, configuring, and
 * training AI agents for x402 payment scenarios and banking integrations.
 *
 * Instead of building an agent from scratch, developers use Agent Studio to:
 *  - Define an AgentBlueprint (capabilities, wallet config, strategy params)
 *  - Run TrainingSessions against progressively harder scenario sets
 *  - Inspect per-iteration feedback and tune agent behaviour
 *  - Export a trained AgentBlueprint ready for the public benchmark
 *
 * Architecture:
 *
 *   AgentStudio
 *     ├─ AgentBlueprintBuilder   — fluent builder for agent config
 *     ├─ TrainingSessionRunner   — runs iterative training loops
 *     ├─ TrainingFeedbackEngine  — generates actionable per-iteration hints
 *     └─ AgentBlueprintExporter  — serialises a trained blueprint to JSON
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type AgentCapability =
  | 'x402'              // core x402 payment handling
  | 'negotiation'       // payment amount negotiation
  | 'neobanking'        // neobanking API integration
  | 'open-banking'      // PSD2 / FAPI Open Banking APIs
  | 'concurrent'        // concurrent payment handling
  | 'error-recovery'    // malformed / expired requirement recovery
  | 'cost-optimisation';// gas & fee minimisation

export type TrainingDifficulty = 'beginner' | 'intermediate' | 'advanced' | 'adversarial';

export type WalletStrategy =
  | 'eager'       // pay immediately, no negotiation
  | 'conservative'// negotiate, refuse if above ceiling
  | 'adaptive';   // learn ceiling from feedback over training iterations

export interface AgentWalletConfig {
  /** Blockchain network to use for payments. */
  network: 'base' | 'ethereum' | 'polygon' | 'arbitrum' | 'optimism';
  /** Maximum payment per request in USDC base units (6 decimals). */
  maxPaymentPerRequest: bigint;
  /** Total budget cap across an entire training session. */
  sessionBudget: bigint;
  /** Payment strategy the agent applies when facing a 402. */
  strategy: WalletStrategy;
  /** Target latency in ms; the agent optimises to stay below this. */
  targetLatencyMs: number;
}

export interface AgentBlueprint {
  /** Unique identifier for this blueprint (set by studio on creation). */
  id: string;
  /** Human-readable name shown in Agent Studio and on the leaderboard. */
  name: string;
  /** Short description of the agent's purpose and design. */
  description: string;
  /** Declared capabilities — used to select training scenario sets. */
  capabilities: AgentCapability[];
  /** Wallet and payment strategy configuration. */
  wallet: AgentWalletConfig;
  /** Model or runtime powering the agent (informational, not executed). */
  model?: { provider: string; id: string };
  /** ISO timestamp when this blueprint was created in Agent Studio. */
  createdAt: string;
  /** ISO timestamp of last training update. */
  trainedAt?: string;
  /** Number of training iterations completed. */
  trainingIterations: number;
  /** Best overall score achieved across all training sessions. */
  bestTrainingScore?: number;
}

export interface TrainingScenarioResult {
  scenarioId: string;
  passed: boolean;
  latencyMs: number | null;
  amountPaid: bigint | null;
  error: string | null;
}

export interface TrainingIterationResult {
  iteration: number;
  scenariosRun: number;
  passed: number;
  failed: number;
  overallScore: number;
  avgLatencyMs: number;
  totalAmountPaid: bigint;
  scenarioResults: TrainingScenarioResult[];
  /** Feedback hints generated for this iteration. */
  feedback: string[];
}

export interface TrainingSession {
  sessionId: string;
  blueprintId: string;
  difficulty: TrainingDifficulty;
  startedAt: string;
  completedAt?: string;
  iterations: TrainingIterationResult[];
  /** Best score observed across all iterations in this session. */
  bestScore: number;
}

// ---------------------------------------------------------------------------
// AgentBlueprintBuilder
// ---------------------------------------------------------------------------

let _idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${(++_idCounter).toString(36)}`;
}

export class AgentBlueprintBuilder {
  private _name = 'Unnamed Agent';
  private _description = '';
  private _capabilities: AgentCapability[] = ['x402'];
  private _wallet: AgentWalletConfig = {
    network: 'base',
    maxPaymentPerRequest: 1_000_000n, // $1 USDC
    sessionBudget: 50_000_000n,       // $50 USDC
    strategy: 'conservative',
    targetLatencyMs: 800,
  };
  private _model?: { provider: string; id: string };

  name(value: string): this { this._name = value; return this; }
  description(value: string): this { this._description = value; return this; }
  capabilities(...caps: AgentCapability[]): this { this._capabilities = caps; return this; }
  network(n: AgentWalletConfig['network']): this { this._wallet = { ...this._wallet, network: n }; return this; }
  maxPayment(amount: bigint): this { this._wallet = { ...this._wallet, maxPaymentPerRequest: amount }; return this; }
  budget(amount: bigint): this { this._wallet = { ...this._wallet, sessionBudget: amount }; return this; }
  strategy(s: WalletStrategy): this { this._wallet = { ...this._wallet, strategy: s }; return this; }
  targetLatency(ms: number): this { this._wallet = { ...this._wallet, targetLatencyMs: ms }; return this; }
  model(provider: string, id: string): this { this._model = { provider, id }; return this; }

  build(): AgentBlueprint {
    return {
      id: generateId('agent'),
      name: this._name,
      description: this._description,
      capabilities: [...this._capabilities],
      wallet: { ...this._wallet },
      model: this._model,
      createdAt: new Date().toISOString(),
      trainingIterations: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// TrainingFeedbackEngine
// ---------------------------------------------------------------------------

export class TrainingFeedbackEngine {
  /**
   * Analyse an iteration result and return actionable hints the agent can
   * apply in the next iteration to improve its score.
   */
  generateFeedback(result: TrainingIterationResult, blueprint: AgentBlueprint): string[] {
    const hints: string[] = [];
    const passRate = result.scenariosRun > 0 ? result.passed / result.scenariosRun : 0;

    if (passRate < 0.7) {
      hints.push(
        `Pass rate is ${(passRate * 100).toFixed(0)}% — below the 70% threshold. ` +
        `Review failed scenarios: check header parsing for missing or malformed x402 fields.`,
      );
    }

    if (result.avgLatencyMs > blueprint.wallet.targetLatencyMs) {
      const over = result.avgLatencyMs - blueprint.wallet.targetLatencyMs;
      hints.push(
        `Average latency ${result.avgLatencyMs.toFixed(0)} ms exceeds target by ${over.toFixed(0)} ms. ` +
        `Pre-warm RPC connections and cache the gas price between iterations.`,
      );
    }

    if (result.overallScore < 60) {
      hints.push(
        `Score ${result.overallScore.toFixed(1)} is below 60. ` +
        `Focus on protocol-compliance first — it carries the highest weight (30%).`,
      );
    }

    const budgetUsed = result.totalAmountPaid;
    const budgetFraction = Number(budgetUsed) / Number(blueprint.wallet.sessionBudget);
    if (budgetFraction > 0.4) {
      hints.push(
        `${(budgetFraction * 100).toFixed(0)}% of session budget used in one iteration. ` +
        `Review overpayment: compare amounts paid against the minimum required by each scenario.`,
      );
    }

    if (hints.length === 0 && result.overallScore >= 80) {
      hints.push(
        `Strong iteration — score ${result.overallScore.toFixed(1)}. ` +
        `Consider increasing difficulty to 'advanced' or 'adversarial' to expose edge cases.`,
      );
    }

    return hints;
  }
}

// ---------------------------------------------------------------------------
// AgentBlueprintExporter
// ---------------------------------------------------------------------------

export class AgentBlueprintExporter {
  /**
   * Serialise a trained AgentBlueprint to a portable JSON string.
   * The output can be imported into the xPaymind CLI with `xpaymind agent import`.
   */
  export(blueprint: AgentBlueprint): string {
    return JSON.stringify(
      {
        ...blueprint,
        wallet: {
          ...blueprint.wallet,
          maxPaymentPerRequest: blueprint.wallet.maxPaymentPerRequest.toString(),
          sessionBudget: blueprint.wallet.sessionBudget.toString(),
        },
      },
      null,
      2,
    );
  }

  /**
   * Deserialise a JSON string back into an AgentBlueprint.
   * Restores bigint fields from their string representations.
   */
  import(json: string): AgentBlueprint {
    const raw = JSON.parse(json) as Record<string, unknown> & {
      wallet: Record<string, unknown>;
    };
    return {
      ...(raw as unknown as AgentBlueprint),
      wallet: {
        ...(raw.wallet as AgentWalletConfig),
        maxPaymentPerRequest: BigInt(raw.wallet['maxPaymentPerRequest'] as string),
        sessionBudget: BigInt(raw.wallet['sessionBudget'] as string),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// AgentStudio — top-level façade
// ---------------------------------------------------------------------------

export class AgentStudio {
  private readonly feedbackEngine = new TrainingFeedbackEngine();
  private readonly exporter = new AgentBlueprintExporter();

  /** Create a new agent blueprint using the fluent builder. */
  createAgent(): AgentBlueprintBuilder {
    return new AgentBlueprintBuilder();
  }

  /** Start a new training session for a blueprint. */
  startSession(blueprintId: string, difficulty: TrainingDifficulty): TrainingSession {
    return {
      sessionId: generateId('session'),
      blueprintId,
      difficulty,
      startedAt: new Date().toISOString(),
      iterations: [],
      bestScore: 0,
    };
  }

  /**
   * Record the result of a completed training iteration and attach feedback.
   * Mutates the session in-place and returns the updated session.
   */
  recordIteration(
    session: TrainingSession,
    blueprint: AgentBlueprint,
    raw: Omit<TrainingIterationResult, 'feedback'>,
  ): TrainingSession {
    const feedback = this.feedbackEngine.generateFeedback(
      { ...raw, feedback: [] },
      blueprint,
    );
    const result: TrainingIterationResult = { ...raw, feedback };

    session.iterations.push(result);
    if (result.overallScore > session.bestScore) session.bestScore = result.overallScore;
    return session;
  }

  /** Mark a training session as complete. */
  completeSession(session: TrainingSession): TrainingSession {
    return { ...session, completedAt: new Date().toISOString() };
  }

  /** Export a trained blueprint to JSON for use with the CLI or API. */
  exportBlueprint(blueprint: AgentBlueprint): string {
    return this.exporter.export(blueprint);
  }

  /** Import a blueprint from a JSON string. */
  importBlueprint(json: string): AgentBlueprint {
    return this.exporter.import(json);
  }
}
