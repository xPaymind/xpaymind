/**
 * Agent Studio v2 — Public API barrel
 *
 * Single import surface for all Agent Studio 2.0 modules.
 * Import from here; do not import from individual files directly.
 *
 * @example
 *   import {
 *     PipelineOrchestrator,
 *     StudioEventBus,
 *     PluginRegistry,
 *     LoggingPlugin,
 *     MetricsPlugin,
 *     StudioTestHarness,
 *     AgentScoreboard,
 *   } from "@workspace/core/agent-studio";
 */

// ── Pipeline ──────────────────────────────────────────────────────────────
export {
  PipelineOrchestrator,
  type StageDefinition,
  type StageContext,
  type StageResult,
  type PipelineResult,
  type StageStatus,
  type OrchestratorOptions,
} from "./pipeline-orchestrator";

// ── Event Bus ─────────────────────────────────────────────────────────────
export {
  StudioEventBus,
  type StudioEventMap,
  type StudioEventType,
  type StudioEvent,
  type Listener,
  type Unsubscribe,
  type EventBusOptions,
} from "./studio-event-bus";

// ── Plugin Registry ───────────────────────────────────────────────────────
export {
  PluginRegistry,
  LoggingPlugin,
  MetricsPlugin,
  type StudioPlugin,
  type MetricEntry,
  type RegistryOptions,
  type LoggingPluginOptions,
  type InstallCtx,
  type PipelineStartCtx,
  type StageHookCtx,
  type StageCompleteCtx,
  type PipelineCompleteCtx,
  type PaymentEventCtx,
  type HealthChangeCtx,
} from "./plugin-registry";

// ── Test Harness ──────────────────────────────────────────────────────────
export {
  StudioTestHarness,
  type MockFn,
  type MockStageCtx,
  type AssertionResult,
  type TestReport,
  type PipelineTestResult,
  type StageTestResult,
  type CapturedEvent,
  type SnapshotDiff,
  type TestHarnessOptions,
} from "./studio-test-harness";

// ── Scoreboard ────────────────────────────────────────────────────────────
export {
  AgentScoreboard,
  type AgentEntry,
  type DomainScore,
  type Badge,
  type CapabilityDomain,
  type BenchmarkResult,
  type ScoreboardOptions,
} from "./agent-scoreboard";

// ── Define / Configure / Submit / Certify (v1 blocks — still supported) ──
export { AgentDefineBlock }    from "./agent-define-block";
export { AgentConfigureBlock } from "./agent-configure-block";
export { AgentSubmitBlock }    from "./agent-submit-block";
export { AgentCertifyBlock }   from "./agent-certify-block";
