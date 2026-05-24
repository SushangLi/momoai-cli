import { MomoClient } from './client.js';

export async function exploreAgents(query: string, limit = 10, authToken?: string) {
  const response = await new MomoClient().request<any>('/api/cli/agents/search', {
    authToken,
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

export async function exchangeBalance(authToken?: string) {
  const response = await new MomoClient().request<any>('/api/cli/exchange/balance', { authToken });
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

export async function exchangeOwned(authToken?: string) {
  const response = await new MomoClient().request<any>('/api/cli/exchange/owned', { authToken });
  return response.data.agents.map((agent: any) => ({
    agent: agent.agent_id,
    name: agent.agent_name,
    balance: agent.token_balance,
    onsale: agent.token_onsale,
    price: agent.resell_price ?? ''
  }));
}

export async function exchangeListings(agentId?: number, authToken?: string) {
  const response = await new MomoClient().request<any>('/api/cli/exchange/listings', {
    authToken,
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

export async function exchangeBuy(agentId: number, tokens: number, maxPrice: number, authToken?: string) {
  const response = await new MomoClient().request<any>('/api/cli/exchange/buy', {
    authToken,
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

export async function exchangeSell(agentId: number, tokens: number, price: number, authToken?: string) {
  const response = await new MomoClient().request<any>('/api/cli/exchange/sell', {
    authToken,
    body: { agent_id: agentId, tokens, price }
  });
  return {
    agent: response.data.agent_id,
    onsale: response.data.token_onsale,
    price: response.data.resell_price
  };
}

export async function callPlatformAgent(agentId: number, content: string, authToken?: string) {
  const response = await new MomoClient().request<any>('/v1/chat/completions', {
    authToken,
    body: {
      model: `momo_${agentId}`,
      messages: [{ role: 'user', content }]
    }
  });

  return {
    agent: agentId,
    content: response.choices?.[0]?.message?.content ?? '',
    usage: response.usage
  };
}
