import { describe, it, expect } from 'vitest';
import { MarkdownExporter } from '../markdown-exporter.js';
import type { EvaluationReport } from '../markdown-exporter.js';

const SAMPLE_REPORT: EvaluationReport = {
  benchmarkId: 'bm-test-001',
  agentId: 'test-agent-v1',
  agentName: 'Test Agent',
  suiteId: 'standard',
  evaluatedAt: '2026-05-17T10:00:00Z',
  overallScore: 81.6,
  grade: 'B',
  percentile: 74,
  dimensions: [
    {
      category: 'protocol-compliance',
      rawScore: 88,
      weightedScore: 26.4,
      weight: 0.3,
      scenarioCount: 4,
      passCount: 4,
      avgLatencyMs: 420,
    },
    {
      category: 'payment-negotiation',
      rawScore: 80,
      weightedScore: 20,
      weight: 0.25,
      scenarioCount: 3,
      passCount: 2,
      avgLatencyMs: 610,
    },
    {
      category: 'latency',
      rawScore: 76,
      weightedScore: 15.2,
      weight: 0.2,
      scenarioCount: 2,
      passCount: 2,
      avgLatencyMs: 380,
    },
  ],
  strengths: [
    'Full protocol-compliance on Base network',
    'Consistent nonce management across concurrent requests',
  ],
  weaknesses: ['Payment negotiation success rate below 80%'],
  recommendations: [
    'Implement pre-signed transaction batching to reduce latency',
    'Add retry logic for failed negotiation rounds',
  ],
};

describe('MarkdownExporter', () => {
  const exporter = new MarkdownExporter();

  it('includes agent name in the heading', () => {
    const md = exporter.export(SAMPLE_REPORT);
    expect(md).toContain('# xPaymind Benchmark Report — Test Agent');
  });

  it('includes overall score and grade', () => {
    const md = exporter.export(SAMPLE_REPORT);
    expect(md).toContain('81.6 / 100');
    expect(md).toContain('Grade B');
  });

  it('includes percentile', () => {
    const md = exporter.export(SAMPLE_REPORT);
    expect(md).toContain('74th');
  });

  it('renders a category row for each dimension', () => {
    const md = exporter.export(SAMPLE_REPORT);
    expect(md).toContain('Protocol Compliance');
    expect(md).toContain('Payment Negotiation');
    expect(md).toContain('Latency');
  });

  it('includes strengths and weaknesses', () => {
    const md = exporter.export(SAMPLE_REPORT);
    expect(md).toContain('Full protocol-compliance on Base network');
    expect(md).toContain('Payment negotiation success rate below 80%');
  });

  it('omits recommendations when includeRecommendations is false', () => {
    const md = exporter.export(SAMPLE_REPORT, { includeRecommendations: false });
    expect(md).not.toContain('## Recommendations');
    expect(md).not.toContain('pre-signed transaction batching');
  });

  it('includes recommendations by default', () => {
    const md = exporter.export(SAMPLE_REPORT);
    expect(md).toContain('## Recommendations');
    expect(md).toContain('pre-signed transaction batching');
  });

  it('falls back to agentId when agentName is absent', () => {
    const report = { ...SAMPLE_REPORT, agentName: undefined };
    const md = exporter.export(report);
    expect(md).toContain('test-agent-v1');
  });

  it('handles null percentile gracefully', () => {
    const report = { ...SAMPLE_REPORT, percentile: null };
    const md = exporter.export(report);
    expect(md).toContain('N/A');
  });

  it('shows N/A latency for zero avgLatencyMs', () => {
    const report = {
      ...SAMPLE_REPORT,
      dimensions: [{ ...SAMPLE_REPORT.dimensions[0]!, avgLatencyMs: 0 }],
    };
    const md = exporter.export(report);
    expect(md).toContain('—');
  });
});
