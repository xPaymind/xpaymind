import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from '../runner.js';
import type { BenchmarkScenario } from '../types.js';
import type { BenchmarkAgent, AgentRunContext } from '../../agents/base.js';
import type { X402Context, PaymentProof } from '../../x402/types.js';

const makeScenario = (expectedOutcome: 'pay' | 'decline'): BenchmarkScenario => ({
  id: 'test-001',
  name: 'Test Scenario',
  description: 'Unit test scenario',
  category: 'protocol-compliance',
  paymentRequired: {
    'x-payment-version': '1.0',
    'x-payment-network': 'base',
    'x-payment-recipient': '0x1234567890123456789012345678901234567890',
    'x-payment-amount': '1000000',
    'x-payment-token': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'x-payment-expires': String(Math.floor((Date.now() + 60_000) / 1000)),
    'x-payment-nonce': 'a'.repeat(40),
  },
  expectedOutcome,
  timeoutMs: 5_000,
  weight: 1,
  tags: ['test'],
});

const makeAgent = (alwaysPay: boolean): BenchmarkAgent => ({
  metadata: { id: 'test-agent', name: 'Test Agent', version: '0.0.1', capabilities: [] },
  handleX402: async (_ctx: X402Context, _runCtx: AgentRunContext): Promise<PaymentProof | null> => {
    if (!alwaysPay) return null;
    return { txHash: '0x' + 'b'.repeat(64), network: 'base', submittedAt: Date.now() };
  },
});

describe('BenchmarkRunner', () => {
  it('marks correct outcome when agent pays and expected is pay', async () => {
    const runner = new BenchmarkRunner({ iterations: 2 });
    const result = await runner.run(makeAgent(true), [makeScenario('pay')], 'test');
    expect(result.scenarioResults[0]!.successRate).toBeGreaterThan(0);
  });

  it('marks correct outcome when agent declines and expected is decline', async () => {
    const runner = new BenchmarkRunner({ iterations: 2 });
    const result = await runner.run(makeAgent(false), [makeScenario('decline')], 'test');
    expect(result.scenarioResults[0]!.successRate).toBeGreaterThan(0);
  });

  it('calls onProgress for each iteration', async () => {
    const events: string[] = [];
    const runner = new BenchmarkRunner({ iterations: 3, onProgress: (e) => events.push(e.type) });
    await runner.run(makeAgent(false), [makeScenario('decline')], 'test');
    expect(events.filter((e) => e === 'scenario:start')).toHaveLength(3);
    expect(events.includes('suite:complete')).toBe(true);
  });
});
