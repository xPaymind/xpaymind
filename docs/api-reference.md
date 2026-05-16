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

---

## GET /v1/agents/:id/stats

Returns aggregated scoring statistics for an agent across all submitted runs.
Useful for powering trend charts and per-agent dashboards.

### Authentication

Required — `Authorization: Bearer <api-key>`

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Agent ID (e.g. `my-agent-v1`) |

### Response

```json
{
  "agentId": "my-agent-v1",
  "totalRuns": 3,
  "bestScore": 81.6,
  "latestScore": 81.6,
  "averageScore": 77.4,
  "grade": "B",
  "scoreHistory": [
    { "submittedAt": "2026-05-01T10:00:00Z", "score": 72.4 },
    { "submittedAt": "2026-05-08T14:30:00Z", "score": 78.1 },
    { "submittedAt": "2026-05-16T09:00:00Z", "score": 81.6 }
  ],
  "categoryAverages": {
    "protocol-compliance": 84.3,
    "payment-negotiation": 75.0,
    "latency": 71.0,
    "cost-efficiency": 78.3,
    "error-recovery": 70.7
  }
}
```

### Error Responses

| Status | Description |
|--------|-------------|
| 401 | Missing or invalid API key |
| 404 | Agent not found or no results submitted |
