import type { BenchmarkScenario, BenchmarkCategory } from './types.js';

const BASE_HEADERS = {
  'x-payment-version': '1.0',
  'x-payment-network': 'base' as const,
  'x-payment-recipient': '0x1234567890123456789012345678901234567890',
  'x-payment-token': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'x-payment-nonce': crypto.randomUUID().replace(/-/g, ''),
};

const futureExpiry = () => String(Math.floor((Date.now() + 5 * 60 * 1000) / 1000));

export const STANDARD_SUITE: BenchmarkScenario[] = [
  { id: 'pc-001', name: 'Valid 402 response — pay', description: 'Agent receives a well-formed x402 response and should pay', category: 'protocol-compliance', paymentRequired: { ...BASE_HEADERS, 'x-payment-amount': '1000000', 'x-payment-expires': futureExpiry() }, expectedOutcome: 'pay', timeoutMs: 10_000, weight: 0.1, tags: ['basic', 'compliance'] },
  { id: 'pc-002', name: 'Expired 402 — decline', description: 'Agent receives an expired payment requirement and should decline', category: 'protocol-compliance', paymentRequired: { ...BASE_HEADERS, 'x-payment-amount': '1000000', 'x-payment-expires': String(Math.floor(Date.now() / 1000) - 60) }, expectedOutcome: 'decline', timeoutMs: 5_000, weight: 0.08, tags: ['compliance', 'expiry'] },
  { id: 'pc-003', name: 'Multi-network — select optimal', description: 'Agent receives offers on multiple networks', category: 'protocol-compliance', paymentRequired: { ...BASE_HEADERS, 'x-payment-network': 'polygon' as const, 'x-payment-amount': '500000', 'x-payment-expires': futureExpiry() }, expectedOutcome: 'pay', timeoutMs: 15_000, weight: 0.12, tags: ['compliance', 'multinetwork'] },
  { id: 'pn-001', name: 'High-cost resource — negotiate', description: 'Agent receives a costly requirement and should negotiate', category: 'payment-negotiation', paymentRequired: { ...BASE_HEADERS, 'x-payment-amount': '50000000', 'x-payment-expires': futureExpiry() }, expectedOutcome: 'negotiate', timeoutMs: 20_000, weight: 0.1, tags: ['negotiation', 'high-value'] },
  { id: 'pn-002', name: 'Slippage tolerance', description: 'Agent pays within acceptable slippage bounds', category: 'payment-negotiation', paymentRequired: { ...BASE_HEADERS, 'x-payment-amount': '2000000', 'x-payment-max-slippage': '50', 'x-payment-expires': futureExpiry() }, expectedOutcome: 'pay', timeoutMs: 15_000, weight: 0.08, tags: ['negotiation', 'slippage'] },
  { id: 'lt-001', name: 'Sub-second payment', description: 'Agent completes payment in under 1 second', category: 'latency', paymentRequired: { ...BASE_HEADERS, 'x-payment-amount': '100000', 'x-payment-expires': futureExpiry() }, expectedOutcome: 'pay', timeoutMs: 1_000, weight: 0.12, tags: ['latency', 'speed'] },
  { id: 'lt-002', name: 'Concurrent requests', description: 'Agent handles 5 simultaneous 402 responses', category: 'latency', paymentRequired: { ...BASE_HEADERS, 'x-payment-amount': '200000', 'x-payment-expires': futureExpiry() }, expectedOutcome: 'pay', timeoutMs: 5_000, weight: 0.1, tags: ['latency', 'concurrency'] },
  { id: 'ce-001', name: 'No overpayment', description: 'Agent pays exactly the required amount', category: 'cost-efficiency', paymentRequired: { ...BASE_HEADERS, 'x-payment-amount': '1000000', 'x-payment-expires': futureExpiry() }, expectedOutcome: 'pay', timeoutMs: 10_000, weight: 0.1, tags: ['cost', 'precision'] },
  { id: 'ce-002', name: 'Gas optimisation', description: 'Agent selects gas-efficient payment path', category: 'cost-efficiency', paymentRequired: { ...BASE_HEADERS, 'x-payment-network': 'base' as const, 'x-payment-amount': '1500000', 'x-payment-expires': futureExpiry() }, expectedOutcome: 'pay', timeoutMs: 15_000, weight: 0.08, tags: ['cost', 'gas'] },
  { id: 'er-001', name: 'Retry on RPC failure', description: 'Agent retries when the RPC node returns an error', category: 'error-recovery', paymentRequired: { ...BASE_HEADERS, 'x-payment-amount': '1000000', 'x-payment-expires': futureExpiry() }, expectedOutcome: 'pay', timeoutMs: 30_000, weight: 0.06, tags: ['recovery', 'retry'] },
  { id: 'er-002', name: 'Graceful decline — insufficient funds', description: 'Agent declines when it cannot cover the payment', category: 'error-recovery', paymentRequired: { ...BASE_HEADERS, 'x-payment-amount': '999999999999', 'x-payment-expires': futureExpiry() }, expectedOutcome: 'decline', timeoutMs: 5_000, weight: 0.06, tags: ['recovery', 'insufficient-funds'] },
];

export const SUITE_REGISTRY: Record<string, BenchmarkScenario[]> = { standard: STANDARD_SUITE };

export function getSuite(suiteId: string): BenchmarkScenario[] {
  const suite = SUITE_REGISTRY[suiteId];
  if (!suite) throw new Error(`Unknown benchmark suite: ${suiteId}`);
  return suite;
}

export function filterByCategory(scenarios: BenchmarkScenario[], category: BenchmarkCategory): BenchmarkScenario[] {
  return scenarios.filter((s) => s.category === category);
}

export function filterByTags(scenarios: BenchmarkScenario[], tags: string[]): BenchmarkScenario[] {
  return scenarios.filter((s) => tags.some((t) => s.tags.includes(t)));
}
