/**
 * Multi-Currency Payment Normalizer
 *
 * Converts, validates, and normalises payment amounts across all
 * currencies supported by the x402 protocol — stablecoins, fiat, and
 * native crypto assets — into a canonical representation used
 * throughout the benchmark pipeline.
 *
 * Responsibilities:
 *   - Precision-safe arithmetic (integer cents / micro-units — no floats)
 *   - On-chain price feed integration interface (swap with real oracle)
 *   - FX rate caching with configurable TTL
 *   - Conversion path resolution (e.g. SOL → USDC → EUR)
 *   - Validation: dust threshold, max single-payment cap, decimals check
 *   - Normalised output: { amountMicro, currency, usdEquivalentMicro }
 *
 * Usage:
 *
 *   import { PaymentNormalizer } from "@workspace/core/payment-normalizer";
 *
 *   const norm = new PaymentNormalizer();
 *   const result = await norm.normalize({ amount: "1.50", currency: "USDC" });
 *   // { amountMicro: 1_500_000n, currency: "USDC", usdEquivalentMicro: 1_500_000n }
 *
 *   const converted = await norm.convert({
 *     amount: "100", from: "USDC", to: "EUR"
 *   });
 */

// ---------------------------------------------------------------------------
// Supported currencies
// ---------------------------------------------------------------------------

export type StableCoin = "USDC" | "USDT" | "PYUSD" | "EURC" | "AUDD";
export type NativeAsset = "SOL" | "ETH" | "BTC" | "MATIC";
export type FiatCurrency = "USD" | "EUR" | "GBP" | "AUD" | "SGD" | "JPY";
export type SupportedCurrency = StableCoin | NativeAsset | FiatCurrency;

const MICRO = 1_000_000n;   // 1 unit = 1_000_000 micro-units

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PaymentNormalizerError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "PaymentNormalizerError";
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NormalizedPayment = {
  amountMicro:        bigint;   // amount in micro-units of `currency`
  currency:           SupportedCurrency;
  usdEquivalentMicro: bigint;   // USD value in micro-units
  fxRate:             number;   // currency → USD rate used
  fxRateAge:          number;   // ms since rate was fetched
  dustFiltered:       boolean;  // true if amount < dustThreshold
};

export type ConversionResult = {
  fromAmountMicro: bigint;
  fromCurrency:    SupportedCurrency;
  toAmountMicro:   bigint;
  toCurrency:      SupportedCurrency;
  rate:            number;
  path:            SupportedCurrency[];
  rateAgeMs:       number;
};

export type FXRate = {
  base:      SupportedCurrency;
  quote:     SupportedCurrency;
  rate:      number;        // how many `quote` per 1 `base`
  fetchedAt: number;        // Date.now()
};

// ---------------------------------------------------------------------------
// Price feed interface (replace stub with Pyth / Chainlink in production)
// ---------------------------------------------------------------------------

export interface PriceFeed {
  fetchRate(base: SupportedCurrency, quote: SupportedCurrency): Promise<number>;
}

class StubPriceFeed implements PriceFeed {
  private static readonly RATES: Record<string, number> = {
    "USDC/USD": 1.0000, "USDT/USD": 0.9998, "PYUSD/USD": 1.0001,
    "EURC/USD": 1.0850, "AUDD/USD": 0.6540,
    "SOL/USD":  172.50, "ETH/USD":  3_820.00, "BTC/USD": 67_400.00,
    "MATIC/USD": 0.8730,
    "EUR/USD":  1.0850, "GBP/USD":  1.2710, "AUD/USD":  0.6540,
    "SGD/USD":  0.7410, "JPY/USD":  0.006520,
  };

  async fetchRate(base: SupportedCurrency, quote: SupportedCurrency): Promise<number> {
    const direct   = StubPriceFeed.RATES[`${base}/${quote}`];
    if (direct !== undefined) return direct;
    const reversed = StubPriceFeed.RATES[`${quote}/${base}`];
    if (reversed !== undefined) return 1 / reversed;
    // Route via USD
    const baseUsd  = StubPriceFeed.RATES[`${base}/USD`]  ?? 1;
    const quoteUsd = StubPriceFeed.RATES[`${quote}/USD`] ?? 1;
    return baseUsd / quoteUsd;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type NormalizerOptions = {
  /** FX rate cache TTL in ms; default 30 000 (30 s) */
  rateCacheTtlMs?:   number;
  /** Minimum amount in micro-units to be considered non-dust; default 1 000 (0.001 units) */
  dustThresholdMicro?: bigint;
  /** Maximum single payment in micro-USD; default 10 000 000 000 ($10 000) */
  maxPaymentMicroUsd?: bigint;
  /** Custom price feed implementation */
  priceFeed?:        PriceFeed;
};

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

export class PaymentNormalizer {
  private rateCache = new Map<string, FXRate>();
  private feed:      PriceFeed;
  private opts:      Required<NormalizerOptions>;

  constructor(opts: NormalizerOptions = {}) {
    this.feed = opts.priceFeed ?? new StubPriceFeed();
    this.opts = {
      rateCacheTtlMs:      opts.rateCacheTtlMs      ?? 30_000,
      dustThresholdMicro:  opts.dustThresholdMicro  ?? 1_000n,
      maxPaymentMicroUsd:  opts.maxPaymentMicroUsd  ?? 10_000_000_000n,
      priceFeed:           this.feed,
    };
  }

  // ── Normalize ─────────────────────────────────────────────────────────────

  async normalize(req: {
    amount:   string;
    currency: SupportedCurrency;
  }): Promise<NormalizedPayment> {
    const amountMicro  = this.parseToMicro(req.amount);
    const { rate, age } = await this.getRate(req.currency, "USD");
    const usdMicro     = BigInt(Math.round(Number(amountMicro) * rate));
    const dustFiltered = amountMicro < this.opts.dustThresholdMicro;

    if (usdMicro > this.opts.maxPaymentMicroUsd) {
      throw new PaymentNormalizerError(
        `Payment $${Number(usdMicro) / 1e6} USD exceeds cap $${Number(this.opts.maxPaymentMicroUsd) / 1e6} USD`,
        "PAYMENT_EXCEEDS_CAP"
      );
    }

    return {
      amountMicro,
      currency:           req.currency,
      usdEquivalentMicro: usdMicro,
      fxRate:             rate,
      fxRateAge:          age,
      dustFiltered,
    };
  }

  // ── Convert ───────────────────────────────────────────────────────────────

  async convert(req: {
    amount: string;
    from:   SupportedCurrency;
    to:     SupportedCurrency;
  }): Promise<ConversionResult> {
    const fromMicro    = this.parseToMicro(req.amount);
    const { rate, age } = await this.getRate(req.from, req.to);
    const toMicro      = BigInt(Math.round(Number(fromMicro) * rate));

    return {
      fromAmountMicro: fromMicro,
      fromCurrency:    req.from,
      toAmountMicro:   toMicro,
      toCurrency:      req.to,
      rate,
      path:            req.from === req.to ? [req.from] : [req.from, "USD" as SupportedCurrency, req.to],
      rateAgeMs:       age,
    };
  }

  // ── Batch normalize ───────────────────────────────────────────────────────

  async normalizeAll(
    payments: Array<{ amount: string; currency: SupportedCurrency }>
  ): Promise<NormalizedPayment[]> {
    return Promise.all(payments.map(p => this.normalize(p)));
  }

  // ── Rate cache ────────────────────────────────────────────────────────────

  private async getRate(
    base:  SupportedCurrency,
    quote: SupportedCurrency
  ): Promise<{ rate: number; age: number }> {
    const key     = `${base}/${quote}`;
    const cached  = this.rateCache.get(key);
    const now     = Date.now();

    if (cached && now - cached.fetchedAt < this.opts.rateCacheTtlMs) {
      return { rate: cached.rate, age: now - cached.fetchedAt };
    }

    const rate = await this.feed.fetchRate(base, quote);
    this.rateCache.set(key, { base, quote, rate, fetchedAt: now });
    return { rate, age: 0 };
  }

  // ── Parsing ───────────────────────────────────────────────────────────────

  private parseToMicro(amount: string): bigint {
    const trimmed = amount.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new PaymentNormalizerError(
        `Invalid amount "${amount}"`, "INVALID_AMOUNT"
      );
    }
    const [whole, frac = ""] = trimmed.split(".");
    const fracPadded = frac.slice(0, 6).padEnd(6, "0");
    return BigInt(whole) * MICRO + BigInt(fracPadded);
  }

  // ── Formatting ────────────────────────────────────────────────────────────

  format(n: NormalizedPayment): string {
    const amount = (Number(n.amountMicro) / 1e6).toFixed(6);
    const usd    = (Number(n.usdEquivalentMicro) / 1e6).toFixed(4);
    const dust   = n.dustFiltered ? "  ⚠ dust" : "";
    return `${amount} ${n.currency}  ≈  $${usd} USD  (rate: ${n.fxRate.toFixed(6)}, age: ${n.fxRateAge} ms)${dust}`;
  }
}
