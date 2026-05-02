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
  if (command.flags.json) {
    printJson(agents);
    return;
  }

  table(agents.map((agent: any) => ({
    id: agent.id,
    name: truncate(agent.name, 28),
    price: `${agent.price}/${agent.price_unit}`,
    model: truncate(agent.model_call_name, 24),
    intro: truncate(agent.intro, 56)
  })));
}
