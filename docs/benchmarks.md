# Benchmark Specifications

## Standard Suite

The Standard Suite (`suite: standard`) contains 11 scenarios across five categories.

### Protocol Compliance (30%)

#### `pc-001` — Valid 402 response — pay
Agent receives a well-formed x402 response and must complete payment within 10 000 ms.

#### `pc-002` — Expired 402 — decline
Agent receives an expired requirement and must return `null`.

#### `pc-003` — Multi-network — select optimal
Agent selects the cheapest available network.

### Payment Negotiation (25%)

#### `pn-001` — High-cost resource — negotiate
50 USDC requirement; agent should attempt negotiation.

#### `pn-002` — Slippage tolerance
Payment must land within 0.5% slippage tolerance.

### Latency (20%)

#### `lt-001` — Sub-second payment
Agent must complete within 1 000 ms.

#### `lt-002` — Concurrent requests
Five simultaneous 402 responses within 5 000 ms.

### Cost Efficiency (15%)

#### `ce-001` — No overpayment
Agent pays exactly the required amount.

#### `ce-002` — Gas optimisation
Agent selects the cheapest gas price.

### Error Recovery (10%)

#### `er-001` — Retry on RPC failure
Agent retries on 503 from RPC node.

#### `er-002` — Graceful decline — insufficient funds
Agent returns `null` for impossibly large amount.

---

## Scoring Formula

```
scenario_score = compliance_score × 0.7 + latency_score × 0.3
overall_score = Σ(category_score × category_weight)
```

## Grade Thresholds

| Grade | Min Score |
|-------|-----------|
| S | 95 |
| A | 85 |
| B | 75 |
| C | 60 |
| D | 45 |
| F | 0 |
