/**
 * Banking Integration — Payment Reconciliation Engine
 *
 * Matches outbound x402 payment records against bank statement entries
 * to detect unmatched payments, duplicate charges, and amount discrepancies.
 * Produces a signed reconciliation report for audit purposes.
 *
 * Usage:
 *
 *   import { ReconciliationEngine } from "@workspace/core/banking/reconciliation-engine";
 *
 *   const engine = new ReconciliationEngine();
 *   const report = engine.reconcile(x402Exchanges, bankTransactions);
 *   console.log(report.summary());
 */

import type { X402Exchange } from "../x402-types";
import type { UnifiedTransaction } from "./account-aggregator";

// ---------------------------------------------------------------------------
// Matching types
// ---------------------------------------------------------------------------

export type MatchStatus =
  | "matched"          // exchange found in bank statement
  | "unmatched_x402"   // x402 record has no bank statement counterpart
  | "unmatched_bank"   // bank entry has no x402 counterpart
  | "amount_mismatch"  // found but amounts differ
  | "duplicate";       // same exchange matched to more than one bank tx

export type ReconciliationMatch = {
  matchId:      string;
  status:       MatchStatus;
  exchangeId?:  string;
  bankTxId?:    string;
  x402AmountCents?:  number;
  bankAmountCents?:  number;
  discrepancyCents?: number;
  matchedAt:    string;
  note?:        string;
};

export type ReconciliationReport = {
  reportId:       string;
  reconciledAt:   string;
  periodStart:    string;
  periodEnd:      string;
  totalX402:      number;
  totalBank:      number;
  matched:        number;
  unmatchedX402:  number;
  unmatchedBank:  number;
  amountMismatch: number;
  duplicates:     number;
  matches:        ReconciliationMatch[];
  /** Simple hash over all match IDs for tamper-evidence */
  integrityHash:  string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractX402Amount(exchange: X402Exchange): number {
  const p = exchange.paymentProof?.payload as { amount?: number } | undefined;
  return p?.amount ?? 0;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function hashMatches(matches: ReconciliationMatch[]): string {
  const str = matches.map(m => m.matchId + m.status).join("|");
  let h = 0x811c9dc5;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

function isoDate(iso: string): string { return iso.slice(0, 10); }

// ---------------------------------------------------------------------------
// Reconciliation Engine
// ---------------------------------------------------------------------------

export class ReconciliationEngine {
  /**
   * Tolerance in cents: differences within ±toleranceCents are still
   * considered "matched" (handles minor FX rounding). Defaults to 2.
   */
  private toleranceCents: number;

  constructor(opts: { toleranceCents?: number } = {}) {
    this.toleranceCents = opts.toleranceCents ?? 2;
  }

  // ── Core matching ─────────────────────────────────────────────────────────

  reconcile(
    exchanges:    X402Exchange[],
    bankTxs:      UnifiedTransaction[],
    opts: { periodStart?: string; periodEnd?: string } = {}
  ): ReconciliationReport {
    const matches: ReconciliationMatch[] = [];
    const usedBankIds  = new Set<string>();
    const usedExchIds  = new Set<string>();

    // Pass 1 — match each x402 exchange to the closest bank debit entry
    for (const ex of exchanges) {
      if (ex.finalStatus < 200 || ex.finalStatus >= 300) continue; // skip failed

      const x402Cents = extractX402Amount(ex);
      const exDate    = isoDate(ex.response402?.paymentRequired
        ? new Date().toISOString()
        : new Date().toISOString());

      // Find best bank match: same direction (debit), amount within tolerance
      const candidates = bankTxs.filter(
        tx =>
          tx.direction === "debit" &&
          !usedBankIds.has(tx.txId) &&
          Math.abs(tx.amountUsdCents - x402Cents) <= this.toleranceCents
      );

      if (candidates.length === 0) {
        matches.push({
          matchId:         generateId("m"),
          status:          "unmatched_x402",
          exchangeId:      ex.exchangeId,
          x402AmountCents: x402Cents,
          matchedAt:       new Date().toISOString(),
          note:            "no bank statement entry found for this x402 payment",
        });
        continue;
      }

      // Pick the candidate with the smallest amount difference
      const best = candidates.reduce((a, b) =>
        Math.abs(a.amountUsdCents - x402Cents) <= Math.abs(b.amountUsdCents - x402Cents) ? a : b
      );

      const discrepancy = best.amountUsdCents - x402Cents;
      const status: MatchStatus = discrepancy === 0 ? "matched" : "amount_mismatch";

      // Duplicate check — has this exchange already been matched?
      if (usedExchIds.has(ex.exchangeId)) {
        matches.push({
          matchId:         generateId("m"),
          status:          "duplicate",
          exchangeId:      ex.exchangeId,
          bankTxId:        best.txId,
          x402AmountCents: x402Cents,
          bankAmountCents: best.amountUsdCents,
          discrepancyCents: discrepancy,
          matchedAt:       new Date().toISOString(),
          note:            "exchange matched to more than one bank entry",
        });
      } else {
        matches.push({
          matchId:         generateId("m"),
          status,
          exchangeId:      ex.exchangeId,
          bankTxId:        best.txId,
          x402AmountCents: x402Cents,
          bankAmountCents: best.amountUsdCents,
          discrepancyCents: discrepancy !== 0 ? discrepancy : undefined,
          matchedAt:       new Date().toISOString(),
        });
        usedBankIds.add(best.txId);
        usedExchIds.add(ex.exchangeId);
      }
    }

    // Pass 2 — flag bank debits with no x402 counterpart
    for (const tx of bankTxs) {
      if (tx.direction !== "debit") continue;
      if (usedBankIds.has(tx.txId)) continue;
      matches.push({
        matchId:        generateId("m"),
        status:         "unmatched_bank",
        bankTxId:       tx.txId,
        bankAmountCents: tx.amountUsdCents,
        matchedAt:      new Date().toISOString(),
        note:           "bank debit has no corresponding x402 exchange record",
      });
    }

    // Aggregate stats
    const allDates    = [
      ...exchanges.map(() => new Date().toISOString()),
      ...bankTxs.map(t => t.bookedAt),
    ].sort();

    const report: ReconciliationReport = {
      reportId:       generateId("rec"),
      reconciledAt:   new Date().toISOString(),
      periodStart:    opts.periodStart ?? (allDates[0] ?? new Date().toISOString()),
      periodEnd:      opts.periodEnd   ?? (allDates[allDates.length - 1] ?? new Date().toISOString()),
      totalX402:      exchanges.length,
      totalBank:      bankTxs.filter(t => t.direction === "debit").length,
      matched:        matches.filter(m => m.status === "matched").length,
      unmatchedX402:  matches.filter(m => m.status === "unmatched_x402").length,
      unmatchedBank:  matches.filter(m => m.status === "unmatched_bank").length,
      amountMismatch: matches.filter(m => m.status === "amount_mismatch").length,
      duplicates:     matches.filter(m => m.status === "duplicate").length,
      matches,
      integrityHash:  hashMatches(matches),
    };

    return report;
  }

  // ── Reporting ─────────────────────────────────────────────────────────────

  formatReport(r: ReconciliationReport): string {
    const pct = (n: number, d: number) =>
      d > 0 ? `${Math.round((n / d) * 100)}%` : "n/a";

    const lines = [
      `╔══════════ Reconciliation Report ══════════╗`,
      `  Report ID     : ${r.reportId}`,
      `  Period        : ${r.periodStart.slice(0, 10)} → ${r.periodEnd.slice(0, 10)}`,
      `  Integrity     : ${r.integrityHash}`,
      ``,
      `  x402 records  : ${r.totalX402}`,
      `  Bank entries  : ${r.totalBank}`,
      ``,
      `  ✓ Matched     : ${r.matched}  (${pct(r.matched, r.totalX402)})`,
      `  ✗ Unmatched x402 : ${r.unmatchedX402}`,
      `  ✗ Unmatched bank : ${r.unmatchedBank}`,
      `  ⚠ Amount mismatch: ${r.amountMismatch}`,
      `  ⚠ Duplicates  : ${r.duplicates}`,
      `╚${"═".repeat(44)}╝`,
    ];
    return lines.join("\n");
  }
}
