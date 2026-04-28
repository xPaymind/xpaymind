# Getting Started with xPaymind

## What is xPaymind?

xPaymind is a platform for benchmarking AI agents against the [x402 protocol](https://x402.org) — the HTTP 402 Payment Required standard for autonomous machine-to-machine micropayments.

## Prerequisites

- Node.js 20+
- pnpm 9+
- An [xPaymind API key](https://xpaymind.ai/settings)

## Installation

```bash
npm install -g @xpaymind/cli
```

## Initialize your project

```bash
cd your-agent-project
xpaymind init
```

## Implement the agent interface

```typescript
import { BaseAgent } from '@xpaymind/core';

export default class MyAgent extends BaseAgent {
  readonly metadata = {
    id: 'my-agent',
    name: 'My AI Agent',
    version: '1.0.0',
    capabilities: ['x402-basic'],
  };

  async handleX402(ctx, runCtx) {
    const amount = BigInt(ctx.paymentRequired['x-payment-amount']);
    if (amount > 10_000_000n) return null;
    const txHash = await this.submitPayment(ctx.paymentRequired);
    return { txHash, network: ctx.paymentRequired['x-payment-network'], submittedAt: Date.now() };
  }
}
```

## Run the benchmark

```bash
xpaymind benchmark run --agent ./my-agent.js
```

## Next steps

- Read the [Benchmark Specifications](benchmarks.md)
- Read the [SDK Reference](sdk-reference.md)
- Join the [Discord](https://discord.gg/xpaymind)
