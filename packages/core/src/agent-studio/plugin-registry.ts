/**
 * Agent Studio v2 — Plugin Registry
 *
 * Extensibility layer for Agent Studio 2.0.  Third-party developers and
 * internal teams register plugins that hook into the pipeline lifecycle
 * without modifying core orchestrator code.
 *
 * Plugin lifecycle hooks (all optional):
 *
 *   onInstall(ctx)           — called once when the plugin is registered
 *   onPipelineStart(ctx)     — before any stage runs
 *   onStageStart(ctx)        — before each stage
 *   onStageComplete(ctx)     — after each stage (pass or fail)
 *   onPipelineComplete(ctx)  — after all stages finish
 *   onPaymentEvent(ctx)      — on every payment bus event
 *   onHealthChange(ctx)      — when agent health level changes
 *   onUninstall()            — cleanup when plugin is removed
 *
 * Built-in plugins shipped with v2:
 *   - LoggingPlugin      : structured stage/pipeline logs to console
 *   - MetricsPlugin      : Prometheus-compatible counter/gauge exports
 *   - SlackNotifyPlugin  : webhook alerts on pipeline failure or health change
 *
 * Usage:
 *
 *   import { PluginRegistry, LoggingPlugin } from
 *     "@workspace/core/agent-studio/plugin-registry";
 *
 *   const registry = PluginRegistry.global();
 *   registry.install(new LoggingPlugin({ prefix: "[my-agent]" }));
 *
 *   // Custom plugin
 *   registry.install({
 *     id: "my-plugin",
 *     version: "1.0.0",
 *     onPipelineComplete: async ({ result }) => {
 *       await myDb.save(result);
 *     },
 *   });
 */

// ---------------------------------------------------------------------------
// Context types passed to hooks
// ---------------------------------------------------------------------------

export type PipelineStartCtx = {
  agentId:    string;
  pipelineId: string;
  stages:     string[];
  startedAt:  string;
};

export type StageHookCtx = {
  agentId:    string;
  pipelineId: string;
  stageId:    string;
  attempt:    number;
  startedAt:  string;
};

export type StageCompleteCtx = StageHookCtx & {
  status:     "passed" | "failed" | "skipped" | "timed_out";
  latencyMs:  number;
  error?:     string;
};

export type PipelineCompleteCtx = {
  agentId:      string;
  pipelineId:   string;
  passed:       boolean;
  totalMs:      number;
  failedStages: string[];
  finishedAt:   string;
};

export type PaymentEventCtx = {
  agentId:   string;
  eventType: string;
  payload:   Record<string, unknown>;
  emittedAt: string;
};

export type HealthChangeCtx = {
  agentId:  string;
  previous: string;
  current:  string;
  reasons:  string[];
};

export type InstallCtx = {
  agentId:    string;
  registryId: string;
};

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export type StudioPlugin = {
  /** Unique plugin identifier */
  id:       string;
  version:  string;
  description?: string;

  onInstall?:          (ctx: InstallCtx) => void | Promise<void>;
  onPipelineStart?:    (ctx: PipelineStartCtx) => void | Promise<void>;
  onStageStart?:       (ctx: StageHookCtx) => void | Promise<void>;
  onStageComplete?:    (ctx: StageCompleteCtx) => void | Promise<void>;
  onPipelineComplete?: (ctx: PipelineCompleteCtx & { result: PipelineCompleteCtx }) => void | Promise<void>;
  onPaymentEvent?:     (ctx: PaymentEventCtx) => void | Promise<void>;
  onHealthChange?:     (ctx: HealthChangeCtx) => void | Promise<void>;
  onUninstall?:        () => void | Promise<void>;
};

// ---------------------------------------------------------------------------
// Registry options
// ---------------------------------------------------------------------------

export type RegistryOptions = {
  agentId?:        string;
  /** Suppress hook errors; default true */
  suppressErrors?: boolean;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class PluginRegistry {
  private plugins   = new Map<string, StudioPlugin>();
  private agentId:  string;
  private suppress: boolean;
  readonly id = `reg_${Date.now().toString(36)}`;

  private static _global: PluginRegistry | null = null;

  constructor(opts: RegistryOptions = {}) {
    this.agentId  = opts.agentId        ?? "default";
    this.suppress = opts.suppressErrors ?? true;
  }

  static global(opts?: RegistryOptions): PluginRegistry {
    if (!PluginRegistry._global) {
      PluginRegistry._global = new PluginRegistry(opts);
    }
    return PluginRegistry._global;
  }

  static resetGlobal(): void {
    PluginRegistry._global = null;
  }

  // ── Install / uninstall ───────────────────────────────────────────────────

  async install(plugin: StudioPlugin): Promise<void> {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already installed`);
    }
    this.plugins.set(plugin.id, plugin);
    await this.invoke(plugin, "onInstall", { agentId: this.agentId, registryId: this.id });
  }

  async uninstall(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    await this.invoke(plugin, "onUninstall", undefined);
    this.plugins.delete(pluginId);
  }

  list(): Array<{ id: string; version: string; description?: string }> {
    return [...this.plugins.values()].map(p => ({
      id: p.id, version: p.version, description: p.description,
    }));
  }

  // ── Hook dispatchers ──────────────────────────────────────────────────────

  async dispatchPipelineStart(ctx: PipelineStartCtx): Promise<void> {
    await this.broadcast("onPipelineStart", ctx);
  }

  async dispatchStageStart(ctx: StageHookCtx): Promise<void> {
    await this.broadcast("onStageStart", ctx);
  }

  async dispatchStageComplete(ctx: StageCompleteCtx): Promise<void> {
    await this.broadcast("onStageComplete", ctx);
  }

  async dispatchPipelineComplete(ctx: PipelineCompleteCtx): Promise<void> {
    await this.broadcast("onPipelineComplete", { ...ctx, result: ctx });
  }

  async dispatchPaymentEvent(ctx: PaymentEventCtx): Promise<void> {
    await this.broadcast("onPaymentEvent", ctx);
  }

  async dispatchHealthChange(ctx: HealthChangeCtx): Promise<void> {
    await this.broadcast("onHealthChange", ctx);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async broadcast(hook: keyof StudioPlugin, ctx: unknown): Promise<void> {
    const tasks = [...this.plugins.values()].map(p => this.invoke(p, hook, ctx));
    await Promise.all(tasks);
  }

  private async invoke(plugin: StudioPlugin, hook: keyof StudioPlugin, ctx: unknown): Promise<void> {
    const fn = plugin[hook] as ((ctx: unknown) => void | Promise<void>) | undefined;
    if (typeof fn !== "function") return;
    try {
      await fn.call(plugin, ctx);
    } catch (err) {
      if (!this.suppress) throw err;
      console.error(`[PluginRegistry] plugin "${plugin.id}" hook "${hook}" error:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Built-in: LoggingPlugin
// ---------------------------------------------------------------------------

export type LoggingPluginOptions = {
  prefix?: string;
  verbose?: boolean;
};

export class LoggingPlugin implements StudioPlugin {
  readonly id      = "logging";
  readonly version = "2.0.0";
  readonly description = "Structured console logging for pipeline and stage events";

  private prefix:  string;
  private verbose: boolean;

  constructor(opts: LoggingPluginOptions = {}) {
    this.prefix  = opts.prefix  ?? "[studio]";
    this.verbose = opts.verbose ?? false;
  }

  onPipelineStart({ pipelineId, stages }: PipelineStartCtx) {
    console.log(`${this.prefix} pipeline ${pipelineId} started — stages: ${stages.join(", ")}`);
  }

  onStageStart({ stageId, attempt }: StageHookCtx) {
    if (this.verbose) {
      console.log(`${this.prefix}   → stage "${stageId}" attempt ${attempt}`);
    }
  }

  onStageComplete({ stageId, status, latencyMs, error }: StageCompleteCtx) {
    const icon = status === "passed" ? "✓" : status === "skipped" ? "—" : "✗";
    const msg  = error ? `  [${error.slice(0, 80)}]` : "";
    console.log(`${this.prefix}   ${icon} stage "${stageId}" ${status} (${latencyMs} ms)${msg}`);
  }

  onPipelineComplete({ pipelineId, passed, totalMs, failedStages }: PipelineCompleteCtx) {
    const icon = passed ? "✓" : "✗";
    const fails = failedStages.length ? `  failed: ${failedStages.join(", ")}` : "";
    console.log(`${this.prefix} pipeline ${pipelineId} ${passed ? "PASSED" : "FAILED"} ${icon} (${totalMs} ms)${fails}`);
  }
}

// ---------------------------------------------------------------------------
// Built-in: MetricsPlugin
// ---------------------------------------------------------------------------

export type MetricEntry = { name: string; value: number; labels: Record<string, string> };

export class MetricsPlugin implements StudioPlugin {
  readonly id      = "metrics";
  readonly version = "2.0.0";
  readonly description = "Prometheus-compatible counters and gauges for pipeline telemetry";

  private counters: MetricEntry[] = [];
  private gauges:   MetricEntry[] = [];

  private inc(name: string, labels: Record<string, string>, n = 1) {
    this.counters.push({ name, value: n, labels });
  }
  private set(name: string, labels: Record<string, string>, v: number) {
    this.gauges.push({ name, value: v, labels });
  }

  onPipelineComplete({ agentId, passed, totalMs }: PipelineCompleteCtx) {
    this.inc("studio_pipeline_total",   { agentId, status: passed ? "passed" : "failed" });
    this.set("studio_pipeline_duration_ms", { agentId }, totalMs);
  }

  onStageComplete({ agentId, stageId, status, latencyMs }: StageCompleteCtx) {
    this.inc("studio_stage_total",      { agentId, stageId, status });
    this.set("studio_stage_duration_ms",{ agentId, stageId }, latencyMs);
  }

  onPaymentEvent({ agentId, eventType }: PaymentEventCtx) {
    this.inc("studio_payment_events_total", { agentId, eventType });
  }

  /** Export in Prometheus text format */
  toPrometheusText(): string {
    const lines: string[] = [];
    const fmt = (e: MetricEntry) => {
      const lbl = Object.entries(e.labels).map(([k, v]) => `${k}="${v}"`).join(",");
      return `${e.name}{${lbl}} ${e.value}`;
    };
    for (const c of this.counters) lines.push(`# TYPE ${c.name} counter`, fmt(c));
    for (const g of this.gauges)   lines.push(`# TYPE ${g.name} gauge`,   fmt(g));
    return lines.join("\n");
  }

  snapshot() {
    return { counters: [...this.counters], gauges: [...this.gauges] };
  }
}
