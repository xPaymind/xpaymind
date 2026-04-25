import { Router } from 'express';
import { z } from 'zod';
import { BenchmarkScorer } from '@xpaymind/evaluator';
export const benchmarksRouter = Router();
const SubmitResultSchema = z.object({ id: z.string().uuid(), agentId: z.string(), agentVersion: z.string(), suiteId: z.string(), startedAt: z.string().datetime(), completedAt: z.string().datetime(), scenarioResults: z.array(z.unknown()), overallScore: z.number().min(0).max(100), categoryScores: z.record(z.number()), summary: z.string() });
benchmarksRouter.post('/results', async (req, res) => {
  const parsed = SubmitResultSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.format() }); return; }
  const scorer = new BenchmarkScorer();
  const report = scorer.evaluate(parsed.data as any);
  res.status(201).json({ reportId: crypto.randomUUID(), report });
});
benchmarksRouter.get('/suites', async (_req, res) => { res.json({ suites: [{ id: 'standard', name: 'Standard Suite', scenarioCount: 11 }, { id: 'compliance-only', name: 'Compliance Only', scenarioCount: 3 }] }); });
