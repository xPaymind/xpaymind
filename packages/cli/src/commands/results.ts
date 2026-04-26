import { Command } from 'commander';
import { XPaymindClient } from '@xpaymind/sdk';
import { EvaluationReporter } from '@xpaymind/evaluator';
export const resultsCommand = new Command('results')
  .description('View benchmark results')
  .option('--report <id>', 'Report ID to fetch')
  .option('--format <fmt>', 'Output format', 'markdown')
  .action(async (opts) => {
    const client = new XPaymindClient({ apiKey: process.env['XPAYMIND_API_KEY'] ?? '', agentId: 'cli' });
    if (opts.report) {
      const report = await client.getReport(opts.report);
      console.log(new EvaluationReporter().format(report, opts.format));
    } else {
      console.log(JSON.stringify(await client.getAgentHistory(), null, 2));
    }
  });
