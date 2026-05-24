import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MomoClient } from '../client.js';
import { buildAgentCard, buildOasfRecord } from './card.js';
import type { AgentServiceType, ResolvedAgentConfig } from '../config.js';

interface InstallOpenClawA2aOptions {
  openclawBin?: string;
  gatewayBaseUrl?: string;
  standardPluginSource?: string;
  skipStandardPlugin?: boolean;
  serviceId?: string;
  upstreamPath?: string;
  protectedPath?: string;
  agentCardPath?: string;
  marketPath?: string;
  oasfPath?: string;
  providerUrl?: string;
  serviceType?: AgentServiceType;
  requirePlatformAuth?: boolean;
  forwardAuthorization?: boolean;
  restart?: boolean;
}

interface ProviderRegistration {
  provider_token: string;
  node_id: string;
  session_id: string;
  service_type?: AgentServiceType;
  endpoint_url?: string | null;
  relay_url?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface A2aProbeResult {
  baseUrl: string;
  endpointUrl: string;
  agentCardUrl: string;
  cardOk: boolean;
  endpointOk: boolean;
  card?: unknown;
  endpointStatus?: number;
  error?: string;
}

function adapterPluginPath() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'openclaw-plugins', 'momoai-a2a-adapter');
}

function standardA2aPluginPath() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'openclaw-plugins', 'standard-a2a');
}

const DEFAULT_STANDARD_A2A_PLUGIN_SOURCE = process.env.MOMOAI_OPENCLAW_STANDARD_A2A_PLUGIN_SOURCE || standardA2aPluginPath();

function normalizeRoutePath(value: string | undefined, fallback: string) {
  const raw = (value || fallback).trim();
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeBaseUrl(value: string | undefined, fallback = 'http://127.0.0.1:18789') {
  return (value || fallback).trim().replace(/\/$/, '');
}

function sanitizeServiceId(value: string | undefined) {
  const normalized = String(value || 'default')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'default';
}

function execOpenClaw(openclawBin: string, args: string[], stdin?: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = stdin === undefined
      ? execFile(openclawBin, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`${openclawBin} ${args.join(' ')} failed: ${stderr || error.message}`));
            return;
          }
          resolve({ stdout, stderr });
        })
      : spawn(openclawBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    if (stdin !== undefined && 'stdin' in child) {
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`${openclawBin} ${args.join(' ')} failed: ${stderr || `exit ${code}`}`));
      });
      child.stdin?.end(stdin);
    }
  });
}

function marketCapabilityPayload(agent: ResolvedAgentConfig) {
  return agent.capabilities
    .filter((capability) => capability.enabled !== false)
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description || '',
      fixedTokens: Number(capability.fixedTokens || 1000),
      enabled: capability.enabled !== false
    }));
}

function providerCapabilityPayload(agent: ResolvedAgentConfig) {
  return marketCapabilityPayload(agent).map((capability, index) => ({
    ...capability,
    sortOrder: index
  }));
}

function standardA2aSkills(agent: ResolvedAgentConfig) {
  return agent.capabilities
    .filter((capability) => capability.enabled !== false)
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description || '',
      tags: ['momoai', 'openclaw'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain']
    }));
}

function standardA2aPatch(agent: ResolvedAgentConfig, options: {
  serviceId: string;
  upstreamPath: string;
  agentCardPath: string;
}) {
  return {
    plugins: {
      entries: {
        'openclaw-standard-a2a': {
          enabled: true,
          config: {
            services: {
              [options.serviceId]: {
                enabled: true,
                endpointPath: options.upstreamPath,
                agentCardPath: options.agentCardPath,
                name: agent.name,
                description: agent.description,
                version: agent.version,
                skills: standardA2aSkills(agent)
              }
            }
          }
        }
      }
    }
  };
}

function adapterPatch(agent: ResolvedAgentConfig, options: {
  serviceId: string;
  serviceType: AgentServiceType;
  upstreamPath: string;
  protectedPath: string;
  agentCardPath: string;
  marketPath: string;
  oasfPath: string;
  providerUrl?: string;
  providerRegistration?: ProviderRegistration;
  requirePlatformAuth: boolean;
  forwardAuthorization: boolean;
}) {
  return {
    plugins: {
      entries: {
        'momoai-a2a-adapter': {
          enabled: true,
          config: {
            services: {
              [options.serviceId]: {
                enabled: true,
                upstreamPath: options.upstreamPath,
                protectedPath: options.protectedPath,
                agentCardPath: options.agentCardPath,
                marketPath: options.marketPath,
                oasfPath: options.oasfPath,
                name: agent.name,
                description: agent.description,
                version: agent.version,
                momoaiApiUrl: process.env.MOMOAI_API_URL || 'https://momoai.pro',
                ...(agent.agentId ? { momoaiAgentId: agent.agentId } : {}),
                serviceType: options.serviceType,
                ...(options.providerUrl ? { providerUrl: options.providerUrl } : {}),
                ...(options.providerRegistration?.provider_token ? { providerToken: options.providerRegistration.provider_token } : {}),
                ...(options.providerRegistration?.relay_url ? { relayUrl: options.providerRegistration.relay_url } : {}),
                ...(options.providerRegistration?.node_id ? { nodeId: options.providerRegistration.node_id } : {}),
                ...(options.providerRegistration?.session_id ? { sessionId: options.providerRegistration.session_id } : {}),
                requirePlatformAuth: options.requirePlatformAuth,
                forwardAuthorization: options.forwardAuthorization,
                capabilities: marketCapabilityPayload(agent)
              }
            }
          }
        }
      }
    }
  };
}

async function registerOpenClawProvider(agent: ResolvedAgentConfig, options: {
  serviceType: AgentServiceType;
  providerUrl?: string;
}): Promise<ProviderRegistration> {
  const agentId = agent.agentId;
  if (!agentId) throw new Error('OpenClaw provider registration requires --agent-id or a published profile.');
  if (options.serviceType === 'funnel' && !options.providerUrl) {
    throw new Error('OpenClaw funnel registration requires --provider-url <https://.../momoai/a2a/...>.');
  }

  const card = buildAgentCard({ mode: 'remote_service', agentId, agent });
  const oasf = buildOasfRecord({ mode: 'remote_service', agentId, agent });
  const capabilities = providerCapabilityPayload(agent);
  const response = await new MomoClient().request<{ data?: ProviderRegistration } & ProviderRegistration>('/api/a2a/provider/register', {
    body: {
      agent_id: agentId,
      service_type: options.serviceType,
      ...(options.serviceType === 'funnel' ? { provider_url: options.providerUrl } : {}),
      card,
      oasf,
      capabilities,
      market_capabilities: capabilities
    }
  });
  return (response as any).data || response;
}

async function readJson(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { response, json };
}

function looksLikeAgentCard(value: any) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.name === 'string' &&
      typeof value.url === 'string' &&
      Array.isArray(value.skills)
  );
}

function looksLikeJsonRpc(value: any) {
  return Boolean(value && typeof value === 'object' && value.jsonrpc === '2.0' && ('result' in value || 'error' in value));
}

export async function probeA2aEndpoint(options: {
  baseUrl?: string;
  endpointPath?: string;
  agentCardPath?: string;
} = {}): Promise<A2aProbeResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const endpointPath = normalizeRoutePath(options.endpointPath, '/a2a');
  const agentCardPath = normalizeRoutePath(options.agentCardPath, '/.well-known/agent-card.json');
  const endpointUrl = `${baseUrl}${endpointPath}`;
  const agentCardUrl = `${baseUrl}${agentCardPath}`;
  const result: A2aProbeResult = {
    baseUrl,
    endpointUrl,
    agentCardUrl,
    cardOk: false,
    endpointOk: false
  };

  try {
    const card = await readJson(agentCardUrl);
    result.card = card.json;
    result.cardOk = card.response.ok && looksLikeAgentCard(card.json);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'momoai_a2a_probe',
        method: 'tasks/get',
        params: { id: 'momoai_a2a_probe_missing_task' }
      })
    });
    result.endpointStatus = response.status;
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    result.endpointOk = looksLikeJsonRpc(payload);
  } catch (error) {
    result.error = result.error || (error instanceof Error ? error.message : String(error));
  }

  return result;
}

export async function installOpenClawA2a(agent: ResolvedAgentConfig, options: InstallOpenClawA2aOptions = {}) {
  const openclawBin = options.openclawBin || 'openclaw';
  const gatewayBaseUrl = normalizeBaseUrl(options.gatewayBaseUrl);
  const serviceId = sanitizeServiceId(options.serviceId || agent.profile);
  const serviceType = options.serviceType || agent.serviceType || 'websocket';
  const isDefault = serviceId === 'default';
  const upstreamPath = normalizeRoutePath(options.upstreamPath, isDefault ? '/a2a' : `/a2a/${serviceId}`);
  const protectedPath = normalizeRoutePath(options.protectedPath, isDefault ? '/momoai/a2a' : `/momoai/a2a/${serviceId}`);
  const agentCardPath = normalizeRoutePath(options.agentCardPath, isDefault ? '/.well-known/agent-card.json' : `/.well-known/a2a/${serviceId}/agent-card.json`);
  const marketPath = normalizeRoutePath(options.marketPath, isDefault ? '/.well-known/momoai-a2a/market-card.json' : `/.well-known/momoai-a2a/${serviceId}/market-card.json`);
  const oasfPath = normalizeRoutePath(options.oasfPath, isDefault ? '/.well-known/momoai-a2a/oasf-record.json' : `/.well-known/momoai-a2a/${serviceId}/oasf-record.json`);
  const standardPluginSource = options.standardPluginSource || DEFAULT_STANDARD_A2A_PLUGIN_SOURCE;
  const beforeProbe = await probeA2aEndpoint({
    baseUrl: gatewayBaseUrl,
    endpointPath: upstreamPath,
    agentCardPath
  });

  let standardPluginInstalled = false;
  if ((!beforeProbe.cardOk || !beforeProbe.endpointOk) && !options.skipStandardPlugin) {
    if (!standardPluginSource) {
      throw new Error('Standard OpenClaw A2A plugin source is required. Pass --standard-plugin-source or set MOMOAI_OPENCLAW_STANDARD_A2A_PLUGIN_SOURCE.');
    }
    await execOpenClaw(openclawBin, ['plugins', 'install', standardPluginSource, '--force']);
    await execOpenClaw(openclawBin, ['config', 'patch', '--stdin'], `${JSON.stringify(standardA2aPatch(agent, {
      serviceId,
      upstreamPath,
      agentCardPath
    }), null, 2)}\n`);
    standardPluginInstalled = true;
  }

  const adapterRoot = adapterPluginPath();
  const providerRegistration = agent.agentId
    ? await registerOpenClawProvider(agent, {
        serviceType,
        providerUrl: options.providerUrl
      })
    : undefined;

  await access(adapterRoot);
  await execOpenClaw(openclawBin, ['plugins', 'install', adapterRoot, '--force']);
  await execOpenClaw(openclawBin, ['config', 'patch', '--stdin'], `${JSON.stringify(adapterPatch(agent, {
    serviceId,
    serviceType,
    upstreamPath,
    protectedPath,
    agentCardPath,
    marketPath,
    oasfPath,
    providerUrl: options.providerUrl,
    providerRegistration,
    requirePlatformAuth: options.requirePlatformAuth ?? true,
    forwardAuthorization: options.forwardAuthorization ?? false
  }), null, 2)}\n`);

  if (options.restart) {
    await execOpenClaw(openclawBin, ['gateway', 'restart']);
  }

  const afterProbe = options.restart
    ? await probeA2aEndpoint({ baseUrl: gatewayBaseUrl, endpointPath: upstreamPath, agentCardPath })
    : undefined;

  return {
    serviceId,
    standardPluginSource,
    standardPluginInstalled,
    standardA2aWasAlreadyAvailable: beforeProbe.cardOk && beforeProbe.endpointOk,
    beforeProbe,
    afterProbe,
    serviceType,
    providerRegistration,
    upstreamPath,
    protectedPath,
    agentCardPath,
    marketPath,
    oasfPath,
    providerUrl: options.providerUrl,
    localStandardA2aUrl: `${gatewayBaseUrl}${upstreamPath}`,
    localProtectedProviderUrl: `${gatewayBaseUrl}${protectedPath}`,
    localAgentCardUrl: `${gatewayBaseUrl}${agentCardPath}`,
    localMarketCardUrl: `${gatewayBaseUrl}${marketPath}`,
    restarted: Boolean(options.restart)
  };
}
