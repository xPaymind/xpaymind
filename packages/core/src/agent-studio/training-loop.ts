/**
 * Agent Studio — Training Loop
 *
 * Runs iterative training sessions for an agent blueprint, automatically
 * escalating difficulty as the agent improves and generating a final
 * TrainingReport summarising readiness for the public benchmark.
 *
 * The loop follows a three-phase structure:
 *
 *   Phase 1 — Warm-up      (beginner)     iterations 1–3
 *     Establishes a baseline score. Stops early if the agent fails > 50% of
 *     scenarios — the blueprint needs fundamental fixes first.
 *
 *   Phase 2 — Progression  (intermediate) iterations 4–8
 *     Increases scenario complexity. Adaptive ceiling mode adjusts the
 *     agent's maxPaymentPerRequest based on observed overpayment.
 *
 *   Phase 3 — Hardening    (advanced)     iterations 9–12
 *     Exposes the agent to adversarial scenarios (expired requirements,
 *     replay attacks, concurrent floods). Scores here determine eligibility
 *     for the Full AI Banking Economy tier.
 *
 * Usage:
 *   const loop   = new AgentStudioTrainingLoop(config);
 *   const report = await loop.run(blueprint, simulateFn);
 *   console.log(report.readinessScore, report.benchmarkReady);
 */

import type { AgentBlueprint, TrainingIterationResult, TrainingSession } from './agent-studio.js';
import { AgentStudio, TrainingFeedbackEngine } from './agent-studio.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrainingPhase {
  name: 'warm-up' | 'progression' | 'hardening';
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  iterations: [number, number]; // [start, end] inclusive
  passingScore: number;         // minimum score to advance to next phase
}

export interface TrainingReport {
  blueprintId: string;
  agentName: string;
  totalIterations: number;
  bestScore: number;
  finalScore: number;
  phasesCompleted: TrainingPhase['name'][];
  /** 0–100 overall readiness score factoring in consistency + peak score. */
  readinessScore: number;
  /** Whether the agent is ready to submit to the public xPaymind benchmark. */
  benchmarkReady: boolean;
  /** Recommended public benchmark suite based on training results. */
  recommendedSuite: 'standard' | 'neobanking-v1' | 'compliance-only';
  summary: string;
  improvements: string[];   // specific changes made by the loop (e.g. ceiling adjustments)
  remainingGaps: string[];  // issues not resolved during training
}

/** Simulates running one training iteration. Injected by tests or the Studio UI. */
export type IterationSimulator = (
  blueprint: AgentBlueprint,
  phase: TrainingPhase,
  iteration: number,
) => Promise<Omit<TrainingIterationResult, 'feedback'>>;

// ---------------------------------------------------------------------------
// Phase definitions
// ---------------------------------------------------------------------------

const PHASES: TrainingPhase[] = [
  { name: 'warm-up',    difficulty: 'beginner',      iterations: [1, 3],  passingScore: 50 },
  { name: 'progression',difficulty: 'intermediate',  iterations: [4, 8],  passingScore: 65 },
  { name: 'hardening',  difficulty: 'advanced',      iterations: [9, 12], passingScore: 75 },
];

// ---------------------------------------------------------------------------
// AgentStudioTrainingLoop
// ---------------------------------------------------------------------------

export interface TrainingLoopConfig {
  /**
   * Enable adaptive ceiling: if the agent consistently overpays, the loop
   * automatically lowers `maxPaymentPerRequest` by 10% each iteration.
   */
  adaptiveCeiling?: boolean;
  /**
   * Stop training early if the agent achieves this score in Phase 2.
   * Saves budget by skipping Phase 3 for already high-performing agents.
   */
  earlyExitScore?: number;
  /** Verbose logging of per-iteration results. Default false. */
  verbose?: boolean;
}

export class AgentStudioTrainingLoop {
  private readonly studio = new AgentStudio();
  private readonly feedback = new TrainingFeedbackEngine();
  private readonly config: Required<TrainingLoopConfig>;

  constructor(config: TrainingLoopConfig = {}) {
    this.config = {
      adaptiveCeiling: true,
      earlyExitScore: 92,
      verbose: false,
      ...config,
    };
  }

  /**
   * Execute the full three-phase training loop.
   *
   * @param blueprint  The agent blueprint to train.
   * @param simulate   Function that simulates one iteration (provided by Studio or tests).
   * @returns          A TrainingReport summarising readiness for the public benchmark.
   */
  async run(blueprint: AgentBlueprint, simulate: IterationSimulator): Promise<TrainingReport> {
    let currentBlueprint = { ...blueprint };
    const allSessions: TrainingSession[] = [];
    const phasesCompleted: TrainingPhase['name'][] = [];
    const improvements: string[] = [];

    for (const phase of PHASES) {
      const session = this.studio.startSession(currentBlueprint.id, phase.difficulty);
      const [start, end] = phase.iterations;

      for (let i = start; i <= end; i++) {
        const raw = await simulate(currentBlueprint, phase, i);
        this.studio.recordIteration(session, currentBlueprint, raw);

        const iter = session.iterations[session.iterations.length - 1]!;
        if (this.config.verbose) this.log(phase, i, iter);

        // Adaptive ceiling: reduce max payment if agent is overpaying
        if (this.config.adaptiveCeiling && this.isOverpaying(iter, currentBlueprint)) {
          const prev = currentBlueprint.wallet.maxPaymentPerRequest;
          const next = (prev * 9n) / 10n; // −10%
          currentBlueprint = {
            ...currentBlueprint,
            wallet: { ...currentBlueprint.wallet, maxPaymentPerRequest: next },
          };
          improvements.push(
            `Iteration ${i}: adaptive ceiling reduced from ${prev} to ${next} base units to curb overpayment`,
          );
        }

        // Early exit check (Phase 2 only)
        if (phase.name === 'progression' && iter.overallScore >= this.config.earlyExitScore) {
          improvements.push(`Iteration ${i}: early exit triggered — score ${iter.overallScore.toFixed(1)} ≥ ${this.config.earlyExitScore}`);
          phasesCompleted.push(phase.name);
          allSessions.push(this.studio.completeSession(session));
          return this.buildReport(currentBlueprint, allSessions, phasesCompleted, improvements);
        }
      }

      const completedSession = this.studio.completeSession(session);
      allSessions.push(completedSession);
      phasesCompleted.push(phase.name);

      // Stop if the agent failed to reach the passing score for this phase
      if (completedSession.bestScore < phase.passingScore) {
        break;
      }
    }

    return this.buildReport(currentBlueprint, allSessions, phasesCompleted, improvements);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private isOverpaying(
    iter: TrainingIterationResult,
    blueprint: AgentBlueprint,
  ): boolean {
    if (iter.scenariosRun === 0 || iter.totalAmountPaid === 0n) return false;
    const avgPaid = Number(iter.totalAmountPaid) / iter.scenariosRun;
    const ceiling = Number(blueprint.wallet.maxPaymentPerRequest);
    return avgPaid > ceiling * 0.85; // paying > 85% of ceiling on average
  }

  private buildReport(
    blueprint: AgentBlueprint,
    sessions: TrainingSession[],
    phasesCompleted: TrainingPhase['name'][],
    improvements: string[],
  ): TrainingReport {
    const allIterations = sessions.flatMap((s) => s.iterations);
    const totalIterations = allIterations.length;
    const scores = allIterations.map((i) => i.overallScore);
    const bestScore = scores.length > 0 ? Math.max(...scores) : 0;
    const finalScore = scores[scores.length - 1] ?? 0;

    // Readiness = 60% best score + 40% consistency (1 − std-dev/100)
    const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    const stdDev = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length || 1));
    const consistency = Math.max(0, 1 - stdDev / 100);
    const readinessScore = Math.round(bestScore * 0.6 + consistency * 100 * 0.4);

    const benchmarkReady = phasesCompleted.includes('hardening') && readinessScore >= 65;

    const recommendedSuite: TrainingReport['recommendedSuite'] =
      readinessScore >= 80 ? 'neobanking-v1'
      : readinessScore >= 65 ? 'standard'
      : 'compliance-only';

    const remainingGaps: string[] = [];
    if (bestScore < 80) remainingGaps.push('Overall score below 80 — improve protocol-compliance and latency');
    if (!phasesCompleted.includes('hardening')) remainingGaps.push('Hardening phase not reached — agent did not pass intermediate threshold');
    if (stdDev > 15) remainingGaps.push(`Score variance is high (σ=${stdDev.toFixed(1)}) — agent performance is inconsistent across iterations`);

    const summary =
      `Agent \`${blueprint.name}\` completed ${totalIterations} training iterations across ` +
      `${phasesCompleted.length} phase(s) (${phasesCompleted.join(' → ')}). ` +
      `Best score: ${bestScore.toFixed(1)}, readiness score: ${readinessScore}/100. ` +
      (benchmarkReady
        ? `Agent is ready for the public ${recommendedSuite} benchmark.`
        : `Agent needs further training before public benchmark submission.`);

    return {
      blueprintId: blueprint.id,
      agentName: blueprint.name,
      totalIterations,
      bestScore,
      finalScore,
      phasesCompleted,
      readinessScore,
      benchmarkReady,
      recommendedSuite,
      summary,
      improvements,
      remainingGaps,
    };
  }

  private log(phase: TrainingPhase, iteration: number, iter: TrainingIterationResult): void {
    process.stdout.write(
      `[AgentStudio] ${phase.name} iter ${iteration}: ` +
      `score=${iter.overallScore.toFixed(1)} pass=${iter.passed}/${iter.scenariosRun} ` +
      `latency=${iter.avgLatencyMs.toFixed(0)}ms\n`,
    );
  }
}
