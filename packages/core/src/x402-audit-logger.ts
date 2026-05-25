/**
 * x402 Payment Audit Logger
 *
 * Produces a tamper-evident, append-only audit trail for every x402
 * payment event.  Each entry is chained to its predecessor via a
 * running hash so any retroactive modification is detectable.
 *
 * Audit events cover the full payment lifecycle:
 *   payment.initiated → payment.signed → payment.submitted →
 *   payment.confirmed | payment.failed | payment.rejected
 *
 * Usage:
 *
 *   import { X402AuditLogger } from "@workspace/core/x402-audit-logger";
 *
 *   const logger = new X402AuditLogger({ agentId: "payment-agent-001" });
 *
 *   logger.log("payment.initiated", { url, amountCents, currency });
 *   logger.log("payment.confirmed", { txHash, finalStatus: 200 });
 *
 *   const trail = logger.trail();
 *   console.log(logger.verify());   // { valid: true, entries: 2 }
 */

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type AuditEventType =
  | "payment.initiated"
  | "payment.signed"
  | "payment.submitted"
  | "payment.confirmed"
  | "payment.failed"
  | "payment.rejected"
  | "payment.double_spend_blocked"
  | "session.opened"
  | "session.closed"
  | "budget.alert"
  | "budget.breached"
  | "kyc.passed"
  | "kyc.failed"
  | "risk.flagged"
  | "risk.blocked";

export type AuditEntry = {
  entryId:     string;
  sequence:    number;          // monotonically increasing
  agentId:     string;
  event:       AuditEventType;
  occurredAt:  string;          // ISO 8601
  data:        Record<string, unknown>;
  /** FNV-1a hash of (prevHash + entryId + event + occurredAt + JSON(data)) */
  hash:        string;
  /** Hash of the previous entry; "genesis" for the first entry */
  prevHash:    string;
};

export type AuditTrail = {
  agentId:     string;
  entries:     AuditEntry[];
  headHash:    string;
  createdAt:   string;
  lastEventAt: string | null;
};

export type VerifyResult = {
  valid:       boolean;
  entries:     number;
  brokenAt?:   number;     // sequence number where chain breaks
  reason?:     string;
};

// ---------------------------------------------------------------------------
// Hashing (FNV-1a 32-bit, pure TS — swap for WebCrypto SHA-256 in production)
// ---------------------------------------------------------------------------

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function hashEntry(
  prevHash: string,
  entryId:  string,
  event:    string,
  ts:       string,
  data:     Record<string, unknown>
): string {
  return fnv1a(`${prevHash}|${entryId}|${event}|${ts}|${JSON.stringify(data)}`);
}

// ---------------------------------------------------------------------------
// Logger options
// ---------------------------------------------------------------------------

export type AuditLoggerOptions = {
  agentId:    string;
  /** Max entries kept in memory; oldest are flushed when exceeded */
  maxEntries?: number;
  /** Called after every append — use to persist to DB / file */
  onAppend?:   (entry: AuditEntry) => void;
};

// ---------------------------------------------------------------------------
// Audit Logger
// ---------------------------------------------------------------------------

export class X402AuditLogger {
  private entries:  AuditEntry[] = [];
  private sequence  = 0;
  private headHash  = "genesis";
  private createdAt = new Date().toISOString();

  private agentId:    string;
  private maxEntries: number;
  private opts:       AuditLoggerOptions;

  constructor(opts: AuditLoggerOptions) {
    this.opts       = opts;
    this.agentId    = opts.agentId;
    this.maxEntries = opts.maxEntries ?? 10_000;
  }

  // ── Append ────────────────────────────────────────────────────────────────

  log(event: AuditEventType, data: Record<string, unknown> = {}): AuditEntry {
    const occurredAt = new Date().toISOString();
    const entryId    = `ale_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const hash       = hashEntry(this.headHash, entryId, event, occurredAt, data);

    const entry: AuditEntry = {
      entryId,
      sequence:   ++this.sequence,
      agentId:    this.agentId,
      event,
      occurredAt,
      data,
      hash,
      prevHash:   this.headHash,
    };

    this.headHash = hash;
    this.entries.push(entry);

    // Evict oldest entries when cap is reached
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    this.opts.onAppend?.(entry);
    return entry;
  }

  // ── Verification ──────────────────────────────────────────────────────────

  verify(): VerifyResult {
    if (this.entries.length === 0) {
      return { valid: true, entries: 0 };
    }

    let prev = "genesis";

    for (const entry of this.entries) {
      if (entry.prevHash !== prev) {
        return {
          valid:    false,
          entries:  this.entries.length,
          brokenAt: entry.sequence,
          reason:   `chain broken at sequence ${entry.sequence}: prevHash mismatch`,
        };
      }
      const expected = hashEntry(prev, entry.entryId, entry.event, entry.occurredAt, entry.data);
      if (entry.hash !== expected) {
        return {
          valid:    false,
          entries:  this.entries.length,
          brokenAt: entry.sequence,
          reason:   `hash mismatch at sequence ${entry.sequence}`,
        };
      }
      prev = entry.hash;
    }

    return { valid: true, entries: this.entries.length };
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  trail(): AuditTrail {
    return {
      agentId:     this.agentId,
      entries:     [...this.entries],
      headHash:    this.headHash,
      createdAt:   this.createdAt,
      lastEventAt: this.entries.at(-1)?.occurredAt ?? null,
    };
  }

  filter(event: AuditEventType): AuditEntry[] {
    return this.entries.filter(e => e.event === event);
  }

  since(isoDate: string): AuditEntry[] {
    const ts = new Date(isoDate).getTime();
    return this.entries.filter(e => new Date(e.occurredAt).getTime() >= ts);
  }

  // ── Formatted output ──────────────────────────────────────────────────────

  format(maxRows = 20): string {
    const rows = this.entries.slice(-maxRows);
    const lines = [
      `╔══════════ x402 Audit Trail — agent: ${this.agentId} ══════════╗`,
      `  Entries: ${this.entries.length}  |  Head: ${this.headHash}`,
      ``,
      ...rows.map(e =>
        `  [${String(e.sequence).padStart(4)}] ${e.occurredAt.slice(11, 19)}  ` +
        `${e.event.padEnd(32)}  ${e.hash.slice(0, 8)}`
      ),
      `╚${"═".repeat(60)}╝`,
    ];
    return lines.join("\n");
  }
}
