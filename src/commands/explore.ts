import { printJson, table, truncate } from '../format.js';
import { flagNumber, flagString } from '../parser.js';
import type { ParsedCommand } from '../parser.js';
import { exploreAgents } from '../services.js';

export async function exploreCommand(command: ParsedCommand) {
  const query = command.args.join(' ').trim();
  if (!query) {
    throw new Error('Usage: $explore <query> [--limit n] [--scope agent|capability] [--input-mode mime] [--output-mode mime] [--max-fixed-tokens n] [--json]');
  }
  const onlineOnlyFlag = flagString(command.flags, 'online-only') || flagString(command.flags, 'online_only');

  const jsonRows = await exploreAgents(query, flagNumber(command.flags, 'limit') || 10, undefined, {
    scope: flagString(command.flags, 'scope') === 'capability' ? 'capability' : 'agent',
    inputMode: flagString(command.flags, 'input-mode') || flagString(command.flags, 'input_mode'),
    outputMode: flagString(command.flags, 'output-mode') || flagString(command.flags, 'output_mode'),
    maxFixedTokens: flagNumber(command.flags, 'max-fixed-tokens') || flagNumber(command.flags, 'max_fixed_tokens'),
    onlineOnly: onlineOnlyFlag === 'false' ? false : command.flags['online-only'] === true || command.flags.online_only === true ? true : undefined
  });

  if (command.flags.json) {
    printJson(jsonRows);
    return;
  }

  table(jsonRows.map((agent: any) => ({
    ...agent,
    name: truncate(agent.name, 28),
    model: truncate(agent.model, 24),
    intro: truncate(agent.intro, 56),
    capability: agent.matched_capability?.id || ''
  })));
}
