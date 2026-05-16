import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WalletBalanceChecker,
  InsufficientFundsError,
} from '../wallet-balance-checker.js';

const WALLET = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';
const USDC   = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// Minimal mock fetch that returns canned JSON-RPC responses
function buildFetch(overrides: Record<string, string> = {}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? '{}') as { method: string };
    const defaults: Record<string, string> = {
      eth_getBalance:          '0x16345785D8A0000',  // ~0.1 ETH
      eth_call:                '0x' + BigInt(500_000_000).toString(16).padStart(64, '0'), // 500 USDC
      eth_gasPrice:            '0x' + BigInt(1_000_000_000).toString(16), // 1 Gwei
      ...overrides,
    };
    const result = defaults[body.method] ?? '0x0';
    return {
      ok: true,
      json: async () => ({ result }),
    } as Response;
  });
}

describe('WalletBalanceChecker', () => {
  let checker: WalletBalanceChecker;

  beforeEach(() => {
    global.fetch = buildFetch() as unknown as typeof fetch;
    checker = new WalletBalanceChecker('https://rpc.example.com', WALLET);
  });

  it('reports sufficient when USDC balance covers requirement', async () => {
    const result = await checker.check({
      tokenAddress: USDC,
      amount: 100_000_000n, // 100 USDC
      network: 'base',
    });

    expect(result.sufficient).toBe(true);
    expect(result.shortfall).toBe(0n);
    expect(result.balance).toBe(500_000_000n);
  });

  it('reports insufficient when USDC balance is too low', async () => {
    global.fetch = buildFetch({
      eth_call: '0x' + BigInt(10_000_000).toString(16).padStart(64, '0'), // only 10 USDC
    }) as unknown as typeof fetch;
    checker = new WalletBalanceChecker('https://rpc.example.com', WALLET);

    const result = await checker.check({
      tokenAddress: USDC,
      amount: 100_000_000n,
      network: 'base',
    });

    expect(result.sufficient).toBe(false);
    expect(result.shortfall).toBeGreaterThan(0n);
  });

  it('accounts for gas buffer on native token payments', async () => {
    const result = await checker.check({
      tokenAddress: NATIVE,
      amount: 1_000_000_000_000_000n, // 0.001 ETH
      network: 'base',
    });

    // Gas cost = 1 Gwei × 65_000 units × 1.2 buffer = 78_000 Gwei
    const expectedGas = BigInt(Math.ceil(1_000_000_000 * 65_000 * 1.2));
    expect(result.estimatedGasCost).toBe(expectedGas);
  });

  it('uses arbitrum gas units for arbitrum network', async () => {
    const result = await checker.check({
      tokenAddress: USDC,
      amount: 1n,
      network: 'arbitrum',
    });

    // Arbitrum units = 800_000
    const expectedGas = BigInt(Math.ceil(1_000_000_000 * 800_000 * 1.2));
    expect(result.estimatedGasCost).toBe(expectedGas);
  });

  it('throws InsufficientFundsError with correct shortfall', () => {
    const err = new InsufficientFundsError(50_000_000n);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InsufficientFundsError');
    expect(err.shortfall).toBe(50_000_000n);
    expect(err.message).toContain('50000000');
  });

  it('throws when RPC returns an error', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ error: { message: 'connection refused' } }),
    })) as unknown as typeof fetch;
    checker = new WalletBalanceChecker('https://rpc.example.com', WALLET);

    await expect(
      checker.check({ tokenAddress: USDC, amount: 1n, network: 'base' }),
    ).rejects.toThrow('RPC error: connection refused');
  });
});
