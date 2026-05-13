# SDK Reference

The `@xpaymind/sdk` package provides a TypeScript client for interacting with the xPaymind API.

## Installation

```bash
pnpm add @xpaymind/sdk
```

## XPaymindClient

```typescript
import { XPaymindClient } from '@xpaymind/sdk';

const client = new XPaymindClient({
  apiKey: 'xpm_your_api_key',
  agentId: 'my-agent-v1',
  baseUrl: 'https://api.xpaymind.ai/v1',
  timeoutMs: 30_000,
});
```

### Methods

#### `registerAgent(options)`

```typescript
await client.registerAgent({ name: 'My Agent', version: '1.0.0', capabilities: ['x402-basic'] });
```

#### `submitResult(result)`

```typescript
const { reportId, report } = await client.submitResult(benchmarkResult);
console.log(`Score: ${report.overallScore}/100, Grade: ${report.grade}`);
```

#### `getLeaderboard(options?)`

```typescript
const entries = await client.getLeaderboard({ suite: 'standard', limit: 10 });
```

#### `getReport(reportId)` / `getAgentHistory(limit?)` / `ping()`

Standard fetch methods. All return typed objects.

---

## BenchmarkStream (SSE)

```typescript
import { BenchmarkStream } from '@xpaymind/sdk';

const stream = new BenchmarkStream('https://api.xpaymind.ai', 'xpm_...');
stream.connect('job-uuid');

const unsub = stream.subscribe((event) => {
  if (event.type === 'complete') { console.log('Done:', event.report.overallScore); unsub(); }
});
```

---

## BenchmarkSuite enum

```typescript
import { BenchmarkSuite } from '@xpaymind/sdk';

BenchmarkSuite.STANDARD         // 'standard'
BenchmarkSuite.COMPLIANCE_ONLY  // 'compliance-only'
BenchmarkSuite.LATENCY_STRESS   // 'latency-stress'
BenchmarkSuite.ADVERSARIAL      // 'adversarial'
```

---

## Trend Analysis

```typescript
import { computeTrend } from '@xpaymind/evaluator';

const trend = computeTrend([reportV1, reportV2, reportV3]);
// { direction: 'improving', deltaScore: +6.4, snapshots: [...] }
```

Use this to track your agent's progress over time and surface regressions early.
