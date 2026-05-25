import { loadConfig } from '../config.js';
import type { AgentCapability, AgentMode, ResolvedAgentConfig } from '../config.js';

interface AgentCardOptions {
  mode?: AgentMode;
  agentId?: number;
  localBaseUrl?: string;
  agent?: ResolvedAgentConfig;
}

function localA2aUrl(localBaseUrl: string | undefined, agent?: ResolvedAgentConfig) {
  if (localBaseUrl) return `${localBaseUrl.replace(/\/$/, '')}/a2a`;
  const current = agent || loadConfig().agent;
  return `http://${current.host}:${current.port}/a2a`;
}

function localBaseAgentUrl(localBaseUrl: string | undefined, agent?: ResolvedAgentConfig) {
  if (localBaseUrl) return localBaseUrl.replace(/\/$/, '');
  const current = agent || loadConfig().agent;
  return `http://${current.host}:${current.port}`;
}

function remoteServiceUrl(agentId?: number, agent?: ResolvedAgentConfig) {
  const config = loadConfig();
  const id = agentId || agent?.agentId || config.agent.agentId;
  if (!id) {
    throw new Error('remote_service agent card requires --agent-id or MOMOAI_AGENT_ID.');
  }
  return `${config.apiUrl}/a2a/agents/${id}`;
}

function remoteServiceId(agentId?: number, agent?: ResolvedAgentConfig) {
  const config = loadConfig();
  const id = agentId || agent?.agentId || config.agent.agentId;
  if (!id) {
    throw new Error('remote_service card requires --agent-id or MOMOAI_AGENT_ID.');
  }
  return id;
}

function agentCardUrl(mode: AgentMode, localBaseUrl: string | undefined, agentId?: number, agent?: ResolvedAgentConfig) {
  if (mode === 'remote_service') return remoteServiceUrl(agentId, agent);
  return `${localBaseAgentUrl(localBaseUrl, agent)}/.well-known/agent-card.json`;
}

function marketCardUrl(mode: AgentMode, localBaseUrl: string | undefined, agentId?: number, agent?: ResolvedAgentConfig) {
  if (mode === 'remote_service') return remoteServiceUrl(agentId, agent);
  return `${localBaseAgentUrl(localBaseUrl, agent)}/.well-known/momoai-a2a/market-card.json`;
}

function uniqueModes(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const modes = [...new Set(value.map((mode) => String(mode || '').trim()).filter(Boolean))];
  return modes.length ? modes : fallback;
}

function renderCapabilities(capabilities: AgentCapability[]) {
  return capabilities
    .filter((capability) => capability.enabled !== false)
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      tags: ['momoai', 'agent'],
      inputModes: uniqueModes(capability.inputModes, ['text/plain', 'application/json']),
      outputModes: uniqueModes(capability.outputModes, ['text/plain'])
    }));
}

function renderMarketCapabilities(capabilities: AgentCapability[]) {
  return capabilities
    .filter((capability) => capability.enabled !== false)
    .map((capability, index) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      fixedTokens: Number(capability.fixedTokens || 1000),
      enabled: true,
      sortOrder: index,
      inputModes: uniqueModes(capability.inputModes, ['text/plain', 'application/json']),
      outputModes: uniqueModes(capability.outputModes, ['text/plain']),
      ...(capability.formatContract ? { formatContract: capability.formatContract } : {})
    }));
}

export function buildAgentCard(options: AgentCardOptions = {}) {
  const config = loadConfig();
  const agent = options.agent || config.agent;
  const mode = options.mode || agent.mode;
  const url = mode === 'remote_service'
    ? remoteServiceUrl(options.agentId, options.agent)
    : localA2aUrl(options.localBaseUrl, options.agent);
  const baseUrl = mode === 'remote_service'
    ? url
    : localBaseAgentUrl(options.localBaseUrl, options.agent);
  const skills = renderCapabilities(agent.capabilities);
  return {
    name: agent.name,
    description: agent.description,
    version: agent.version,
    url,
    mode,
    preferredTransport: 'JSONRPC',
    protocolVersion: '1.0.0',
    supportedInterfaces: [
      {
        transport: 'JSON-RPC',
        url,
        contentTypes: ['application/json']
      },
      ...(mode === 'local'
        ? [{
            transport: 'HTTP+JSON',
            url: baseUrl,
            contentTypes: ['application/json']
          }]
        : [])
    ],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain'],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true
    },
    ...(mode === 'remote_service'
      ? {
          securitySchemes: {
            platformInvocationJwt: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description: 'Short-lived MOMOAI platform invocation JWT. Remote service calls must be authorized and routed by the MOMOAI platform gateway.'
            }
          },
          security: [{ platformInvocationJwt: [] }]
        }
      : {
          securitySchemes: {},
          security: []
        }),
    skills
  };
}

export function buildMarketCard(options: AgentCardOptions = {}) {
  const config = loadConfig();
  const agent = options.agent || config.agent;
  const serviceId = options.agent?.profile || 'default';
  const mode = options.mode || agent.mode;
  const id = mode === 'remote_service' ? remoteServiceId(options.agentId, options.agent) : agent.agentId;
  const standardEndpoint = mode === 'remote_service'
    ? remoteServiceUrl(options.agentId, options.agent)
    : localA2aUrl(options.localBaseUrl, options.agent);

  return {
    schema_version: 'momoai.a2a.market.v1',
    service_id: serviceId,
    name: agent.name,
    description: agent.description,
    version: agent.version,
    standard_a2a: {
      agent_card_url: agentCardUrl(mode, options.localBaseUrl, options.agentId, options.agent),
      endpoint_url: standardEndpoint,
      transport: 'JSONRPC'
    },
    momoai_market: {
      provider_url: standardEndpoint,
      market_card_url: marketCardUrl(mode, options.localBaseUrl, options.agentId, options.agent),
      api_url: config.apiUrl,
      agent_id: id,
      service_type: agent.serviceType,
      charge_when: 'task_completed',
      capabilities: renderMarketCapabilities(agent.capabilities)
    },
    securitySchemes: mode === 'remote_service'
      ? {
          platformInvocationJwt: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Short-lived MOMOAI invocation JWT for paid platform-routed calls.'
          }
        }
      : {},
    security: mode === 'remote_service' ? [{ platformInvocationJwt: [] }] : []
  };
}

export function buildOasfRecord(options: AgentCardOptions = {}) {
  const card = buildAgentCard(options);
  return {
    schema_version: '1.0.0',
    name: card.name,
    description: card.description,
    version: card.version,
    locator: {
      type: 'a2a',
      url: card.url
    },
    modules: [
      {
        name: 'agent_communication',
        protocols: ['a2a'],
        capabilities: card.skills.map((skill: any) => skill.id)
      }
    ],
    skills: card.skills,
    security: card.securitySchemes
  };
}
