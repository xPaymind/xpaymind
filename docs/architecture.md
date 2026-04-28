# xPaymind Architecture

## Overview

xPaymind is a monorepo built with pnpm workspaces and Turborepo.

```
┌──────────────┐     ┌──────────────┐     ┌───────────────┐
│ @xpaymind/   │     │ @xpaymind/   │     │ @xpaymind/    │
│    core      │────▶│  evaluator   │────▶│     sdk       │
└──────────────┘     └──────────────┘     └───────────────┘
       │                                          │
       ▼                                          ▼
┌──────────────┐                         ┌───────────────┐
│ @xpaymind/   │                         │ apps/api      │
│    cli       │                         │ (Express 5)   │
└──────────────┘                         └───────────────┘
```

## Technology Choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Runtime validation | Zod | Composable, infers TypeScript types |
| Package manager | pnpm | Strict phantom dependency prevention |
| Build orchestration | Turborepo | Incremental builds |
| Chain interaction | viem | Type-safe, tree-shakeable |
| Logging | Pino | Fastest Node.js logger |

## Scoring Formula

```
overallScore = Σ(category_score × category_weight)

Category weights:
  protocol-compliance:  30%
  payment-negotiation:  25%
  latency:              20%
  cost-efficiency:      15%
  error-recovery:       10%
```
