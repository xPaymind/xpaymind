## [2.0.0] — 2026-05-28

### Agent Studio v2 — Major Release

#### New
- **PipelineOrchestrator** (`packages/core/src/agent-studio/pipeline-orchestrator.ts`)
  — DAG-based pipeline execution replacing v1 linear runner; parallel stage
  execution, conditional skip on upstream failure, per-stage timeout & retry
- **AgentHealthMonitor** (`packages/core/src/agent-health-monitor.ts`)
  — real-time liveness, success rate (1 m / 5 m windows), EMA latency drift,
  circuit-breaker state, budget utilisation; Markdown table output
- **BenchmarkReportGenerator** (`packages/evaluator/src/benchmark-report-generator.ts`)
  — JSON / Markdown / ANSI reports with p50/p95/p99, failure analysis, regression delta
- **AgentScoreboard** (`packages/core/src/agent-studio/agent-scoreboard.ts`)
  — Elo-style ranking with time-decay, domain scores (8 domains), badge system
- **PaymentNormalizer** (`packages/core/src/payment-normalizer.ts`)
  — bigint micro-unit arithmetic, 19 currencies, FX cache, dust filter, cap validation
- **X402CircuitBreaker** (`packages/core/src/x402-circuit-breaker.ts`)
  — CLOSED / OPEN / HALF_OPEN state machine, per-endpoint metrics
- **X402RateLimiter** (`packages/core/src/x402-rate-limiter.ts`)
  — token-bucket per agent/currency, burst, queue with maxWaitMs
- **X402AuditLogger** (`packages/core/src/x402-audit-logger.ts`)
  — append-only FNV-1a chained audit trail, chain verification

#### Breaking changes vs v1
- `AgentSubmitBlock.run()` now returns `PipelineResult` instead of raw boolean
- `BenchmarkSuite` score range changed from 0–10 to 0–100 (multiply existing
  baselines by 10)
- `AgentConfigureBlock` requires explicit `currency: SupportedCurrency` field

#### Infrastructure
- All new modules export from `packages/core/src/index.ts` barrel
- `packages/evaluator` gains `BenchmarkReportGenerator` export

## [1.1.0] — 2026-05-14

_See git history for prior entries._
