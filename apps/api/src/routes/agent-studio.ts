/**
 * POST /api/agent-studio/submit
 * POST /api/agent-studio/certify/:submissionId
 *
 * Thin HTTP layer over the Agent Studio pipeline.
 * Full auth and rate-limiting handled by upstream middleware.
 */

import { Router } from "express";
import { defineAgent }    from "../../packages-ref/agent-define-block";
import { configureAgent } from "../../packages-ref/agent-configure-block";
import { submitAgent }    from "../../packages-ref/agent-submit-block";
import { certifyAgent }   from "../../packages-ref/agent-certify-block";
import type { Request, Response } from "express";

const router = Router();

/**
 * POST /api/agent-studio/define
 * Body: { name, type, description?, tags? }
 */
router.post("/define", (req: Request, res: Response) => {
  const { name, type, description, tags } = req.body ?? {};

  if (!name || !type) {
    res.status(400).json({ error: "name and type are required" });
    return;
  }

  try {
    const agent = defineAgent({ name, type, description, tags });
    res.status(201).json({ agent });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    res.status(422).json({ error: msg });
  }
});

/**
 * POST /api/agent-studio/configure
 * Body: { agentId, modelProvider, modelId, contextWindowTokens?, tools?, paymentLimits?, retryPolicy? }
 */
router.post("/configure", (req: Request, res: Response) => {
  const { agentId, modelProvider, modelId, ...rest } = req.body ?? {};

  if (!agentId || !modelProvider || !modelId) {
    res.status(400).json({ error: "agentId, modelProvider, and modelId are required" });
    return;
  }

  try {
    const cfg = configureAgent(agentId, { modelProvider, modelId, ...rest });
    res.status(201).json({ configuration: cfg });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    res.status(422).json({ error: msg });
  }
});

/**
 * POST /api/agent-studio/submit
 * Body: AgentConfiguration
 */
router.post("/submit", (req: Request, res: Response) => {
  const cfg = req.body;

  if (!cfg?.agentId || !cfg?.configHash) {
    res.status(400).json({ error: "a sealed AgentConfiguration is required" });
    return;
  }

  try {
    const { receipt, preflight } = submitAgent(cfg);
    res.status(202).json({ receipt, preflight });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "submission failed";
    res.status(422).json({ error: msg });
  }
});

/**
 * POST /api/agent-studio/certify
 * Body: { receipt: SubmissionReceipt, scenarioResults? }
 */
router.post("/certify", (req: Request, res: Response) => {
  const { receipt, scenarioResults } = req.body ?? {};

  if (!receipt?.submissionId) {
    res.status(400).json({ error: "a valid SubmissionReceipt is required" });
    return;
  }

  try {
    const cert = certifyAgent(receipt, { scenarioResults });
    res.status(200).json({ certification: cert });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "certification failed";
    res.status(422).json({ error: msg });
  }
});

export default router;
