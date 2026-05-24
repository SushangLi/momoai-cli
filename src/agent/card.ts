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

function renderCapabilities(capabilities: AgentCapability[]) {
  return capabilities
    .filter((capability) => capability.enabled !== false)
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      tags: ['momoai', 'agent']
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
    defaultOutputModes: ['text/plain', 'application/json'],
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
