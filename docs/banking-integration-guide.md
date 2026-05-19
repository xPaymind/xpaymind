# Banking Integration Guide for AI Agents

This guide explains how to build an AI agent that integrates with banking systems
via the x402 payment protocol and the xPaymind evaluation platform.

## Overview

Modern neobanks and financial data providers are adopting x402 as the standard
for autonomous, permissionless API monetisation. An AI agent that can reliably
handle x402 challenges becomes a first-class participant in the **AI banking economy**:
it can query account data, initiate payments, retrieve compliance signals, and
access real-time FX rates — all without human intervention.

## Prerequisites

- Node.js 20+, TypeScript 5.5+
- A funded wallet on Base (for USDC payments)
- An xPaymind API key (`xpm_...`)

## Quick Start

### 1. Install the SDK

```bash
npm install @xpaymind/sdk
```

### 2. Implement `BankingIntegrationAdapter`

```typescript
import { BankingIntegrationAdapter } from '@xpaymind/core/banking';

export class MyBankingAgent extends BankingIntegrationAdapter {
  constructor() {
    super({
      name: 'my-banking-agent-v1',
      baseUrl: 'https://api.my-neobank.com',
      timeoutMs: 800,
      maxPaymentAmount: 5_000_000n, // $5 USDC ceiling
      auditLogging: true,
    });
  }

  protected async authenticate(): Promise<void> {
    // Obtain OAuth 2.0 access token from your neobank
  }

  protected defaultHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  protected async handleX402(headers: Headers) {
    const amount  = BigInt(headers.get('x-payment-amount') ?? '0');
    const network = headers.get('x-payment-network') ?? 'base';
    if (amount > this.config.maxPaymentAmount) return null;
    const txHash = await this.wallet.submitPayment({ amount, network });
    return { txHash, network, amountPaid: amount };
  }
}
```

### 3. Use `OpenBankingConnector` for PSD2 APIs

```typescript
import { OpenBankingConnector } from '@xpaymind/core/banking';

const connector = new OpenBankingConnector({
  name: 'truelayer-agent',
  baseUrl: 'https://api.truelayer.com',
  clientId: process.env.TL_CLIENT_ID!,
  clientSecret: process.env.TL_CLIENT_SECRET!,
  tokenUrl: 'https://auth.truelayer.com/connect/token',
  scopes: ['accounts', 'balances', 'transactions'],
  fapiMode: true,
  maxPaymentAmount: 2_000_000n,
});

const balance = await connector.getBalance('acc_001');
const txns    = await connector.getTransactions('acc_001', new Date('2026-01-01'), new Date());
```

### 4. Run the neobanking benchmark

```bash
xpaymind benchmark run \
  --agent ./my-banking-agent.js \
  --suite neobanking-v1 \
  --iterations 10 \
  --format table
```

### 5. Check AI banking economy eligibility

```typescript
import { AIBankingEligibilityChecker } from '@xpaymind/evaluator';
import { BankingIntegrationScorecardBuilder } from '@xpaymind/evaluator';

const eligibility = new AIBankingEligibilityChecker().check(report);
const scorecard   = new BankingIntegrationScorecardBuilder().build(report);

console.log(eligibility.tier);                  // 'full' | 'limited' | 'ineligible'
console.log(scorecard.bankApprovalLikelihood);  // 'high' | 'medium' | 'low' | 'very-low'
console.log(scorecard.executiveSummary);
```

## Eligibility Gates

| Gate | Minimum Score | Why |
|------|--------------|-----|
| Protocol Compliance | 80 | Correctly implements x402 handshake |
| Payment Negotiation | 65 | Can handle basic negotiation / refusals |
| Latency SLA | 70 | Meets sub-800 ms neobanking requirement |
| Cost Efficiency | 60 | Does not consistently overpay |
| Error Recovery | 55 | Rejects expired/invalid requirements |

Agents scoring ≥ 80 overall with Protocol Compliance ≥ 88 earn **Full** eligibility
and are eligible for $XPAYMIND incentive distributions.

## Neobanking Suite Scenarios

| # | Scenario | Category | Timeout |
|---|---------|----------|---------|
| 1 | Account Balance Query | protocol-compliance | 800 ms |
| 2 | FX Rate Conversion | latency | 600 ms |
| 3 | Virtual Card Issuance | payment-negotiation | 1 200 ms |
| 4 | KYC Compliance Check (expired) | error-recovery | 800 ms |
| 5 | Micro-Lending Signal | payment-negotiation | 900 ms |
| 6 | Bulk Transaction Export | cost-efficiency | 2 000 ms |
| 7 | Insufficient Funds Guard | error-recovery | 500 ms |
| 8 | Concurrent Neobank Payments ×5 | latency | 800 ms |

## Tips for High Scores

1. **Pre-warm RPC connections** — establish WebSocket RPC connections before the benchmark starts
2. **Cache the gas price** — refresh every 10 s; avoid `eth_gasPrice` on every payment
3. **Use a local nonce counter** — eliminates one `eth_getTransactionCount` RPC call per payment
4. **Implement `WalletBalanceChecker`** — pre-flight balance checks prevent failed transactions
5. **Handle expiry before signing** — check `x-payment-expires` before building the transaction

## Security Considerations

- Never log private keys or raw wallet credentials
- Set a `maxPaymentAmount` ceiling appropriate for your use case
- Verify the `x-payment-recipient` address against a whitelist for production deployments
- Store API keys in environment variables, not source code
