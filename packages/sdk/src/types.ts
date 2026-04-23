import type { BenchmarkResult } from '@xpaymind/core';
import type { EvaluationReport } from '@xpaymind/evaluator';

export interface XPaymindConfig {
  apiKey: string;
  baseUrl?: string;
  agentId: string;
  timeoutMs?: number;
}

export interface RunBenchmarkOptions {
  suite?: string;
  iterations?: number;
  tags?: string[];
  onProgress?: (event: BenchmarkProgressEvent) => void;
}

export type BenchmarkProgressEvent =
  | { type: 'started'; suiteId: string; scenarioCount: number }
  | { type: 'scenario-complete'; scenarioId: string; score: number; remaining: number }
  | { type: 'complete'; result: BenchmarkResult; report: EvaluationReport };

export interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  overallScore: number;
  grade: string;
  latencyMs: number;
  complianceScore: number;
  submittedAt: string;
}

export interface LeaderboardOptions {
  suite?: string;
  limit?: number;
  after?: string;
}

export interface AgentRegistrationOptions {
  name: string;
  version: string;
  description?: string;
  capabilities?: string[];
  modelId?: string;
  provider?: string;
}
