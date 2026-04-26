import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';

export const initCommand = new Command('init')
  .description('Initialize xPaymind in your project')
  .option('--api-key <key>', 'xPaymind API key')
  .action(async (opts) => {
    console.log(chalk.bold('\n  xPaymind — x402 Benchmark Platform\n'));
    const spinner = ora('Initializing xPaymind config...').start();
    const config = { apiKey: opts.apiKey ?? '', agentId: path.basename(process.cwd()), baseUrl: 'https://api.xpaymind.ai/v1', defaultSuite: 'standard', iterations: 10 };
    await fs.writeFile(path.join(process.cwd(), 'xpaymind.config.json'), JSON.stringify(config, null, 2));
    spinner.succeed('Created xpaymind.config.json');
    console.log(chalk.green('\n  Next steps:\n') + '  1. Add your API key to xpaymind.config.json\n  2. Implement BenchmarkAgent in your agent\n  3. Run: xpaymind benchmark run --agent ./agent.js\n');
  });
