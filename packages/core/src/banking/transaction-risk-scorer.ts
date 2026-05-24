/**
 * Banking Integration — Transaction Risk Scorer
 *
 * Assigns a real-time risk score (0–100) to every outbound payment request
 * before it is submitted through the x402 or Open Banking channel.
 * High-scoring transactions are flagged for human review or auto-blocked.
 *
 * Risk signals evaluated:
 *   - Velocity: too many transactions in a short window
 *   - Amount spike: amount > N× the agent's rolling average
 *   - New destination: recipient seen for the first time
 *   - Off-hours: payment outside configured business hours
 *   - Round-amount: suspiciously round figures common in fraud
 *   - Geo-anomaly: currency mismatch vs agent's home currency
 *
 * Usage:
 *
 *   import { TransactionRiskScorer } from "@workspace/core/banking/transaction-risk-scorer";
 *
 *   const scorer = new TransactionRiskScorer({ homeCurrency: "USD" });
 *   const result = scorer.score({ agentId, amountCents, currency, destination, requestedAt });
 *
 *   if (result.riskLevel === "high") blockTransaction(result);
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type RiskSignal = {
  name:        string;
  triggered:   boolean;
  weight:      number;    // contribution to total score when triggered
  detail?:     string;
};

export type RiskScoreResult = {
  txId:        string;
  agentId:     string;
  score:       number;        // 0 – 100
  riskLevel:   RiskLevel;
  signals:     RiskSignal[];
  decision:    "allow" | "review" | "block";
  scoredAt:    string;
};

export type ScoreRequest = {
  agentId:      string;
  amountCents:  number;
  currency:     string;
  destination:  string;       // URL, IBAN, wallet address, etc.
  requestedAt?: string;       // ISO 8601; defaults to now
};

// ---------------------------------------------------------------------------
// Scorer options
// ---------------------------------------------------------------------------

export type RiskScorerOptions = {
  /** Agent's home / base currency; geo-anomaly fires on mismatch */
  homeCurrency?:       string;
  /** Max transactions per agent in the velocity window; defaults to 10 */
  velocityLimit?:      number;
  /** Velocity window in ms; defaults to 60 000 (1 minute) */
  velocityWindowMs?:   number;
  /** Amount spike multiplier vs rolling average; defaults to 5× */
  spikeMultiplier?:    number;
  /** Block threshold score; defaults to 80 */
  blockThreshold?:     number;
  /** Review threshold score; defaults to 50 */
  reviewThreshold?:    number;
  /** Business hours (local 24 h); off-hours transactions scored higher */
  businessHours?:      { start: number; end: number };   // e.g. { start: 8, end: 20 }
};

// ---------------------------------------------------------------------------
// Risk Scorer
// ---------------------------------------------------------------------------

export class TransactionRiskScorer {
  // Per-agent rolling history: timestamp → amountCents
  private history = new Map<string, Array<{ ts: number; amountCents: number; destination: string }>>();

  private homeCurrency:     string;
  private velocityLimit:    number;
  private velocityWindowMs: number;
  private spikeMultiplier:  number;
  private blockThreshold:   number;
  private reviewThreshold:  number;
  private businessHours:    { start: number; end: number };

  constructor(opts: RiskScorerOptions = {}) {
    this.homeCurrency     = opts.homeCurrency     ?? "USD";
    this.velocityLimit    = opts.velocityLimit    ?? 10;
    this.velocityWindowMs = opts.velocityWindowMs ?? 60_000;
    this.spikeMultiplier  = opts.spikeMultiplier  ?? 5;
    this.blockThreshold   = opts.blockThreshold   ?? 80;
    this.reviewThreshold  = opts.reviewThreshold  ?? 50;
    this.businessHours    = opts.businessHours    ?? { start: 8, end: 20 };
  }

  // ── Scoring ───────────────────────────────────────────────────────────────

  score(req: ScoreRequest): RiskScoreResult {
    const now  = req.requestedAt ? new Date(req.requestedAt).getTime() : Date.now();
    const hour = new Date(now).getUTCHours();

    // Retrieve + prune agent history
    const agentHistory = (this.history.get(req.agentId) ?? [])
      .filter(e => now - e.ts <= this.velocityWindowMs);
    this.history.set(req.agentId, agentHistory);

    // ── Signal evaluations ────────────────────────────────────────────────

    // 1. Velocity
    const velocityCount    = agentHistory.length;
    const velocityTriggered = velocityCount >= this.velocityLimit;

    // 2. Amount spike
    const avgAmount        = agentHistory.length > 0
      ? agentHistory.reduce((s, e) => s + e.amountCents, 0) / agentHistory.length
      : 0;
    const spikeTriggered   = avgAmount > 0 && req.amountCents > avgAmount * this.spikeMultiplier;

    // 3. New destination
    const knownDests       = new Set(agentHistory.map(e => e.destination));
    const newDestTriggered = !knownDests.has(req.destination);

    // 4. Off-hours
    const offHoursTriggered =
      hour < this.businessHours.start || hour >= this.businessHours.end;

    // 5. Round amount (multiples of 100, e.g. $10.00, $50.00)
    const roundTriggered   = req.amountCents > 0 && req.amountCents % 1000 === 0;

    // 6. Geo-anomaly (currency mismatch)
    const geoTriggered     = req.currency !== this.homeCurrency;

    const signals: RiskSignal[] = [
      {
        name:      "velocity",
        triggered: velocityTriggered,
        weight:    25,
        detail:    `${velocityCount} txs in window (limit ${this.velocityLimit})`,
      },
      {
        name:      "amount-spike",
        triggered: spikeTriggered,
        weight:    30,
        detail:    spikeTriggered
          ? `${req.amountCents}¢ is ${(req.amountCents / avgAmount).toFixed(1)}× avg`
          : undefined,
      },
      {
        name:      "new-destination",
        triggered: newDestTriggered,
        weight:    15,
        detail:    newDestTriggered ? `first payment to ${req.destination.slice(0, 40)}` : undefined,
      },
      {
        name:      "off-hours",
        triggered: offHoursTriggered,
        weight:    10,
        detail:    `UTC hour ${hour} outside [${this.businessHours.start}–${this.businessHours.end})`,
      },
      {
        name:      "round-amount",
        triggered: roundTriggered,
        weight:    10,
        detail:    roundTriggered ? `${req.amountCents}¢ is a round figure` : undefined,
      },
      {
        name:      "geo-anomaly",
        triggered: geoTriggered,
        weight:    10,
        detail:    geoTriggered
          ? `currency ${req.currency} != home ${this.homeCurrency}`
          : undefined,
      },
    ];

    const totalScore = signals
      .filter(s => s.triggered)
      .reduce((s, sig) => s + sig.weight, 0);

    const score     = Math.min(100, totalScore);
    const riskLevel = this.classifyRisk(score);
    const decision  = score >= this.blockThreshold
      ? "block"
      : score >= this.reviewThreshold
      ? "review"
      : "allow";

    // Record in history
    agentHistory.push({ ts: now, amountCents: req.amountCents, destination: req.destination });

    const txId = `rtx_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    return {
      txId,
      agentId:   req.agentId,
      score,
      riskLevel,
      signals,
      decision,
      scoredAt:  new Date(now).toISOString(),
    };
  }

  private classifyRisk(score: number): RiskLevel {
    if (score >= 80) return "critical";
    if (score >= 60) return "high";
    if (score >= 40) return "medium";
    return "low";
  }

  // ── Inspection ────────────────────────────────────────────────────────────

  clearHistory(agentId?: string): void {
    if (agentId) this.history.delete(agentId);
    else this.history.clear();
  }

  formatResult(r: RiskScoreResult): string {
    const triggered = r.signals.filter(s => s.triggered);
    const lines = [
      `Risk Score: ${r.score}/100  [${r.riskLevel.toUpperCase()}]  → ${r.decision.toUpperCase()}`,
      `Agent: ${r.agentId}  |  ${r.scoredAt}`,
      triggered.length > 0
        ? `Signals: ${triggered.map(s => `${s.name}(+${s.weight})`).join(", ")}`
        : `Signals: none triggered`,
    ];
    return lines.join("\n");
  }
}
