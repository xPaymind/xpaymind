import { z } from 'zod';

export const X402HeaderSchema = z.object({
  'x-payment-version': z.string().regex(/^\d+\.\d+$/),
  'x-payment-network': z.enum(['base', 'ethereum', 'polygon', 'arbitrum', 'optimism']),
  'x-payment-recipient': z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  'x-payment-amount': z.string().regex(/^\d+$/),
  'x-payment-token': z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  'x-payment-expires': z.string().regex(/^\d+$/),
  'x-payment-nonce': z.string().min(16),
  'x-payment-description': z.string().optional(),
  'x-payment-max-slippage': z.string().regex(/^\d+$/).optional(),
});

export type X402Header = z.infer<typeof X402HeaderSchema>;

export const PaymentProofSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  blockNumber: z.bigint().optional(),
  network: z.enum(['base', 'ethereum', 'polygon', 'arbitrum', 'optimism']),
  submittedAt: z.number().int().positive(),
  confirmedAt: z.number().int().positive().optional(),
});

export type PaymentProof = z.infer<typeof PaymentProofSchema>;

export const PaymentNegotiationSchema = z.object({
  preferredNetworks: z.array(z.enum(['base', 'ethereum', 'polygon', 'arbitrum', 'optimism'])),
  maxAmount: z.bigint(),
  willNegotiate: z.boolean(),
  maxConfirmationWaitMs: z.number().int().positive(),
});

export type PaymentNegotiation = z.infer<typeof PaymentNegotiationSchema>;

export interface X402Context {
  originalRequest: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  paymentRequired: X402Header;
  receivedAt: number;
}
