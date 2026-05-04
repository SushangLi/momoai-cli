import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CliConfig {
  apiUrl: string;
  model: string;
  defaultModels: string[];
  permissionMode: 'part' | 'full';
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
const defaultConfig: CliConfig = {
  apiUrl: 'https://hub.momoai.pro',
  model: 'momo_237',
  defaultModels: ['momo_237'],
  permissionMode: 'part'
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

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  return loadConfig();
}

export function getConfigPath() {
  return configPath;
}
