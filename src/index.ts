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
import { modelCommand } from './commands/model.js';
import { permissionCommand } from './commands/permission.js';
import { agentCommand } from './commands/agent.js';
import { completer } from './completion.js';
import { sendChat } from './chat.js';
import { loadConfig } from './config.js';
import type { ConfirmTool } from './tools.js';

const cliCommands = new Set(['register', 'explore', 'exchange', 'model', 'permission', 'run', 'config', 'agent', 'help', 'quit']);

function help() {
  console.log(`Commands:
	  $register
	  $explore <query> [--limit n] [--scope agent|capability] [--output-mode mime] [--json]
  $exchange balance [--json]
  $exchange owned [--json]
  $exchange listings [--agent <agent_id>] [--json]
  $exchange buy <agent_id> --tokens <n> --max-price <credits_per_k>
  $exchange sell <agent_id> --tokens <n> --price <credits_per_k>
  $model [model]
  $permission part|full
  $run <agent_id> [--json]
  $agent profile|publish|update-listing|serve|connect|card|market-card|call ...
  $config show
  $config reset key
  $quit

In interactive CLI, text without $ is sent to the current $model.`);
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
    case 'model':
      return modelCommand(command);
    case 'permission':
      return permissionCommand(command);
    case 'agent':
      return agentCommand(command);
    case 'help':
      return help();
    case 'quit':
      process.exit(0);
    default:
      throw new Error(`Unknown command: ${command.name}. Run $help.`);
  }
}

async function runLine(line: string, confirmTool?: ConfirmTool) {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (!trimmed.startsWith('$')) {
    await sendChat(trimmed, confirmTool);
    return;
  }

  const command = parseCommand(line);
  if (!command) return;
  await dispatch(command);
}

async function main() {
  const direct = process.argv.slice(2).map((arg) => {
    if (!/[\s"'\\]/.test(arg)) return arg;
    return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }).join(' ');
  if (direct) {
    const firstToken = direct.trim().split(/\s+/)[0].replace(/^\$/, '');
    if (direct.trim().startsWith('$') || cliCommands.has(firstToken)) {
      await runLine(direct.startsWith('$') ? direct : `$${direct}`);
    } else {
      await sendChat(direct);
    }
    return;
  }

  console.log('MOMOAI CLI. Run $help for commands.');
  console.log(`Current model: ${loadConfig().model}. Run $model to view or change models.`);
  const rl = createInterface({ input, output, prompt: `momoai (${loadConfig().model})> `, completer });
  const confirmTool: ConfirmTool = async (toolName, args) => {
    if (!input.isTTY) return false;
    const answer = await rl.question(`Tool request: ${toolName} ${JSON.stringify(args)}\nRun this tool? y/N `);
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  };
  rl.prompt();

  for await (const line of rl) {
    try {
      await runLine(line, confirmTool);
    } catch (error) {
      if (error instanceof CliError && error.status) {
        console.error(`Error ${error.status}: ${error.message}`);
      } else {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    rl.setPrompt(`momoai (${loadConfig().model})> `);
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
