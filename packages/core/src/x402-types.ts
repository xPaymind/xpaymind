/**
 * x402 Protocol — Core TypeScript Types
 *
 * Canonical type definitions for the x402 HTTP payment protocol used
 * throughout the xPaymind benchmarking platform.
 *
 * Reference: https://x402.org/specification
 */

// ---------------------------------------------------------------------------
// Payment schemes
// ---------------------------------------------------------------------------

/** Exact-amount one-shot payment */
export type ExactPayment = {
  scheme:   "exact";
  /** Amount in the smallest unit of the currency (e.g. cents for USD) */
  amount:   number;
  currency: string;   // ISO 4217
  /** Recipient address (network-dependent encoding) */
  to:       string;
  /** Idempotency key — prevents double-spend on retry */
  nonce:    string;
};

/** Time-based streaming micropayment session */
export type StreamingPayment = {
  scheme:           "streaming";
  /** Amount per time-unit in smallest currency unit */
  ratePerSecond:    number;
  currency:         string;
  to:               string;
  sessionId:        string;
  maxDurationSecs:  number;
};

/** Recurring subscription authorization */
export type SubscriptionPayment = {
  scheme:       "subscription";
  amount:       number;
  currency:     string;
  to:           string;
  intervalDays: number;
  maxCycles:    number;
  subscriptionId: string;
};

export type PaymentSchemePayload =
  | ExactPayment
  | StreamingPayment
  | SubscriptionPayment;

// ---------------------------------------------------------------------------
// x402 HTTP message types
// ---------------------------------------------------------------------------

/**
 * Parsed representation of the `Payment-Required` response header returned
 * by a resource server when it receives an unauthenticated request.
 */
export type PaymentRequired = {
  /** Accepted payment schemes */
  accepts:       Array<{ scheme: string; details: Record<string, unknown> }>;
  /** Human-readable description of what the payment unlocks */
  resource:      string;
  /** Amount in smallest currency unit (convenience field for `exact` scheme) */
  amount?:       number;
  currency?:     string;
  /** ISO 8601 — how long a valid payment token remains accepted */
  expiresIn?:    string;
  /** Opaque challenge value the payment payload must bind to */
  challenge:     string;
};

/**
 * Signed payment proof submitted by the client as the value of the
 * `X-Payment` request header on the retried request.
 */
export type PaymentProof = {
  scheme:        string;
  payload:       PaymentSchemePayload;
  /** Base64-encoded signature over `JSON.stringify(payload)` */
  signature:     string;
  /** Public key / address the signature can be verified against */
  signerAddress: string;
  /** Echo of the challenge from PaymentRequired */
  challenge:     string;
  /** ISO 8601 timestamp of signing */
  signedAt:      string;
};

// ---------------------------------------------------------------------------
// Evaluation-specific types
// ---------------------------------------------------------------------------

/**
 * A single x402 exchange as recorded by the benchmark harness.
 */
export type X402Exchange = {
  exchangeId:   string;
  scenarioId:   string;
  /** Original request the agent sent */
  requestUrl:   string;
  requestMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** 402 response the resource server returned */
  response402:  { status: 402; paymentRequired: PaymentRequired };
  /** Payment proof the agent produced */
  paymentProof: PaymentProof;
  /** Final response after payment */
  finalStatus:  number;
  /** Wall-clock duration of the full round-trip in milliseconds */
  durationMs:   number;
  error?:       string;
};

export type X402ExchangeOutcome = "success" | "double-spend" | "invalid-proof" | "timeout" | "rejected";

export function classifyOutcome(exchange: X402Exchange): X402ExchangeOutcome {
  if (exchange.error?.includes("double-spend"))   return "double-spend";
  if (exchange.error?.includes("invalid-proof"))  return "invalid-proof";
  if (exchange.error?.includes("timeout"))        return "timeout";
  if (exchange.finalStatus === 402)               return "rejected";
  if (exchange.finalStatus >= 200 && exchange.finalStatus < 300) return "success";
  return "rejected";
}
