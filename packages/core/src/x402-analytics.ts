/**
 * x402 Payment Analytics
 *
 * Collects X402Exchange events and produces real-time payment metrics:
 * volume, success rate, latency percentiles, scheme breakdown, and
 * hourly bucketed time-series.
 *
 * Usage:
 *
 *   import { X402Analytics } from "@workspace/core/x402-analytics";
 *
 *   const analytics = new X402Analytics();
 *   analytics.record(exchange);
 *
 *   console.log(analytics.snapshot());
 */

import type { X402Exchange } from "./x402-types";
import { classifyOutcome }   from "./x402-types";

// ---------------------------------------------------------------------------
// Metric types
// ---------------------------------------------------------------------------

export type SchemeBreakdown = {
  exact:        number;
  streaming:    number;
  subscription: number;
};

export type LatencyPercentiles = {
  p50:  number;
  p90:  number;
  p95:  number;
  p99:  number;
  max:  number;
};

export type HourlyBucket = {
  /** ISO 8601 hour label, e.g. "2026-05-22T14:00:00Z" */
  hour:          string;
  totalPayments: number;
  succeeded:     number;
  failed:        number;
  volumeCents:   number;
};

export type AnalyticsSnapshot = {
  capturedAt:        string;
  totalPayments:     number;
  succeeded:         number;
  failed:            number;
  successRatePct:    number;
  totalVolumeCents:  number;
  avgAmountCents:    number;
  latency:           LatencyPercentiles;
  schemeBreakdown:   SchemeBreakdown;
  /** Last 24 hourly buckets */
  timeSeries:        HourlyBucket[];
  /** Top 5 destination URLs by payment count */
  topDestinations:   Array<{ url: string; count: number; volumeCents: number }>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hourLabel(isoDate: string): string {
  // Round down to the hour
  const d = new Date(isoDate);
  d.setMinutes(0, 0, 0);
  return d.toISOString().replace(".000Z", "Z");
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function extractAmount(exchange: X402Exchange): number {
  const p = exchange.paymentProof?.payload as
    | { amount?: number; ratePerSecond?: number }
    | undefined;
  return p?.amount ?? p?.ratePerSecond ?? 0;
}

// ---------------------------------------------------------------------------
// Analytics class
// ---------------------------------------------------------------------------

export class X402Analytics {
  private exchanges: X402Exchange[] = [];

  // ── Ingest ────────────────────────────────────────────────────────────────

  record(exchange: X402Exchange): void {
    this.exchanges.push(exchange);
  }

  recordBatch(exchanges: X402Exchange[]): void {
    this.exchanges.push(...exchanges);
  }

  clear(): void {
    this.exchanges = [];
  }

  // ── Compute snapshot ──────────────────────────────────────────────────────

  snapshot(): AnalyticsSnapshot {
    const all       = this.exchanges;
    const total     = all.length;
    const succeeded = all.filter(e => classifyOutcome(e) === "success").length;
    const failed    = total - succeeded;

    const successRatePct = total > 0
      ? Math.round((succeeded / total) * 1000) / 10
      : 0;

    const amounts       = all.map(extractAmount);
    const totalVolume   = amounts.reduce((s, a) => s + a, 0);
    const avgAmount     = total > 0 ? Math.round(totalVolume / total) : 0;

    // Latency percentiles
    const latencies = [...all.map(e => e.durationMs)].sort((a, b) => a - b);
    const latency: LatencyPercentiles = {
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies[latencies.length - 1] ?? 0,
    };

    // Scheme breakdown
    const schemeBreakdown: SchemeBreakdown = { exact: 0, streaming: 0, subscription: 0 };
    for (const e of all) {
      const scheme = e.paymentProof?.scheme as keyof SchemeBreakdown | undefined;
      if (scheme && scheme in schemeBreakdown) schemeBreakdown[scheme]++;
    }

    // Hourly time-series (last 24 h)
    const buckets = new Map<string, HourlyBucket>();
    for (const e of all) {
      const hour = hourLabel(e.response402?.paymentRequired
        ? new Date().toISOString()   // fallback
        : new Date().toISOString());
      const realHour = hourLabel(e.durationMs
        ? new Date(Date.now() - e.durationMs).toISOString()
        : new Date().toISOString());

      if (!buckets.has(realHour)) {
        buckets.set(realHour, {
          hour: realHour, totalPayments: 0,
          succeeded: 0, failed: 0, volumeCents: 0,
        });
      }
      const b = buckets.get(realHour)!;
      b.totalPayments++;
      if (classifyOutcome(e) === "success") b.succeeded++;
      else b.failed++;
      b.volumeCents += extractAmount(e);
    }
    const timeSeries = [...buckets.values()]
      .sort((a, b) => a.hour.localeCompare(b.hour))
      .slice(-24);

    // Top destinations
    const destMap = new Map<string, { count: number; volumeCents: number }>();
    for (const e of all) {
      const url = e.requestUrl;
      const cur = destMap.get(url) ?? { count: 0, volumeCents: 0 };
      cur.count++;
      cur.volumeCents += extractAmount(e);
      destMap.set(url, cur);
    }
    const topDestinations = [...destMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([url, v]) => ({ url, ...v }));

    return {
      capturedAt:       new Date().toISOString(),
      totalPayments:    total,
      succeeded,
      failed,
      successRatePct,
      totalVolumeCents: totalVolume,
      avgAmountCents:   avgAmount,
      latency,
      schemeBreakdown,
      timeSeries,
      topDestinations,
    };
  }

  // ── Formatted report ──────────────────────────────────────────────────────

  report(): string {
    const s = this.snapshot();
    const lines = [
      `╔══════════ x402 Payment Analytics ══════════╗`,
      `  Captured at   : ${s.capturedAt}`,
      `  Total payments: ${s.totalPayments}  (✓ ${s.succeeded}  ✗ ${s.failed})`,
      `  Success rate   : ${s.successRatePct}%`,
      `  Volume         : $${(s.totalVolumeCents / 100).toFixed(2)}  avg $${(s.avgAmountCents / 100).toFixed(4)}`,
      ``,
      `  Latency (ms)   : p50=${s.latency.p50}  p90=${s.latency.p90}  p99=${s.latency.p99}  max=${s.latency.max}`,
      ``,
      `  Schemes        : exact=${s.schemeBreakdown.exact}  streaming=${s.schemeBreakdown.streaming}  subscription=${s.schemeBreakdown.subscription}`,
      ``,
      `  Top destinations:`,
      ...s.topDestinations.map(
        d => `    ${d.url.slice(0, 50).padEnd(50)}  ${d.count} payments  $${(d.volumeCents / 100).toFixed(2)}`
      ),
      `╚${"═".repeat(45)}╝`,
    ];
    return lines.join("\n");
  }
}
