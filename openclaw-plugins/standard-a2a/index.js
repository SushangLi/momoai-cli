import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const tasks = new Map();

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizePath(value, fallback) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function normalizeString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeModes(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const modes = [...new Set(value.map((mode) => String(mode || '').trim()).filter(Boolean))];
  return modes.length ? modes : fallback;
}

function normalizeSkill(value, index) {
  const skill = isRecord(value) ? value : {};
  const id = normalizeString(skill.id || skill.capability_id || skill.capabilityId, `skill_${index + 1}`);
  return {
    id,
    name: normalizeString(skill.name, id),
    description: normalizeString(skill.description, ''),
    tags: Array.isArray(skill.tags) ? skill.tags.map(String) : [],
    inputModes: normalizeModes(skill.inputModes || skill.input_modes, ['text/plain', 'application/json']),
    outputModes: normalizeModes(skill.outputModes || skill.output_modes, ['text/plain'])
  };
}

function defaultSkills() {
  return [
    {
      id: 'general_task',
      name: 'General task',
      description: 'Complete one standard A2A task through OpenClaw.',
      tags: ['openclaw'],
      inputModes: ['text/plain', 'application/json'],
      outputModes: ['text/plain']
    }
  ];
}

function normalizeService(serviceId, rawService) {
  const service = isRecord(rawService) ? rawService : {};
  const isDefault = serviceId === 'default';
  const endpointPath = normalizePath(service.endpointPath || service.upstreamPath, isDefault ? '/a2a' : `/a2a/${serviceId}`);
  const agentCardPath = normalizePath(service.agentCardPath, isDefault ? '/.well-known/agent-card.json' : `/.well-known/a2a/${serviceId}/agent-card.json`);
  const skills = Array.isArray(service.skills) ? service.skills.map(normalizeSkill).filter((skill) => skill.id && skill.name) : defaultSkills();
  const timeoutSeconds = Number(service.timeoutSeconds || 600);
  return {
    id: serviceId,
    enabled: service.enabled === undefined ? true : Boolean(service.enabled),
    endpointPath,
    agentCardPath,
    name: normalizeString(service.name, 'OpenClaw A2A Agent'),
    description: normalizeString(service.description, 'OpenClaw exposed through the standard Agent2Agent protocol.'),
    version: normalizeString(service.version, '0.1.0'),
    openclawBin: normalizeString(service.openclawBin, 'openclaw'),
    openclawAgent: normalizeString(service.openclawAgent, ''),
    timeoutSeconds: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? Math.floor(timeoutSeconds) : 600,
    skills: skills.length ? skills : defaultSkills()
  };
}

function normalizeServices(pluginConfig) {
  const servicesConfig = isRecord(pluginConfig?.services) ? pluginConfig.services : {};
  return Object.entries(servicesConfig)
    .map(([serviceId, service]) => normalizeService(serviceId, service))
    .filter((service) => service.enabled);
}

function originFromRequest(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || '127.0.0.1:18789';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}`;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJson(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error('Payload too large');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function taskMessage(role, text, metadata = {}) {
  return {
    role,
    parts: [{ kind: 'text', text }],
    metadata
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function decodeTextBytes(bytes, mimeType) {
  const normalizedMime = String(mimeType || '').toLowerCase();
  const canDecode =
    normalizedMime.startsWith('text/') ||
    normalizedMime.includes('json') ||
    normalizedMime.includes('xml') ||
    normalizedMime.includes('yaml');
  if (!canDecode) return undefined;
  try {
    const buffer = Buffer.from(bytes, 'base64');
    if (buffer.byteLength > 64 * 1024) return `[decoded text omitted: ${buffer.byteLength} bytes exceeds 65536]`;
    return buffer.toString('utf8');
  } catch {
    return undefined;
  }
}

function filePartToText(part) {
  const file = isRecord(part?.file) ? part.file : part;
  const name = normalizeString(file?.name, 'unnamed');
  const mimeType = normalizeString(file?.mimeType, 'application/octet-stream');
  const uri = normalizeString(file?.uri || file?.url, '');
  if (uri) return `[file: ${name}; mimeType=${mimeType}; uri=${uri}]`;
  const bytes = typeof file?.bytes === 'string' ? file.bytes : '';
  if (!bytes) return `[file: ${name}; mimeType=${mimeType}]`;
  const decoded = decodeTextBytes(bytes, mimeType);
  if (decoded !== undefined) return `[file: ${name}; mimeType=${mimeType}]\n${decoded}`;
  return `[file: ${name}; mimeType=${mimeType}; base64Bytes=${bytes.length}]`;
}

function partToText(part) {
  const kind = String(part?.kind || part?.type || '').toLowerCase();
  if (typeof part?.text === 'string') return part.text.trim();
  if (kind === 'file' || part?.file || part?.bytes || part?.uri || part?.url) return filePartToText(part);
  if (kind === 'data' || part?.data !== undefined) return `data:\n${safeJson(part.data)}`;
  if (part?.raw !== undefined) return `raw:\n${safeJson(part.raw)}`;
  return '';
}

function contentFromMessage(message) {
  if (typeof message?.content === 'string') return message.content;
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .map(partToText)
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function collectPayloadText(payloads) {
  return (Array.isArray(payloads) ? payloads : [])
    .map((payload) => payload && payload.isReasoning !== true && typeof payload.text === 'string' ? payload.text.trim() : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

function safeFileName(value) {
  return String(value || 'session').replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 120) || 'session';
}

async function invokeOpenClaw(api, service, input, contextId) {
  if (!api.runtime?.agent?.runEmbeddedPiAgent) {
    throw new Error('OpenClaw embedded agent runtime is not available to this plugin.');
  }

  const cfg = api.runtime.config?.current?.() || api.config;
  const agentId = service.openclawAgent || undefined;
  const sessionId = `a2a-${safeFileName(contextId)}`;
  const stateDir = api.runtime.state?.resolveStateDir?.() || process.cwd();
  const sessionDir = join(stateDir, 'a2a-sessions');
  await mkdir(sessionDir, { recursive: true });

  const workspaceDir = agentId
    ? api.runtime.agent.resolveAgentWorkspaceDir(cfg, agentId)
    : cfg?.agents?.defaults?.workspace || process.cwd();
  const result = await api.runtime.agent.runEmbeddedPiAgent({
    sessionId,
    sessionKey: `agent:${agentId || service.id}:a2a:${contextId}`,
    ...(agentId ? { agentId } : {}),
    sessionFile: join(sessionDir, `${sessionId}.json`),
    workspaceDir,
    ...(agentId ? { agentDir: api.runtime.agent.resolveAgentDir(cfg, agentId) } : {}),
    config: cfg,
    prompt: input,
    timeoutMs: service.timeoutSeconds * 1000,
    runTimeoutOverrideMs: service.timeoutSeconds * 1000,
    runId: `a2a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    trigger: 'manual',
    disableMessageTool: true,
    sourceReplyDeliveryMode: 'none'
  });

  return collectPayloadText(result?.payloads) || 'OpenClaw task completed without text output.';
}

function buildAgentCard(req, service) {
  const origin = originFromRequest(req);
  const endpoint = `${origin}${service.endpointPath}`;
  return {
    protocolVersion: '1.0.0',
    name: service.name,
    description: service.description,
    version: service.version,
    url: endpoint,
    supportedInterfaces: [
      { transport: 'JSONRPC', url: endpoint },
      { transport: 'HTTP+JSON', url: endpoint }
    ],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain'],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true
    },
    skills: service.skills,
    securitySchemes: {},
    security: []
  };
}

async function handleSendMessage(api, service, requestId, params) {
  const content = contentFromMessage(params?.message);
  if (!content) return jsonRpcError(requestId, -32602, 'message/send requires at least one text, data, or file part');

  const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const contextId = String(params?.metadata?.contextId || params?.contextId || taskId);
  const task = {
    id: taskId,
    contextId,
    status: {
      state: 'TASK_STATE_WORKING',
      message: taskMessage('agent', 'Working', { contextId })
    },
    artifacts: [],
    history: [params.message]
  };
  tasks.set(taskId, task);

  try {
    const reply = await invokeOpenClaw(api, service, content, contextId);
    task.status = {
      state: 'TASK_STATE_COMPLETED',
      message: taskMessage('agent', reply, { contextId })
    };
    task.artifacts = [
      {
        artifactId: `artifact_${taskId}`,
        name: 'result',
        parts: [{ kind: 'text', text: reply }]
      }
    ];
    tasks.set(taskId, task);
    return jsonRpcResult(requestId, task);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    task.status = {
      state: 'TASK_STATE_FAILED',
      message: taskMessage('agent', message, { contextId })
    };
    tasks.set(taskId, task);
    return jsonRpcResult(requestId, task);
  }
}

async function handleJsonRpc(api, service, body) {
  const method = body?.method;
  if (body?.jsonrpc !== '2.0' || typeof method !== 'string') {
    return jsonRpcError(body?.id, -32600, 'Invalid JSON-RPC request');
  }
  if (method === 'message/send' || method === 'SendMessage') {
    return handleSendMessage(api, service, body.id, body.params || {});
  }
  if (method === 'tasks/get' || method === 'GetTask') {
    const taskId = String(body.params?.id || body.params?.taskId || '');
    const task = tasks.get(taskId);
    return task ? jsonRpcResult(body.id, task) : jsonRpcError(body.id, -32001, 'Task not found');
  }
  if (method === 'tasks/list' || method === 'ListTasks') {
    return jsonRpcResult(body.id, Array.from(tasks.values()));
  }
  if (method === 'tasks/cancel' || method === 'CancelTask') {
    const taskId = String(body.params?.id || body.params?.taskId || '');
    const task = tasks.get(taskId);
    if (!task) return jsonRpcError(body.id, -32001, 'Task not found');
    task.status = {
      state: 'TASK_STATE_CANCELED',
      message: taskMessage('agent', 'Canceled')
    };
    tasks.set(taskId, task);
    return jsonRpcResult(body.id, task);
  }
  return jsonRpcError(body.id, -32601, `Unsupported A2A method: ${method}`);
}

function registerJsonRoute(api, path, handler, match = 'exact') {
  api.registerHttpRoute({
    path,
    auth: 'plugin',
    match,
    replaceExisting: true,
    handler
  });
}

function registerService(api, service) {
  registerJsonRoute(api, service.agentCardPath, async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    sendJson(res, 200, buildAgentCard(req, service));
    return true;
  });

  registerJsonRoute(api, service.endpointPath, async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      sendJson(res, 200, await handleJsonRpc(api, service, await readJson(req)));
    } catch (error) {
      sendJson(res, 400, jsonRpcError(null, -32700, error instanceof Error ? error.message : String(error)));
    }
    return true;
  });

  registerJsonRoute(api, `${service.endpointPath}/message:send`, async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    try {
      const response = await handleSendMessage(api, service, null, await readJson(req));
      sendJson(res, 200, response.result || response);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  });

  registerJsonRoute(api, `${service.endpointPath}/tasks/`, async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }
    const taskId = decodeURIComponent(String(req.url || '').split('/tasks/')[1]?.split('?')[0] || '');
    const task = tasks.get(taskId);
    sendJson(res, task ? 200 : 404, task || { error: 'Task not found' });
    return true;
  }, 'prefix');

  api.logger.info?.(`[openclaw-standard-a2a] registered ${service.id}: ${service.agentCardPath}, ${service.endpointPath}`);
}

export default definePluginEntry({
  id: 'openclaw-standard-a2a',
  name: 'OpenClaw Standard A2A',
  description: 'Exposes OpenClaw as a spec-compatible A2A agent endpoint.',
  register(api) {
    const services = normalizeServices(api.pluginConfig);
    for (const service of services) registerService(api, service);
    if (!services.length) api.logger.warn?.('[openclaw-standard-a2a] no enabled services configured');
  }
});
