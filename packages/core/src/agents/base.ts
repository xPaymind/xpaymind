import type { X402Context, PaymentProof, PaymentNegotiation } from '../x402/types.js';

export interface AgentMetadata {
  id: string;
  name: string;
  version: string;
  description?: string;
  capabilities: string[];
  provider?: string;
  modelId?: string;
}

export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'timeout';

export interface AgentRunContext {
  benchmarkId: string;
  scenarioId: string;
  iterationIndex: number;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface BenchmarkAgent {
  readonly metadata: AgentMetadata;
  setup?(): Promise<void>;
  teardown?(): Promise<void>;
  handleX402(ctx: X402Context, runCtx: AgentRunContext): Promise<PaymentProof | null>;
  negotiate?(ctx: X402Context): Promise<PaymentNegotiation | null>;
}

export abstract class BaseAgent implements BenchmarkAgent {
  abstract readonly metadata: AgentMetadata;

  async setup(): Promise<void> {}
  async teardown(): Promise<void> {}

  abstract handleX402(ctx: X402Context, runCtx: AgentRunContext): Promise<PaymentProof | null>;
}
