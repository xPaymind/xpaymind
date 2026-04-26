#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { benchmarkCommand } from './commands/benchmark.js';
import { leaderboardCommand } from './commands/leaderboard.js';
import { resultsCommand } from './commands/results.js';

const program = new Command();
program.name('xpaymind').description('xPaymind CLI — benchmark your AI agent for x402 compliance').version('0.1.0');
program.addCommand(initCommand);
program.addCommand(benchmarkCommand);
program.addCommand(leaderboardCommand);
program.addCommand(resultsCommand);
program.parse();
