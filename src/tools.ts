import { loadConfig, normalizeAgentProviderRuntime, normalizeAgentServiceType, normalizeProfileName, resolveAgentConfig, saveAgentProfile } from './config.js';
import { installOpenClawA2a } from './agent/openclaw.js';
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
          provider_runtime: { type: 'string', enum: ['cli', 'external'], description: 'cli means this CLI runs the A2A service; external means platform calls the given A2A provider_url directly.' },
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
          provider_runtime: { type: 'string', enum: ['cli', 'external'] },
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
  },
  {
    type: 'function',
    function: {
      name: 'prepare_openclaw_a2a_market_service',
      description: 'Probe an OpenClaw/agent port, install a public standard A2A OpenClaw plugin when A2A is missing, then install the MOMOAI market adapter plugin. The CLI is not used as a runtime proxy.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          agent_id: { type: 'number', description: 'MOMOAI platform agent id, if already published.' },
          provider_url: { type: 'string', description: 'Public URL for the MOMOAI protected provider endpoint.' },
          gateway_base_url: { type: 'string', description: 'Local OpenClaw Gateway base URL, usually http://127.0.0.1:18789.' },
          standard_plugin_source: { type: 'string', description: 'Public OpenClaw plugin source for standard A2A communication. Override this when an official source is available.' },
          skip_standard_plugin: { type: 'boolean', default: false, description: 'Skip installing the standard A2A plugin when the port already supports A2A or the user manages it separately.' },
          service_id: { type: 'string' },
          upstream_path: { type: 'string', description: 'Standard A2A endpoint path owned by the public A2A plugin, for example /a2a/gomoku.' },
          protected_path: { type: 'string', description: 'MOMOAI adapter endpoint path that verifies market invocation and forwards to upstream_path.' },
          agent_card_path: { type: 'string' },
          market_path: { type: 'string' },
          oasf_path: { type: 'string' },
          require_platform_auth: { type: 'boolean', default: true },
          forward_authorization: { type: 'boolean', default: false },
          restart: { type: 'boolean', default: false },
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
  },
  {
    type: 'function',
    function: {
      name: 'install_openclaw_a2a_plugin',
      description: 'Backward-compatible alias for prepare_openclaw_a2a_market_service.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          agent_id: { type: 'number' },
          provider_url: { type: 'string' },
          gateway_base_url: { type: 'string' },
          standard_plugin_source: { type: 'string' },
          skip_standard_plugin: { type: 'boolean', default: false },
          service_id: { type: 'string' },
          upstream_path: { type: 'string' },
          protected_path: { type: 'string' },
          agent_card_path: { type: 'string' },
          market_path: { type: 'string' },
          oasf_path: { type: 'string' },
          require_platform_auth: { type: 'boolean', default: true },
          forward_authorization: { type: 'boolean', default: false },
          restart: { type: 'boolean', default: false },
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
  const isTrade = name === 'exchange_buy' || name === 'exchange_sell' || name === 'publish_local_agent_listing' || name === 'update_local_agent_listing' || name === 'install_openclaw_a2a_plugin' || name === 'prepare_openclaw_a2a_market_service';
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
    providerRuntime: normalizeAgentProviderRuntime(args.provider_runtime || args.providerRuntime || agent.providerRuntime),
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
    providerRuntime: agent.providerRuntime,
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
    if (name === 'install_openclaw_a2a_plugin' || name === 'prepare_openclaw_a2a_market_service') {
      const agent = {
        ...agentForTool({
          ...args,
          service_type: 'http',
          provider_runtime: 'external'
        }),
        providerRuntime: 'external' as const,
        serviceType: 'http' as const
      };
      const result = await installOpenClawA2a(agent, {
        gatewayBaseUrl: typeof args.gateway_base_url === 'string' ? args.gateway_base_url : undefined,
        standardPluginSource: typeof args.standard_plugin_source === 'string' ? args.standard_plugin_source : undefined,
        skipStandardPlugin: args.skip_standard_plugin === true,
        serviceId: typeof args.service_id === 'string' ? args.service_id : undefined,
        upstreamPath: typeof args.upstream_path === 'string' ? args.upstream_path : typeof args.path === 'string' ? args.path : undefined,
        protectedPath: typeof args.protected_path === 'string' ? args.protected_path : undefined,
        agentCardPath: typeof args.agent_card_path === 'string' ? args.agent_card_path : typeof args.card_path === 'string' ? args.card_path : undefined,
        marketPath: typeof args.market_path === 'string' ? args.market_path : undefined,
        oasfPath: typeof args.oasf_path === 'string' ? args.oasf_path : undefined,
        providerUrl: agent.providerUrl,
        requirePlatformAuth: args.require_platform_auth === undefined ? true : Boolean(args.require_platform_auth),
        forwardAuthorization: args.forward_authorization === true,
        restart: args.restart === true
      });
      saveToolAgent(agent);
      return result;
    }
    return { error: `Unknown tool: ${name}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
