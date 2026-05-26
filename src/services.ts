import { MomoClient } from './client.js';
import type { ResolvedAgentConfig } from './config.js';

export interface ExploreAgentsOptions {
  scope?: 'agent' | 'capability';
  inputMode?: string;
  outputMode?: string;
  maxFixedTokens?: number;
  onlineOnly?: boolean;
  agentId?: number;
}

export interface PlatformAgentCallOptions {
  capabilityId?: string;
  outputMode?: string | string[];
  contextId?: string;
  showPlan?: boolean;
}

function compactQuery(value: Record<string, string | number | boolean | undefined>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== '')) as Record<string, string | number | boolean>;
}

function normalizeModes(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(raw.map((mode) => String(mode || '').trim()).filter(Boolean))];
}

function mediaTypeMatches(accepted: string, actual: string) {
  const left = accepted.trim().toLowerCase();
  const right = actual.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === '*/*' || left === right) return true;
  const [leftType, leftSubtype] = left.split('/');
  const [rightType] = right.split('/');
  return leftSubtype === '*' && leftType === rightType;
}

export async function exploreAgents(query: string, limit = 10, authToken?: string, options: ExploreAgentsOptions = {}) {
  const response = await new MomoClient().request<any>('/api/cli/agents/search', {
    authToken,
    query: compactQuery({
      query,
      limit,
      scope: options.scope,
      input_mode: options.inputMode,
      output_mode: options.outputMode,
      max_fixed_tokens: options.maxFixedTokens,
      online_only: options.onlineOnly,
      agent_id: options.agentId
    })
  });
  const agents = response.data?.agents || [];
  return agents.map((agent: any) => ({
    id: agent.id,
    name: agent.name,
    price: `${agent.price}/${agent.price_unit}`,
    model: agent.model_call_name,
    intro: agent.intro,
    ...(agent.online === undefined ? {} : { online: agent.online }),
    ...(agent.agent_card_url ? { agent_card_url: agent.agent_card_url } : {}),
    ...(agent.market_card_url ? { market_card_url: agent.market_card_url } : {}),
    ...(agent.matched_capability ? { matched_capability: agent.matched_capability } : {})
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

function findCapability(cardOrMarket: any, capabilityId: string) {
  const normalized = capabilityId.trim();
  const skills = Array.isArray(cardOrMarket?.skills) ? cardOrMarket.skills : [];
  const marketCapabilities = Array.isArray(cardOrMarket?.momoai_market?.capabilities)
    ? cardOrMarket.momoai_market.capabilities
    : [];
  return [...skills, ...marketCapabilities].find((item: any) => String(item?.id || item?.capability_id || '').trim() === normalized);
}

async function validateA2aCapabilityCall(agentId: number, capabilityId: string, outputModes: string[], authToken?: string) {
  const client = new MomoClient();
  const card = await client.request<any>(`/a2a/agents/${agentId}`, { authToken });
  const market = await client.request<any>(`/a2a/agents/${agentId}`, {
    authToken,
    query: { format: 'market' }
  });
  const skill = findCapability(card, capabilityId);
  if (!skill) throw new Error(`A2A agent ${agentId} does not expose capability ${capabilityId} in its Agent Card.`);
  const marketCapability = findCapability(market, capabilityId);
  if (!marketCapability) throw new Error(`A2A agent ${agentId} does not expose capability ${capabilityId} in its Market Card.`);
  if (marketCapability.enabled === false) throw new Error(`A2A capability ${capabilityId} is disabled.`);
  if (market?.momoai_market?.online === false) throw new Error(`A2A agent ${agentId} is offline.`);

  const supported = Array.isArray(marketCapability.outputModes)
    ? marketCapability.outputModes
    : Array.isArray(marketCapability.output_modes)
      ? marketCapability.output_modes
      : Array.isArray(skill.outputModes)
        ? skill.outputModes
        : Array.isArray(skill.output_modes) ? skill.output_modes : ['text/plain'];
  const unsupported = outputModes.filter((mode) => !supported.some((item: string) => mediaTypeMatches(mode, String(item))));
  if (unsupported.length) {
    throw new Error(`A2A capability ${capabilityId} does not support output mode: ${unsupported.join(', ')}`);
  }
}

export async function callPlatformAgent(agentId: number, content: string, authToken?: string, options: PlatformAgentCallOptions = {}) {
  const capabilityId = options.capabilityId?.trim();
  if (capabilityId) {
    const outputModes = normalizeModes(options.outputMode);
    await validateA2aCapabilityCall(agentId, capabilityId, outputModes, authToken);
    const response = await new MomoClient().request<any>(`/a2a/agents/${agentId}`, {
      authToken,
      body: {
        jsonrpc: '2.0',
        id: `cli_${Date.now()}`,
        method: 'message/send',
        params: {
          message: {
            messageId: `cli_msg_${Date.now()}`,
            role: 'user',
            parts: [{ text: content, mediaType: 'text/plain' }]
          },
          ...(outputModes.length ? { configuration: { acceptedOutputModes: outputModes } } : {}),
          metadata: {
            capability_id: capabilityId,
            ...(options.contextId ? { contextId: options.contextId } : {}),
            ...(options.showPlan === undefined ? {} : { showPlan: options.showPlan })
          }
        }
      }
    });
    if (response.error) throw new Error(response.error.message || 'A2A capability call failed');
    return {
      agent: agentId,
      capability_id: capabilityId,
      task: response.result || response
    };
  }

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

function listingPayload(agent: ResolvedAgentConfig, overrides: {
  name?: string;
  description?: string;
  price?: number;
  availableTokens?: number;
  isDelisted?: boolean;
} = {}) {
  return {
    agent_name: overrides.name || agent.name,
    agent_intro: overrides.description || agent.description || agent.name,
    agent_price: overrides.price ?? agent.listing.price,
    agent_available_tokens: overrides.availableTokens ?? agent.listing.availableTokens,
    is_delisted: overrides.isDelisted ?? agent.listing.isDelisted,
    baseurl_type: 'a2a',
    agent_source_type: 'api',
    agent_source: agent.agentId ? `https://momoai.pro/a2a/agents/${agent.agentId}` : 'https://momoai.pro/a2a/agents/pending',
    agentCallName: agent.agentId ? `momo_${agent.agentId}` : `momo_${agent.name.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 48) || 'agent'}`,
    a2a_capabilities: agent.capabilities
      .filter((capability) => capability.enabled !== false)
      .map((capability, index) => ({
        id: capability.id,
        name: capability.name,
        description: capability.description || '',
        fixedTokens: Number(capability.fixedTokens || 0),
        enabled: capability.enabled !== false,
        sortOrder: index,
        inputModes: capability.inputModes || ['text/plain', 'application/json'],
        outputModes: capability.outputModes || ['text/plain'],
        ...(capability.formatContract ? { formatContract: capability.formatContract } : {})
      }))
  };
}

export async function publishLocalAgentListing(agent: ResolvedAgentConfig, overrides: {
  name?: string;
  description?: string;
  price?: number;
  availableTokens?: number;
} = {}, authToken?: string) {
  const response = await new MomoClient().request<any>('/api/cli/agents/listing', {
    authToken,
    body: listingPayload(agent, { ...overrides, isDelisted: true })
  });
  return response.data || response;
}

export async function updateLocalAgentListing(agent: ResolvedAgentConfig, overrides: {
  agentId?: number;
  name?: string;
  description?: string;
  price?: number;
  availableTokens?: number;
  isDelisted?: boolean;
} = {}, authToken?: string) {
  const agentId = overrides.agentId || agent.agentId;
  if (!agentId) throw new Error('update-listing requires --agent-id or a profile with agentId.');
  const response = await new MomoClient().request<any>('/api/cli/agents/listing', {
    authToken,
    method: 'PUT',
    body: {
      agent_id: agentId,
      ...listingPayload({ ...agent, agentId }, overrides)
    }
  });
  return response.data || response;
}
