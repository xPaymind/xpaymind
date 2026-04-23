import axios, { type AxiosInstance } from 'axios';
import type { XPaymindConfig, LeaderboardEntry, LeaderboardOptions, AgentRegistrationOptions } from './types.js';
import type { BenchmarkResult } from '@xpaymind/core';
import type { EvaluationReport } from '@xpaymind/evaluator';

const DEFAULT_BASE_URL = 'https://api.xpaymind.ai/v1';

export class XPaymindClient {
  private readonly http: AxiosInstance;
  private readonly agentId: string;

  constructor(config: XPaymindConfig) {
    this.agentId = config.agentId;
    this.http = axios.create({
      baseURL: config.baseUrl ?? DEFAULT_BASE_URL,
      timeout: config.timeoutMs ?? 30_000,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'User-Agent': `@xpaymind/sdk/0.1.0` },
    });
  }

  async registerAgent(options: AgentRegistrationOptions): Promise<{ agentId: string }> {
    const res = await this.http.post('/agents', { agentId: this.agentId, ...options });
    return res.data as { agentId: string };
  }

  async submitResult(result: BenchmarkResult): Promise<{ reportId: string; report: EvaluationReport }> {
    const res = await this.http.post('/benchmarks/results', result);
    return res.data as { reportId: string; report: EvaluationReport };
  }

  async getLeaderboard(options?: LeaderboardOptions): Promise<LeaderboardEntry[]> {
    const res = await this.http.get('/leaderboard', { params: { suite: options?.suite ?? 'standard', limit: options?.limit ?? 50, after: options?.after } });
    return res.data as LeaderboardEntry[];
  }

  async getReport(reportId: string): Promise<EvaluationReport> {
    const res = await this.http.get(`/reports/${reportId}`);
    return res.data as EvaluationReport;
  }

  async getAgentHistory(limit = 20): Promise<BenchmarkResult[]> {
    const res = await this.http.get(`/agents/${this.agentId}/results`, { params: { limit } });
    return res.data as BenchmarkResult[];
  }

  async ping(): Promise<{ status: 'ok'; version: string }> {
    const res = await this.http.get('/health');
    return res.data as { status: 'ok'; version: string };
  }
}
