import type { InvocationAuth } from './auth.js';
import type { JsonRpcRequest, JsonRpcResponse } from './types.js';
import type { AgentCapability, AgentMode, ResolvedAgentConfig } from '../config.js';

export interface ProviderExecutorInput {
  protocolVersion: 'momoai.provider-executor.v1';
  request: JsonRpcRequest;
  content: string;
  mode: AgentMode;
  agent: ResolvedAgentConfig;
  capability?: AgentCapability;
  capabilityId?: string;
  contextId: string;
  taskId: string;
  acceptedOutputModes: string[];
  invocationToken?: string;
  auth?: InvocationAuth;
  options?: Record<string, unknown>;
}

export type ProviderExecutorOutput =
  | JsonRpcResponse
  | {
      response?: JsonRpcResponse;
      task?: unknown;
      id?: string;
      taskId?: string;
      contextId?: string;
      state?: string;
      status?: string;
      message?: unknown;
      parts?: unknown[];
      text?: string;
      content?: string;
      data?: unknown;
      mediaType?: string;
      metadata?: Record<string, unknown>;
      artifacts?: unknown[];
    };

type ExecutorFunction = (input: ProviderExecutorInput) => Promise<ProviderExecutorOutput> | ProviderExecutorOutput;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return isRecord(value) && value.jsonrpc === '2.0' && ('result' in value || 'error' in value);
}

function normalizeModes(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(raw.map((mode) => String(mode || '').trim()).filter(Boolean))];
}

export function acceptedOutputModesFromParams(params: any): string[] {
  const configuration = params?.configuration || params?.config || {};
  const metadata = params?.metadata || {};
  return normalizeModes(
    configuration.acceptedOutputModes ||
      configuration.accepted_output_modes ||
      params?.acceptedOutputModes ||
      params?.accepted_output_modes ||
      metadata.acceptedOutputModes ||
      metadata.accepted_output_modes ||
      metadata.outputModes ||
      metadata.output_modes ||
      metadata.momoai?.acceptedOutputModes ||
      metadata.momoai?.accepted_output_modes
  );
}

export function hasProviderExecutor(agent: ResolvedAgentConfig) {
  return Boolean(agent.providerExecutor?.trim());
}

function normalizeTaskState(value: unknown) {
  const state = String(value || '').trim().toUpperCase();
  if (state === 'TASK_STATE_COMPLETED' || state === 'COMPLETED') return 'TASK_STATE_COMPLETED';
  if (state === 'TASK_STATE_FAILED' || state === 'FAILED') return 'TASK_STATE_FAILED';
  if (state === 'TASK_STATE_CANCELED' || state === 'TASK_STATE_CANCELLED' || state === 'CANCELED' || state === 'CANCELLED') {
    return 'TASK_STATE_CANCELED';
  }
  if (state === 'TASK_STATE_SUBMITTED' || state === 'SUBMITTED') return 'TASK_STATE_SUBMITTED';
  if (state === 'TASK_STATE_WORKING' || state === 'WORKING') return 'TASK_STATE_WORKING';
  return 'TASK_STATE_COMPLETED';
}

function looksLikeTask(value: unknown) {
  return isRecord(value) && typeof value.id === 'string' && isRecord(value.status);
}

function asResponse(value: unknown, requestId: JsonRpcRequest['id']): JsonRpcResponse | undefined {
  if (isJsonRpcResponse(value)) {
    return {
      ...value,
      id: value.id ?? requestId ?? null
    };
  }
  if (isRecord(value) && isJsonRpcResponse(value.response)) {
    return {
      ...value.response,
      id: value.response.id ?? requestId ?? null
    };
  }
  return undefined;
}

async function resolveExecutor(specifier: string, input: ProviderExecutorInput): Promise<ExecutorFunction> {
  const module = await import(specifier);
  const candidate = (module as any).default ?? module;

  if (typeof candidate === 'function') return candidate as ExecutorFunction;
  if (isRecord(candidate) && typeof candidate.execute === 'function') {
    return candidate.execute.bind(candidate) as ExecutorFunction;
  }
  if (typeof (module as any).execute === 'function') {
    return (module as any).execute.bind(module) as ExecutorFunction;
  }
  if (isRecord(candidate) && typeof candidate.createExecutor === 'function') {
    const created = await candidate.createExecutor({
      agent: input.agent,
      options: input.options || {}
    });
    if (typeof created === 'function') return created as ExecutorFunction;
    if (isRecord(created) && typeof created.execute === 'function') {
      return created.execute.bind(created) as ExecutorFunction;
    }
  }

  throw new Error(`Provider executor '${specifier}' must export a function, execute(input), or createExecutor().`);
}

function outputParts(output: Record<string, unknown>) {
  if (Array.isArray(output.parts)) return output.parts;
  if (output.data !== undefined) {
    return [{ kind: 'data', data: output.data, mediaType: String(output.mediaType || 'application/json') }];
  }
  const text = typeof output.text === 'string'
    ? output.text
    : typeof output.content === 'string' ? output.content : 'Provider executor completed.';
  return [{ kind: 'text', text, mediaType: String(output.mediaType || 'text/plain') }];
}

function taskFromOutput(output: unknown, input: ProviderExecutorInput) {
  if (isRecord(output) && output.task !== undefined) return output.task;
  if (looksLikeTask(output)) return output;

  const record = isRecord(output) ? output : {};
  const contextId = String(record.contextId || input.contextId || input.taskId);
  const metadata = {
    contextId,
    mode: input.mode,
    ...(input.capabilityId ? { capability_id: input.capabilityId } : {}),
    ...(record.metadata && isRecord(record.metadata) ? record.metadata : {})
  };
  const message = record.message && isRecord(record.message)
    ? record.message
    : {
        role: 'agent',
        parts: outputParts(record),
        metadata
      };

  return {
    id: String(record.taskId || record.id || input.taskId),
    contextId,
    status: {
      state: normalizeTaskState(record.state || record.status),
      message
    },
    ...(Array.isArray(record.artifacts) ? { artifacts: record.artifacts } : {}),
    metadata
  };
}

export async function executeProviderExecutor(input: ProviderExecutorInput): Promise<JsonRpcResponse> {
  const specifier = input.agent.providerExecutor?.trim();
  if (!specifier) {
    return {
      jsonrpc: '2.0',
      id: input.request.id ?? null,
      error: { code: -32603, message: 'No provider executor is configured.' }
    };
  }

  const executor = await resolveExecutor(specifier, input);
  const output = await executor(input);
  const response = asResponse(output, input.request.id);
  if (response) return response;

  return {
    jsonrpc: '2.0',
    id: input.request.id ?? null,
    result: taskFromOutput(output, input)
  };
}

