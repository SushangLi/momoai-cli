#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const distEntry = join(repoRoot, 'dist', 'index.js');
const configPath = join(homedir(), '.momoai-cli', 'config.json');
const promptPattern = /momoai \([^)]+\)> /g;

const args = new Set(process.argv.slice(2));
const yes = args.has('--yes') || args.has('-y');
const skipRegister = args.has('--skip-register');
const skipBuy = args.has('--skip-buy');
const buyAgentId = argValue('--buy-agent-id') || argValue('--agent-id');
const buyTokens = argValue('--buy-tokens') || '1000';
const maxPrice = argValue('--max-price');
const capabilityId = argValue('--capability');
const callMessage = argValue('--message') || 'Return a short demo result.';

function argValue(name) {
  const rawArgs = process.argv.slice(2);
  const index = rawArgs.indexOf(name);
  if (index >= 0) return rawArgs[index + 1];
  const prefix = `${name}=`;
  const inline = rawArgs.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : undefined;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runProcess(command, processArgs, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, processArgs, {
      cwd: repoRoot,
      stdio: options.stdio || 'inherit',
      shell: false
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${processArgs.join(' ')} exited with ${code}`));
    });
  });
}

function readLocalConfig() {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function hasMomoKey() {
  return Boolean(process.env.MOMOAI_KEY || readLocalConfig().account?.momoKey);
}

function countPrompts(text) {
  return [...text.matchAll(promptPattern)].length;
}

async function ask(rl, question, fallback = '') {
  if (yes && fallback) return fallback;
  const answer = await rl.question(question);
  return answer.trim() || fallback;
}

async function askYesNo(rl, question, fallback = true) {
  if (yes) return fallback;
  const suffix = fallback ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${question} [${suffix}] `)).trim().toLowerCase();
  if (!answer) return fallback;
  return answer === 'y' || answer === 'yes';
}

async function main() {
  console.log('MOMOAI CLI real-flow demo');
  console.log('This script launches the real CLI, runs live commands, and leaves you in the prompt.');
  console.log('Registration, discovery, balance, listings, purchase, and A2A calls use native CLI commands.');
  console.log('Passing --buy-agent-id and --max-price is explicit authorization for a real token purchase.');
  console.log('');

  if (!existsSync(distEntry)) {
    console.log('dist/index.js was not found. Building first...');
    await runProcess(npmCommand(), ['run', 'build']);
  }

  const rl = createInterface({ input, output });
  let outputBuffer = '';
  let closed = false;
  const cli = spawn(process.execPath, [distEntry], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  cli.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    outputBuffer += text;
    output.write(text);
  });
  cli.stderr.on('data', (chunk) => output.write(chunk.toString()));
  cli.on('exit', (code) => {
    closed = true;
    if (code && code !== 0) {
      console.error(`momoai exited with code ${code}`);
    }
  });

  function waitForPrompt(previousPromptCount, timeoutMs = 120_000) {
    return new Promise((resolvePrompt, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (closed) {
          clearInterval(timer);
          reject(new Error('momoai exited before the next prompt.'));
          return;
        }
        const currentPromptCount = countPrompts(outputBuffer);
        if (currentPromptCount > previousPromptCount) {
          clearInterval(timer);
          resolvePrompt(currentPromptCount);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer);
          reject(new Error('Timed out waiting for the momoai prompt.'));
        }
      }, 100);
    });
  }

  async function sendCli(command, timeoutMs) {
    const previousPromptCount = countPrompts(outputBuffer);
    cli.stdin.write(`${command}\n`);
    await waitForPrompt(previousPromptCount, timeoutMs);
  }

  try {
    await waitForPrompt(0, 15_000);
    await sendCli('$help', 15_000);

    if (!hasMomoKey() && !skipRegister) {
      const shouldRegister = await askYesNo(
        rl,
        'No MOMOAI key was found. Run $register to create a real demo account now?',
        true
      );
      if (shouldRegister) {
        await sendCli('$register', 150_000);
      }
    }

    if (hasMomoKey()) {
      await sendCli('$explore gomoku --scope capability --output-mode application/json --limit 5 --json', 60_000);
      await sendCli('$exchange balance --json', 60_000);
      await sendCli('$exchange listings --json', 60_000);
    } else {
      console.log('Marketplace steps require an account key. Run without --skip-register to create one through $register.');
    }

    if (hasMomoKey() && !skipBuy) {
      const shouldPrepareBuy = await askYesNo(
        rl,
        'Do you want to continue to a real token purchase? Demo accounts use platform gift credits when available.',
        Boolean(buyAgentId && maxPrice)
      );
      if (shouldPrepareBuy) {
        const agentId = buyAgentId || await ask(rl, 'Agent id to buy: ');
        const tokens = buyTokens || await ask(rl, 'Token amount [1000]: ', '1000');
        const unitMaxPrice = maxPrice || await ask(rl, 'Maximum unit price in credits per 1,000 tokens: ');
        const confirmation = buyAgentId && maxPrice ? 'BUY' : await ask(rl, 'Type BUY to execute the purchase: ');
        if (agentId && tokens && unitMaxPrice && confirmation === 'BUY') {
          await sendCli(`$exchange buy ${agentId} --tokens ${tokens} --max-price ${unitMaxPrice}`, 60_000);
          await sendCli('$exchange balance --json', 60_000);

          const selectedCapabilityId = capabilityId || await ask(
            rl,
            'Optional A2A capability id to call on the bought agent, or press Enter to skip: '
          );
          if (selectedCapabilityId) {
            const message = capabilityId ? callMessage : await ask(rl, 'A2A message [Return a short demo result.]: ', callMessage);
            await sendCli(
              `$agent call https://momoai.pro/a2a/agents/${agentId} "${message.replace(/"/g, '\\"')}" --capability ${selectedCapabilityId} --json`,
              120_000
            );
          }
        } else {
          console.log('Purchase skipped.');
        }
      }
    }

    console.log('');
    console.log('Demo handoff complete. You are still in the real momoai CLI.');
    console.log('Try $exchange owned, $agent card --json, or $quit.');
    rl.close();
    input.pipe(cli.stdin);
  } catch (error) {
    rl.close();
    cli.kill();
    throw error;
  }
}

main().catch((error) => {
  console.error(`Demo failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
