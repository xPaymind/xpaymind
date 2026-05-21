/**
 * x402 Integration Client
 *
 * Drop-in fetch wrapper that transparently handles 402 Payment Required
 * responses according to the x402 HTTP payment protocol.
 *
 * Usage:
 *
 *   import { x402Fetch } from "@workspace/core/x402-integration-client";
 *
 *   const res = await x402Fetch("https://api.example.com/data", {
 *     wallet: myWallet,
 *     paymentLimits: { maxSingleTxUsdCents: 500 },
 *   });
 */

import type {
  PaymentRequired,
  PaymentProof,
  PaymentSchemePayload,
  ExactPayment,
  StreamingPayment,
} from "./x402-types";

// ---------------------------------------------------------------------------
// Wallet interface — implement this for your signing backend
// ---------------------------------------------------------------------------

export interface X402Wallet {
  /** Publicly identifiable address / pubkey */
  address: string;
  /**
   * Sign an arbitrary UTF-8 message.
   * Returns a base64-encoded signature string.
   */
  sign(message: string): Promise<string>;
  /**
   * Return the current balance in the smallest currency unit.
   * Used for pre-spend guard checks.
   */
  balance(currency: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export type X402FetchOptions = RequestInit & {
  wallet: X402Wallet;
  paymentLimits?: {
    maxSingleTxUsdCents?: number;   // default 1 000 ($10.00)
    dailyCapUsdCents?:    number;   // default 50 000 ($500.00)
  };
  retryPolicy?: {
    maxAttempts?:       number;   // default 3
    backoffMs?:         number;   // default 400
    backoffMultiplier?: number;   // default 2
  };
  /** Invoked before each payment so the caller can approve or reject */
  onPaymentRequired?: (req: PaymentRequired) => Promise<boolean>;
  /** Invoked after a successful payment with the proof and response */
  onPaymentSuccess?: (proof: PaymentProof, response: Response) => void;
  /** Invoked when a payment is rejected or fails */
  onPaymentError?: (error: Error) => void;
};

// ---------------------------------------------------------------------------
// Nonce / idempotency
// ---------------------------------------------------------------------------

function generateNonce(): string {
  const ts   = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}`;
}

// ---------------------------------------------------------------------------
// Parse Payment-Required header
// ---------------------------------------------------------------------------

function parsePaymentRequired(response: Response): PaymentRequired | null {
  const raw = response.headers.get("Payment-Required")
            ?? response.headers.get("X-Payment-Required");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as PaymentRequired;
  } catch {
    // Fallback: try reading `amount` and `currency` as simple header fields
    const amount   = Number(response.headers.get("X-Payment-Amount") ?? "0");
    const currency = response.headers.get("X-Payment-Currency") ?? "USD";
    const challenge = response.headers.get("X-Payment-Challenge") ?? generateNonce();
    return {
      accepts:  [{ scheme: "exact", details: { amount, currency } }],
      resource: response.url,
      amount,
      currency,
      challenge,
    };
  }
}

// ---------------------------------------------------------------------------
// Build payment payload
// ---------------------------------------------------------------------------

function buildExactPayload(
  paymentRequired: PaymentRequired,
  wallet:          X402Wallet
): ExactPayment {
  return {
    scheme:   "exact",
    amount:   paymentRequired.amount ?? 0,
    currency: paymentRequired.currency ?? "USD",
    to:       paymentRequired.resource,
    nonce:    generateNonce(),
  };
}

function buildStreamingPayload(
  paymentRequired: PaymentRequired,
  _wallet:         X402Wallet
): StreamingPayment {
  const details = paymentRequired.accepts.find(a => a.scheme === "streaming")?.details ?? {};
  return {
    scheme:          "streaming",
    ratePerSecond:   Number(details["ratePerSecond"] ?? 1),
    currency:        paymentRequired.currency ?? "USD",
    to:              paymentRequired.resource,
    sessionId:       generateNonce(),
    maxDurationSecs: Number(details["maxDurationSecs"] ?? 300),
  };
}

function selectPayload(
  paymentRequired: PaymentRequired,
  wallet:          X402Wallet
): PaymentSchemePayload {
  const schemes = paymentRequired.accepts.map(a => a.scheme);
  if (schemes.includes("exact"))     return buildExactPayload(paymentRequired, wallet);
  if (schemes.includes("streaming")) return buildStreamingPayload(paymentRequired, wallet);
  return buildExactPayload(paymentRequired, wallet); // graceful fallback
}

// ---------------------------------------------------------------------------
// Sign payment
// ---------------------------------------------------------------------------

async function signPayment(
  payload:   PaymentSchemePayload,
  challenge: string,
  wallet:    X402Wallet
): Promise<PaymentProof> {
  const message   = JSON.stringify({ payload, challenge });
  const signature = await wallet.sign(message);

  return {
    scheme:        payload.scheme,
    payload,
    signature,
    signerAddress: wallet.address,
    challenge,
    signedAt:      new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Guard: refuse overpayment
// ---------------------------------------------------------------------------

function guardAmount(
  paymentRequired: PaymentRequired,
  limits: Required<NonNullable<X402FetchOptions["paymentLimits"]>>
): void {
  const amountCents = paymentRequired.amount ?? 0;
  if (amountCents > limits.maxSingleTxUsdCents) {
    throw new Error(
      `x402: payment amount ${amountCents}¢ exceeds single-tx limit ${limits.maxSingleTxUsdCents}¢`
    );
  }
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

export async function x402Fetch(
  input:   RequestInfo | URL,
  options: X402FetchOptions
): Promise<Response> {
  const {
    wallet,
    paymentLimits  = {},
    retryPolicy    = {},
    onPaymentRequired,
    onPaymentSuccess,
    onPaymentError,
    ...fetchInit
  } = options;

  const limits = {
    maxSingleTxUsdCents: paymentLimits.maxSingleTxUsdCents ?? 1_000,
    dailyCapUsdCents:    paymentLimits.dailyCapUsdCents    ?? 50_000,
  };

  const retry = {
    maxAttempts:       retryPolicy.maxAttempts       ?? 3,
    backoffMs:         retryPolicy.backoffMs         ?? 400,
    backoffMultiplier: retryPolicy.backoffMultiplier ?? 2,
  };

  let attempt = 0;
  let delay   = retry.backoffMs;

  while (attempt < retry.maxAttempts) {
    attempt++;

    const response = await fetch(input, fetchInit);

    // Happy path — no payment needed
    if (response.status !== 402) return response;

    // Parse the 402 details
    const paymentRequired = parsePaymentRequired(response);
    if (!paymentRequired) {
      throw new Error("x402: received 402 but no Payment-Required header found");
    }

    // Amount guard
    try {
      guardAmount(paymentRequired, limits);
    } catch (err) {
      onPaymentError?.(err as Error);
      throw err;
    }

    // Caller approval hook
    if (onPaymentRequired) {
      const approved = await onPaymentRequired(paymentRequired);
      if (!approved) {
        throw new Error("x402: payment rejected by onPaymentRequired hook");
      }
    }

    // Build, sign, attach proof
    let proof: PaymentProof;
    try {
      const payload = selectPayload(paymentRequired, wallet);
      proof         = await signPayment(payload, paymentRequired.challenge, wallet);
    } catch (err) {
      onPaymentError?.(err as Error);
      throw err;
    }

    const retryInit: RequestInit = {
      ...fetchInit,
      headers: {
        ...(fetchInit.headers as Record<string, string> | undefined),
        "X-Payment": JSON.stringify(proof),
      },
    };

    const retryResponse = await fetch(input, retryInit);

    if (retryResponse.status !== 402) {
      onPaymentSuccess?.(proof, retryResponse);
      return retryResponse;
    }

    // Still 402 after payment — back off and retry
    if (attempt < retry.maxAttempts) {
      await new Promise(r => setTimeout(r, delay));
      delay = Math.round(delay * retry.backoffMultiplier);
    }
  }

  throw new Error(`x402: payment failed after ${retry.maxAttempts} attempt(s)`);
}

// ---------------------------------------------------------------------------
// Convenience: JSON fetch with x402 handling
// ---------------------------------------------------------------------------

export async function x402FetchJson<T = unknown>(
  url:     string,
  options: X402FetchOptions
): Promise<T> {
  const res = await x402Fetch(url, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string> | undefined),
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`x402FetchJson: HTTP ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}
