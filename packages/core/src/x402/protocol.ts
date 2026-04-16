import type { X402Context, PaymentProof, PaymentNegotiation } from './types.js';
import { X402HeaderSchema } from './types.js';

export interface X402ProtocolHandler {
  parsePaymentRequired(headers: Record<string, string>): X402Context['paymentRequired'];
  negotiate(ctx: X402Context): Promise<PaymentNegotiation | null>;
  pay(ctx: X402Context, negotiation: PaymentNegotiation): Promise<PaymentProof>;
  verify(ctx: X402Context, proof: PaymentProof): Promise<boolean>;
}

export class X402Protocol {
  constructor(private readonly handler: X402ProtocolHandler) {}

  async handle(
    responseHeaders: Record<string, string>,
    originalRequest: X402Context['originalRequest'],
  ): Promise<PaymentProof | null> {
    const paymentRequired = this.handler.parsePaymentRequired(responseHeaders);
    const ctx: X402Context = {
      originalRequest,
      paymentRequired,
      receivedAt: Date.now(),
    };

    const negotiation = await this.handler.negotiate(ctx);
    if (!negotiation) return null;

    const proof = await this.handler.pay(ctx, negotiation);
    const verified = await this.handler.verify(ctx, proof);

    if (!verified) {
      throw new Error(`Payment proof verification failed for tx ${proof.txHash}`);
    }

    return proof;
  }

  static parseHeaders(headers: Record<string, string>): X402Context['paymentRequired'] {
    const result = X402HeaderSchema.safeParse(headers);
    if (!result.success) {
      throw new Error(`Invalid x402 headers: ${result.error.message}`);
    }
    return result.data;
  }
}
