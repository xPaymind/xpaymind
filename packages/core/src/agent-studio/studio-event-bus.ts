/**
 * Agent Studio v2 — Event Bus
 *
 * Type-safe, in-process publish/subscribe event bus that wires together
 * all Agent Studio 2.0 components without hard dependencies between them.
 *
 * Components emit strongly-typed events; listeners react without polling.
 * The bus also maintains a bounded replay buffer so late subscribers can
 * catch up on recent history (useful for dashboards and test assertions).
 *
 * Event catalogue (v2):
 *
 *   Pipeline events   : pipeline.started | pipeline.completed | pipeline.failed
 *   Stage events      : stage.started | stage.passed | stage.failed | stage.skipped | stage.timeout
 *   Payment events    : payment.initiated | payment.confirmed | payment.failed | payment.rejected
 *   Health events     : health.degraded | health.unhealthy | health.recovered
 *   Budget events     : budget.alert | budget.breached
 *   Circuit events    : circuit.opened | circuit.half_opened | circuit.closed
 *   Rate-limit events : ratelimit.throttled | ratelimit.queue_timeout
 *   Audit events      : audit.chain_valid | audit.chain_broken
 *   KYC events        : kyc.passed | kyc.failed
 *
 * Usage:
 *
 *   import { StudioEventBus } from
 *     "@workspace/core/agent-studio/studio-event-bus";
 *
 *   const bus = StudioEventBus.global();   // singleton
 *
 *   // Subscribe
 *   const unsub = bus.on("pipeline.completed", e => {
 *     console.log(e.payload.passed, e.payload.totalMs);
 *   });
 *
 *   // Publish
 *   bus.emit("pipeline.completed", { pipelineId: "p1", passed: true, totalMs: 320 });
 *
 *   // Replay last 50 events of a type
 *   bus.replay("payment.confirmed", 50).forEach(e => process(e));
 *
 *   unsub();  // clean up listener
 */

// ---------------------------------------------------------------------------
// Event catalogue
// ---------------------------------------------------------------------------

export type StudioEventMap = {
  // Pipeline
  "pipeline.started":   { pipelineId: string; agentId: string; stages: string[] };
  "pipeline.completed": { pipelineId: string; agentId: string; passed: boolean; totalMs: number; failedStages: string[] };
  "pipeline.failed":    { pipelineId: string; agentId: string; reason: string };

  // Stage
  "stage.started":   { pipelineId: string; stageId: string; attempt: number };
  "stage.passed":    { pipelineId: string; stageId: string; latencyMs: number; attempts: number };
  "stage.failed":    { pipelineId: string; stageId: string; error: string; attempts: number };
  "stage.skipped":   { pipelineId: string; stageId: string; reason: string };
  "stage.timeout":   { pipelineId: string; stageId: string; timeoutMs: number };

  // Payment
  "payment.initiated":  { agentId: string; url: string; amountMicro: string; currency: string };
  "payment.confirmed":  { agentId: string; txHash: string; latencyMs: number };
  "payment.failed":     { agentId: string; error: string; attempt: number };
  "payment.rejected":   { agentId: string; reason: string };

  // Health
  "health.degraded":   { agentId: string; reasons: string[] };
  "health.unhealthy":  { agentId: string; reasons: string[] };
  "health.recovered":  { agentId: string };

  // Budget
  "budget.alert":    { agentId: string; usedPct: number; limitCents: number };
  "budget.breached": { agentId: string; usedCents: number; limitCents: number };

  // Circuit breaker
  "circuit.opened":      { endpoint: string; failures: number };
  "circuit.half_opened": { endpoint: string };
  "circuit.closed":      { endpoint: string };

  // Rate limiter
  "ratelimit.throttled":      { key: string; waitedMs: number };
  "ratelimit.queue_timeout":  { key: string; waitedMs: number };

  // Audit
  "audit.chain_valid":  { agentId: string; entries: number };
  "audit.chain_broken": { agentId: string; brokenAt: number; reason: string };

  // KYC
  "kyc.passed": { agentId: string; identityId: string; level: string };
  "kyc.failed": { agentId: string; identityId: string; reason: string };
};

export type StudioEventType = keyof StudioEventMap;

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type StudioEvent<T extends StudioEventType = StudioEventType> = {
  eventId:   string;
  type:      T;
  payload:   StudioEventMap[T];
  emittedAt: string;
};

export type Listener<T extends StudioEventType> =
  (event: StudioEvent<T>) => void | Promise<void>;

export type Unsubscribe = () => void;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type EventBusOptions = {
  /** Max events kept per type in the replay buffer; default 200 */
  replayBufferSize?: number;
  /** If true, async listener errors are suppressed (logged to console.error); default true */
  suppressErrors?:   boolean;
};

// ---------------------------------------------------------------------------
// Event Bus
// ---------------------------------------------------------------------------

export class StudioEventBus {
  private listeners = new Map<string, Set<Listener<any>>>();
  private replay    = new Map<string, StudioEvent<any>[]>();
  private bufferSz:  number;
  private suppress:  boolean;

  private static _global: StudioEventBus | null = null;

  constructor(opts: EventBusOptions = {}) {
    this.bufferSz = opts.replayBufferSize ?? 200;
    this.suppress = opts.suppressErrors   ?? true;
  }

  /** Global singleton — shared across all Agent Studio v2 components */
  static global(): StudioEventBus {
    if (!StudioEventBus._global) {
      StudioEventBus._global = new StudioEventBus();
    }
    return StudioEventBus._global;
  }

  /** Reset the global singleton (useful in tests) */
  static resetGlobal(): void {
    StudioEventBus._global = null;
  }

  // ── Publish ───────────────────────────────────────────────────────────────

  emit<T extends StudioEventType>(type: T, payload: StudioEventMap[T]): void {
    const event: StudioEvent<T> = {
      eventId:   `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      payload,
      emittedAt: new Date().toISOString(),
    };

    // Replay buffer
    const buf = this.replay.get(type) ?? [];
    buf.push(event);
    if (buf.length > this.bufferSz) buf.shift();
    this.replay.set(type, buf);

    // Notify listeners
    const fns = this.listeners.get(type);
    if (!fns) return;

    for (const fn of fns) {
      try {
        const ret = fn(event);
        if (ret instanceof Promise && this.suppress) {
          ret.catch(err => console.error(`[StudioEventBus] listener error on "${type}":`, err));
        }
      } catch (err) {
        if (!this.suppress) throw err;
        console.error(`[StudioEventBus] listener error on "${type}":`, err);
      }
    }
  }

  // ── Subscribe ─────────────────────────────────────────────────────────────

  on<T extends StudioEventType>(type: T, listener: Listener<T>): Unsubscribe {
    let fns = this.listeners.get(type);
    if (!fns) { fns = new Set(); this.listeners.set(type, fns); }
    fns.add(listener);
    return () => fns!.delete(listener);
  }

  /** Subscribe to multiple event types with one listener */
  onAny<T extends StudioEventType>(
    types: T[],
    listener: Listener<T>
  ): Unsubscribe {
    const unsubs = types.map(t => this.on(t, listener));
    return () => unsubs.forEach(u => u());
  }

  /** Subscribe and immediately receive the latest buffered event (if any) */
  onWithReplay<T extends StudioEventType>(type: T, listener: Listener<T>): Unsubscribe {
    const latest = this.replay.get(type)?.at(-1);
    if (latest) listener(latest as StudioEvent<T>);
    return this.on(type, listener);
  }

  // ── Replay ────────────────────────────────────────────────────────────────

  replay_events<T extends StudioEventType>(type: T, last = this.bufferSz): StudioEvent<T>[] {
    return ((this.replay.get(type) ?? []) as StudioEvent<T>[]).slice(-last);
  }

  /** All buffered events across all types, sorted by emittedAt */
  allEvents(last = this.bufferSz): StudioEvent[] {
    const all: StudioEvent[] = [];
    for (const buf of this.replay.values()) all.push(...buf);
    return all.sort((a, b) => a.emittedAt.localeCompare(b.emittedAt)).slice(-last);
  }

  // ── Management ────────────────────────────────────────────────────────────

  off<T extends StudioEventType>(type: T, listener: Listener<T>): void {
    this.listeners.get(type)?.delete(listener);
  }

  removeAllListeners(type?: StudioEventType): void {
    if (type) this.listeners.delete(type);
    else      this.listeners.clear();
  }

  clearReplay(type?: StudioEventType): void {
    if (type) this.replay.delete(type);
    else      this.replay.clear();
  }

  listenerCount(type: StudioEventType): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  stats(): Record<string, { listeners: number; buffered: number }> {
    const result: Record<string, { listeners: number; buffered: number }> = {};
    const types = new Set([...this.listeners.keys(), ...this.replay.keys()]);
    for (const t of types) {
      result[t] = {
        listeners: this.listeners.get(t)?.size    ?? 0,
        buffered:  this.replay.get(t)?.length ?? 0,
      };
    }
    return result;
  }
}
