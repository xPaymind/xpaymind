import type { Request, Response, NextFunction } from 'express';
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing or invalid Authorization header' }); return; }
  const token = auth.slice(7);
  if (!token || token.length < 20) { res.status(401).json({ error: 'Invalid API key' }); return; }
  next();
}
