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
  console.log('Purchases are skipped unless you explicitly confirm them.');
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
      console.log('Skipping live discovery, balance, and listings because no MOMOAI key is configured.');
    }

    if (hasMomoKey() && !skipBuy) {
      const shouldPrepareBuy = await askYesNo(
        rl,
        'Do you want to continue to a real token purchase? This spends real credits.',
        false
      );
      if (shouldPrepareBuy) {
        const agentId = await ask(rl, 'Agent id to buy: ');
        const tokens = await ask(rl, 'Token amount [1000]: ', '1000');
        const maxPrice = await ask(rl, 'Maximum unit price in credits per 1,000 tokens: ');
        const confirmation = await ask(rl, 'Type BUY to execute the purchase: ');
        if (agentId && tokens && maxPrice && confirmation === 'BUY') {
          await sendCli(`$exchange buy ${agentId} --tokens ${tokens} --max-price ${maxPrice}`, 60_000);
          await sendCli('$exchange balance --json', 60_000);

          const capabilityId = await ask(
            rl,
            'Optional A2A capability id to call on the bought agent, or press Enter to skip: '
          );
          if (capabilityId) {
            const message = await ask(rl, 'A2A message [Return a short demo result.]: ', 'Return a short demo result.');
            await sendCli(
              `$agent call https://momoai.pro/a2a/agents/${agentId} "${message.replace(/"/g, '\\"')}" --capability ${capabilityId} --json`,
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
