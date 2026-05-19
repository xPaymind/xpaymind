/**
 * BankingIntegrationAdapter
 *
 * Abstract base class for integrating AI agents into banking systems via x402.
 *
 * The adapter sits between an AI agent and a banking API, handling:
 *  - x402 payment negotiation for gated banking endpoints
 *  - Request signing (OAuth 2.0, mTLS, Open Banking FAPI)
 *  - Response normalisation across different core banking formats
 *  - Audit logging required by financial regulators
 *
 * Concrete implementations extend this class for specific banking providers
 * (e.g. StripeAdapter, PlaidAdapter, TrueLayerAdapter, CoreBankingAdapter).
 *
 * Integration flow:
 *
 *   AI Agent
 *     └─▶ BankingIntegrationAdapter.request(endpoint, payload)
 *           ├─ authenticate()          — obtain / refresh access token
 *           ├─ call banking API        — may return 402
 *           ├─ handleX402()            — pay via agent wallet
 *           ├─ retry with proof        — re-submit with payment headers
 *           └─ normalise(response)     — return standardised BankingResponse
 */

export interface BankingRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface BankingResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  paymentProof?: { txHash: string; network: string; amountPaid: bigint };
  latencyMs: number;
}

export interface BankingAdapterConfig {
  name: string;
  baseUrl: string;
  timeoutMs?: number;
  maxPaymentAmount?: bigint;
  auditLogging?: boolean;
}

export abstract class BankingIntegrationAdapter {
  protected readonly config: Required<BankingAdapterConfig>;

  constructor(config: BankingAdapterConfig) {
    this.config = {
      timeoutMs: 10_000,
      maxPaymentAmount: 50_000_000n,
      auditLogging: true,
      ...config,
    };
  }

  async request<T = unknown>(opts: BankingRequestOptions): Promise<BankingResponse<T>> {
    const start = Date.now();
    await this.authenticate();

    const headers = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders(),
      ...opts.headers,
    };

    const timeout = opts.timeoutMs ?? this.config.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      let response = await fetch(opts.url, {
        method: opts.method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      if (response.status === 402) {
        const proof = await this.handleX402(response.headers);
        if (!proof) {
          return { ok: false, status: 402, data: null as T, latencyMs: Date.now() - start };
        }

        response = await fetch(opts.url, {
          method: opts.method,
          headers: {
            ...headers,
            'x-payment-proof-tx': proof.txHash,
            'x-payment-proof-network': proof.network,
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });

        const data = (await response.json()) as T;
        const latencyMs = Date.now() - start;
        if (this.config.auditLogging) this.auditLog({ method: opts.method, url: opts.url, status: response.status, latencyMs, paid: true });
        return { ok: response.ok, status: response.status, data, paymentProof: proof, latencyMs };
      }

      const data = (await response.json()) as T;
      const latencyMs = Date.now() - start;
      if (this.config.auditLogging) this.auditLog({ method: opts.method, url: opts.url, status: response.status, latencyMs, paid: false });
      return { ok: response.ok, status: response.status, data, latencyMs };
    } finally {
      clearTimeout(timer);
    }
  }

  protected abstract authenticate(): Promise<void>;
  protected abstract defaultHeaders(): Record<string, string>;
  protected abstract handleX402(
    headers: Headers,
  ): Promise<{ txHash: string; network: string; amountPaid: bigint } | null>;

  protected auditLog(entry: { method: string; url: string; status: number; latencyMs: number; paid: boolean }): void {
    process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), adapter: this.config.name, ...entry }) + '\n');
  }
}
