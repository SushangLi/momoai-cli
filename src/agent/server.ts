import express from 'express';
import { buildAgentCard, buildMarketCard } from './card.js';
import { verifyInvocationAuth } from './auth.js';
import type { InvocationAuth } from './auth.js';
import { AgentRuntime } from './runtime.js';
import { makeId } from './token.js';
import { contentFromA2aMessage } from './message.js';
import { acceptedOutputModesFromParams, executeProviderExecutor, hasProviderExecutor } from './provider-executor.js';
import type { JsonRpcRequest, JsonRpcResponse } from './types.js';
import { loadConfig, resolveAgentConfig, type AgentMode, type ResolvedAgentConfig } from '../config.js';

type TaskState = 'submitted' | 'working' | 'completed' | 'canceled' | 'failed';

interface StoredTask {
  id: string;
  contextId: string;
  capabilityId?: string;
  state: TaskState;
  result?: unknown;
  error?: string;
  a2aTask?: unknown;
}

const tasks = new Map<string, StoredTask>();

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result
  };
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  };
}

function taskResult(task: StoredTask) {
  if (task.a2aTask) return task.a2aTask;
  const states: Record<TaskState, string> = {
    submitted: 'TASK_STATE_SUBMITTED',
    working: 'TASK_STATE_WORKING',
    completed: 'TASK_STATE_COMPLETED',
    canceled: 'TASK_STATE_CANCELED',
    failed: 'TASK_STATE_FAILED'
  };
  return {
    id: task.id,
    contextId: task.contextId,
    status: {
      state: states[task.state],
      ...(task.result ? { message: task.result } : {}),
      ...(task.error ? { error: task.error } : {})
    }
  };
}

function capabilityIdFromParams(params: any) {
  return String(params?.metadata?.capability_id || params?.metadata?.capabilityId || params?.capability_id || params?.capabilityId || '').trim();
}

function stateFromA2aTask(task: unknown): TaskState {
  const state = String((task as any)?.status?.state || '').toUpperCase();
  if (state === 'TASK_STATE_COMPLETED' || state === 'COMPLETED') return 'completed';
  if (state === 'TASK_STATE_FAILED' || state === 'FAILED') return 'failed';
  if (state === 'TASK_STATE_CANCELED' || state === 'TASK_STATE_CANCELLED' || state === 'CANCELED' || state === 'CANCELLED') return 'canceled';
  if (state === 'TASK_STATE_SUBMITTED' || state === 'SUBMITTED') return 'submitted';
  return 'working';
}

async function handleMessageSend(request: JsonRpcRequest, mode: AgentMode, agent: ResolvedAgentConfig, auth?: InvocationAuth) {
  const params = request.params || {};
  const content = contentFromA2aMessage(params.message);
  if (!content) {
    return jsonRpcError(request.id, -32602, 'message/send requires at least one text, data, or file part');
  }

  const capabilityId = capabilityIdFromParams(params);
  const knownCapabilityIds = new Set(
    agent.capabilities
      .filter((capability) => capability.enabled !== false)
      .map((capability) => capability.id)
  );
  if (mode === 'remote_service') {
    if (!auth) return jsonRpcError(request.id, -32010, 'Remote service mode requires platform invocation token');
    if (!capabilityId) return jsonRpcError(request.id, -32602, 'message/send requires metadata.capability_id in remote_service mode');
    if (auth.capabilityId && auth.capabilityId !== capabilityId) {
      return jsonRpcError(request.id, -32602, 'capability_id does not match platform invocation token');
    }
  }
  if (capabilityId && !knownCapabilityIds.has(capabilityId)) {
    return jsonRpcError(request.id, -32602, `Unknown or disabled capability_id: ${capabilityId}`);
  }
  if (capabilityId) {
    const capability = agent.capabilities.find((item) => item.enabled !== false && item.id === capabilityId);
    if (!hasProviderExecutor(agent) && (!capability?.skill?.id || !capability.skill.instructions?.trim())) {
      return jsonRpcError(request.id, -32602, `Capability ${capabilityId} is not bound to a local skill with instructions`);
    }
  }

  const contextId = String(params.metadata?.contextId || params.contextId || auth?.runId || makeId('ctx'));
  const task: StoredTask = {
    id: makeId('task'),
    contextId,
    capabilityId: capabilityId || undefined,
    state: 'working'
  };
  tasks.set(task.id, task);

  try {
    const capability = capabilityId
      ? agent.capabilities.find((item) => item.enabled !== false && item.id === capabilityId)
      : undefined;
    if (hasProviderExecutor(agent)) {
      const executorResponse = await executeProviderExecutor({
        protocolVersion: 'momoai.provider-executor.v1',
        request,
        content,
        mode,
        agent,
        capability,
        capabilityId: capabilityId || undefined,
        contextId,
        taskId: task.id,
        acceptedOutputModes: acceptedOutputModesFromParams(params),
        invocationToken: auth?.token,
        auth,
        options: agent.providerExecutorOptions
      });
      if (executorResponse.error) {
        task.state = 'failed';
        task.error = executorResponse.error.message;
      } else {
        task.a2aTask = executorResponse.result;
        task.state = stateFromA2aTask(executorResponse.result);
      }
      return executorResponse;
    }

    const result = await new AgentRuntime().run({
      content,
      mode,
      capabilityId: capabilityId || undefined,
      contextId,
      showPlan: params.metadata?.showPlan === true,
      invocationToken: auth?.token,
      agent
    });
    task.state = 'completed';
    task.result = {
      role: 'agent',
      parts: [{ text: result.content, mediaType: 'text/plain' }],
      metadata: {
        contextId: result.contextId,
        mode,
        ...(capabilityId ? { capability_id: capabilityId } : {}),
        usage: result.usage,
        ...(result.plan ? { plan: result.plan } : {})
      }
    };
    return jsonRpcResult(request.id, taskResult(task));
  } catch (error) {
    task.state = 'failed';
    task.error = error instanceof Error ? error.message : String(error);
    return jsonRpcError(request.id, -32000, task.error);
  }
}

function handleTaskGet(request: JsonRpcRequest) {
  const taskId = String(request.params?.id || request.params?.taskId || '');
  const task = tasks.get(taskId);
  if (!task) return jsonRpcError(request.id, -32001, 'Task not found');
  return jsonRpcResult(request.id, taskResult(task));
}

function handleTaskCancel(request: JsonRpcRequest) {
  const taskId = String(request.params?.id || request.params?.taskId || '');
  const task = tasks.get(taskId);
  if (!task) return jsonRpcError(request.id, -32001, 'Task not found');
  if (task.state === 'working' || task.state === 'submitted') {
    task.state = 'canceled';
  }
  return jsonRpcResult(request.id, taskResult(task));
}

function restStatusForJsonRpcError(code: number) {
  if (code === -32001) return 404;
  if (code === -32010) return 401;
  if (code === -32602 || code === -32600) return 400;
  return 500;
}

async function authForMode(authorization: string | undefined, mode: AgentMode, agent: ResolvedAgentConfig) {
  return mode === 'remote_service'
    ? await verifyInvocationAuth(authorization, agent.agentId)
    : undefined;
}

export async function startAgentServer(options: {
  host: string;
  port: number;
  mode: AgentMode;
  agent?: ResolvedAgentConfig;
}) {
  const agent = options.agent || resolveAgentConfig(loadConfig());
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/.well-known/agent-card.json', (_request, response) => {
    response.json(buildAgentCard({ mode: options.mode, agent }));
  });

  app.get('/.well-known/momoai-a2a/market-card.json', (_request, response) => {
    response.json(buildMarketCard({ mode: options.mode, agent }));
  });

  app.post('/message:send', async (expressRequest, response) => {
    const body = expressRequest.body || {};
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: body.id || body.message?.messageId || makeId('rest'),
      method: 'message/send',
      params: body.params || body
    };

    try {
      const auth = await authForMode(expressRequest.headers.authorization, options.mode, agent);
      const result = await handleMessageSend(request, options.mode, agent, auth);
      if (result.error) {
        response.status(restStatusForJsonRpcError(result.error.code)).json(result);
        return;
      }
      response.json(result.result);
    } catch (error) {
      response.status(401).json(jsonRpcError(request.id, -32010, error instanceof Error ? error.message : String(error)));
    }
  });

  app.get('/tasks', (_request, response) => {
    response.json([...tasks.values()].map(taskResult));
  });

  app.get('/tasks/:id', (expressRequest, response) => {
    const result = handleTaskGet({
      jsonrpc: '2.0',
      id: expressRequest.params.id,
      method: 'tasks/get',
      params: { id: expressRequest.params.id }
    });
    if (result.error) {
      response.status(restStatusForJsonRpcError(result.error.code)).json(result);
      return;
    }
    response.json(result.result);
  });

  app.post(/^\/tasks\/([^/]+):cancel$/, (expressRequest, response) => {
    const taskId = expressRequest.params[0];
    const result = handleTaskCancel({
      jsonrpc: '2.0',
      id: taskId,
      method: 'tasks/cancel',
      params: { id: taskId }
    });
    if (result.error) {
      response.status(restStatusForJsonRpcError(result.error.code)).json(result);
      return;
    }
    response.json(result.result);
  });

  app.post('/a2a', async (expressRequest, response) => {
    const request = expressRequest.body as JsonRpcRequest;
    if (request?.jsonrpc !== '2.0' || !request.method) {
      response.status(400).json(jsonRpcError(request?.id, -32600, 'Invalid JSON-RPC request'));
      return;
    }

    try {
      const auth = await authForMode(expressRequest.headers.authorization, options.mode, agent);
      if (request.method === 'message/send') {
        response.json(await handleMessageSend(request, options.mode, agent, auth));
        return;
      }
      if (request.method === 'tasks/get') {
        response.json(handleTaskGet(request));
        return;
      }
      if (request.method === 'tasks/cancel') {
        response.json(handleTaskCancel(request));
        return;
      }
      response.json(jsonRpcError(request.id, -32601, `Unsupported method: ${request.method}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(401).json(jsonRpcError(request.id, -32010, message));
    }
  });

  await new Promise<void>((resolve, reject) => {
    app.listen(options.port, options.host, (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
