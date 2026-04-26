import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { BenchmarkRunner, getSuite } from '@xpaymind/core';
import { BenchmarkScorer, EvaluationReporter } from '@xpaymind/evaluator';

export const benchmarkCommand = new Command('benchmark').description('Benchmark commands');

benchmarkCommand
  .command('run')
  .description('Run benchmark suite against your agent')
  .requiredOption('--agent <path>', 'Path to your agent module')
  .option('--suite <id>', 'Benchmark suite ID', 'standard')
  .option('--iterations <n>', 'Iterations per scenario', '10')
  .option('--format <fmt>', 'Output format: table|json|markdown', 'table')
  .option('--submit', 'Submit result to leaderboard')
  .action(async (opts) => {
    const spinner = ora(`Loading agent from ${opts.agent}...`).start();
    try {
      const { default: AgentClass } = await import(opts.agent);
      const agent = new AgentClass();
      spinner.succeed(`Loaded agent: ${agent.metadata.name} v${agent.metadata.version}`);
      const scenarios = getSuite(opts.suite);
      const runner = new BenchmarkRunner({ iterations: parseInt(opts.iterations, 10), onProgress: (event) => { if (event.type === 'scenario:start') spinner.text = `Running ${event.scenarioId} (iteration ${event.iteration + 1})`; } });
      spinner.start('Running benchmark suite...');
      const result = await runner.run(agent, scenarios, opts.suite);
      spinner.succeed('Benchmark complete');
      const scorer = new BenchmarkScorer();
      const report = scorer.evaluate(result);
      const reporter = new EvaluationReporter();
      console.log('\n' + reporter.format(report, opts.format));
      console.log(chalk.bold(`\n  Overall Score: ${report.overallScore}/100  Grade: ${report.grade}\n`));
    } catch (err) {
      spinner.fail(`Benchmark failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });
