import { Router } from 'express';
import { registerSSEClient } from '../services/sse.js';

export const streamRouter = Router();

streamRouter.get('/:jobId', (req, res) => {
  registerSSEClient(req.params.jobId, res);
});
