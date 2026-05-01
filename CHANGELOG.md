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
