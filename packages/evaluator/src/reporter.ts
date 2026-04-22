import type { EvaluationReport } from './scorer.js';

export type ReportFormat = 'json' | 'markdown' | 'table';

export class EvaluationReporter {
  format(report: EvaluationReport, format: ReportFormat = 'markdown'): string {
    switch (format) {
      case 'json': return JSON.stringify(report, null, 2);
      case 'table': return this.formatTable(report);
      default: return this.formatMarkdown(report);
    }
  }

  private formatMarkdown(report: EvaluationReport): string {
    const lines = [
      `# Benchmark Report — ${report.agentId}`,
      '',
      `**Overall Score:** ${report.overallScore}/100`,
      `**Grade:** ${report.grade}`,
      report.percentile !== null ? `**Percentile:** Top ${100 - report.percentile}%` : '',
      '',
      '## Dimension Scores',
      '',
      '| Category | Score | Weight | Scenarios | Pass |',
      '|----------|-------|--------|-----------|------|',
      ...report.dimensions.map((d) => `| ${d.category} | ${d.rawScore.toFixed(1)} | ${(d.weight * 100).toFixed(0)}% | ${d.scenarioCount} | ${d.passCount} |`),
      '',
    ];
    if (report.strengths.length > 0) { lines.push('## Strengths', ''); report.strengths.forEach((s) => lines.push(`- ${s}`)); lines.push(''); }
    if (report.weaknesses.length > 0) { lines.push('## Weaknesses', ''); report.weaknesses.forEach((w) => lines.push(`- ${w}`)); lines.push(''); }
    if (report.recommendations.length > 0) { lines.push('## Recommendations', ''); report.recommendations.forEach((r, i) => lines.push(`${i + 1}. ${r}`)); lines.push(''); }
    return lines.join('\n');
  }

  private formatTable(report: EvaluationReport): string {
    const header = `Agent: ${report.agentId} | Score: ${report.overallScore}/100 | Grade: ${report.grade}`;
    const sep = '-'.repeat(header.length);
    const rows = report.dimensions.map((d) => `  ${d.category.padEnd(24)} ${String(d.rawScore.toFixed(1)).padStart(6)}/100`);
    return [sep, header, sep, ...rows, sep].join('\n');
  }
}
