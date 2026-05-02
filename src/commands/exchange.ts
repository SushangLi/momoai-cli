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
    const rows = response.data.tokens.map((token: any) => ({
      agent: token.agent_id,
      balance: token.token_balance,
      onsale: token.token_onsale,
      price: token.resell_price ?? ''
    }));
    if (command.flags.json) {
      return printJson({
        credits: response.data.credits.total,
        purchase: response.data.credits.purchase,
        gift: response.data.credits.gift,
        tokens: rows
      });
    }
    console.log(`credits: ${response.data.credits.total} (purchase ${response.data.credits.purchase}, gift ${response.data.credits.gift})`);
    table(rows);
    return;
  }

  if (action === 'owned') {
    const response = await client.request<any>('/api/cli/exchange/owned');
    const jsonRows = response.data.agents.map((agent: any) => ({
      agent: agent.agent_id,
      name: agent.agent_name,
      balance: agent.token_balance,
      onsale: agent.token_onsale,
      price: agent.resell_price ?? ''
    }));
    if (command.flags.json) return printJson(jsonRows);
    table(jsonRows.map((agent: any) => ({
      ...agent,
      name: truncate(agent.name, 30)
    })));
    return;
  }

  if (action === 'listings') {
    const response = await client.request<any>('/api/cli/exchange/listings', {
      query: { agent_id: flagNumber(command.flags, 'agent') }
    });
    const jsonRows = response.data.listings.map((listing: any) => ({
      agent: listing.agent_id,
      seller: listing.seller_username,
      tokens: listing.token_onsale,
      price: listing.resell_price,
      author: listing.model_author
    }));
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
    const response = await client.request<any>('/api/cli/exchange/buy', {
      body: { agent_id: agentId, tokens, max_price: maxPrice }
    });
    return printJson({
      agent: response.data.agent_id,
      tokens_bought: response.data.tokens_bought,
      tokens_remaining: response.data.tokens_remaining,
      credits_used: response.data.credits_used?.total,
      status: response.data.status
    });
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
    return printJson({
      agent: response.data.agent_id,
      onsale: response.data.token_onsale,
      price: response.data.resell_price
    });
  }

  throw new Error(`Unknown exchange action: ${action}`);
}
