import { describe, it, expect } from 'vitest';
import { X402Validator } from '../../x402/validator.js';

const validHeaders = {
  'x-payment-version': '1.0',
  'x-payment-network': 'base',
  'x-payment-recipient': '0x1234567890123456789012345678901234567890',
  'x-payment-amount': '1000000',
  'x-payment-token': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'x-payment-expires': String(Math.floor((Date.now() + 60_000) / 1000)),
  'x-payment-nonce': 'a'.repeat(40),
};

describe('X402Validator.validateHeaders', () => {
  it('accepts valid headers', () => {
    const result = X402Validator.validateHeaders(validHeaders);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing required fields', () => {
    const { 'x-payment-amount': _, ...missing } = validHeaders;
    const result = X402Validator.validateHeaders(missing as any);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects expired requirements', () => {
    const expired = { ...validHeaders, 'x-payment-expires': String(Math.floor((Date.now() - 60_000) / 1000)) };
    const result = X402Validator.validateHeaders(expired);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('expired'))).toBe(true);
  });

  it('warns on short expiry window', () => {
    const shortExpiry = { ...validHeaders, 'x-payment-expires': String(Math.floor((Date.now() + 10_000) / 1000)) };
    const result = X402Validator.validateHeaders(shortExpiry);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('30 seconds'))).toBe(true);
  });

  it('rejects invalid recipient address', () => {
    const result = X402Validator.validateHeaders({ ...validHeaders, 'x-payment-recipient': '0xinvalid' });
    expect(result.valid).toBe(false);
  });
});

describe('X402Validator.validateProof', () => {
  const validProof = { txHash: '0x' + 'a'.repeat(64), network: 'base' as const, submittedAt: Date.now() };

  it('accepts valid proof', () => {
    expect(X402Validator.validateProof(validProof).valid).toBe(true);
  });

  it('warns when unconfirmed', () => {
    expect(X402Validator.validateProof(validProof).warnings.some((w) => w.includes('confirmed'))).toBe(true);
  });

  it('rejects malformed tx hash', () => {
    expect(X402Validator.validateProof({ ...validProof, txHash: '0xinvalid' }).valid).toBe(false);
  });
});
