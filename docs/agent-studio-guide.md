# Agent Studio — Developer Guide

Agent Studio is the authoring environment inside xPaymind for building,
configuring, and certifying AI agents that implement the
[x402 HTTP payment protocol](https://x402.org).

---

## Pipeline overview

```
DEFINE → CONFIGURE → SUBMIT → CERTIFY
```

Each block is implemented as a standalone TypeScript module under
`packages/core/src/agent-studio/`.

---

## 1. DEFINE

Create an agent identity and declare its type.

```ts
import { defineAgent, AgentType } from "@workspace/core/agent-studio";

const agent = defineAgent({
  name: "PayBot Alpha",
  type: "payment",           // payment | treasury | compliance | lending | custom
  description: "Handles micropayments via x402 exact scheme",
  tags: ["production", "v1"],
});

console.log(agent.agentId);  // payment-paybot-alpha-<hash>
```

### Agent types

| Type         | Primary use-case                               |
|--------------|------------------------------------------------|
| `payment`    | End-to-end x402 payment flows                  |
| `treasury`   | Batch disbursements and reconciliation          |
| `compliance` | KYC/AML gating and audit trail generation       |
| `lending`    | Instalment plans and default handling           |
| `custom`     | Any other x402-adjacent workload                |

---

## 2. CONFIGURE

Bind a model, tools, payment limits, and a retry policy to the agent.

```ts
import { configureAgent } from "@workspace/core/agent-studio";

const cfg = configureAgent(agent.agentId, {
  modelProvider:       "openai",
  modelId:             "gpt-4o",
  contextWindowTokens: 128_000,
  paymentLimits: {
    maxSingleTxUsdCents: 500,     // $5.00 per transaction
    dailyCapUsdCents:    20_000,  // $200.00 daily
    allowedSchemes:      ["exact", "streaming"],
  },
  retryPolicy: {
    maxAttempts:       4,
    backoffMs:         300,
    backoffMultiplier: 2,
  },
});
```

---

## 3. SUBMIT

Run pre-flight checks and enqueue the agent for benchmarking.

```ts
import { submitAgent } from "@workspace/core/agent-studio";

const { receipt, preflight } = submitAgent(cfg);

if (!preflight.passed) {
  console.error("Pre-flight failed:", preflight.checks.filter(c => !c.passed));
}

console.log("Submitted:", receipt.submissionId);
console.log("Scenarios:", receipt.scenarioIds);
console.log("ETA (ms):", receipt.estimatedDurationMs);
```

### Pre-flight checks

| Check                      | Requirement                              |
|----------------------------|------------------------------------------|
| `model-provider-supported` | One of openai / anthropic / google / mistral / local |
| `payment-scheme-present`   | At least one scheme declared             |
| `context-window-adequate`  | ≥ 8 192 tokens                           |
| `daily-budget-sufficient`  | ≥ $1.00 daily cap                        |

---

## 4. CERTIFY

Score the completed run and issue a certification badge.

```ts
import { certifyAgent, formatCertificationSummary } from "@workspace/core/agent-studio";

const cert = certifyAgent(receipt);  // uses simulated scores during dev
console.log(formatCertificationSummary(cert));
```

### Certification tiers

| Tier       | Minimum score | Badge colour |
|------------|:-------------:|:------------:|
| Platinum   | 95 %          | Purple       |
| Gold       | 85 %          | Amber        |
| Silver     | 70 %          | Grey         |
| Bronze     | 50 %          | Brown        |
| Unrated    | < 50 %        | Light grey   |

---

## 5. Leaderboard

Aggregate certifications into a ranked leaderboard.

```ts
import { buildLeaderboard, formatLeaderboard } from "@workspace/core";

const lb = buildLeaderboard(certifications, { limit: 10, tier: "gold" });
console.log(formatLeaderboard(lb));
```

---

## API endpoints

| Method | Path                           | Description                |
|--------|--------------------------------|----------------------------|
| POST   | `/api/agent-studio/define`     | Create agent identity      |
| POST   | `/api/agent-studio/configure`  | Seal agent configuration   |
| POST   | `/api/agent-studio/submit`     | Submit for benchmarking    |
| POST   | `/api/agent-studio/certify`    | Issue certification result |

---

## x402 Benchmark Scenarios

Nine canonical scenarios are defined in
`packages/evaluator/src/x402-benchmark-suite.ts`:

| Scenario ID               | Scheme      | Weight |
|---------------------------|-------------|:------:|
| x402-basic-pay            | exact       | 20 %   |
| x402-retry-on-402         | exact       | 15 %   |
| x402-streaming-pay        | streaming   | 15 %   |
| x402-overpay-guard        | exact       | 10 %   |
| x402-batch-treasury       | exact       | 10 %   |
| x402-reconciliation       | exact       | 10 %   |
| x402-kyc-gate             | exact       |  8 %   |
| x402-aml-flag             | exact       |  7 %   |
| x402-audit-trail          | exact       |  5 %   |

Total weight sums to **100 %**.
