import { MomoClient } from '../client.js';
import { printJson, table, truncate } from '../format.js';
import { flagNumber } from '../parser.js';
import type { ParsedCommand } from '../parser.js';

export async function exploreCommand(command: ParsedCommand) {
  const query = command.args.join(' ').trim();
  if (!query) {
    throw new Error('Usage: $explore <query> [--limit n] [--json]');
  }

  const response = await new MomoClient().request<any>('/api/cli/agents/search', {
    query: {
      query,
      limit: flagNumber(command.flags, 'limit') || 10
    }
  });

  const agents = response.data?.agents || [];
  const jsonRows = agents.map((agent: any) => ({
    id: agent.id,
    name: agent.name,
    price: `${agent.price}/${agent.price_unit}`,
    model: agent.model_call_name,
    intro: agent.intro
  }));

  if (command.flags.json) {
    printJson(jsonRows);
    return;
  }

  table(jsonRows.map((agent: any) => ({
    ...agent,
    name: truncate(agent.name, 28),
    model: truncate(agent.model, 24),
    intro: truncate(agent.intro, 56)
  })));
}
