import { Command } from 'commander';
import chalk from 'chalk';
import { XPaymindClient } from '@xpaymind/sdk';
export const leaderboardCommand = new Command('leaderboard')
  .description('View the xPaymind leaderboard')
  .option('--suite <id>', 'Suite to show', 'standard')
  .option('--limit <n>', 'Number of entries', '20')
  .action(async (opts) => {
    const client = new XPaymindClient({ apiKey: process.env['XPAYMIND_API_KEY'] ?? '', agentId: 'cli' });
    const entries = await client.getLeaderboard({ suite: opts.suite, limit: parseInt(opts.limit, 10) });
    console.log(chalk.bold(`\n  xPaymind Leaderboard — ${opts.suite}\n`));
    for (const e of entries) {
      console.log(`  ${String(e.rank).padStart(4)}  ${e.agentName.substring(0, 32).padEnd(34)} ${String(e.overallScore.toFixed(1)).padStart(5)}  ${e.grade.padEnd(5)}  ${e.latencyMs}ms`);
    }
    console.log();
  });
