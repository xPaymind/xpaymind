import type { BenchmarkAgent, AgentRunContext } from '../agents/base.js';
import type {
  BenchmarkScenario,
  BenchmarkResult,
  ScenarioResult,
  IterationResult,
  BenchmarkCategory,
} from './types.js';
import { X402Validator } from '../x402/validator.js';

export interface RunnerOptions {
  iterations?: number;
  totalTimeoutMs?: number;
  onProgress?: (event: ProgressEvent) => void;
  bail?: boolean;
}

export type ProgressEvent =
  | { type: 'scenario:start'; scenarioId: string; iteration: number }
  | { type: 'scenario:complete'; scenarioId: string; result: IterationResult }
  | { type: 'suite:complete'; result: BenchmarkResult };

const DEFAULT_ITERATIONS = 10;
const DEFAULT_TOTAL_TIMEOUT_MS = 10 * 60 * 1000;

export class BenchmarkRunner {
  constructor(private readonly options: RunnerOptions = {}) {}

  async run(
    agent: BenchmarkAgent,
    scenarios: BenchmarkScenario[],
    suiteId: string,
  ): Promise<BenchmarkResult> {
    const iterations = this.options.iterations ?? DEFAULT_ITERATIONS;
    const totalTimeoutMs = this.options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    const startedAt = new Date();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), totalTimeoutMs);

    await agent.setup?.();
    const scenarioResults: ScenarioResult[] = [];

    try {
      for (const scenario of scenarios) {
        if (controller.signal.aborted) break;
        const iterationResults: IterationResult[] = [];

        for (let i = 0; i < iterations; i++) {
          if (controller.signal.aborted) break;
          this.options.onProgress?.({ type: 'scenario:start', scenarioId: scenario.id, iteration: i });

          const result = await this.runIteration(agent, scenario, i, controller.signal);
          iterationResults.push(result);
          this.options.onProgress?.({ type: 'scenario:complete', scenarioId: scenario.id, result });

          if (this.options.bail && !result.outcomeCorrect) break;
        }

        scenarioResults.push(this.aggregateScenario(scenario, iterationResults));
      }
    } finally {
      clearTimeout(timeoutId);
      await agent.teardown?.();
    }

    const completedAt = new Date();
    const result = this.buildResult(agent, suiteId, scenarioResults, startedAt, completedAt);
    this.options.onProgress?.({ type: 'suite:complete', result });
    return result;
  }

  private async runIteration(
    agent: BenchmarkAgent,
    scenario: BenchmarkScenario,
    iterationIndex: number,
    signal: AbortSignal,
  ): Promise<IterationResult> {
    const start = Date.now();
    const runCtx: AgentRunContext = {
      benchmarkId: crypto.randomUUID(),
      scenarioId: scenario.id,
      iterationIndex,
      timeoutMs: scenario.timeoutMs,
      signal,
    };
    const ctx = {
      originalRequest: { method: 'GET', url: 'https://api.example.com/resource', headers: {} },
      paymentRequired: scenario.paymentRequired,
      receivedAt: start,
    };

    try {
      const proof = await Promise.race([
        agent.handleX402(ctx, runCtx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), scenario.timeoutMs),
        ),
      ]);

      const latencyMs = proof ? Date.now() - start : null;
      let proofValid = false;
      if (proof) {
        const v = X402Validator.validateProof(proof);
        const s = X402Validator.proofSatisfiesRequirement(proof, scenario.paymentRequired);
        proofValid = v.valid && s.valid;
      }

      const expectedPay = scenario.expectedOutcome === 'pay';
      return {
        scenarioId: scenario.id,
        iterationIndex,
        outcomeCorrect: expectedPay === (proof !== null),
        latencyMs,
        confirmationLatencyMs: null,
        paymentRatio: null,
        didNegotiate: false,
        proofValid,
        error: null,
        rawOutput: proof,
      };
    } catch (err) {
      return {
        scenarioId: scenario.id,
        iterationIndex,
        outcomeCorrect: false,
        latencyMs: null,
        confirmationLatencyMs: null,
        paymentRatio: null,
        didNegotiate: false,
        proofValid: false,
        error: err instanceof Error ? err.message : String(err),
        rawOutput: null,
      };
    }
  }

  private aggregateScenario(scenario: BenchmarkScenario, iterations: IterationResult[]): ScenarioResult {
    const successful = iterations.filter((i) => i.outcomeCorrect && i.proofValid);
    const withLatency = iterations.filter((i) => i.latencyMs !== null);
    const avgLatencyMs =
      withLatency.length > 0
        ? withLatency.reduce((sum, i) => sum + (i.latencyMs ?? 0), 0) / withLatency.length
        : 0;
    const successRate = iterations.length > 0 ? successful.length / iterations.length : 0;
    const complianceScore = successRate * 100;
    const latencyScore = Math.max(0, 100 - (avgLatencyMs / scenario.timeoutMs) * 100);
    const score = complianceScore * 0.7 + latencyScore * 0.3;
    return { scenario, iterations, avgLatencyMs, successRate, complianceScore, score };
  }

  private buildResult(
    agent: BenchmarkAgent,
    suiteId: string,
    scenarioResults: ScenarioResult[],
    startedAt: Date,
    completedAt: Date,
  ): BenchmarkResult {
    const categoryScores: Record<BenchmarkCategory, number> = {
      'protocol-compliance': 0, 'payment-negotiation': 0, latency: 0, 'cost-efficiency': 0, 'error-recovery': 0,
    };
    const categoryCounts = { ...categoryScores };
    for (const sr of scenarioResults) {
      categoryScores[sr.scenario.category] += sr.score;
      categoryCounts[sr.scenario.category] += 1;
    }
    for (const cat of Object.keys(categoryScores) as BenchmarkCategory[]) {
      if (categoryCounts[cat] > 0) categoryScores[cat] = categoryScores[cat]! / categoryCounts[cat]!;
    }
    const totalWeight = scenarioResults.reduce((sum, sr) => sum + sr.scenario.weight, 0);
    const overallScore = totalWeight > 0
      ? scenarioResults.reduce((sum, sr) => sum + sr.score * sr.scenario.weight, 0) / totalWeight
      : 0;
    return {
      id: crypto.randomUUID(),
      agentId: agent.metadata.id,
      agentVersion: agent.metadata.version,
      suiteId,
      startedAt,
      completedAt,
      scenarioResults,
      overallScore: Math.round(overallScore * 10) / 10,
      categoryScores,
      summary: `${agent.metadata.name} v${agent.metadata.version} scored ${Math.round(overallScore)}/100 on suite ${suiteId}`,
    };
  }
}
