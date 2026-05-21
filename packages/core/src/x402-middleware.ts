/**
 * x402 Payment Middleware (Express)
 *
 * Protects any Express route behind x402 payment verification.
 * When an unauthenticated request arrives the middleware responds with
 * 402 Payment Required and a structured `Payment-Required` header.
 * On retry the `X-Payment` header is validated; if valid, the request
 * proceeds to the next handler.
 *
 * Usage:
 *
 *   import { x402Gate } from "@workspace/core/x402-middleware";
 *
 *   app.get(
 *     "/api/premium-data",
 *     x402Gate({ amount: 50, currency: "USD", description: "Premium dataset" }),
 *     myHandler
 *   );
 */

import type { Request, Response, NextFunction } from "express";
import type { PaymentRequired, PaymentProof } from "./x402-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type X402GateOptions = {
  /** Price in USD cents (e.g. 50 = $0.50) */
  amount:       number;
  currency?:    string;
  description?: string;
  /** Accepted payment schemes; defaults to ["exact"] */
  schemes?:     string[];
  /**
   * Optional custom verifier.
   * Return true to accept, false to reject.
   * Defaults to signature-length heuristic (replace with real on-chain check).
   */
  verifyProof?: (proof: PaymentProof, req: Request) => Promise<boolean>;
  /**
   * Optional nonce store to prevent double-spend.
   * Implement with Redis or any key-value store in production.
   */
  nonceStore?: {
    has(nonce: string): Promise<boolean>;
    set(nonce: string, ttlMs: number): Promise<void>;
  };
  /** How long (ms) a payment proof is valid; defaults to 5 minutes */
  proofTtlMs?: number;
};

// ---------------------------------------------------------------------------
// In-memory nonce store (development only — not suitable for production)
// ---------------------------------------------------------------------------

class InMemoryNonceStore {
  private store = new Map<string, number>();

  async has(nonce: string): Promise<boolean> {
    const exp = this.store.get(nonce);
    if (exp === undefined) return false;
    if (Date.now() > exp) { this.store.delete(nonce); return false; }
    return true;
  }

  async set(nonce: string, ttlMs: number): Promise<void> {
    this.store.set(nonce, Date.now() + ttlMs);
    // Lazy cleanup: prune expired entries every 100 inserts
    if (this.store.size % 100 === 0) {
      const now = Date.now();
      for (const [k, v] of this.store) { if (now > v) this.store.delete(k); }
    }
  }
}

const defaultNonceStore = new InMemoryNonceStore();

// ---------------------------------------------------------------------------
// Challenge generation
// ---------------------------------------------------------------------------

function generateChallenge(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// ---------------------------------------------------------------------------
// Default proof verifier
// ---------------------------------------------------------------------------

async function defaultVerifyProof(proof: PaymentProof): Promise<boolean> {
  // Structural sanity checks
  if (!proof.scheme)                       return false;
  if (!proof.signerAddress)                return false;
  if (!proof.challenge)                    return false;
  if (!proof.signedAt)                     return false;
  if (!proof.signature || proof.signature.length < 16) return false;

  // Payload presence
  if (!proof.payload)                      return false;

  return true;
}

// ---------------------------------------------------------------------------
// Parse X-Payment header
// ---------------------------------------------------------------------------

function parseXPayment(req: Request): PaymentProof | null {
  const raw = req.headers["x-payment"] as string | undefined;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PaymentProof;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build 402 response body
// ---------------------------------------------------------------------------

function buildPaymentRequired(
  opts:      X402GateOptions,
  challenge: string
): PaymentRequired {
  return {
    accepts: (opts.schemes ?? ["exact"]).map(scheme => ({
      scheme,
      details: { amount: opts.amount, currency: opts.currency ?? "USD" },
    })),
    resource:    "",           // filled at response time from req.path
    amount:      opts.amount,
    currency:    opts.currency ?? "USD",
    expiresIn:   `${Math.round((opts.proofTtlMs ?? 300_000) / 1000)}s`,
    challenge,
  };
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export function x402Gate(opts: X402GateOptions) {
  const nonceStore  = opts.nonceStore ?? defaultNonceStore;
  const proofTtlMs  = opts.proofTtlMs ?? 300_000; // 5 min
  const verify      = opts.verifyProof
    ?? (async (p: PaymentProof) => defaultVerifyProof(p));

  return async function x402GateMiddleware(
    req:  Request,
    res:  Response,
    next: NextFunction
  ): Promise<void> {
    const proof = parseXPayment(req);

    // ── No payment header: issue 402 ────────────────────────────────────────
    if (!proof) {
      const challenge = generateChallenge();
      const pr: PaymentRequired = {
        ...buildPaymentRequired(opts, challenge),
        resource: req.path,
      };

      res.setHeader("Payment-Required", JSON.stringify(pr));
      res.setHeader("Content-Type", "application/json");
      res.status(402).json({
        error:           "Payment Required",
        paymentRequired: pr,
      });
      return;
    }

    // ── Payment header present: verify ──────────────────────────────────────

    // 1. Structural / signature check
    const valid = await verify(proof, req);
    if (!valid) {
      res.status(402).json({ error: "Invalid payment proof" });
      return;
    }

    // 2. Expiry check
    const signedAt = new Date(proof.signedAt).getTime();
    if (isNaN(signedAt) || Date.now() - signedAt > proofTtlMs) {
      res.status(402).json({ error: "Payment proof expired" });
      return;
    }

    // 3. Double-spend check (nonce)
    const nonce = (proof.payload as { nonce?: string }).nonce
               ?? (proof.payload as { sessionId?: string }).sessionId
               ?? "";

    if (nonce) {
      if (await nonceStore.has(nonce)) {
        res.status(402).json({ error: "Payment nonce already used (double-spend)" });
        return;
      }
      await nonceStore.set(nonce, proofTtlMs);
    }

    // 4. Attach proof to request for downstream handlers
    (req as Request & { x402Proof?: PaymentProof }).x402Proof = proof;

    next();
  };
}

// ---------------------------------------------------------------------------
// Typed request augmentation helper
// ---------------------------------------------------------------------------

export type X402Request = Request & { x402Proof: PaymentProof };

export function getProof(req: Request): PaymentProof | undefined {
  return (req as X402Request).x402Proof;
}
