import WebSocket from 'ws';
import { MomoClient } from '../client.js';
import { loadConfig } from '../config.js';
import { buildAgentCard, buildOasfRecord } from './card.js';
import { verifyInvocationAuth } from './auth.js';
import { AgentRuntime } from './runtime.js';
import { startAgentServer } from './server.js';
import type { JsonRpcRequest, JsonRpcResponse } from './types.js';
import type { ResolvedAgentConfig } from '../config.js';

interface ProviderRegistration {
  provider_token: string;
  node_id: string;
  session_id: string;
  service_type?: string;
  endpoint_url?: string;
  relay_url?: string;
}

interface ProviderInvocation {
  run_id: string;
  invocation_token: string;
  request: JsonRpcRequest;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localA2aEndpoint(agent: ResolvedAgentConfig) {
  return `http://${agent.host}:${agent.port}/a2a`;
}

function isLocalPlatformUrl(apiUrl: string) {
  try {
    const host = new URL(apiUrl).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function funnelEndpoint(agent: ResolvedAgentConfig, allowLocalFallback: boolean) {
  if (agent.providerUrl) return agent.providerUrl.replace(/\/$/, '');
  if (agent.providerRuntime === 'external') {
    throw new Error('External A2A provider registration requires --provider-url <https://.../a2a>.');
  }
  if (allowLocalFallback) return localA2aEndpoint(agent);
  throw new Error('Funnel remote service requires --provider-url <https://.../a2a> so momoai.pro can reach this provider.');
}

function websocketEndpoint(value?: string) {
  if (!value) throw new Error('Platform did not return a WebSocket relay URL.');
  const url = new URL(value);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Invalid WebSocket relay URL: ${value}`);
  }
  return url.toString();
}

function marketCapabilities(agent: ResolvedAgentConfig) {
  return agent.capabilities
    .filter((capability) => capability.enabled !== false)
    .map((capability, index) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description || '',
      fixedTokens: Number(capability.fixedTokens || 0),
      enabled: capability.enabled !== false,
      sortOrder: index
    }));
}

function textFromA2aMessage(message: any) {
  if (typeof message?.content === 'string') return message.content;
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .map((part: { text?: unknown }) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function capabilityIdFromParams(params: any) {
  return String(params?.metadata?.capability_id || params?.metadata?.capabilityId || params?.capability_id || params?.capabilityId || '').trim();
}

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message }
  };
}

async function registerProvider(agent: ResolvedAgentConfig, allowLocalFallback: boolean): Promise<ProviderRegistration> {
  const agentId = agent.agentId;
  if (!agentId) throw new Error('Remote service provider requires an agent id.');
  const card = buildAgentCard({ mode: 'remote_service', agentId, agent });
  const oasf = buildOasfRecord({ mode: 'remote_service', agentId, agent });
  const capabilities = marketCapabilities(agent);
  const response = await new MomoClient().request<{ data?: ProviderRegistration } & ProviderRegistration>('/api/a2a/provider/register', {
    body: {
      agent_id: agentId,
      service_type: agent.serviceType,
      ...(agent.serviceType === 'funnel' ? { provider_url: funnelEndpoint(agent, allowLocalFallback) } : {}),
      card,
      oasf,
      capabilities,
      market_capabilities: capabilities
    }
  });

  return (response as any).data || response;
}

async function executeProviderInvocation(invocation: ProviderInvocation, agent: ResolvedAgentConfig): Promise<JsonRpcResponse> {
  const request = invocation.request;
  if (request?.jsonrpc !== '2.0' || request.method !== 'message/send') {
    return jsonRpcError(request?.id, -32601, 'Remote service provider only supports message/send');
  }

  try {
    const auth = await verifyInvocationAuth(`Bearer ${invocation.invocation_token}`, agent.agentId);
    const params = request.params || {};
    const content = textFromA2aMessage(params.message);
    if (!content) return jsonRpcError(request.id, -32602, 'message/send requires a text message');

    const capabilityId = capabilityIdFromParams(params);
    if (!capabilityId) return jsonRpcError(request.id, -32602, 'message/send requires metadata.capability_id');
    if (auth.capabilityId && auth.capabilityId !== capabilityId) {
      return jsonRpcError(request.id, -32602, 'capability_id does not match platform invocation token');
    }

    const result = await new AgentRuntime().run({
      content,
      mode: 'remote_service',
      capabilityId,
      contextId: String(params.metadata?.contextId || params.contextId || auth.runId || invocation.run_id),
      showPlan: params.metadata?.showPlan === true,
      invocationToken: invocation.invocation_token,
      agent
    });

    return jsonRpcResult(request.id, {
      id: invocation.run_id,
      contextId: result.contextId,
      status: {
        state: 'completed',
        message: {
          role: 'agent',
          parts: [{ kind: 'text', text: result.content }],
          metadata: {
            contextId: result.contextId,
            mode: 'remote_service',
            capability_id: capabilityId,
            usage: result.usage,
            ...(result.plan ? { plan: result.plan } : {})
          }
        }
      }
    });
  } catch (error) {
    return jsonRpcError(request?.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

function rawMessageToString(raw: WebSocket.RawData) {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}

async function runWebSocketSession(registration: ProviderRegistration, agent: ResolvedAgentConfig) {
  const relayUrl = websocketEndpoint(registration.relay_url);

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const ws = new WebSocket(relayUrl, {
      headers: {
        Authorization: `Bearer ${registration.provider_token}`
      }
    });
    const connectTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
    }, 30_000);

    ws.on('open', () => {
      clearTimeout(connectTimer);
      console.log(`WebSocket relay connected: ${relayUrl}`);
    });

    ws.on('message', (raw) => {
      void (async () => {
        let message: any;
        try {
          message = JSON.parse(rawMessageToString(raw));
        } catch (error) {
          console.warn('Ignoring invalid relay message:', error instanceof Error ? error.message : String(error));
          return;
        }

        if (message?.type === 'a2a.ready') {
          console.log(`relay node ready: ${message.node_id || registration.node_id}`);
          return;
        }
        if (message?.type !== 'a2a.invoke') return;

        const runId = String(message.run_id || message.runId || '');
        try {
          const response = await executeProviderInvocation({
            run_id: runId,
            invocation_token: String(message.invocation_token || message.invocationToken || ''),
            request: message.request
          }, agent);
          ws.send(JSON.stringify({
            type: 'a2a.result',
            run_id: runId,
            response
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'a2a.error',
            run_id: runId,
            error: error instanceof Error ? error.message : String(error)
          }));
        }
      })();
    });

    ws.on('close', (code, reason) => {
      clearTimeout(connectTimer);
      console.warn(`WebSocket relay disconnected: ${code} ${reason.toString()}`);
      finish();
    });

    ws.on('error', (error) => {
      clearTimeout(connectTimer);
      console.error(`WebSocket relay error: ${error.message}`);
      if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) finish();
    });
  });
}

export async function runRemoteServiceProvider(agent: ResolvedAgentConfig) {
  const config = loadConfig();
  if (!agent.agentId) throw new Error('Remote service provider requires an agent id.');
  const allowLocalFallback = isLocalPlatformUrl(config.apiUrl);
  if (agent.providerRuntime === 'external' && agent.serviceType !== 'funnel') {
    throw new Error('External providers must use --service funnel because the platform calls their endpoint directly.');
  }

  const registration = await registerProvider(agent, allowLocalFallback);
  console.log(`MOMOAI remote service provider connected to ${config.apiUrl}`);
  console.log(`profile: ${agent.profile}`);
  console.log(`agent: ${agent.agentId}`);
  console.log(`node: ${registration.node_id}`);
  console.log(`provider runtime: ${agent.providerRuntime}`);
  console.log(`service: ${registration.service_type || agent.serviceType}`);

  if (agent.providerRuntime === 'external') {
    console.log(`external provider endpoint: ${funnelEndpoint(agent, allowLocalFallback)}`);
    console.log('registered external A2A provider; CLI will not proxy or start a local server.');
    return;
  }

  if (agent.serviceType === 'funnel') {
    const endpoint = funnelEndpoint(agent, allowLocalFallback);
    console.log(`provider endpoint: ${endpoint}`);
    if (!agent.providerUrl && allowLocalFallback) {
      console.warn('providerUrl is not configured; using the local endpoint because MOMOAI_API_URL points to a local platform.');
    }
    console.log(`MOMOAI A2A agent server listening on http://${agent.host}:${agent.port}`);
    await startAgentServer({ host: agent.host, port: agent.port, mode: 'remote_service', agent });
    return;
  }

  console.log(`relay: ${registration.relay_url}`);
  console.log('WebSocket provider uses an outbound connection; no inbound port is required.');

  let attempt = 0;
  for (;;) {
    await runWebSocketSession(registration, agent);
    attempt += 1;
    const backoffMs = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
    console.log(`reconnecting relay in ${Math.round(backoffMs / 1000)}s`);
    await delay(backoffMs);
  }
}
