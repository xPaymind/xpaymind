/**
 * Neobanking Benchmark Suite
 *
 * Evaluates AI agents operating inside neobanking contexts — scenarios where
 * AI agents must autonomously handle x402 payment requirements originating
 * from neobank-grade financial APIs: balance queries, FX conversion, card
 * issuance endpoints, compliance data, and micro-lending signals.
 *
 * AI agents for neobanking face stricter latency requirements (< 800 ms SLA)
 * and must demonstrate PSD2 / Open Banking header awareness alongside x402.
 *
 * Suite ID: neobanking-v1
 * Scenario count: 8
 */

import type { BenchmarkScenario, X402PaymentRequirement } from '../types.js';

/** Base endpoint for the neobanking mock server. */
const NEOBANK_BASE = 'https://mock-neobank.xpaymind.ai';

/** Token contract for USDC on Base (used in all neobanking scenarios). */
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** Neobank recipient escrow wallet. */
const NEOBANK_RECIPIENT = '0x4C9A5b3D2e1F8a7B6C0E9D3A4B5C6D7E8F9A0B1C';

function requirement(
  overrides: Partial<X402PaymentRequirement>,
): X402PaymentRequirement {
  const base: X402PaymentRequirement = {
    version: '1.0',
    network: 'base',
    recipient: NEOBANK_RECIPIENT,
    amount: 500_000n,          // 0.50 USDC default
    token: USDC_BASE,
    expires: Math.floor(Date.now() / 1000) + 300,
    nonce: crypto.randomUUID().replace(/-/g, ''),
  };
  return { ...base, ...overrides };
}

export const neobankingSuite: BenchmarkScenario[] = [
  // ── 1. Account balance API ─────────────────────────────────────────────────
  {
    id: 'neobanking-balance-query',
    name: 'Account Balance Query',
    description:
      'Agent fetches a real-time account balance from a neobank API protected by x402. ' +
      'Tests the fundamental pay-per-query model used by neobank data products.',
    category: 'protocol-compliance',
    request: {
      method: 'GET',
      url: `${NEOBANK_BASE}/v1/accounts/acc_test_001/balance`,
      headers: { Accept: 'application/json' },
    },
    paymentRequired: requirement({ amount: 200_000n }), // $0.20
    expectedOutcome: 'pay',
    timeoutMs: 800,
    tags: ['neobanking', 'balance', 'data-api'],
  },

  // ── 2. FX rate conversion ──────────────────────────────────────────────────
  {
    id: 'neobanking-fx-conversion',
    name: 'FX Rate Conversion',
    description:
      'Agent retrieves live EUR/USD FX rate from a neobank pricing API. ' +
      'Verifies agents can pay micro-amounts for time-sensitive financial data.',
    category: 'latency',
    request: {
      method: 'GET',
      url: `${NEOBANK_BASE}/v1/fx/rates?from=EUR&to=USD`,
      headers: { Accept: 'application/json' },
    },
    paymentRequired: requirement({ amount: 50_000n }), // $0.05
    expectedOutcome: 'pay',
    timeoutMs: 600,
    tags: ['neobanking', 'fx', 'latency-critical'],
  },

  // ── 3. Virtual card issuance ───────────────────────────────────────────────
  {
    id: 'neobanking-card-issuance',
    name: 'Virtual Card Issuance',
    description:
      'Agent pays a neobank API to issue a single-use virtual card on behalf of a user. ' +
      'Tests higher-value payments and POST request payment flows.',
    category: 'payment-negotiation',
    request: {
      method: 'POST',
      url: `${NEOBANK_BASE}/v1/cards/virtual`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: 'USD', limit: 100, single_use: true }),
    },
    paymentRequired: requirement({ amount: 2_000_000n }), // $2.00
    expectedOutcome: 'pay',
    timeoutMs: 1200,
    tags: ['neobanking', 'card', 'high-value'],
  },

  // ── 4. KYC compliance check ────────────────────────────────────────────────
  {
    id: 'neobanking-kyc-check',
    name: 'KYC Compliance Check',
    description:
      'Agent fetches a KYC compliance signal for a counterparty from a neobank compliance API. ' +
      'Expired requirement — agent must detect and decline gracefully.',
    category: 'error-recovery',
    request: {
      method: 'GET',
      url: `${NEOBANK_BASE}/v1/compliance/kyc/usr_test_001`,
      headers: { Accept: 'application/json' },
    },
    paymentRequired: requirement({
      amount: 1_000_000n,
      expires: Math.floor(Date.now() / 1000) - 60, // already expired
    }),
    expectedOutcome: 'decline',
    timeoutMs: 800,
    tags: ['neobanking', 'kyc', 'compliance', 'expiry'],
  },

  // ── 5. Micro-lending signal ────────────────────────────────────────────────
  {
    id: 'neobanking-lending-signal',
    name: 'Micro-Lending Signal',
    description:
      'Agent retrieves a creditworthiness signal from a neobank ML API. ' +
      'Tests payment-negotiation: the API accepts any amount between $0.10–$1.00.',
    category: 'payment-negotiation',
    request: {
      method: 'GET',
      url: `${NEOBANK_BASE}/v1/lending/signals/usr_test_002`,
      headers: { Accept: 'application/json' },
    },
    paymentRequired: requirement({ amount: 1_000_000n }), // $1.00 asking price
    expectedOutcome: 'pay',
    timeoutMs: 900,
    tags: ['neobanking', 'lending', 'negotiation'],
  },

  // ── 6. Bulk transaction export ─────────────────────────────────────────────
  {
    id: 'neobanking-tx-export',
    name: 'Bulk Transaction Export',
    description:
      'Agent pays for a CSV export of 90-day transaction history. ' +
      'Validates cost-efficiency: agent should not overpay for bulk data.',
    category: 'cost-efficiency',
    request: {
      method: 'GET',
      url: `${NEOBANK_BASE}/v1/transactions/export?period=90d&format=csv`,
      headers: { Accept: 'text/csv' },
    },
    paymentRequired: requirement({ amount: 5_000_000n }), // $5.00
    expectedOutcome: 'pay',
    timeoutMs: 2000,
    tags: ['neobanking', 'export', 'cost-efficiency'],
  },

  // ── 7. Insufficient funds (neobank guard) ──────────────────────────────────
  {
    id: 'neobanking-insufficient-funds',
    name: 'Insufficient Funds Guard',
    description:
      'Server returns a 402 with an amount exceeding any realistic agent wallet balance. ' +
      'Agent must detect it cannot pay and return null without attempting the transaction.',
    category: 'error-recovery',
    request: {
      method: 'GET',
      url: `${NEOBANK_BASE}/v1/premium/analytics`,
      headers: { Accept: 'application/json' },
    },
    paymentRequired: requirement({ amount: 999_999_000_000n }), // ~$1,000,000
    expectedOutcome: 'decline',
    timeoutMs: 500,
    tags: ['neobanking', 'funds', 'error-recovery'],
  },

  // ── 8. Concurrent neobank payments ────────────────────────────────────────
  {
    id: 'neobanking-concurrent',
    name: 'Concurrent Neobank Payments',
    description:
      'Five simultaneous neobank API calls each return a distinct 402 requirement. ' +
      'Agent must resolve all five within the SLA window without nonce collisions.',
    category: 'latency',
    request: {
      method: 'GET',
      url: `${NEOBANK_BASE}/v1/accounts/multi-fetch`,
      headers: { Accept: 'application/json', 'x-concurrent-count': '5' },
    },
    paymentRequired: requirement({ amount: 200_000n }),
    expectedOutcome: 'pay',
    timeoutMs: 800,
    tags: ['neobanking', 'concurrent', 'latency'],
  },
];

/** Suite metadata exported for registration with BenchmarkRegistry. */
export const neobankingSuiteMeta = {
  id: 'neobanking-v1',
  name: 'AI Agents for Neobanking',
  description:
    'Evaluates AI agent performance in neobanking environments — pay-per-query financial APIs, ' +
    'FX data, card issuance, KYC compliance, and micro-lending signals. ' +
    'Reflects the real-world demands placed on AI agents for neobanking products ' +
    'that rely on x402 for autonomous, permissionless API monetisation.',
  version: '1.0.0',
  scenarioCount: 8,
  requiredCapabilities: ['x402', 'neobanking'],
  strictLatencySla: true,
  latencyThresholdMs: 800,
};
