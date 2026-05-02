import { loadConfig } from '../config.js';
import { MomoClient } from '../client.js';
import { printJson } from '../format.js';
import type { ParsedCommand } from '../parser.js';

export async function runCommand(command: ParsedCommand) {
  const agentId = Number(command.args[0]);
  if (!Number.isInteger(agentId) || agentId <= 0) {
    throw new Error('Usage: $run <agent_id> [--json]');
  }

  const response = await new MomoClient().request<any>(`/api/cli/agents/${agentId}/run-info`);
  const info = response.data;
  const key = loadConfig().account?.momoKey || '<momo_key>';
  const model = String(agentId);
  const curl = [
    `curl -X POST "${info.baseurl}" \\`,
    `  -H "Authorization: Bearer ${key}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`
  ].join('\n');

  if (command.flags.json) {
    printJson({
      baseurl: info.baseurl,
      curl
    });
    return;
  }

  console.log(`baseurl: ${info.baseurl}`);
  console.log('');
  console.log('openai-compatible curl:');
  console.log(curl);
}
