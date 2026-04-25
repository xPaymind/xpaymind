import { Router } from 'express';
export const reportsRouter = Router();
reportsRouter.get('/:reportId', async (req, res) => { res.status(404).json({ error: 'Report not found' }); });
