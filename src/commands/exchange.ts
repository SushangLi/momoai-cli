import { printJson, table, truncate } from '../format.js';
import { flagNumber } from '../parser.js';
import type { ParsedCommand } from '../parser.js';
import { exchangeBalance, exchangeBuy, exchangeListings, exchangeOwned, exchangeSell } from '../services.js';

export async function exchangeCommand(command: ParsedCommand) {
  const [action, agentIdArg] = command.args;

  if (!action) {
    throw new Error('Usage: $exchange balance|owned|listings|buy|sell ...');
  }

  if (action === 'balance') {
    const balance = await exchangeBalance();
    if (command.flags.json) {
      return printJson(balance);
    }
    console.log(`credits: ${balance.credits} (purchase ${balance.purchase}, gift ${balance.gift})`);
    console.log('bought agents and token balances:');
    table(balance.tokens);
    return;
  }

  if (action === 'owned') {
    const jsonRows = await exchangeOwned();
    if (command.flags.json) return printJson(jsonRows);
    table(jsonRows.map((agent: any) => ({
      ...agent,
      name: truncate(agent.name, 30)
    })));
    return;
  }

  if (action === 'listings') {
    const jsonRows = await exchangeListings(flagNumber(command.flags, 'agent'));
    if (command.flags.json) return printJson(jsonRows);
    table(jsonRows.map((listing: any) => ({
      ...listing,
      seller: truncate(listing.seller, 20),
      author: truncate(listing.author, 24)
    })));
    return;
  }

  if (action === 'buy') {
    const agentId = Number(agentIdArg);
    const tokens = flagNumber(command.flags, 'tokens');
    const maxPrice = flagNumber(command.flags, 'max-price') ?? flagNumber(command.flags, 'max_price');
    if (!Number.isInteger(agentId) || !tokens || !maxPrice) {
      throw new Error('Usage: $exchange buy <agent_id> --tokens <n> --max-price <credits_per_k>');
    }
    return printJson(await exchangeBuy(agentId, tokens, maxPrice));
  }

  if (action === 'sell') {
    const agentId = Number(agentIdArg);
    const tokens = flagNumber(command.flags, 'tokens');
    const price = flagNumber(command.flags, 'price');
    if (!Number.isInteger(agentId) || !tokens || !price) {
      throw new Error('Usage: $exchange sell <agent_id> --tokens <n> --price <credits_per_k>');
    }
    return printJson(await exchangeSell(agentId, tokens, price));
  }

  throw new Error(`Unknown exchange action: ${action}`);
}
