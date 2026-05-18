<h1 align="center">xPaymind</h1>

<p align="center">
  <strong>The definitive benchmarking platform for AI agents implementing x402 payment protocols</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/CI-passing-brightgreen?style=flat-square" alt="CI">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/TypeScript-5.7-blue?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/x402-protocol-orange?style=flat-square" alt="x402">
</p>


## Official Token

**$XPAYMIND** is live on Solana.

| | |
|---|---|
| **Contract Address** | `H5FX3C3BhNJELMCobkhRRKZCFokmEWfXS6v9NRMRpump` |
| **Network** | Solana |
| **DEX** | [pump.fun](https://pump.fun/coin/H5FX3C3BhNJELMCobkhRRKZCFokmEWfXS6v9NRMRpump) |

> The token is used for governance and incentivising agent developers who submit results to the public leaderboard.


---

## Overview

**xPaymind** is an open-source benchmarking platform designed to evaluate the capability of AI agents to implement, negotiate, and execute [x402](https://x402.org) — the HTTP 402 Payment Required protocol for autonomous machine-to-machine payments.

## Why x402?

The HTTP 402 ("Payment Required") status code has been reserved since 1991 but never standardized — until now. The [x402 protocol](https://x402.org) defines a machine-readable payment handshake that allows AI agents to autonomously pay for resources. xPaymind ensures the ecosystem is ready.

## Quick Start

```bash
npm install -g @xpaymind/cli
xpaymind init
xpaymind benchmark run --suite standard --agent ./my-agent.js
```

## Leaderboard

| Rank | Agent | Score | Grade | Latency |
|------|-------|-------|-------|---------|
| 1 | Claude 3.5 Sonnet (x402-native) | 94.2 | S | 284ms |
| 2 | GPT-4o (xpaymind-tuned) | 91.8 | A | 312ms |
| 3 | Gemini 2.0 Flash | 88.4 | A | 201ms |
| 4 | Llama 3.3 70B | 82.1 | B | 445ms |
| 5 | Mistral Large 2 | 79.6 | B | 389ms |

## Benchmark Categories

| Category | Weight |
|----------|--------|
| Protocol Compliance | 30% |
| Payment Negotiation | 25% |
| Latency | 20% |
| Cost Efficiency | 15% |
| Error Recovery | 10% |

## Documentation

- [Getting Started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [API Reference](docs/api-reference.md)
- [Benchmark Specs](docs/benchmarks.md)

## License

MIT — see [LICENSE](LICENSE).
