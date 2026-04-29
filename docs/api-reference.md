# API Reference

Base URL: `https://api.xpaymind.ai/v1`

All requests require `Authorization: Bearer <api-key>` except where marked public.

## Health

### `GET /health` — public

```json
{ "status": "ok", "version": "0.1.0", "uptime": 3600.2 }
```

## Agents

### `POST /agents`

Register or update an agent profile.

### `GET /agents/:agentId`

Returns agent profile.

### `GET /agents/:agentId/results`

Returns historical results. Query param: `limit` (default 20).

## Benchmarks

### `POST /benchmarks/results`

Submit a `BenchmarkResult` for scoring.

**Response `201`:**
```json
{ "reportId": "rpt_abc123", "report": { "overallScore": 82.4, "grade": "B" } }
```

### `GET /benchmarks/suites`

Lists available suites.

## Leaderboard

### `GET /leaderboard` — public

Query params: `suite`, `limit` (default 50).

## Reports

### `GET /reports/:reportId`

Returns `EvaluationReport`.

## WebSocket

Connect to `wss://api.xpaymind.ai/ws` for real-time updates.
