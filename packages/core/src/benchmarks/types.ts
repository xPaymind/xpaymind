import type { X402Header } from '../x402/types.js';

export type BenchmarkCategory =
  | 'protocol-compliance'
  | 'payment-negotiation'
  | 'latency'
  | 'cost-efficiency'
  | 'error-recovery';

export interface BenchmarkScenario {
  id: string;
  name: string;
  description: string;
  category: BenchmarkCategory;
  paymentRequired: X402Header;
  expectedOutcome: 'pay' | 'decline' | 'negotiate';
  timeoutMs: number;
  weight: number;
  tags: string[];
}

export interface IterationResult {
  scenarioId: string;
  iterationIndex: number;
  outcomeCorrect: boolean;
  latencyMs: number | null;
  confirmationLatencyMs: number | null;
  paymentRatio: number | null;
  didNegotiate: boolean;
  proofValid: boolean;
  error: string | null;
  rawOutput: unknown;
}

export interface ScenarioResult {
  scenario: BenchmarkScenario;
  iterations: IterationResult[];
  avgLatencyMs: number;
  successRate: number;
  complianceScore: number;
  score: number;
}

export interface BenchmarkResult {
  id: string;
  agentId: string;
  agentVersion: string;
  suiteId: string;
  startedAt: Date;
  completedAt: Date;
  scenarioResults: ScenarioResult[];
  overallScore: number;
  categoryScores: Record<BenchmarkCategory, number>;
  summary: string;
}
