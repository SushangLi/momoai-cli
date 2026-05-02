#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { CliError } from './client.js';
import { parseCommand } from './parser.js';
import type { ParsedCommand } from './parser.js';
import { registerCommand } from './commands/register.js';
import { exploreCommand } from './commands/explore.js';
import { exchangeCommand } from './commands/exchange.js';
import { runCommand } from './commands/run.js';
import { configCommand } from './commands/config.js';
import { completer } from './completion.js';

function help() {
  console.log(`Commands:
  $register
  $explore <query> [--limit n] [--json]
  $exchange balance [--json]
  $exchange owned [--json]
  $exchange listings [--agent <agent_id>] [--json]
  $exchange buy <agent_id> --tokens <n> --max-price <credits_per_k>
  $exchange sell <agent_id> --tokens <n> --price <credits_per_k>
  $run <agent_id> [--json]
  $config show
  $config reset key
  $quit`);
}

async function dispatch(command: ParsedCommand) {
  switch (command.name) {
    case 'register':
      return registerCommand(command);
    case 'explore':
      return exploreCommand(command);
    case 'exchange':
      return exchangeCommand(command);
    case 'run':
      return runCommand(command);
    case 'config':
      return configCommand(command);
    case 'help':
      return help();
    case 'quit':
      process.exit(0);
    default:
      throw new Error(`Unknown command: ${command.name}. Run $help.`);
  }
}

async function runLine(line: string) {
  const command = parseCommand(line);
  if (!command) return;
  await dispatch(command);
}

async function main() {
  const direct = process.argv.slice(2).join(' ');
  if (direct) {
    await runLine(direct.startsWith('$') ? direct : `$${direct}`);
    return;
  }

  console.log('MOMOAI CLI. Run $help for commands.');
  const rl = createInterface({ input, output, prompt: 'momoai> ', completer });
  rl.prompt();

  for await (const line of rl) {
    try {
      await runLine(line);
    } catch (error) {
      if (error instanceof CliError && error.status) {
        console.error(`Error ${error.status}: ${error.message}`);
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    rl.prompt();
  }
}

main().catch((error) => {
  if (error instanceof CliError && error.status) {
    console.error(`Error ${error.status}: ${error.message}`);
  } else {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
});
