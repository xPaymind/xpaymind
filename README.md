# xPaymind

**Platform for benchmarking AI agents for x402 payment protocol implementation.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Agent Studio](https://img.shields.io/badge/Agent%20Studio-v2.0.0-green.svg)]()
[![x402](https://img.shields.io/badge/x402-compliant-orange.svg)]()

---

## What is xPaymind?

xPaymind provides a complete benchmarking and certification pipeline for AI agents
that implement the **x402 payment protocol** — the open standard for machine-to-machine
micropayments over HTTP.

Agents are evaluated across protocol correctness, security posture, resilience patterns,
KYC compliance, audit integrity, budget enforcement, and latency — producing a
**compliance score (0–100)** and a certification tier (Bronze / Silver / Gold).

---

## Token

**$XPAYMIND** · Solana: `H5FX3C3BhNJELMCobkhRRKZCFokmEWfXS6v9NRMRpump`

See [TOKEN.md](TOKEN.md) for full token details and utility.

---

## Agent Studio 2.0

Agent Studio is the core evaluation pipeline.  Version 2.0 ships a DAG-based
orchestrator with parallel stage execution, a typed event bus, a plugin system,
a test harness, and a capability matrix.

### Quick start

```ts
import {
  PipelineOrchestrator,
  StudioEventBus,
  PluginRegistry,
  LoggingPlugin,
  createSessionContext,
} from "@workspace/core/agent-studio";
import { parseStudioConfig } from "@workspace/core/agent-studio/studio-config-schema";

const config  = parseStudioConfig({ agentId: "my-agent", budget: { limitCents: 5_000 } });
const session = createSessionContext({ agentId: config.agentId, limitCents: 5_000 });

await PluginRegistry.global().install(new LoggingPlugin());

const pipeline = new PipelineOrchestrator({ agentId: config.agentId });

pipeline
  .stage({ id: "kyc",     run: kycStage })
  .stage({ id: "payment", run: paymentStage, after: ["kyc"], retries: 2 })
  .stage({ id: "audit",   run: auditStage,   after: ["payment"] });

const result = await pipeline.run();
console.log(result.passed, result.totalMs);
```

---

## Compliance Scoring

| Tier   | Score | Criteria |
|--------|------:|---------|
| 🥇 Gold   | ≥ 90  | Full protocol correctness, security, resilience, KYC, audit |
| 🥈 Silver | ≥ 75  | Strong protocol + security coverage |
| 🥉 Bronze | ≥ 60  | Basic x402 compliance |

Run the scenario suite against your agent:

```ts
import { X402ScenarioRunner }   from "@workspace/evaluator/x402-scenario-runner";
import { X402ComplianceScorer } from "@workspace/evaluator/x402-compliance-scorer";

const runner = new X402ScenarioRunner({ agentId: "my-agent" });
const scorer = new X402ComplianceScorer();

const results = await runner.runAll();
results.forEach(r => scorer.record(r.observation));

console.log(scorer.toMarkdown("my-agent"));
```

---

## Repository structure

```
packages/
  core/src/
    agent-studio/          # Pipeline, EventBus, Plugins, TestHarness, CLI, Config
    banking/               # KYC gateway, direct-debit scheduler, reconciliation
    x402-*.ts              # Circuit breaker, rate limiter, audit logger, analytics
    payment-normalizer.ts  # Multi-currency bigint arithmetic
  evaluator/src/
    x402-benchmark-suite.ts
    x402-compliance-scorer.ts
    x402-scenario-runner.ts
    benchmark-report-generator.ts
apps/
  api/src/routes/          # REST API: leaderboard, agents, compliance, certify
docs/
  migration-v1-to-v2.md
  developer-guide.md
```

---

## API

The REST API is available at `/api`:

| Endpoint | Description |
|----------|-------------|
| `GET /api/leaderboard` | Top agents by compliance score |
| `GET /api/agents/:id` | Agent profile and score history |
| `GET /api/compliance/:id` | Compliance report with criterion breakdown |
| `POST /api/compliance/:id/observe` | Submit a benchmark observation |
| `GET /api/compliance/:id/tier` | Certification tier |

---

## Development

```bash
# Install dependencies
pnpm install

# Run API server
pnpm --filter @workspace/api-server run dev

# Typecheck
pnpm run typecheck

# Push DB schema
pnpm --filter @workspace/db run push

# Regenerate API hooks
pnpm --filter @workspace/api-spec run codegen
```

---

## Docs

- [Migration guide: v1 → v2](docs/migration-v1-to-v2.md)
- [Developer guide](docs/developer-guide.md)
- [Token](TOKEN.md)

---

## License

MIT © xPaymind
