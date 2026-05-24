import { loadConfig, normalizeAgentServiceType, normalizeProfileName, resolveAgentConfig, saveAgentProfile } from './config.js';
import { callPlatformAgent, exchangeBalance, exchangeBuy, exchangeListings, exchangeOwned, exchangeSell, exploreAgents, publishLocalAgentListing, updateLocalAgentListing } from './services.js';
import type { AgentCapability, ResolvedAgentConfig } from './config.js';

export type ConfirmTool = (toolName: string, args: Record<string, unknown>) => Promise<boolean>;

export const momoTools = [
  {
    type: 'function',
    function: {
      name: 'explore_agents',
      description: 'Search MOMO AI agents by query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 10 }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exchange_balance',
      description: 'Get account credits and token balances.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exchange_owned',
      description: 'Get agents whose tokens the user owns and can resell.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exchange_listings',
      description: 'Get resale token listings, optionally for one agent.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'number' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exchange_buy',
      description: 'Buy tokens for an agent from resale listings.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'number' },
          tokens: { type: 'number' },
          max_price: { type: 'number' }
        },
        required: ['agent_id', 'tokens', 'max_price']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exchange_sell',
      description: 'List owned tokens for resale.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'number' },
          tokens: { type: 'number' },
          price: { type: 'number' }
        },
        required: ['agent_id', 'tokens', 'price']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'call_platform_agent',
      description: 'Call another MOMOAI market agent. During remote service execution, the original caller pays for this child agent call.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'number' },
          content: { type: 'string' }
        },
        required: ['agent_id', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'publish_local_agent_listing',
      description: 'Create a delisted MOMOAI A2A remote-service listing for one local CLI agent profile.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'string', description: 'Local agent profile name. Use default if omitted.' },
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number', description: 'Credits per 1K agent tokens.' },
          available_tokens: { type: 'number' },
          service_type: { type: 'string', enum: ['polling', 'http'], description: 'polling is delayed and safer; http is realtime and requires a reachable provider_url.' },
          provider_url: { type: 'string', description: 'Public or tunneled URL ending in /a2a for http service_type.' },
          capabilities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                fixedTokens: { type: 'number' },
                enabled: { type: 'boolean' }
              },
              required: ['id', 'name', 'fixedTokens']
            }
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_local_agent_listing',
      description: 'Update an existing MOMOAI A2A remote-service listing for one local CLI agent profile.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'string' },
          agent_id: { type: 'number' },
          public: { type: 'boolean', description: 'Set true to publish publicly after a provider node is online.' },
          delisted: { type: 'boolean', description: 'Set true to keep the listing hidden.' },
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number' },
          available_tokens: { type: 'number' },
          service_type: { type: 'string', enum: ['polling', 'http'] },
          provider_url: { type: 'string' },
          capabilities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                fixedTokens: { type: 'number' },
                enabled: { type: 'boolean' }
              },
              required: ['id', 'name', 'fixedTokens']
            }
          }
        }
      }
    }
  }
];

function parseArgs(raw: string | undefined) {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function numberArg(args: Record<string, unknown>, name: string) {
  const value = Number(args[name]);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  return value;
}

function intArg(args: Record<string, unknown>, name: string) {
  const value = numberArg(args, name);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function confirmIfNeeded(name: string, args: Record<string, unknown>, confirm?: ConfirmTool) {
  const isTrade = name === 'exchange_buy' || name === 'exchange_sell' || name === 'publish_local_agent_listing' || name === 'update_local_agent_listing';
  if (!isTrade || loadConfig().permissionMode === 'full') return true;
  if (!confirm) return false;
  return confirm(name, args);
}

function capabilitiesArg(value: unknown): AgentCapability[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('capabilities must be an array');
  const capabilities = value.map((capability: any) => ({
    id: String(capability.id || capability.capability_id || capability.capabilityId || '').trim(),
    name: String(capability.name || capability.id || capability.capability_id || capability.capabilityId || '').trim(),
    description: String(capability.description || '').trim(),
    fixedTokens: Number(capability.fixedTokens ?? capability.fixed_tokens),
    enabled: capability.enabled === undefined ? true : Boolean(capability.enabled)
  })).filter((capability) => capability.id && capability.name);
  if (!capabilities.length) throw new Error('capabilities must include at least one item');
  return capabilities;
}

function agentForTool(args: Record<string, unknown>): ResolvedAgentConfig {
  const config = loadConfig();
  const profile = normalizeProfileName(args.profile) || 'default';
  let agent: ResolvedAgentConfig;
  try {
    agent = resolveAgentConfig(config, profile);
  } catch {
    agent = { ...resolveAgentConfig(config), profile };
  }

  const caps = capabilitiesArg(args.capabilities);
  return {
    ...agent,
    mode: 'remote_service',
    serviceType: normalizeAgentServiceType(args.service_type || args.serviceType || agent.serviceType),
    ...(args.provider_url || args.providerUrl ? { providerUrl: String(args.provider_url || args.providerUrl).trim().replace(/\/$/, '') } : {}),
    ...(args.name ? { name: String(args.name) } : {}),
    ...(args.description ? { description: String(args.description) } : {}),
    ...(args.agent_id ? { agentId: intArg(args, 'agent_id') } : {}),
    ...(caps ? { capabilities: caps } : {}),
    listing: {
      ...agent.listing,
      ...(args.price === undefined ? {} : { price: numberArg(args, 'price') }),
      ...(args.available_tokens === undefined ? {} : { availableTokens: numberArg(args, 'available_tokens') })
    }
  };
}

function saveToolAgent(agent: ResolvedAgentConfig) {
  saveAgentProfile(agent.profile, {
    mode: 'remote_service',
    name: agent.name,
    description: agent.description,
    version: agent.version,
    host: agent.host,
    port: agent.port,
    serviceType: agent.serviceType,
    ...(agent.providerUrl ? { providerUrl: agent.providerUrl } : {}),
    agentId: agent.agentId,
    capabilities: agent.capabilities,
    listing: agent.listing
  });
}

export async function executeToolCall(
  name: string,
  rawArgs: string | undefined,
  confirm?: ConfirmTool,
  options: { planId?: string; authToken?: string } = {}
) {
  if (!options.planId) {
    return {
      error: 'Tool call blocked: agent actions require an approved plan before execution.'
    };
  }

  const args = parseArgs(rawArgs);
  const allowed = await confirmIfNeeded(name, args, confirm);
  if (!allowed) {
    return {
      denied: true,
      message: `${name} was not executed because user confirmation was not granted.`
    };
  }

  try {
    if (name === 'explore_agents') {
      return await exploreAgents(String(args.query || ''), Number(args.limit || 10), options.authToken);
    }
    if (name === 'exchange_balance') return await exchangeBalance(options.authToken);
    if (name === 'exchange_owned') return await exchangeOwned(options.authToken);
    if (name === 'exchange_listings') {
      const agentId = args.agent_id === undefined ? undefined : intArg(args, 'agent_id');
      return await exchangeListings(agentId, options.authToken);
    }
    if (name === 'exchange_buy') {
      return await exchangeBuy(intArg(args, 'agent_id'), numberArg(args, 'tokens'), numberArg(args, 'max_price'), options.authToken);
    }
    if (name === 'exchange_sell') {
      return await exchangeSell(intArg(args, 'agent_id'), numberArg(args, 'tokens'), numberArg(args, 'price'), options.authToken);
    }
    if (name === 'call_platform_agent') {
      return await callPlatformAgent(intArg(args, 'agent_id'), String(args.content || ''), options.authToken);
    }
    if (name === 'publish_local_agent_listing') {
      const agent = agentForTool(args);
      const listing = await publishLocalAgentListing(agent, {
        name: agent.name,
        description: agent.description,
        price: agent.listing.price,
        availableTokens: agent.listing.availableTokens
      }, options.authToken);
      agent.agentId = Number((listing as any).agent_id || (listing as any).agentId);
      saveToolAgent(agent);
      return listing;
    }
    if (name === 'update_local_agent_listing') {
      const agent = agentForTool(args);
      const isDelisted = args.public === true ? false : args.delisted === true ? true : undefined;
      const listing = await updateLocalAgentListing(agent, {
        agentId: agent.agentId,
        name: agent.name,
        description: agent.description,
        price: agent.listing.price,
        availableTokens: agent.listing.availableTokens,
        ...(isDelisted === undefined ? {} : { isDelisted })
      }, options.authToken);
      agent.agentId = Number((listing as any).agent_id || (listing as any).agentId || agent.agentId);
      if (isDelisted !== undefined) agent.listing.isDelisted = isDelisted;
      saveToolAgent(agent);
      return listing;
    }
    return { error: `Unknown tool: ${name}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
