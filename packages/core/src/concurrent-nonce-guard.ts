/**
 * ConcurrentNonceGuard
 *
 * Prevents nonce collisions when an agent submits multiple x402 payments
 * concurrently. Each call to `acquire` returns a unique nonce that is
 * released on settlement (commit or rollback).
 *
 * Usage:
 *   const guard = new ConcurrentNonceGuard();
 *   const nonce = await guard.acquire(recipient, network);
 *   try {
 *     await submitPayment(nonce);
 *     guard.commit(nonce);
 *   } catch {
 *     guard.rollback(nonce);
 *   }
 */

import { randomBytes } from 'node:crypto';

type NonceKey = `${string}:${string}`; // `${recipient}:${network}`

export class ConcurrentNonceGuard {
  /** Nonces currently in-flight, keyed by recipient:network */
  private readonly inFlight = new Map<NonceKey, Set<string>>();

  /**
   * Acquire a globally unique nonce for the given recipient + network pair.
   * Retries up to `maxRetries` times if the generated nonce collides with an
   * in-flight nonce (extremely unlikely but guarded against).
   */
  acquire(recipient: string, network: string, maxRetries = 5): string {
    const key: NonceKey = `${recipient}:${network}`;
    const inFlightSet = this.inFlight.get(key) ?? new Set<string>();

    for (let i = 0; i < maxRetries; i++) {
      const nonce = randomBytes(16).toString('hex');
      if (!inFlightSet.has(nonce)) {
        inFlightSet.add(nonce);
        this.inFlight.set(key, inFlightSet);
        return nonce;
      }
    }

    throw new Error(
      `ConcurrentNonceGuard: failed to acquire unique nonce after ${maxRetries} retries`,
    );
  }

  /** Mark a nonce as successfully used — remove from in-flight set. */
  commit(recipient: string, network: string, nonce: string): void {
    this.inFlight.get(`${recipient}:${network}`)?.delete(nonce);
  }

  /** Release a nonce that was not used (e.g. payment failed). */
  rollback(recipient: string, network: string, nonce: string): void {
    this.inFlight.get(`${recipient}:${network}`)?.delete(nonce);
  }

  /** Return the number of nonces currently in-flight (for monitoring). */
  inFlightCount(): number {
    let total = 0;
    for (const set of this.inFlight.values()) total += set.size;
    return total;
  }
}
