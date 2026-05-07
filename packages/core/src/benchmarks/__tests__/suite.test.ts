import { describe, it, expect } from 'vitest';
import { STANDARD_SUITE } from '../suite.js';

describe('STANDARD_SUITE', () => {
  it('has at least 10 scenarios', () => { expect(STANDARD_SUITE.length).toBeGreaterThanOrEqual(10); });
  it('all scenarios have unique ids', () => { const ids = STANDARD_SUITE.map((s) => s.id); expect(new Set(ids).size).toBe(ids.length); });
  it('all weights are positive', () => { for (const s of STANDARD_SUITE) expect(s.weight).toBeGreaterThan(0); });
  it('all timeoutMs are positive', () => { for (const s of STANDARD_SUITE) expect(s.timeoutMs).toBeGreaterThan(0); });
});
