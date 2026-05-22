/**
 * x402 Provider Registry
 *
 * A pluggable registry of payment network providers (Solana, Base, Ethereum, etc.)
 * Each provider knows how to:
 *   - verify a PaymentProof on-chain
 *   - estimate network fees before committing a payment
 *   - broadcast a signed payment transaction
 *
 * Usage:
 *
 *   import { providerRegistry } from "@workspace/core/x402-provider-registry";
 *
 *   // Register a custom provider
 *   providerRegistry.register(myBaseProvider);
 *
 *   // Resolve the best provider for a proof
 *   const provider = providerRegistry.resolve("base");
 *   const result   = await provider.verify(proof);
 */

import type { PaymentProof, PaymentSchemePayload } from "./x402-types";

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export type FeeEstimate = {
  networkId:     string;
  feeCents:      number;      // estimated fee in USD cents
  feeNative:     number;      // fee in the network's native unit
  nativeSymbol:  string;      // e.g. "SOL", "ETH", "USDC"
  estimatedAt:   string;      // ISO 8601
  ttlMs:         number;      // how long this estimate is valid
};

export type BroadcastResult = {
  networkId:   string;
  txHash:      string;
  confirmedAt: string | null; // null if still pending
  status:      "pending" | "confirmed" | "failed";
  explorer:    string;        // URL to block explorer tx page
};

export type VerifyResult = {
  valid:       boolean;
  networkId:   string;
  reason?:     string;        // why it failed, if valid=false
  confirmedAt: string | null;
  txHash?:     string;
};

export interface X402Provider {
  /** Unique network identifier, e.g. "solana", "base", "ethereum" */
  readonly networkId: string;
  /** Human-readable label */
  readonly label:     string;
  /** Whether this provider supports the given payment scheme */
  supports(scheme: string): boolean;
  /** Estimate the network fee for a given payload */
  estimateFee(payload: PaymentSchemePayload): Promise<FeeEstimate>;
  /** Verify a PaymentProof against the network */
  verify(proof: PaymentProof): Promise<VerifyResult>;
  /** Broadcast a signed payment to the network */
  broadcast(payload: PaymentSchemePayload, signedTx: string): Promise<BroadcastResult>;
}

// ---------------------------------------------------------------------------
// Built-in stub providers (replace with real SDK calls in production)
// ---------------------------------------------------------------------------

function explorerUrl(network: string, txHash: string): string {
  const bases: Record<string, string> = {
    solana:   `https://solscan.io/tx/${txHash}`,
    base:     `https://basescan.org/tx/${txHash}`,
    ethereum: `https://etherscan.io/tx/${txHash}`,
    polygon:  `https://polygonscan.com/tx/${txHash}`,
  };
  return bases[network] ?? `https://explorer.unknown/tx/${txHash}`;
}

function mockTxHash(): string {
  return "0x" + Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("");
}

class SolanaProvider implements X402Provider {
  readonly networkId = "solana";
  readonly label     = "Solana";

  supports(scheme: string): boolean {
    return ["exact", "streaming"].includes(scheme);
  }

  async estimateFee(_payload: PaymentSchemePayload): Promise<FeeEstimate> {
    return {
      networkId:    this.networkId,
      feeCents:     0,        // Solana fees are sub-cent
      feeNative:    5000,     // lamports
      nativeSymbol: "SOL",
      estimatedAt:  new Date().toISOString(),
      ttlMs:        30_000,
    };
  }

  async verify(proof: PaymentProof): Promise<VerifyResult> {
    const valid = proof.signature.length >= 16 && !!proof.signerAddress;
    return {
      valid,
      networkId:   this.networkId,
      reason:      valid ? undefined : "invalid signature length",
      confirmedAt: valid ? new Date().toISOString() : null,
      txHash:      valid ? mockTxHash() : undefined,
    };
  }

  async broadcast(_payload: PaymentSchemePayload, signedTx: string): Promise<BroadcastResult> {
    const txHash = mockTxHash();
    return {
      networkId:   this.networkId,
      txHash,
      confirmedAt: new Date().toISOString(),
      status:      "confirmed",
      explorer:    explorerUrl(this.networkId, txHash),
    };
  }
}

class BaseProvider implements X402Provider {
  readonly networkId = "base";
  readonly label     = "Base (Coinbase L2)";

  supports(scheme: string): boolean {
    return ["exact", "subscription"].includes(scheme);
  }

  async estimateFee(_payload: PaymentSchemePayload): Promise<FeeEstimate> {
    return {
      networkId:    this.networkId,
      feeCents:     1,          // ~$0.01
      feeNative:    21_000,     // gas units
      nativeSymbol: "ETH",
      estimatedAt:  new Date().toISOString(),
      ttlMs:        15_000,
    };
  }

  async verify(proof: PaymentProof): Promise<VerifyResult> {
    const valid = proof.signature.startsWith("0x") || proof.signature.length >= 32;
    return {
      valid,
      networkId:   this.networkId,
      reason:      valid ? undefined : "signature must be hex-encoded",
      confirmedAt: valid ? new Date().toISOString() : null,
      txHash:      valid ? mockTxHash() : undefined,
    };
  }

  async broadcast(_payload: PaymentSchemePayload, _signedTx: string): Promise<BroadcastResult> {
    const txHash = mockTxHash();
    return {
      networkId:   this.networkId,
      txHash,
      confirmedAt: new Date().toISOString(),
      status:      "confirmed",
      explorer:    explorerUrl(this.networkId, txHash),
    };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class X402ProviderRegistry {
  private providers = new Map<string, X402Provider>();

  constructor(defaults: X402Provider[] = []) {
    for (const p of defaults) this.providers.set(p.networkId, p);
  }

  register(provider: X402Provider): this {
    this.providers.set(provider.networkId, provider);
    return this;
  }

  unregister(networkId: string): this {
    this.providers.delete(networkId);
    return this;
  }

  resolve(networkId: string): X402Provider {
    const p = this.providers.get(networkId);
    if (!p) throw new Error(`x402: no provider registered for network "${networkId}"`);
    return p;
  }

  /** Return all providers that support a given payment scheme */
  forScheme(scheme: string): X402Provider[] {
    return [...this.providers.values()].filter(p => p.supports(scheme));
  }

  list(): Array<{ networkId: string; label: string; schemes: string[] }> {
    return [...this.providers.values()].map(p => ({
      networkId: p.networkId,
      label:     p.label,
      schemes:   ["exact", "streaming", "subscription"].filter(s => p.supports(s)),
    }));
  }
}

// ---------------------------------------------------------------------------
// Default singleton registry — pre-loaded with Solana and Base
// ---------------------------------------------------------------------------

export const providerRegistry = new X402ProviderRegistry([
  new SolanaProvider(),
  new BaseProvider(),
]);
