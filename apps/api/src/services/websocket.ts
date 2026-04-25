import type { WebSocketServer, WebSocket } from 'ws';
import type { Logger } from 'pino';
interface WSClient { ws: WebSocket; agentId?: string; subscribedSuites: Set<string>; }
const clients = new Map<string, WSClient>();
export function setupWebSocket(wss: WebSocketServer, logger: Logger): void {
  wss.on('connection', (ws) => {
    const clientId = crypto.randomUUID();
    clients.set(clientId, { ws, subscribedSuites: new Set() });
    logger.info({ clientId }, 'WebSocket client connected');
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string; payload?: unknown };
        const client = clients.get(clientId);
        if (!client) return;
        if (msg.type === 'subscribe') { const { suite } = msg.payload as { suite: string }; client.subscribedSuites.add(suite); client.ws.send(JSON.stringify({ type: 'subscribed', suite })); }
        if (msg.type === 'unsubscribe') { const { suite } = msg.payload as { suite: string }; client.subscribedSuites.delete(suite); }
      } catch { ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' })); }
    });
    ws.on('close', () => { clients.delete(clientId); logger.info({ clientId }, 'WebSocket client disconnected'); });
    ws.send(JSON.stringify({ type: 'connected', clientId }));
  });
}
export function broadcastBenchmarkUpdate(suiteId: string, data: unknown): void {
  const payload = JSON.stringify({ type: 'benchmark-update', suiteId, data });
  for (const client of clients.values()) { if (client.subscribedSuites.has(suiteId) && client.ws.readyState === 1) client.ws.send(payload); }
}
