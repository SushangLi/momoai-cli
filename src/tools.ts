import { loadConfig, normalizeAgentProviderRuntime, normalizeAgentServiceType, normalizeCapabilitySkill, normalizeProfileName, resolveAgentConfig, saveAgentProfile } from './config.js';
import { inspectOpenClawA2aStack, installOpenClawA2a } from './agent/openclaw.js';
import { listLocalAgentProfiles, normalizeOpenClawCapabilityList, publishOpenClawA2aService } from './agent/openclaw-publishing.js';
import { exposeViaTailscaleFunnel } from './agent/tailscale.js';
import { callPlatformAgent, exchangeBalance, exchangeBuy, exchangeListings, exchangeOwned, exchangeSell, exploreAgents, publishLocalAgentListing, updateLocalAgentListing } from './services.js';
import type { AgentCapability, ResolvedAgentConfig } from './config.js';

export type ConfirmTool = (toolName: string, args: Record<string, unknown>) => Promise<boolean>;

const capabilitiesSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      fixedTokens: { type: 'number' },
      enabled: { type: 'boolean' },
      inputModes: { type: 'array', items: { type: 'string' } },
      outputModes: { type: 'array', items: { type: 'string' } },
      skill: {
        type: 'object',
        description: 'Local runtime skill bound to this external capability. Required for priced A2A services.',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          instructions: { type: 'string', description: 'What to do and how to do it when this capability_id is invoked.' }
        },
        required: ['id', 'instructions']
      }
    },
    required: ['id', 'name', 'fixedTokens', 'skill']
  }
} as const;

export const momoTools = [
  {
    type: 'function',
    function: {
      name: 'explore_agents',
      description: 'Search MOMOAI agents. Use scope=capability when the user needs an agent that can perform a specific A2A capability.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 10 },
          scope: { type: 'string', enum: ['agent', 'capability'], default: 'agent' },
          input_mode: { type: 'string', description: 'Required input media type when scope=capability, for example text/plain or application/json.' },
          output_mode: { type: 'string', description: 'Required output media type when scope=capability, for example text/plain or application/json.' },
          max_fixed_tokens: { type: 'number', description: 'Maximum fixed result-token price when scope=capability.' },
          online_only: { type: 'boolean', default: true, description: 'Only return A2A agents with an online provider when scope=capability.' },
          agent_id: { type: 'number', description: 'Limit capability search to one A2A agent.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'exchange_balance',
      description: 'Get account credits, spendable credits, and token balances. For agents that require purchase credits, use spendable_purchase rather than total credits.',
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
      description: 'Get buyable token offers, optionally for one agent. Results always include the publisher direct price when the agent has a public price, plus any resale listings. price is credits per 1,000 tokens (cr/K).',
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
      description: 'Buy tokens for an agent from the best eligible source: publisher direct inventory or resale listings. max_price is the maximum unit price in credits per 1,000 tokens (cr/K), not total spend. This is all-or-nothing: it never executes a partial purchase. For a user limit of price < 20 cr/K, pass max_price=20. If status is no_purchases, inspect skipped_sources/fillable_tokens and do not retry unchanged; ask the user or decide a smaller explicit amount if authorized.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'number', description: 'Target agent id.' },
          tokens: { type: 'number', description: 'Number of agent tokens to buy.' },
          max_price: { type: 'number', description: 'Maximum acceptable unit price in credits per 1,000 tokens (cr/K); not the total transaction cost.' }
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
      description: 'Call another MOMOAI market agent. With capability_id, call its standard A2A capability; otherwise use the legacy chat completion path.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'number' },
          content: { type: 'string' },
          capability_id: { type: 'string', description: 'A2A capability id to call, selected from explore_agents scope=capability results.' },
          output_mode: { type: 'string', description: 'Requested A2A output media type, for example application/json.' },
          context_id: { type: 'string' },
          show_plan: { type: 'boolean' }
        },
        required: ['agent_id', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_local_agent_profiles',
      description: 'Read-only local inspection. List complete MOMOAI CLI agent profiles configured on this machine, including capabilities, format contracts, and bound local skill instructions. Use for check/list/show/clone local agents; do not use publish/update tools for read-only checks.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'inspect_openclaw_a2a_stack',
      description: 'Read-only local OpenClaw inspection. Probe the target gateway paths to determine whether the standard A2A endpoint and MOMOAI adapter are already available before installing or publishing. Use this before publishing OpenClaw; do not assume plugins are present.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'string', default: 'openclaw', description: 'Local profile/service name. Used as the default service_id.' },
          service_type: { type: 'string', enum: ['websocket', 'funnel'], default: 'websocket' },
          gateway_base_url: { type: 'string', description: 'Local OpenClaw Gateway base URL, usually http://127.0.0.1:18789.' },
          openclaw_bin: { type: 'string', description: 'OpenClaw executable. Defaults to openclaw.' },
          service_id: { type: 'string' },
          upstream_path: { type: 'string', description: 'Standard A2A endpoint path to probe.' },
          protected_path: { type: 'string', description: 'MOMOAI protected provider endpoint path to probe.' },
          agent_card_path: { type: 'string', description: 'Agent Card path to probe.' },
          market_path: { type: 'string', description: 'MOMOAI market card path to probe.' },
          oasf_path: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'publish_local_agent_listing',
      description: 'Create a delisted MOMOAI A2A remote-service listing for one local CLI agent profile. Do not use this for external websocket agents such as OpenClaw; those require provider-specific inspection/adapter setup.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'string', description: 'Local agent profile name. Use default if omitted.' },
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number', description: 'Credits per 1K agent tokens.' },
          available_tokens: { type: 'number' },
          service_type: { type: 'string', enum: ['websocket', 'funnel'], description: 'websocket is the default outbound relay; funnel registers a public or tunneled provider_url.' },
          provider_runtime: { type: 'string', enum: ['cli', 'external'], description: 'cli means this CLI runs the A2A service; external means platform calls the given A2A provider_url directly through funnel.' },
          provider_url: { type: 'string', description: 'Public or tunneled URL ending in the provider A2A path for funnel service_type.' },
          capabilities: capabilitiesSchema
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
          service_type: { type: 'string', enum: ['websocket', 'funnel'] },
          provider_runtime: { type: 'string', enum: ['cli', 'external'] },
          provider_url: { type: 'string' },
          capabilities: capabilitiesSchema
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'publish_openclaw_a2a_service',
      description: 'High-level OpenClaw publishing workflow. It first inspects the local machine, then creates/updates a MOMOAI A2A listing, installs/configures only missing or required OpenClaw A2A pieces, registers the provider, and optionally makes it public. Use this for publishing one local OpenClaw service with one or more capability skill bindings. Do not include capability-specific plugin handlers.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'string', default: 'openclaw' },
          name: { type: 'string' },
          description: { type: 'string' },
          agent_id: { type: 'number' },
          service_type: { type: 'string', enum: ['websocket', 'funnel'], default: 'websocket' },
          provider_url: { type: 'string', description: 'Required only for funnel; public MOMOAI protected provider endpoint.' },
          price: { type: 'number', description: 'Credits per 1K direct-purchase tokens.' },
          available_tokens: { type: 'number' },
          public: { type: 'boolean', default: false, description: 'Make the platform listing public after provider online verification.' },
          restart: { type: 'boolean', default: true, description: 'Restart OpenClaw gateway after plugin changes.' },
          gateway_base_url: { type: 'string', description: 'Local OpenClaw Gateway base URL, usually http://127.0.0.1:18789.' },
          openclaw_bin: { type: 'string', description: 'OpenClaw executable. Defaults to openclaw.' },
          standard_plugin_source: { type: 'string', description: 'Optional override for the standard A2A OpenClaw plugin source.' },
          skip_standard_plugin: { type: 'boolean', default: false },
          service_id: { type: 'string' },
          upstream_path: { type: 'string' },
          protected_path: { type: 'string' },
          agent_card_path: { type: 'string' },
          market_path: { type: 'string' },
          oasf_path: { type: 'string' },
          require_platform_auth: { type: 'boolean', default: true },
          forward_authorization: { type: 'boolean', default: false },
          capabilities: {
            type: 'array',
            description: 'Capabilities to expose. Each capability is implemented by OpenClaw through the generic A2A skill router using the bound skill instructions; no capability-specific plugin handler is allowed.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: 'string' },
                fixedTokens: { type: 'number' },
                enabled: { type: 'boolean' },
                inputModes: { type: 'array', items: { type: 'string' } },
                outputModes: { type: 'array', items: { type: 'string' } },
                formatContract: { type: 'object' },
                skill: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    instructions: { type: 'string', description: 'Executable instructions OpenClaw receives when this capability_id is invoked.' }
                  },
                  required: ['id', 'instructions']
                }
              },
              required: ['id', 'name', 'fixedTokens', 'skill']
            }
          }
        },
        required: ['capabilities']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'prepare_openclaw_a2a_market_service',
      description: 'Low-level OpenClaw setup. Inspect an OpenClaw/agent port, install the bundled spec-compatible standard A2A OpenClaw plugin only when the standard A2A endpoint is missing, configure the generic A2A skill router, then install/configure the MOMOAI market adapter when needed. The CLI is not used as a runtime proxy.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          agent_id: { type: 'number', description: 'MOMOAI platform agent id, if already published.' },
          service_type: { type: 'string', enum: ['websocket', 'funnel'], default: 'websocket', description: 'websocket registers an outbound provider relay; funnel registers a public direct provider_url.' },
          provider_url: { type: 'string', description: 'Public URL for the MOMOAI protected provider endpoint when service_type is funnel.' },
          gateway_base_url: { type: 'string', description: 'Local OpenClaw Gateway base URL, usually http://127.0.0.1:18789.' },
          standard_plugin_source: { type: 'string', description: 'OpenClaw plugin source for standard A2A communication. Defaults to the bundled spec-compatible plugin; override when an official source is available.' },
          skip_standard_plugin: { type: 'boolean', default: false, description: 'Skip installing the standard A2A plugin when the port already supports A2A or the user manages it separately.' },
          service_id: { type: 'string' },
          upstream_path: { type: 'string', description: 'Standard A2A endpoint path owned by the public A2A plugin, for example /a2a/gomoku.' },
          protected_path: { type: 'string', description: 'MOMOAI adapter endpoint path that verifies market invocation and forwards to upstream_path.' },
          agent_card_path: { type: 'string' },
          market_path: { type: 'string' },
          require_platform_auth: { type: 'boolean', default: true },
          forward_authorization: { type: 'boolean', default: false },
          restart: { type: 'boolean', default: false },
          capabilities: capabilitiesSchema
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'expose_agent_with_tailscale_funnel',
      description: 'Expose only the required local A2A/MOMOAI paths through Tailscale Funnel. This does not proxy through momoai-cli at runtime.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'string' },
          kind: { type: 'string', enum: ['cli', 'openclaw', 'custom'], description: 'cli exposes this CLI profile; openclaw exposes OpenClaw A2A/MOMOAI adapter paths; custom exposes explicit paths.' },
          local_base_url: { type: 'string', description: 'Loopback target such as http://127.0.0.1:18789.' },
          hostname: { type: 'string', description: 'Optional explicit Tailscale Funnel hostname. If omitted, CLI reads tailscale status.' },
          https_port: { type: 'number', default: 443 },
          service_id: { type: 'string' },
          provider_path: { type: 'string', description: 'Public provider path registered with momoai.pro, for example /momoai/a2a/gomoku or /a2a.' },
          upstream_path: { type: 'string' },
          agent_card_path: { type: 'string' },
          market_path: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Additional exact paths to expose. Do not expose the whole OpenClaw gateway.' },
          include_standard: { type: 'boolean', default: false, description: 'For OpenClaw, also expose the generic A2A endpoint and agent card, not only MOMOAI protected paths.' },
          disable: { type: 'boolean', default: false },
          dry_run: { type: 'boolean', default: false }
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
          service_type: { type: 'string', enum: ['websocket', 'funnel'], default: 'websocket' },
          provider_url: { type: 'string' },
          gateway_base_url: { type: 'string' },
          standard_plugin_source: { type: 'string' },
          skip_standard_plugin: { type: 'boolean', default: false },
          service_id: { type: 'string' },
          upstream_path: { type: 'string' },
          protected_path: { type: 'string' },
          agent_card_path: { type: 'string' },
          market_path: { type: 'string' },
          require_platform_auth: { type: 'boolean', default: true },
          forward_authorization: { type: 'boolean', default: false },
          restart: { type: 'boolean', default: false },
          capabilities: capabilitiesSchema
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
  const isTrade = name === 'exchange_buy' || name === 'exchange_sell' || name === 'publish_local_agent_listing' || name === 'update_local_agent_listing' || name === 'publish_openclaw_a2a_service' || name === 'install_openclaw_a2a_plugin' || name === 'prepare_openclaw_a2a_market_service' || name === 'expose_agent_with_tailscale_funnel';
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
    enabled: capability.enabled === undefined ? true : Boolean(capability.enabled),
    inputModes: modesArg(capability.inputModes || capability.input_modes),
    outputModes: modesArg(capability.outputModes || capability.output_modes),
    formatContract: capability.formatContract || capability.format_contract,
    handler: capability.handler || capability.localHandler || capability.local_handler,
    ...(capability.pluginId || capability.plugin_id ? { pluginId: capability.pluginId || capability.plugin_id } : {}),
    ...(capability.pluginSource || capability.plugin_source ? { pluginSource: capability.pluginSource || capability.plugin_source } : {}),
    skill: normalizeCapabilitySkill(capability)
  })).filter((capability) => capability.id && capability.name);
  if (!capabilities.length) throw new Error('capabilities must include at least one item');
  return capabilities;
}

function modesArg(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const modes = [...new Set(value.map((mode) => String(mode || '').trim()).filter(Boolean))];
  return modes.length ? modes : undefined;
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

function validateBillableCapabilities(agent: ResolvedAgentConfig) {
  const invalid = agent.capabilities
    .filter((capability) => capability.enabled !== false)
    .filter((capability) => !Number.isFinite(Number(capability.fixedTokens)) || Number(capability.fixedTokens) <= 0);
  if (invalid.length) {
    throw new Error(`A2A listing capabilities require positive fixedTokens: ${invalid.map((capability) => capability.id).join(', ')}`);
  }
  const unbound = agent.capabilities
    .filter((capability) => capability.enabled !== false)
    .filter((capability) => !capability.skill?.id || !capability.skill.instructions?.trim());
  if (unbound.length) {
    throw new Error(`A2A listing capabilities require a local skill binding with instructions: ${unbound.map((capability) => capability.id).join(', ')}`);
  }
}

function rejectExternalWebsocketGenericListing(agent: ResolvedAgentConfig, toolName: string) {
  if (agent.providerRuntime !== 'external' || agent.serviceType !== 'websocket') return;
  throw new Error(
    `${toolName} cannot publish or update an external websocket provider directly. ` +
      'Use publish_openclaw_a2a_service for OpenClaw so the CLI first inspects the local gateway and configures the standard A2A plugin, generic skill router, MOMOAI adapter, and relay credentials. ' +
      'For an already-public external A2A endpoint, use service_type=funnel with provider_url instead.'
  );
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
      return await exploreAgents(String(args.query || ''), Number(args.limit || 10), options.authToken, {
        scope: args.scope === 'capability' ? 'capability' : 'agent',
        inputMode: typeof args.input_mode === 'string' ? args.input_mode : typeof args.inputMode === 'string' ? args.inputMode : undefined,
        outputMode: typeof args.output_mode === 'string' ? args.output_mode : typeof args.outputMode === 'string' ? args.outputMode : undefined,
        maxFixedTokens: args.max_fixed_tokens === undefined ? undefined : Number(args.max_fixed_tokens),
        onlineOnly: args.online_only === undefined ? undefined : Boolean(args.online_only),
        agentId: args.agent_id === undefined ? undefined : intArg(args, 'agent_id')
      });
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
    if (name === 'list_local_agent_profiles') {
      return listLocalAgentProfiles();
    }
    if (name === 'inspect_openclaw_a2a_stack') {
      const profile = typeof args.profile === 'string' && args.profile.trim() ? normalizeProfileName(args.profile) || args.profile.trim() : 'openclaw';
      return await inspectOpenClawA2aStack({
        openclawBin: typeof args.openclaw_bin === 'string' ? args.openclaw_bin : undefined,
        gatewayBaseUrl: typeof args.gateway_base_url === 'string' ? args.gateway_base_url : undefined,
        serviceType: normalizeAgentServiceType(args.service_type || args.serviceType || 'websocket'),
        serviceId: typeof args.service_id === 'string' ? args.service_id : profile,
        upstreamPath: typeof args.upstream_path === 'string' ? args.upstream_path : undefined,
        protectedPath: typeof args.protected_path === 'string' ? args.protected_path : undefined,
        agentCardPath: typeof args.agent_card_path === 'string' ? args.agent_card_path : undefined,
        marketPath: typeof args.market_path === 'string' ? args.market_path : undefined,
        oasfPath: typeof args.oasf_path === 'string' ? args.oasf_path : undefined
      });
    }
    if (name === 'call_platform_agent') {
      return await callPlatformAgent(intArg(args, 'agent_id'), String(args.content || ''), options.authToken, {
        capabilityId: typeof args.capability_id === 'string' ? args.capability_id : typeof args.capabilityId === 'string' ? args.capabilityId : undefined,
        outputMode: typeof args.output_mode === 'string' ? args.output_mode : typeof args.outputMode === 'string' ? args.outputMode : undefined,
        contextId: typeof args.context_id === 'string' ? args.context_id : typeof args.contextId === 'string' ? args.contextId : undefined,
        showPlan: args.show_plan === undefined && args.showPlan === undefined ? undefined : Boolean(args.show_plan ?? args.showPlan)
      });
    }
    if (name === 'publish_local_agent_listing') {
      const agent = agentForTool(args);
      rejectExternalWebsocketGenericListing(agent, name);
      validateBillableCapabilities(agent);
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
      rejectExternalWebsocketGenericListing(agent, name);
      validateBillableCapabilities(agent);
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
    if (name === 'publish_openclaw_a2a_service') {
      const serviceType = normalizeAgentServiceType(args.service_type || args.serviceType || 'websocket');
      return await publishOpenClawA2aService({
        profile: typeof args.profile === 'string' ? args.profile : undefined,
        name: typeof args.name === 'string' ? args.name : undefined,
        description: typeof args.description === 'string' ? args.description : undefined,
        agentId: args.agent_id === undefined ? undefined : intArg(args, 'agent_id'),
        serviceType,
        providerUrl: typeof args.provider_url === 'string' ? args.provider_url : typeof args.providerUrl === 'string' ? args.providerUrl : undefined,
        price: args.price === undefined ? undefined : numberArg(args, 'price'),
        availableTokens: args.available_tokens === undefined ? undefined : numberArg(args, 'available_tokens'),
        public: args.public === true,
        restart: args.restart === undefined ? true : Boolean(args.restart),
        gatewayBaseUrl: typeof args.gateway_base_url === 'string' ? args.gateway_base_url : undefined,
        openclawBin: typeof args.openclaw_bin === 'string' ? args.openclaw_bin : undefined,
        standardPluginSource: typeof args.standard_plugin_source === 'string' ? args.standard_plugin_source : undefined,
        skipStandardPlugin: args.skip_standard_plugin === true,
        serviceId: typeof args.service_id === 'string' ? args.service_id : undefined,
        upstreamPath: typeof args.upstream_path === 'string' ? args.upstream_path : undefined,
        protectedPath: typeof args.protected_path === 'string' ? args.protected_path : undefined,
        agentCardPath: typeof args.agent_card_path === 'string' ? args.agent_card_path : undefined,
        marketPath: typeof args.market_path === 'string' ? args.market_path : undefined,
        oasfPath: typeof args.oasf_path === 'string' ? args.oasf_path : undefined,
        requirePlatformAuth: args.require_platform_auth === undefined ? true : Boolean(args.require_platform_auth),
        forwardAuthorization: args.forward_authorization === true,
        capabilities: normalizeOpenClawCapabilityList(args.capabilities),
        authToken: options.authToken
      });
    }
    if (name === 'install_openclaw_a2a_plugin' || name === 'prepare_openclaw_a2a_market_service') {
      const serviceType = normalizeAgentServiceType(args.service_type || args.serviceType || 'websocket');
      const agent = {
        ...agentForTool({
          ...args,
          service_type: serviceType,
          provider_runtime: 'external'
        }),
        providerRuntime: 'external' as const,
        serviceType
      };
      validateBillableCapabilities(agent);
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
        serviceType: agent.serviceType,
        requirePlatformAuth: args.require_platform_auth === undefined ? true : Boolean(args.require_platform_auth),
        forwardAuthorization: args.forward_authorization === true,
        restart: args.restart === true
      });
      saveToolAgent(agent);
      return result;
    }
    if (name === 'expose_agent_with_tailscale_funnel') {
      const agent = agentForTool({
        ...args,
        service_type: 'funnel',
        provider_runtime: args.kind === 'openclaw' || args.kind === 'custom' ? 'external' : 'cli'
      });
      const result = await exposeViaTailscaleFunnel(agent, {
        kind: args.kind === 'openclaw' || args.kind === 'custom' ? args.kind : 'cli',
        localBaseUrl: typeof args.local_base_url === 'string' ? args.local_base_url : undefined,
        hostname: typeof args.hostname === 'string' ? args.hostname : undefined,
        httpsPort: args.https_port === undefined ? undefined : Number(args.https_port),
        serviceId: typeof args.service_id === 'string' ? args.service_id : undefined,
        providerPath: typeof args.provider_path === 'string' ? args.provider_path : undefined,
        upstreamPath: typeof args.upstream_path === 'string' ? args.upstream_path : undefined,
        agentCardPath: typeof args.agent_card_path === 'string' ? args.agent_card_path : undefined,
        marketPath: typeof args.market_path === 'string' ? args.market_path : undefined,
        oasfPath: typeof args.oasf_path === 'string' ? args.oasf_path : undefined,
        paths: Array.isArray(args.paths) ? args.paths.map(String) : undefined,
        includeStandard: args.include_standard === true,
        disable: args.disable === true,
        dryRun: args.dry_run === true
      });
      if (result.providerUrl && !result.disabled) {
        agent.providerUrl = result.providerUrl;
        saveToolAgent(agent);
      }
      return result;
    }
    return { error: `Unknown tool: ${name}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
