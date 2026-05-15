# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Standard benchmark suite with 11 scenarios across 5 categories
- `@xpaymind/core` — benchmark runner and x402 harness
- `@xpaymind/evaluator` — scoring engine with grade and percentile
- `@xpaymind/sdk` — TypeScript SDK for API integration
- `@xpaymind/cli` — CLI with `init`, `benchmark run`, `leaderboard`, `results`
- REST API server (`apps/api`) with Express 5
- WebSocket support for live benchmark updates
- GitHub Actions CI, release, and security workflows

## [0.1.0] — 2026-04-14

### Added
- Initial repository setup
- Monorepo configuration (pnpm, Turborepo, TypeScript)
- MIT license

## [0.2.0] — 2026-05-13

### Added
- `computeTrend()` in `@xpaymind/evaluator` for historical score trend analysis
- `BenchmarkStream` SSE client in `@xpaymind/sdk` for real-time progress updates
- Server-Sent Events endpoint (`/v1/benchmarks/stream/:jobId`) in API server
- Adversarial benchmark suite (`adv-001` through `adv-004`)
- Cost efficiency metrics module
- Leaderboard builder with best-score deduplication
- Unit tests for `X402Validator`, `BenchmarkRunner`, and standard suite

### Fixed
- Exponential backoff retry logic added to `BenchmarkRunner`
- CI workflow now triggers only on pull requests and manual dispatch

## [0.2.1] — 2026-05-15

### Fixed

- **core**: `ConcurrentNonceGuard` — agents running multiple x402 payments in
  parallel could generate duplicate nonces, causing one or more payments to be
  rejected by the recipient server. The new guard uses a per-`recipient:network`
  in-flight set with crypto-random nonce generation and retry logic.

### Added

- **evaluator**: `GlobalPercentileTracker` — computes the percentile rank of a
  new benchmark score relative to all historical scores in O(log n) time via
  binary-search insertion into a sorted array. Seeding from an existing dataset
  is supported for server-startup hydration.

### Internal

- Both modules are exported from their respective package barrels.
- No public API changes; no breaking changes.
