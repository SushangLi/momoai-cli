import { printJson, table, truncate } from '../format.js';
import { flagNumber } from '../parser.js';
import type { ParsedCommand } from '../parser.js';
import { exploreAgents } from '../services.js';

export async function exploreCommand(command: ParsedCommand) {
  const query = command.args.join(' ').trim();
  if (!query) {
    throw new Error('Usage: $explore <query> [--limit n] [--json]');
  }

  const jsonRows = await exploreAgents(query, flagNumber(command.flags, 'limit') || 10);

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
