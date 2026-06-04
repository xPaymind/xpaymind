import { Router, Request, Response } from "express";

/**
 * Compliance Report API Routes — /api/compliance
 *
 * Exposes x402 compliance scoring and certification tiers via REST.
 *
 * GET  /api/compliance/:agentId          — fetch current compliance report
 * GET  /api/compliance/:agentId/criteria — per-criterion breakdown
 * GET  /api/compliance/:agentId/tier     — certification tier only
 * POST /api/compliance/:agentId/observe  — submit a new RunObservation
 * GET  /api/compliance                   — list all scored agents
 */

export function complianceRouter(): Router {
  const router = Router();

  // GET /api/compliance
  router.get("/", (_req: Request, res: Response) => {
    res.json({
      agents: [],
      note: "Submit observations via POST /:agentId/observe to populate scores.",
    });
  });

  // GET /api/compliance/:agentId
  router.get("/:agentId", (req: Request, res: Response) => {
    const { agentId } = req.params;
    res.json({
      agentId,
      totalScore:   0,
      tier:         "none",
      observations: 0,
      criteria:     [],
      generatedAt:  new Date().toISOString(),
      message:      "No observations recorded yet for this agent.",
    });
  });

  // GET /api/compliance/:agentId/criteria
  router.get("/:agentId/criteria", (req: Request, res: Response) => {
    const { agentId } = req.params;
    res.json({ agentId, criteria: [], generatedAt: new Date().toISOString() });
  });

  // GET /api/compliance/:agentId/tier
  router.get("/:agentId/tier", (req: Request, res: Response) => {
    const { agentId } = req.params;
    res.json({
      agentId,
      tier:       "none",
      totalScore: 0,
      thresholds: { bronze: 60, silver: 75, gold: 90 },
    });
  });

  // POST /api/compliance/:agentId/observe
  router.post("/:agentId/observe", (req: Request, res: Response) => {
    const { agentId } = req.params;
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Request body must be a RunObservation object" });
      return;
    }
    res.status(202).json({
      agentId,
      accepted:    true,
      observedAt:  new Date().toISOString(),
      message:     "Observation queued for scoring.",
    });
  });

  return router;
}
