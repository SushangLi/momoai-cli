import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type AgentMode = 'local' | 'remote_service';
export type AgentServiceType = 'websocket' | 'funnel';
export type AgentProviderRuntime = 'cli' | 'external';

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  fixedTokens?: number;
  enabled?: boolean;
}

export interface AgentListingConfig {
  price?: number;
  availableTokens?: number;
  isDelisted?: boolean;
}

export interface AgentInstanceConfig {
  mode?: AgentMode;
  serviceType?: AgentServiceType;
  providerUrl?: string;
  providerRuntime?: AgentProviderRuntime;
  name?: string;
  description?: string;
  version?: string;
  host?: string;
  port?: number;
  agentId?: number;
  capabilities?: AgentCapability[];
  listing?: AgentListingConfig;
}

export interface ResolvedAgentConfig {
  profile: string;
  mode: AgentMode;
  serviceType: AgentServiceType;
  providerUrl?: string;
  providerRuntime: AgentProviderRuntime;
  name: string;
  description: string;
  version: string;
  host: string;
  port: number;
  agentId?: number;
  capabilities: AgentCapability[];
  listing: Required<AgentListingConfig>;
}

export interface CliConfig {
  apiUrl: string;
  model: string;
  defaultModels: string[];
  permissionMode: 'part' | 'full';
  agent: Omit<ResolvedAgentConfig, 'profile' | 'listing'> & { listing?: AgentListingConfig };
  agentProfiles?: Record<string, AgentInstanceConfig>;
  memory: {
    path?: string;
    contextTokenLimit: number;
    recentTokenBudget: number;
  };
  account?: {
    email: string;
    username: string;
    password: string;
    momoKey: string;
    createdAt: string;
  };
  pendingRegistration?: {
    email: string;
    username: string;
    password: string;
    createdAt: string;
  };
}

const configPath = join(homedir(), '.momoai-cli', 'config.json');
const defaultCapabilities: AgentCapability[] = [
  {
    id: 'general_task',
    name: 'General task',
    description: 'Plan and complete a general command-line agent task with MOMOAI tools and memory.',
    fixedTokens: 1000,
    enabled: true
  },
  {
    id: 'market_trading',
    name: 'Market trading',
    description: 'Use MOMOAI market tools to discover, buy, sell, and call agents with the objective of profitable token trading.',
    fixedTokens: 2000,
    enabled: true
  }
];

const defaultListing: Required<AgentListingConfig> = {
  price: 10,
  availableTokens: 1_000_000,
  isDelisted: true
};

const defaultConfig: CliConfig = {
  apiUrl: 'https://momoai.pro',
  model: 'momo_237',
  defaultModels: ['momo_237'],
  permissionMode: 'part',
  agent: {
    mode: 'local',
    serviceType: 'websocket',
    providerRuntime: 'cli',
    name: 'MOMOAI CLI Agent',
    description: 'A MOMOAI command-line agent with market tools, ReAct planning, A2A communication, and layered memory.',
    version: '0.1.0',
    host: '127.0.0.1',
    port: 41241,
    capabilities: defaultCapabilities,
    listing: defaultListing
  },
  memory: {
    contextTokenLimit: 200_000,
    recentTokenBudget: 20_000
  }
};

function readStoredConfig(): Partial<CliConfig> {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as Partial<CliConfig>;
  } catch {
    return {};
  }
}

type LegacyConfig = Partial<CliConfig> & { momoKey?: string };

function normalizeAgentMode(value: unknown): AgentMode {
  if (value === undefined || value === null || value === '') return 'local';
  if (value === 'local' || value === 'remote_service') return value;
  throw new Error('Invalid agent mode. Use local or remote_service.');
}

export function normalizeAgentServiceType(value: unknown): AgentServiceType {
  if (value === undefined || value === null || value === '') return 'websocket';
  if (value === 'websocket' || value === 'funnel') return value;
  if (value === 'polling') return 'websocket';
  if (value === 'http') return 'funnel';
  throw new Error('Invalid agent service type. Use websocket or funnel.');
}

export function normalizeAgentProviderRuntime(value: unknown): AgentProviderRuntime {
  if (value === undefined || value === null || value === '') return 'cli';
  if (value === 'cli' || value === 'external') return value;
  throw new Error('Invalid agent provider runtime. Use cli or external.');
}

function normalizeAgentDescription(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const legacyMarketLabel = ['market', 'place'].join('');
  return value
    .replace(new RegExp(`${legacyMarketLabel} tools`, 'gi'), 'MOMOAI market tools')
    .replace(new RegExp(legacyMarketLabel, 'gi'), 'MOMOAI market');
}

function parseCapabilities(value: string | undefined): AgentCapability[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .map((capability) => ({
        id: String(capability.id || capability.capability_id || capability.capabilityId || '').trim(),
        name: String(capability.name || capability.id || capability.capability_id || capability.capabilityId || '').trim(),
        description: String(capability.description || '').trim(),
        fixedTokens: capability.fixedTokens === undefined && capability.fixed_tokens === undefined
          ? undefined
          : Number(capability.fixedTokens ?? capability.fixed_tokens),
        enabled: capability.enabled === undefined ? true : Boolean(capability.enabled)
      }))
      .filter((capability) => capability.id && capability.name);
  } catch {
    return undefined;
  }
}

function normalizeCapabilities(value: unknown): AgentCapability[] {
  const capabilities = Array.isArray(value) ? value : [];
  const normalized = capabilities
    .map((capability: any) => ({
      id: String(capability?.id || capability?.capability_id || capability?.capabilityId || '').trim(),
      name: String(capability?.name || capability?.id || capability?.capability_id || capability?.capabilityId || '').trim(),
      description: String(capability?.description || '').trim(),
      fixedTokens: capability?.fixedTokens === undefined && capability?.fixed_tokens === undefined
        ? undefined
        : Number(capability.fixedTokens ?? capability.fixed_tokens),
      enabled: capability?.enabled === undefined ? true : Boolean(capability.enabled)
    }))
    .filter((capability) => capability.id && capability.name);

  return normalized.length ? normalized : defaultCapabilities;
}

function normalizeListing(value: unknown): Required<AgentListingConfig> {
  const listing = value && typeof value === 'object' ? value as AgentListingConfig : {};
  const price = Number(listing.price ?? defaultListing.price);
  const availableTokens = Number(listing.availableTokens ?? defaultListing.availableTokens);
  return {
    price: Number.isFinite(price) && price >= 0 ? price : defaultListing.price,
    availableTokens: Number.isFinite(availableTokens) && availableTokens >= 0 ? Math.floor(availableTokens) : defaultListing.availableTokens,
    isDelisted: listing.isDelisted === undefined ? defaultListing.isDelisted : Boolean(listing.isDelisted)
  };
}

function normalizeAgentInstance(value: unknown): AgentInstanceConfig {
  const agent = value && typeof value === 'object' ? value as AgentInstanceConfig : {};
  return {
    ...(agent.mode === undefined ? {} : { mode: normalizeAgentMode(agent.mode) }),
    ...(agent.serviceType === undefined ? {} : { serviceType: normalizeAgentServiceType(agent.serviceType) }),
    ...(typeof agent.providerUrl === 'string' && agent.providerUrl.trim() ? { providerUrl: agent.providerUrl.trim().replace(/\/$/, '') } : {}),
    ...(agent.providerRuntime === undefined ? {} : { providerRuntime: normalizeAgentProviderRuntime(agent.providerRuntime) }),
    ...(typeof agent.name === 'string' && agent.name.trim() ? { name: agent.name.trim() } : {}),
    ...(typeof agent.description === 'string' && agent.description.trim() ? { description: normalizeAgentDescription(agent.description) || agent.description.trim() } : {}),
    ...(typeof agent.version === 'string' && agent.version.trim() ? { version: agent.version.trim() } : {}),
    ...(typeof agent.host === 'string' && agent.host.trim() ? { host: agent.host.trim() } : {}),
    ...(agent.port === undefined ? {} : { port: Number(agent.port) }),
    ...(agent.agentId === undefined ? {} : { agentId: Number(agent.agentId) }),
    ...(agent.capabilities === undefined ? {} : { capabilities: normalizeCapabilities(agent.capabilities) }),
    ...(agent.listing === undefined ? {} : { listing: normalizeListing(agent.listing) })
  };
}

function normalizeAgentProfiles(value: unknown): Record<string, AgentInstanceConfig> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const profiles: Record<string, AgentInstanceConfig> = {};
  for (const [rawName, rawProfile] of Object.entries(value as Record<string, unknown>)) {
    const name = normalizeProfileName(rawName);
    if (!name || name === 'default') continue;
    profiles[name] = normalizeAgentInstance(rawProfile);
  }
  return Object.keys(profiles).length ? profiles : undefined;
}

export function normalizeProfileName(value: unknown) {
  const name = String(value || '').trim();
  if (!name) return undefined;
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
    throw new Error('Agent profile must be 1-64 characters: letters, numbers, underscore, dot, or dash.');
  }
  return name;
}

function buildBaseAgent(storedAgent: Partial<CliConfig['agent']> | undefined): CliConfig['agent'] {
  return {
    ...defaultConfig.agent,
    ...(storedAgent || {}),
    mode: normalizeAgentMode(process.env.MOMOAI_AGENT_MODE || storedAgent?.mode || defaultConfig.agent.mode),
    serviceType: normalizeAgentServiceType(process.env.MOMOAI_AGENT_SERVICE_TYPE || storedAgent?.serviceType || defaultConfig.agent.serviceType),
    providerUrl: (process.env.MOMOAI_AGENT_PROVIDER_URL || storedAgent?.providerUrl || '').replace(/\/$/, '') || undefined,
    providerRuntime: normalizeAgentProviderRuntime(process.env.MOMOAI_AGENT_PROVIDER_RUNTIME || storedAgent?.providerRuntime || defaultConfig.agent.providerRuntime),
    description: normalizeAgentDescription(storedAgent?.description) || defaultConfig.agent.description,
    host: process.env.MOMOAI_AGENT_HOST || storedAgent?.host || defaultConfig.agent.host,
    port: Number(process.env.MOMOAI_AGENT_PORT || storedAgent?.port || defaultConfig.agent.port),
    agentId: process.env.MOMOAI_AGENT_ID
      ? Number(process.env.MOMOAI_AGENT_ID)
      : storedAgent?.agentId,
    capabilities: normalizeCapabilities(parseCapabilities(process.env.MOMOAI_AGENT_CAPABILITIES) || storedAgent?.capabilities || defaultConfig.agent.capabilities),
    listing: normalizeListing(storedAgent?.listing)
  };
}

export function loadConfig(): CliConfig {
  const stored = readStoredConfig() as LegacyConfig;
  const envMomoKey = process.env.MOMOAI_KEY;
  const legacyMomoKey = stored.momoKey;
  const account = stored.account || (envMomoKey || legacyMomoKey
    ? {
        email: '',
        username: '',
        password: '',
        momoKey: envMomoKey || legacyMomoKey || '',
        createdAt: ''
      }
    : undefined);

  const agent = buildBaseAgent(stored.agent);

  return {
    apiUrl: (process.env.MOMOAI_API_URL || stored.apiUrl || defaultConfig.apiUrl).replace(/\/$/, ''),
    model: stored.model || defaultConfig.model,
    defaultModels: stored.defaultModels?.length ? stored.defaultModels : defaultConfig.defaultModels,
    permissionMode: stored.permissionMode === 'full' ? 'full' : defaultConfig.permissionMode,
    agent,
    agentProfiles: normalizeAgentProfiles(stored.agentProfiles),
    memory: {
      ...defaultConfig.memory,
      ...(stored.memory || {}),
      path: process.env.MOMOAI_MEMORY_PATH || stored.memory?.path,
      contextTokenLimit: Number(process.env.MOMOAI_CONTEXT_TOKEN_LIMIT || stored.memory?.contextTokenLimit || defaultConfig.memory.contextTokenLimit),
      recentTokenBudget: Number(process.env.MOMOAI_RECENT_TOKEN_BUDGET || stored.memory?.recentTokenBudget || defaultConfig.memory.recentTokenBudget)
    },
    account,
    pendingRegistration: stored.pendingRegistration
  };
}

export function saveConfig(next: Partial<CliConfig>): CliConfig {
  const current = readStoredConfig() as LegacyConfig;
  const { momoKey: _legacyMomoKey, ...currentWithoutLegacy } = current;
  const merged = {
    ...currentWithoutLegacy,
    ...next
  };

  if (merged.apiUrl) {
    merged.apiUrl = merged.apiUrl.replace(/\/$/, '');
  }
  if (!merged.model) {
    merged.model = defaultConfig.model;
  }
  if (!merged.defaultModels?.length) {
    merged.defaultModels = defaultConfig.defaultModels;
  }
  if (merged.permissionMode !== 'full') {
    merged.permissionMode = defaultConfig.permissionMode;
  }
  merged.agent = {
    ...defaultConfig.agent,
    ...(merged.agent || {}),
    mode: normalizeAgentMode(merged.agent?.mode),
    serviceType: normalizeAgentServiceType(merged.agent?.serviceType),
    providerUrl: merged.agent?.providerUrl?.replace(/\/$/, ''),
    providerRuntime: normalizeAgentProviderRuntime(merged.agent?.providerRuntime),
    capabilities: normalizeCapabilities(merged.agent?.capabilities),
    listing: normalizeListing(merged.agent?.listing)
  };
  merged.agentProfiles = normalizeAgentProfiles(merged.agentProfiles);
  merged.memory = {
    ...defaultConfig.memory,
    ...(merged.memory || {})
  };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  return loadConfig();
}

export function getConfigPath() {
  return configPath;
}

export function resolveAgentConfig(config: CliConfig, profileName?: string): ResolvedAgentConfig {
  const envProfile = process.env.MOMOAI_AGENT_PROFILE;
  const normalizedProfile = normalizeProfileName(profileName || envProfile || 'default') || 'default';
  const base = config.agent;
  if (normalizedProfile === 'default') {
    return {
      profile: 'default',
      ...base,
      listing: normalizeListing(base.listing)
    };
  }

  const profile = config.agentProfiles?.[normalizedProfile];
  if (!profile) {
    throw new Error(`Agent profile '${normalizedProfile}' is not configured. Publish it or set it first.`);
  }

  return {
    profile: normalizedProfile,
    mode: normalizeAgentMode(profile.mode || base.mode),
    serviceType: normalizeAgentServiceType(profile.serviceType || base.serviceType),
    providerUrl: profile.providerUrl || base.providerUrl,
    providerRuntime: normalizeAgentProviderRuntime(profile.providerRuntime || base.providerRuntime),
    name: profile.name || base.name,
    description: normalizeAgentDescription(profile.description) || base.description,
    version: profile.version || base.version,
    host: profile.host || base.host,
    port: Number(profile.port || base.port),
    agentId: profile.agentId || base.agentId,
    capabilities: normalizeCapabilities(profile.capabilities || base.capabilities),
    listing: normalizeListing(profile.listing || base.listing)
  };
}

export function saveAgentProfile(profileName: string | undefined, updates: AgentInstanceConfig): CliConfig {
  const normalizedProfile = normalizeProfileName(profileName || 'default') || 'default';
  const current = readStoredConfig() as LegacyConfig;

  if (normalizedProfile === 'default') {
    return saveConfig({
      agent: {
        ...(current.agent || {}),
        ...updates,
        capabilities: updates.capabilities || current.agent?.capabilities,
        listing: {
          ...(current.agent?.listing || {}),
          ...(updates.listing || {})
        }
      } as CliConfig['agent']
    });
  }

  const profiles = {
    ...(current.agentProfiles || {})
  };
  profiles[normalizedProfile] = {
    ...(profiles[normalizedProfile] || {}),
    ...updates,
    capabilities: updates.capabilities || profiles[normalizedProfile]?.capabilities,
    listing: {
      ...(profiles[normalizedProfile]?.listing || {}),
      ...(updates.listing || {})
    }
  };

  return saveConfig({ agentProfiles: profiles });
}
