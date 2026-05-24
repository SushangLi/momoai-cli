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
  poll_interval_ms?: number;
  service_type?: string;
  endpoint_url?: string;
}

interface RelayTask {
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

function providerEndpoint(agent: ResolvedAgentConfig, allowLocalFallback: boolean) {
  if (agent.providerUrl) return agent.providerUrl.replace(/\/$/, '');
  if (allowLocalFallback) return localA2aEndpoint(agent);
  throw new Error('HTTP remote service requires --provider-url <https://.../a2a> so momoai.pro can reach this local provider.');
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
  const response = await new MomoClient().request<{ data?: ProviderRegistration } & ProviderRegistration>('/api/a2a/provider/register', {
    body: {
      agent_id: agentId,
      service_type: agent.serviceType,
      ...(agent.serviceType === 'http' ? { provider_url: providerEndpoint(agent, allowLocalFallback) } : {}),
      card,
      oasf,
      capabilities: card.skills
    }
  });

  return (response as any).data || response;
}

async function pollTask(registration: ProviderRegistration): Promise<RelayTask | null> {
  const response = await new MomoClient().request<any>('/api/a2a/provider/poll', {
    authToken: registration.provider_token,
    body: {
      node_id: registration.node_id,
      session_id: registration.session_id
    }
  });

  return response.data?.task || response.task || null;
}

async function submitResult(registration: ProviderRegistration, runId: string, response: JsonRpcResponse) {
  await new MomoClient().request('/api/a2a/provider/result', {
    authToken: registration.provider_token,
    body: {
      node_id: registration.node_id,
      session_id: registration.session_id,
      run_id: runId,
      response
    }
  });
}

async function executeRelayTask(task: RelayTask, agent: ResolvedAgentConfig): Promise<JsonRpcResponse> {
  const request = task.request;
  if (request?.jsonrpc !== '2.0' || request.method !== 'message/send') {
    return jsonRpcError(request?.id, -32601, 'Remote service provider only supports message/send');
  }

  try {
    const auth = await verifyInvocationAuth(`Bearer ${task.invocation_token}`, agent.agentId);
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
      contextId: String(params.metadata?.contextId || params.contextId || auth.runId || task.run_id),
      showPlan: params.metadata?.showPlan === true,
      invocationToken: task.invocation_token,
      agent
    });

    return jsonRpcResult(request.id, {
      id: task.run_id,
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

export async function runRemoteServiceProvider(agent: ResolvedAgentConfig) {
  const config = loadConfig();
  if (!agent.agentId) throw new Error('Remote service provider requires an agent id.');
  const allowLocalFallback = isLocalPlatformUrl(config.apiUrl);
  const registration = await registerProvider(agent, allowLocalFallback);
  console.log(`MOMOAI remote service provider connected to ${config.apiUrl}`);
  console.log(`profile: ${agent.profile}`);
  console.log(`agent: ${agent.agentId}`);
  console.log(`node: ${registration.node_id}`);

  if (agent.serviceType === 'http') {
    const endpoint = providerEndpoint(agent, allowLocalFallback);
    console.log('service: http');
    console.log(`provider endpoint: ${endpoint}`);
    if (!agent.providerUrl && allowLocalFallback) {
      console.warn('providerUrl is not configured; using the local endpoint because MOMOAI_API_URL points to a local platform.');
    }
    console.log(`MOMOAI A2A agent server listening on http://${agent.host}:${agent.port}`);
    await startAgentServer({ host: agent.host, port: agent.port, mode: 'remote_service', agent });
    return;
  }

  const intervalMs = Number(registration.poll_interval_ms || 3_600_000);
  console.log('service: polling');
  console.log(`poll interval: ${Math.round(intervalMs / 1000)}s`);

  for (;;) {
    const task = await pollTask(registration);
    if (!task) {
      await delay(intervalMs);
      continue;
    }

    const response = await executeRelayTask(task, agent);
    await submitResult(registration, task.run_id, response);
  }
}
