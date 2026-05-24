import { MomoClient } from '../client.js';
import { loadConfig } from '../config.js';
import { buildAgentCard, buildOasfRecord } from './card.js';
import { verifyInvocationAuth } from './auth.js';
import { AgentRuntime } from './runtime.js';
import type { JsonRpcRequest, JsonRpcResponse } from './types.js';

interface ProviderRegistration {
  provider_token: string;
  node_id: string;
  session_id: string;
  poll_interval_ms?: number;
}

interface RelayTask {
  run_id: string;
  invocation_token: string;
  request: JsonRpcRequest;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function registerProvider(agentId: number): Promise<ProviderRegistration> {
  const card = buildAgentCard({ mode: 'remote_service', agentId });
  const oasf = buildOasfRecord({ mode: 'remote_service', agentId });
  const response = await new MomoClient().request<{ data?: ProviderRegistration } & ProviderRegistration>('/api/a2a/provider/register', {
    body: {
      agent_id: agentId,
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

async function executeRelayTask(task: RelayTask, agentId: number): Promise<JsonRpcResponse> {
  const request = task.request;
  if (request?.jsonrpc !== '2.0' || request.method !== 'message/send') {
    return jsonRpcError(request?.id, -32601, 'Remote service provider only supports message/send');
  }

  try {
    const auth = await verifyInvocationAuth(`Bearer ${task.invocation_token}`, agentId);
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
      invocationToken: task.invocation_token
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

export async function runRemoteServiceProvider(agentId: number) {
  const config = loadConfig();
  const registration = await registerProvider(agentId);
  const intervalMs = Number(registration.poll_interval_ms || 1500);
  console.log(`MOMOAI remote service provider connected to ${config.apiUrl}`);
  console.log(`agent: ${agentId}`);
  console.log(`node: ${registration.node_id}`);

  for (;;) {
    const task = await pollTask(registration);
    if (!task) {
      await delay(intervalMs);
      continue;
    }

    const response = await executeRelayTask(task, agentId);
    await submitResult(registration, task.run_id, response);
  }
}
