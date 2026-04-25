import { Router } from 'express';
import { z } from 'zod';
export const agentsRouter = Router();
const RegisterAgentSchema = z.object({ agentId: z.string().min(1).max(100), name: z.string().min(1).max(200), version: z.string().regex(/^\d+\.\d+\.\d+$/), description: z.string().max(1000).optional(), capabilities: z.array(z.string()).optional(), modelId: z.string().optional(), provider: z.string().optional() });
agentsRouter.post('/', async (req, res) => {
  const parsed = RegisterAgentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.format() }); return; }
  res.status(201).json({ agentId: parsed.data.agentId });
});
agentsRouter.get('/:agentId', async (req, res) => { res.json({ agentId: req.params.agentId, name: 'Unknown', version: '0.0.0' }); });
agentsRouter.get('/:agentId/results', async (req, res) => { res.json([]); });
