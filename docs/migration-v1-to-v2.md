# Migrating to Agent Studio 2.0

This guide covers the breaking changes in Agent Studio 2.0 and provides a
step-by-step migration path from v1.

---

## What changed

| Area | v1 | v2 |
|------|----|----|
| Pipeline execution | Linear `AgentSubmitBlock.run()` returning `boolean` | DAG `PipelineOrchestrator` returning `PipelineResult` |
| Score range | 0 – 10 | 0 – 100 (multiply existing baselines × 10) |
| Config | Inline options on each class | Centralised `StudioConfig` via `parseStudioConfig()` |
| Events | Ad-hoc callbacks | `StudioEventBus` typed pub/sub |
| Extensibility | None | `PluginRegistry` with `LoggingPlugin` + `MetricsPlugin` |
| Testing | Manual mocking | `StudioTestHarness` with built-in assertions |
| Currency field | Optional | **Required** — `currency: SupportedCurrency` on `AgentConfigureBlock` |

---

## Step 1 — Update the config

**Before (v1):**
```ts
const submit = new AgentSubmitBlock({
  agentId: "agent-001",
  timeoutMs: 30_000,
});
```

**After (v2):**
```ts
import { parseStudioConfig } from "@workspace/core/agent-studio/studio-config-schema";

const config = parseStudioConfig({
  agentId: "agent-001",
  pipeline: { defaultTimeoutMs: 30_000 },
  budget:   { limitCents: 5_000 },
});
```

---

## Step 2 — Replace the linear runner with PipelineOrchestrator

**Before (v1):**
```ts
const passed = await submitBlock.run();
if (!passed) throw new Error("run failed");
```

**After (v2):**
```ts
import { PipelineOrchestrator } from "@workspace/core/agent-studio";

const pipeline = new PipelineOrchestrator({ agentId: config.agentId });

pipeline
  .stage({ id: "kyc",     run: kycStage })
  .stage({ id: "payment", run: paymentStage, after: ["kyc"] })
  .stage({ id: "audit",   run: auditStage,   after: ["payment"] });

const result = await pipeline.run();
if (!result.passed) {
  console.error("Failed stages:", result.failedStages);
}
```

---

## Step 3 — Add currency to AgentConfigureBlock

`currency` is now a **required** field:

```ts
// Before
const config = new AgentConfigureBlock({ agentId: "agent-001", network: "mainnet" });

// After
const config = new AgentConfigureBlock({
  agentId:  "agent-001",
  network:  "mainnet",
  currency: "USDC",          // ← required in v2
});
```

---

## Step 4 — Update benchmark score baselines

The score range changed from **0–10** to **0–100**.
Multiply all stored baseline scores by **10**:

```ts
// Before
const baseline = { overallAvgScore: 8.7 };

// After
const baseline = { overallAvgScore: 87.0 };
```

---

## Step 5 — Wire up the Event Bus (optional but recommended)

```ts
import { StudioEventBus } from "@workspace/core/agent-studio";

const bus = StudioEventBus.global();

bus.on("pipeline.completed", ({ payload }) => {
  console.log(`Pipeline ${payload.passed ? "PASSED" : "FAILED"} in ${payload.totalMs} ms`);
});

bus.on("health.degraded", ({ payload }) => {
  alerting.send(`Agent ${payload.agentId} degraded: ${payload.reasons.join(", ")}`);
});
```

---

## Step 6 — Install plugins

```ts
import { PluginRegistry, LoggingPlugin, MetricsPlugin } from "@workspace/core/agent-studio";

const registry = PluginRegistry.global();
await registry.install(new LoggingPlugin({ prefix: "[my-agent]", verbose: true }));
await registry.install(new MetricsPlugin());
```

---

## Step 7 — Update tests

Replace manual mocking with `StudioTestHarness`:

```ts
import { StudioTestHarness } from "@workspace/core/agent-studio";

const harness = new StudioTestHarness({ agentId: "test-agent" });
harness.mockPaymentSuccess();
harness.mockStageSuccess("kyc", { verified: true });

const result = await harness.run(buildMyPipeline);

harness
  .assertPassed()
  .assertStagePassed("payment")
  .assertEventEmitted("payment.confirmed")
  .assertLatencyBelow("payment", 500);

console.log(harness.toMarkdown());
```

---

## Full import reference

```ts
import {
  // Pipeline
  PipelineOrchestrator,

  // Events
  StudioEventBus,

  // Plugins
  PluginRegistry, LoggingPlugin, MetricsPlugin,

  // Testing
  StudioTestHarness,

  // Scoreboard
  AgentScoreboard,

  // v1 blocks (still supported)
  AgentDefineBlock, AgentConfigureBlock,
  AgentSubmitBlock, AgentCertifyBlock,
} from "@workspace/core/agent-studio";
```

---

## Changelog highlights

See [CHANGELOG.md](../../CHANGELOG.md) for the full list of additions.

- `PipelineOrchestrator` — DAG pipeline with parallel stages
- `StudioEventBus` — typed pub/sub event system
- `PluginRegistry` + `LoggingPlugin` + `MetricsPlugin`
- `StudioTestHarness` — assertion framework with JUnit export
- `AgentCapabilityMatrix` — scenario coverage analysis
- `StudioCLIRunner` — terminal / CI runner
- `AgentHealthMonitor` — real-time health signals
- `BenchmarkReportGenerator` — p50/p95/p99 reports with regression delta
- `X402CircuitBreaker`, `X402RateLimiter`, `X402AuditLogger`
- `PaymentNormalizer` — bigint multi-currency arithmetic
