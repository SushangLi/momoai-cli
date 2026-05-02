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

  if (command.flags.json) {
    printJson(info);
    return;
  }

  const key = loadConfig().account?.momoKey || '<momo_key>';
  const model = String(agentId);
  console.log(`baseurl: ${info.baseurl}`);
  console.log('');
  console.log('openai-compatible curl:');
  console.log(`curl -X POST "${info.baseurl}" \\`);
  console.log(`  -H "Authorization: Bearer ${key}" \\`);
  console.log('  -H "Content-Type: application/json" \\');
  console.log(`  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello"}]}'`);
}
