/**
 * WalletBalanceChecker
 *
 * Performs a pre-flight check before an agent attempts to pay a 402 requirement.
 * Queries the wallet's on-chain token balance and compares it against the
 * required amount plus a configurable gas buffer.
 *
 * This prevents agents from attempting payments they cannot afford, which would
 * waste gas and skew latency scores with avoidable RPC round-trips.
 *
 * Usage:
 *   const checker = new WalletBalanceChecker(rpcUrl, walletAddress);
 *   const result = await checker.check(requirement);
 *   if (!result.sufficient) {
 *     throw new InsufficientFundsError(result.shortfall);
 *   }
 */

export interface BalanceRequirement {
  /** ERC-20 token contract address (or native sentinel '0xEeeee…'). */
  tokenAddress: string;
  /** Amount required in token base units (e.g. USDC 6-decimal). */
  amount: bigint;
  /** Blockchain network identifier (base | ethereum | polygon | arbitrum | optimism). */
  network: string;
}

export interface BalanceCheckResult {
  sufficient: boolean;
  /** Current token balance of the wallet. */
  balance: bigint;
  /** Amount by which the balance falls short; 0n when sufficient. */
  shortfall: bigint;
  /** Estimated gas cost in native token base units. */
  estimatedGasCost: bigint;
}

/** Sentinel address used to represent the chain's native token. */
const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/**
 * Minimal ABI fragment for ERC-20 balanceOf.
 * Avoids importing a full ABI library for this lightweight check.
 */
const BALANCE_OF_SELECTOR = '0x70a08231'; // keccak256("balanceOf(address)")[0..4]

export class WalletBalanceChecker {
  constructor(
    private readonly rpcUrl: string,
    private readonly walletAddress: string,
    /** Gas buffer multiplier applied to estimated gas cost (default 1.2 = 20 % headroom). */
    private readonly gasBufferMultiplier: number = 1.2,
  ) {}

  async check(req: BalanceRequirement): Promise<BalanceCheckResult> {
    const [balance, estimatedGasCost] = await Promise.all([
      this.fetchTokenBalance(req.tokenAddress),
      this.estimateGasCost(req.network),
    ]);

    const bufferedGas = BigInt(Math.ceil(Number(estimatedGasCost) * this.gasBufferMultiplier));
    const totalRequired =
      req.tokenAddress.toLowerCase() === NATIVE_TOKEN.toLowerCase()
        ? req.amount + bufferedGas   // native: amount + gas
        : req.amount;                // ERC-20: gas paid in native, checked separately

    const sufficient = balance >= totalRequired;
    const shortfall = sufficient ? 0n : totalRequired - balance;

    return { sufficient, balance, shortfall, estimatedGasCost: bufferedGas };
  }

  private async fetchTokenBalance(tokenAddress: string): Promise<bigint> {
    if (tokenAddress.toLowerCase() === NATIVE_TOKEN.toLowerCase()) {
      return this.rpcCall<string>('eth_getBalance', [this.walletAddress, 'latest']).then(
        (hex) => BigInt(hex),
      );
    }

    // ERC-20 balanceOf(address) call
    const paddedWallet = this.walletAddress.slice(2).padStart(64, '0');
    const data = BALANCE_OF_SELECTOR + paddedWallet;

    const result = await this.rpcCall<string>('eth_call', [
      { to: tokenAddress, data },
      'latest',
    ]);

    return BigInt(result);
  }

  private async estimateGasCost(network: string): Promise<bigint> {
    // Fetch current gas price via eth_gasPrice
    const gasPriceHex = await this.rpcCall<string>('eth_gasPrice', []);
    const gasPrice = BigInt(gasPriceHex);

    // Approximate gas units for an ERC-20 transfer (conservative upper bound)
    const gasUnits = this.gasUnitsForNetwork(network);

    return gasPrice * gasUnits;
  }

  /** Conservative gas unit estimates per network for a standard ERC-20 transfer. */
  private gasUnitsForNetwork(network: string): bigint {
    const map: Record<string, bigint> = {
      base: 65_000n,
      ethereum: 65_000n,
      polygon: 65_000n,
      arbitrum: 800_000n, // Arbitrum uses higher gas units (different fee model)
      optimism: 65_000n,
    };
    return map[network] ?? 100_000n;
  }

  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });

    if (!res.ok) {
      throw new Error(`RPC request failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    if (json.result === undefined) throw new Error('RPC returned no result');

    return json.result;
  }
}

/** Thrown when a wallet does not have sufficient funds for a payment. */
export class InsufficientFundsError extends Error {
  constructor(public readonly shortfall: bigint) {
    super(`Insufficient funds: wallet is short by ${shortfall} base units`);
    this.name = 'InsufficientFundsError';
  }
}
