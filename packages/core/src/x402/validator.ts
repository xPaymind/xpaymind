import { X402HeaderSchema, PaymentProofSchema } from './types.js';
import type { X402Header, PaymentProof } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class X402Validator {
  static validateHeaders(headers: Record<string, string>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const result = X402HeaderSchema.safeParse(headers);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
      return { valid: false, errors, warnings };
    }

    const parsed = result.data;

    const expiresAt = parseInt(parsed['x-payment-expires'], 10) * 1000;
    const now = Date.now();
    if (expiresAt < now) {
      errors.push('x-payment-expires: payment requirement has already expired');
    } else if (expiresAt - now < 30_000) {
      warnings.push('x-payment-expires: payment expires in less than 30 seconds');
    }

    if (parsed['x-payment-nonce'].length < 32) {
      warnings.push('x-payment-nonce: nonce shorter than 32 chars reduces replay protection');
    }

    if (parsed['x-payment-token'] === '0x0000000000000000000000000000000000000000') {
      warnings.push('x-payment-token: using native token (zero address)');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  static validateProof(proof: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const result = PaymentProofSchema.safeParse(proof);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push(`${issue.path.join('.')}: ${issue.message}`);
      }
      return { valid: false, errors, warnings };
    }

    const parsed = result.data;
    if (!parsed.confirmedAt) {
      warnings.push('confirmedAt: proof has not been confirmed yet');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  static proofSatisfiesRequirement(
    proof: PaymentProof,
    requirement: X402Header,
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (proof.network !== requirement['x-payment-network']) {
      errors.push(
        `Network mismatch: paid on ${proof.network}, required ${requirement['x-payment-network']}`,
      );
    }

    const expiresAt = parseInt(requirement['x-payment-expires'], 10) * 1000;
    if (proof.submittedAt > expiresAt) {
      errors.push('Payment submitted after requirement expired');
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}
