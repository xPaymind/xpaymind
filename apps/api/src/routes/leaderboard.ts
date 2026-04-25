import { Router } from 'express';
export const leaderboardRouter = Router();
leaderboardRouter.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query['limit'] ?? 50), 200);
  const mockLeaderboard = [
    { rank: 1, agentId: 'claude-3-5-sonnet-x402', agentName: 'Claude 3.5 Sonnet (x402-native)', overallScore: 94.2, grade: 'S', latencyMs: 284, complianceScore: 99, submittedAt: '2026-05-10T12:00:00Z' },
    { rank: 2, agentId: 'gpt-4o-tuned', agentName: 'GPT-4o (xpaymind-tuned)', overallScore: 91.8, grade: 'A', latencyMs: 312, complianceScore: 97, submittedAt: '2026-05-09T15:30:00Z' },
    { rank: 3, agentId: 'gemini-2-flash', agentName: 'Gemini 2.0 Flash', overallScore: 88.4, grade: 'A', latencyMs: 201, complianceScore: 94, submittedAt: '2026-05-11T09:00:00Z' },
    { rank: 4, agentId: 'llama-3-3-70b', agentName: 'Llama 3.3 70B', overallScore: 82.1, grade: 'B', latencyMs: 445, complianceScore: 89, submittedAt: '2026-05-08T18:00:00Z' },
    { rank: 5, agentId: 'mistral-large-2', agentName: 'Mistral Large 2', overallScore: 79.6, grade: 'B', latencyMs: 389, complianceScore: 85, submittedAt: '2026-05-07T11:00:00Z' },
  ];
  res.json(mockLeaderboard.slice(0, limit));
});
