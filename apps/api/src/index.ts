import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { agentsRouter } from './routes/agents.js';
import { benchmarksRouter } from './routes/benchmarks.js';
import { leaderboardRouter } from './routes/leaderboard.js';
import { reportsRouter } from './routes/reports.js';
import { healthRouter } from './routes/health.js';
import { errorHandler } from './middleware/error.js';
import { authMiddleware } from './middleware/auth.js';
import { setupWebSocket } from './services/websocket.js';

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(helmet());
app.use(cors({ origin: process.env['CORS_ORIGIN'] ?? '*' }));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(pinoHttp({ logger }));

app.use('/v1/health', healthRouter);
app.use('/v1/agents', authMiddleware, agentsRouter);
app.use('/v1/benchmarks', authMiddleware, benchmarksRouter);
app.use('/v1/leaderboard', leaderboardRouter);
app.use('/v1/reports', authMiddleware, reportsRouter);
app.use(errorHandler);
setupWebSocket(wss, logger);

const PORT = Number(process.env['PORT'] ?? 4000);
server.listen(PORT, () => { logger.info({ port: PORT }, 'xPaymind API server listening'); });

export { app, server };
