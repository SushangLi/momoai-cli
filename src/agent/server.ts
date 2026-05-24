import express from 'express';
import { buildAgentCard, buildOasfRecord } from './card.js';
import { verifyInvocationAuth } from './auth.js';
import type { InvocationAuth } from './auth.js';
import { AgentRuntime } from './runtime.js';
import { makeId } from './token.js';
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

function textFromA2aMessage(message: any) {
  if (typeof message?.content === 'string') return message.content;
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = parts
    .map((part: { text?: unknown }) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
  return text.trim();
}

function taskResult(task: StoredTask) {
  return {
    id: task.id,
    contextId: task.contextId,
    status: {
      state: task.state,
      ...(task.result ? { message: task.result } : {}),
      ...(task.error ? { error: task.error } : {})
    }
  };
}

function capabilityIdFromParams(params: any) {
  return String(params?.metadata?.capability_id || params?.metadata?.capabilityId || params?.capability_id || params?.capabilityId || '').trim();
}

async function handleMessageSend(request: JsonRpcRequest, mode: AgentMode, agent: ResolvedAgentConfig, auth?: InvocationAuth) {
  const params = request.params || {};
  const content = textFromA2aMessage(params.message);
  if (!content) {
    return jsonRpcError(request.id, -32602, 'message/send requires a text message');
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

  const contextId = String(params.metadata?.contextId || params.contextId || auth?.runId || makeId('ctx'));
  const task: StoredTask = {
    id: makeId('task'),
    contextId,
    capabilityId: capabilityId || undefined,
    state: 'working'
  };
  tasks.set(task.id, task);

  try {
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
      parts: [{ kind: 'text', text: result.content }],
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

  app.get('/.well-known/oasf-record.json', (_request, response) => {
    response.json(buildOasfRecord({ mode: options.mode, agent }));
  });

  app.post('/a2a', async (expressRequest, response) => {
    const request = expressRequest.body as JsonRpcRequest;
    if (request?.jsonrpc !== '2.0' || !request.method) {
      response.status(400).json(jsonRpcError(request?.id, -32600, 'Invalid JSON-RPC request'));
      return;
    }

    try {
      const auth = options.mode === 'remote_service'
        ? await verifyInvocationAuth(expressRequest.headers.authorization, agent.agentId)
        : undefined;
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
