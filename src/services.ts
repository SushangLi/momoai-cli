import { MomoClient } from './client.js';

export async function exploreAgents(query: string, limit = 10) {
  const response = await new MomoClient().request<any>('/api/cli/agents/search', {
    query: { query, limit }
  });
  const agents = response.data?.agents || [];
  return agents.map((agent: any) => ({
    id: agent.id,
    name: agent.name,
    price: `${agent.price}/${agent.price_unit}`,
    model: agent.model_call_name,
    intro: agent.intro
  }));
}

export async function exchangeBalance() {
  const response = await new MomoClient().request<any>('/api/cli/exchange/balance');
  return {
    credits: response.data.credits.total,
    purchase: response.data.credits.purchase,
    gift: response.data.credits.gift,
    tokens: response.data.tokens.map((token: any) => ({
      agent: token.agent_id,
      balance: token.token_balance,
      onsale: token.token_onsale,
      price: token.resell_price ?? ''
    }))
  };
}

export async function exchangeOwned() {
  const response = await new MomoClient().request<any>('/api/cli/exchange/owned');
  return response.data.agents.map((agent: any) => ({
    agent: agent.agent_id,
    name: agent.agent_name,
    balance: agent.token_balance,
    onsale: agent.token_onsale,
    price: agent.resell_price ?? ''
  }));
}

export async function exchangeListings(agentId?: number) {
  const response = await new MomoClient().request<any>('/api/cli/exchange/listings', {
    query: { agent_id: agentId }
  });
  return response.data.listings.map((listing: any) => ({
    agent: listing.agent_id,
    seller: listing.seller_username,
    tokens: listing.token_onsale,
    price: listing.resell_price,
    author: listing.model_author
  }));
}

export async function exchangeBuy(agentId: number, tokens: number, maxPrice: number) {
  const response = await new MomoClient().request<any>('/api/cli/exchange/buy', {
    body: { agent_id: agentId, tokens, max_price: maxPrice }
  });
  return {
    agent: response.data.agent_id,
    tokens_bought: response.data.tokens_bought,
    tokens_remaining: response.data.tokens_remaining,
    credits_used: response.data.credits_used?.total,
    status: response.data.status
  };
}

export async function exchangeSell(agentId: number, tokens: number, price: number) {
  const response = await new MomoClient().request<any>('/api/cli/exchange/sell', {
    body: { agent_id: agentId, tokens, price }
  });
  return {
    agent: response.data.agent_id,
    onsale: response.data.token_onsale,
    price: response.data.resell_price
  };
}
