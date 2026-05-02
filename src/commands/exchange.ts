import { MomoClient } from '../client.js';
import { printJson, table, truncate } from '../format.js';
import { flagNumber } from '../parser.js';
import type { ParsedCommand } from '../parser.js';

export async function exchangeCommand(command: ParsedCommand) {
  const [action, agentIdArg] = command.args;
  const client = new MomoClient();

  if (!action) {
    throw new Error('Usage: $exchange balance|owned|listings|buy|sell ...');
  }

  if (action === 'balance') {
    const response = await client.request<any>('/api/cli/exchange/balance');
    if (command.flags.json) return printJson(response.data);
    console.log(`credits: ${response.data.credits.total} (purchase ${response.data.credits.purchase}, gift ${response.data.credits.gift})`);
    table(response.data.tokens.map((token: any) => ({
      agent: token.agent_id,
      balance: token.token_balance,
      onsale: token.token_onsale,
      price: token.resell_price ?? ''
    })));
    return;
  }

  if (action === 'owned') {
    const response = await client.request<any>('/api/cli/exchange/owned');
    if (command.flags.json) return printJson(response.data.agents);
    table(response.data.agents.map((agent: any) => ({
      agent: agent.agent_id,
      name: truncate(agent.agent_name, 30),
      balance: agent.token_balance,
      onsale: agent.token_onsale,
      price: agent.resell_price ?? ''
    })));
    return;
  }

  if (action === 'listings') {
    const response = await client.request<any>('/api/cli/exchange/listings', {
      query: { agent_id: flagNumber(command.flags, 'agent') }
    });
    if (command.flags.json) return printJson(response.data.listings);
    table(response.data.listings.map((listing: any) => ({
      agent: listing.agent_id,
      seller: truncate(listing.seller_username, 20),
      tokens: listing.token_onsale,
      price: listing.resell_price,
      author: truncate(listing.model_author, 24)
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
    const response = await client.request<any>('/api/cli/exchange/buy', {
      body: { agent_id: agentId, tokens, max_price: maxPrice }
    });
    return printJson(response.data);
  }

  if (action === 'sell') {
    const agentId = Number(agentIdArg);
    const tokens = flagNumber(command.flags, 'tokens');
    const price = flagNumber(command.flags, 'price');
    if (!Number.isInteger(agentId) || !tokens || !price) {
      throw new Error('Usage: $exchange sell <agent_id> --tokens <n> --price <credits_per_k>');
    }
    const response = await client.request<any>('/api/cli/exchange/sell', {
      body: { agent_id: agentId, tokens, price }
    });
    return printJson(response.data);
  }

  throw new Error(`Unknown exchange action: ${action}`);
}
