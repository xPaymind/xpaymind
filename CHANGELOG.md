# Changelog

All notable changes to the Agent Studio are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.1.0] — 2026-05-21

### Agent Studio — SUBMIT Block

#### Added
- `SubmitOptions.dryRun` — validate the full pre-flight pipeline without
  enqueuing the agent; useful for CI checks before production submission.
- `SubmitOptions.priority` (`"low" | "normal" | "high"`) — controls queue
  position; high-priority agents skip ahead of the normal queue.
- `submitAgentDryRun()` convenience wrapper around `submitAgent({ dryRun: true })`.
- `SubmissionReceipt.queuePosition` — approximate position in the live
  benchmark queue returned with every submission.
- `SubmissionReceipt.schemaVersion` — semver string for forward-compatibility
  with future receipt consumers.
- Pre-flight now includes **tool-coverage check**: verifies that tools required
  by each selected scenario (e.g. `kyc-verifier` for `x402-kyc-gate`) are
  bound in the agent configuration before submission.

#### Changed
- `runPreflightChecks()` signature extended to accept `scenarioIds[]` so
  tool-coverage is scenario-aware.
- `SUBMIT_SCHEMA_VERSION` exported constant (`"1.1.0"`) for consumers that
  need to detect receipt format changes.

#### Fixed
- Queue position was previously unset (`undefined`) in the receipt object;
  it now always carries a numeric value.

---

## [1.0.0] — 2026-05-20

### Agent Studio — initial release

- DEFINE block: `defineAgent()`, `AgentType`, `DEFINE_FIELD_SCHEMAS`
- CONFIGURE block: `configureAgent()`, `validateConfiguration()`
- SUBMIT block: `submitAgent()`, `runPreflightChecks()`
- CERTIFY block: `certifyAgent()`, tier scoring (Bronze → Platinum), `formatCertificationSummary()`
- Barrel export: `packages/core/src/agent-studio/index.ts`
- REST API: `/api/agent-studio/{define,configure,submit,certify}`
