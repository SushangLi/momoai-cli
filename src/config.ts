import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type AgentMode = 'local' | 'remote_service';

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  fixedTokens?: number;
  enabled?: boolean;
}

export interface CliConfig {
  apiUrl: string;
  model: string;
  defaultModels: string[];
  permissionMode: 'part' | 'full';
  agent: {
    mode: AgentMode;
    name: string;
    description: string;
    version: string;
    host: string;
    port: number;
    agentId?: number;
    capabilities: AgentCapability[];
  };
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

const defaultConfig: CliConfig = {
  apiUrl: 'https://momoai.pro',
  model: 'momo_237',
  defaultModels: ['momo_237'],
  permissionMode: 'part',
  agent: {
    mode: 'local',
    name: 'MOMOAI CLI Agent',
    description: 'A MOMOAI command-line agent with market tools, ReAct planning, A2A communication, and layered memory.',
    version: '0.1.0',
    host: '127.0.0.1',
    port: 41241,
    capabilities: defaultCapabilities
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

  return {
    apiUrl: (process.env.MOMOAI_API_URL || stored.apiUrl || defaultConfig.apiUrl).replace(/\/$/, ''),
    model: stored.model || defaultConfig.model,
    defaultModels: stored.defaultModels?.length ? stored.defaultModels : defaultConfig.defaultModels,
    permissionMode: stored.permissionMode === 'full' ? 'full' : defaultConfig.permissionMode,
    agent: {
      ...defaultConfig.agent,
      ...(stored.agent || {}),
      mode: normalizeAgentMode(process.env.MOMOAI_AGENT_MODE || stored.agent?.mode || defaultConfig.agent.mode),
      description: normalizeAgentDescription(stored.agent?.description) || defaultConfig.agent.description,
      host: process.env.MOMOAI_AGENT_HOST || stored.agent?.host || defaultConfig.agent.host,
      port: Number(process.env.MOMOAI_AGENT_PORT || stored.agent?.port || defaultConfig.agent.port),
      agentId: process.env.MOMOAI_AGENT_ID
        ? Number(process.env.MOMOAI_AGENT_ID)
        : stored.agent?.agentId,
      capabilities: normalizeCapabilities(parseCapabilities(process.env.MOMOAI_AGENT_CAPABILITIES) || stored.agent?.capabilities || defaultConfig.agent.capabilities)
    },
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
    capabilities: normalizeCapabilities(merged.agent?.capabilities)
  };
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
