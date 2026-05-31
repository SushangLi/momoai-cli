import { loadConfig, normalizeAgentServiceType, normalizeCapabilitySkill, normalizeProfileName, resolveAgentConfig, saveAgentProfile } from '../config.js';
import { MomoClient } from '../client.js';
import { publishLocalAgentListing, updateLocalAgentListing } from '../services.js';
import { inspectOpenClawA2aStack, installOpenClawA2a } from './openclaw.js';
import type { AgentCapability, AgentMode, AgentProviderRuntime, AgentServiceType, ResolvedAgentConfig } from '../config.js';

export interface PublishOpenClawA2aServiceOptions {
  profile?: string;
  name?: string;
  description?: string;
  agentId?: number;
  serviceType?: AgentServiceType;
  providerUrl?: string;
  price?: number;
  availableTokens?: number;
  public?: boolean;
  restart?: boolean;
  gatewayBaseUrl?: string;
  openclawBin?: string;
  standardPluginSource?: string;
  skipStandardPlugin?: boolean;
  serviceId?: string;
  upstreamPath?: string;
  protectedPath?: string;
  agentCardPath?: string;
  marketPath?: string;
  oasfPath?: string;
  requirePlatformAuth?: boolean;
  forwardAuthorization?: boolean;
  capabilities?: AgentCapability[];
  authToken?: string;
}

function localProfile(profileName?: string): ResolvedAgentConfig {
  const config = loadConfig();
  const profile = normalizeProfileName(profileName) || 'openclaw';
  try {
    return resolveAgentConfig(config, profile);
  } catch {
    return {
      ...resolveAgentConfig(config),
      profile
    };
  }
}

export function listLocalAgentProfiles() {
  const config = loadConfig();
  return [
    resolveAgentConfig(config),
    ...Object.keys(config.agentProfiles || {}).map((name) => resolveAgentConfig(config, name))
  ].map(localAgentProfilePayload);
}

function localAgentProfilePayload(agent: ResolvedAgentConfig) {
  return {
    profile: agent.profile,
    agent_id: agent.agentId || '',
    mode: agent.mode,
    service_type: agent.serviceType,
    provider_runtime: agent.providerRuntime,
    provider_executor: agent.providerExecutor || '',
    provider_executor_options: agent.providerExecutorOptions || {},
    provider_url: agent.providerUrl || '',
    name: agent.name,
    description: agent.description,
    version: agent.version,
    host: agent.host,
    port: agent.port,
    listing: {
      price: agent.listing.price,
      available_tokens: agent.listing.availableTokens,
      delisted: agent.listing.isDelisted
    },
    capabilities: agent.capabilities.map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description || '',
      fixed_tokens: capability.fixedTokens,
      enabled: capability.enabled !== false,
      input_modes: capability.inputModes || ['text/plain', 'application/json'],
      output_modes: capability.outputModes || ['text/plain'],
      ...(capability.formatContract ? { format_contract: capability.formatContract } : {}),
      ...(capability.handler ? { handler: capability.handler } : {}),
      ...(capability.skill ? {
        skill: {
          id: capability.skill.id,
          ...(capability.skill.name ? { name: capability.skill.name } : {}),
          ...(capability.skill.description ? { description: capability.skill.description } : {}),
          instructions: capability.skill.instructions,
          ...(capability.skill.handler ? { handler: capability.skill.handler } : {})
        }
      } : {})
    }))
  };
}

export function normalizeOpenClawCapabilityList(value: unknown): AgentCapability[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('capabilities must be an array');
  const capabilities = value.map((capability: any) => ({
    id: String(capability.id || capability.capability_id || capability.capabilityId || '').trim(),
    name: String(capability.name || capability.id || capability.capability_id || capability.capabilityId || '').trim(),
    description: String(capability.description || '').trim(),
    fixedTokens: capability.fixedTokens === undefined && capability.fixed_tokens === undefined
      ? undefined
      : Number(capability.fixedTokens ?? capability.fixed_tokens),
    enabled: capability.enabled === undefined ? true : Boolean(capability.enabled),
    inputModes: normalizeModes(capability.inputModes || capability.input_modes),
    outputModes: normalizeModes(capability.outputModes || capability.output_modes),
    formatContract: isRecord(capability.formatContract || capability.format_contract)
      ? capability.formatContract || capability.format_contract
      : undefined,
    handler: capability.handler || capability.localHandler || capability.local_handler,
    ...(capability.pluginId || capability.plugin_id ? { pluginId: capability.pluginId || capability.plugin_id } : {}),
    ...(capability.pluginSource || capability.plugin_source ? { pluginSource: capability.pluginSource || capability.plugin_source } : {}),
    skill: normalizeCapabilitySkill(capability)
  })).filter((capability) => capability.id && capability.name);
  if (!capabilities.length) throw new Error('capabilities must include at least one item with id and name');
  return capabilities;
}

function normalizeModes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const modes = [...new Set(value.map((mode) => String(mode || '').trim()).filter(Boolean))];
  return modes.length ? modes : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function activeCapabilities(agent: ResolvedAgentConfig) {
  return agent.capabilities.filter((capability) => capability.enabled !== false);
}

export function validateGenericOpenClawCapabilities(agent: ResolvedAgentConfig) {
  const active = activeCapabilities(agent);
  if (!active.length) {
    throw new Error('OpenClaw publishing requires at least one enabled capability.');
  }

  const invalidPrice = active.filter((capability) => !Number.isFinite(Number(capability.fixedTokens)) || Number(capability.fixedTokens) <= 0);
  if (invalidPrice.length) {
    throw new Error(`OpenClaw capabilities require positive fixedTokens: ${invalidPrice.map((capability) => capability.id).join(', ')}`);
  }

  const unbound = active.filter((capability) => !capability.skill?.id || !capability.skill.instructions?.trim());
  if (unbound.length) {
    throw new Error(`OpenClaw capabilities require a local skill binding with instructions: ${unbound.map((capability) => capability.id).join(', ')}`);
  }

  const withPluginHandlers = active.filter((capability) =>
    capability.handler ||
    capability.skill?.handler ||
    (capability as any).pluginId ||
    (capability as any).pluginSource
  );
  if (withPluginHandlers.length) {
    throw new Error(`OpenClaw publishing uses the generic skill router only. Remove handler/plugin fields from: ${withPluginHandlers.map((capability) => capability.id).join(', ')}`);
  }
}

function saveOpenClawProfile(agent: ResolvedAgentConfig) {
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

async function providerStatus(agentId: number, authToken?: string) {
  try {
    const response = await new MomoClient().request<any>(`/a2a/agents/${agentId}`, {
      authToken,
      query: { format: 'market' }
    });
    const market = response.momoai_market || response;
    return {
      online: Boolean(market.online ?? market.provider?.online),
      service_type: market.service_type || market.serviceType || market.provider?.service_type
    };
  } catch (error) {
    return {
      online: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function waitForProviderOnline(agentId: number, authToken?: string, timeoutMs = 5000) {
  const start = Date.now();
  let latest = await providerStatus(agentId, authToken);
  while (!latest.online && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    latest = await providerStatus(agentId, authToken);
  }
  return latest;
}

export async function publishOpenClawA2aService(options: PublishOpenClawA2aServiceOptions) {
  const profile = normalizeProfileName(options.profile) || 'openclaw';
  const baseAgent = localProfile(profile);
  const capabilities = options.capabilities;
  if (!capabilities) {
    throw new Error('publish_openclaw_a2a_service requires explicit capabilities. Do not infer OpenClaw capabilities.');
  }

  const serviceType = normalizeAgentServiceType(options.serviceType || baseAgent.serviceType || 'websocket');
  const agent: ResolvedAgentConfig = {
    ...baseAgent,
    profile,
    mode: 'remote_service' as AgentMode,
    providerRuntime: 'external' as AgentProviderRuntime,
    serviceType,
    ...(options.providerUrl ? { providerUrl: options.providerUrl.trim().replace(/\/$/, '') } : {}),
    ...(options.name ? { name: options.name } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(options.agentId ? { agentId: options.agentId } : {}),
    capabilities,
    listing: {
      ...baseAgent.listing,
      ...(options.price === undefined ? {} : { price: options.price }),
      ...(options.availableTokens === undefined ? {} : { availableTokens: Math.floor(options.availableTokens) }),
      isDelisted: true
    }
  };
  validateGenericOpenClawCapabilities(agent);

  const preflight = await inspectOpenClawA2aStack({
    openclawBin: options.openclawBin,
    gatewayBaseUrl: options.gatewayBaseUrl,
    serviceType,
    serviceId: options.serviceId || profile,
    upstreamPath: options.upstreamPath,
    protectedPath: options.protectedPath,
    agentCardPath: options.agentCardPath,
    marketPath: options.marketPath,
    oasfPath: options.oasfPath
  });
  if (options.skipStandardPlugin && preflight.requirements.standardA2a !== 'satisfied') {
    throw new Error('Cannot publish with skip_standard_plugin=true: local inspection did not find a working standard A2A endpoint for this OpenClaw service.');
  }

  let listing: any;
  const warnings: string[] = [];
  if (!agent.agentId) {
    listing = await publishLocalAgentListing(agent, {
      name: agent.name,
      description: agent.description,
      price: agent.listing.price,
      availableTokens: agent.listing.availableTokens
    }, options.authToken);
    agent.agentId = Number(listing.agent_id || listing.agentId);
  } else {
    listing = await updateLocalAgentListing(agent, {
      agentId: agent.agentId,
      name: agent.name,
      description: agent.description,
      price: agent.listing.price,
      availableTokens: agent.listing.availableTokens,
      isDelisted: true
    }, options.authToken);
  }

  saveOpenClawProfile(agent);

  const install = await installOpenClawA2a(agent, {
    openclawBin: options.openclawBin,
    gatewayBaseUrl: options.gatewayBaseUrl,
    standardPluginSource: options.standardPluginSource,
    skipStandardPlugin: options.skipStandardPlugin,
    serviceId: options.serviceId || profile,
    upstreamPath: options.upstreamPath,
    protectedPath: options.protectedPath,
    agentCardPath: options.agentCardPath,
    marketPath: options.marketPath,
    oasfPath: options.oasfPath,
    providerUrl: agent.providerUrl,
    serviceType,
    requirePlatformAuth: options.requirePlatformAuth ?? true,
    forwardAuthorization: options.forwardAuthorization ?? false,
    restart: options.restart ?? true
  });

  const status = agent.agentId
    ? await waitForProviderOnline(agent.agentId, options.authToken)
    : { online: false };
  let published = false;
  let finalListing = listing;

  if (options.public === true) {
    if (status.online) {
      finalListing = await updateLocalAgentListing(agent, {
        agentId: agent.agentId,
        name: agent.name,
        description: agent.description,
        price: agent.listing.price,
        availableTokens: agent.listing.availableTokens,
        isDelisted: false
      }, options.authToken);
      agent.listing.isDelisted = false;
      published = true;
    } else {
      warnings.push('Provider is not online yet; listing remains delisted. Restart OpenClaw or wait for the MOMOAI adapter relay connection, then publish again with public=true.');
    }
  }

  saveOpenClawProfile(agent);

  return {
    agent_id: agent.agentId,
    profile: agent.profile,
    service_type: agent.serviceType,
    provider_runtime: agent.providerRuntime,
    standard_a2a_url: install.localStandardA2aUrl,
    protected_provider_url: install.localProtectedProviderUrl,
    agent_card_url: install.localAgentCardUrl,
    market_card_url: install.localMarketCardUrl,
    provider_node: install.providerRegistration?.node_id,
    relay_url: install.providerRegistration?.relay_url,
    provider_online: status.online,
    provider_status: status,
    published,
    delisted: agent.listing.isDelisted,
    capabilities: activeCapabilities(agent).map((capability) => ({
      id: capability.id,
      name: capability.name,
      fixedTokens: capability.fixedTokens,
      inputModes: capability.inputModes || ['text/plain', 'application/json'],
      outputModes: capability.outputModes || ['text/plain']
    })),
    install,
    preflight,
    listing: finalListing,
    warnings
  };
}
