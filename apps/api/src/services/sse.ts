import type { Response } from 'express';

interface SSEClient { res: Response; jobId: string; connectedAt: Date; }

const clients = new Map<string, Set<SSEClient>>();

export function registerSSEClient(jobId: string, res: Response): () => void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const client: SSEClient = { res, jobId, connectedAt: new Date() };
  if (!clients.has(jobId)) clients.set(jobId, new Set());
  clients.get(jobId)!.add(client);

  const heartbeat = setInterval(() => { res.write(': heartbeat\n\n'); }, 15_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.get(jobId)?.delete(client);
    if (clients.get(jobId)?.size === 0) clients.delete(jobId);
  };

  res.on('close', cleanup);
  return cleanup;
}

export function emitSSE(jobId: string, event: string, data: unknown): void {
  const jobClients = clients.get(jobId);
  if (!jobClients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of jobClients) client.res.write(payload);
}

export function closeSSE(jobId: string): void {
  const jobClients = clients.get(jobId);
  if (!jobClients) return;
  for (const client of jobClients) client.res.end();
  clients.delete(jobId);
}
