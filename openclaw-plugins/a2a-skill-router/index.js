import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const runtimeSymbol = Symbol.for('openclaw.a2a.localRuntime.v1');

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function normalizeModes(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const modes = [...new Set(value.map((mode) => String(mode || '').trim()).filter(Boolean))];
  return modes.length ? modes : fallback;
}

function normalizeSkillBinding(value, index) {
  const binding = isRecord(value) ? value : {};
  const skill = isRecord(binding.skill) ? binding.skill : {};
  const capabilityId = normalizeString(binding.capabilityId || binding.capability_id || binding.id, `capability_${index + 1}`);
  const skillId = normalizeString(skill.id || binding.skillId || binding.skill_id, '');
  const instructions = normalizeString(skill.instructions || binding.instructions, '');
  if (!capabilityId || !skillId || !instructions) return undefined;
  return {
    capabilityId,
    capabilityName: normalizeString(binding.capabilityName || binding.capability_name || binding.name, capabilityId),
    capabilityDescription: normalizeString(binding.capabilityDescription || binding.capability_description || binding.description, ''),
    inputModes: normalizeModes(binding.inputModes || binding.input_modes, ['text/plain', 'application/json']),
    outputModes: normalizeModes(binding.outputModes || binding.output_modes, ['text/plain']),
    skill: {
      id: skillId,
      name: normalizeString(skill.name || binding.skillName || binding.skill_name, skillId),
      description: normalizeString(skill.description || binding.skillDescription || binding.skill_description, ''),
      instructions
    }
  };
}

function normalizeService(serviceId, rawService) {
  const service = isRecord(rawService) ? rawService : {};
  const timeoutSeconds = Number(service.timeoutSeconds || 600);
  const skillBindings = Array.isArray(service.skillBindings)
    ? service.skillBindings.map(normalizeSkillBinding).filter(Boolean)
    : [];
  return {
    id: serviceId,
    enabled: service.enabled === undefined ? true : Boolean(service.enabled),
    openclawAgent: normalizeString(service.openclawAgent, ''),
    timeoutSeconds: Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? Math.floor(timeoutSeconds) : 600,
    skillBindings
  };
}

function normalizeServices(pluginConfig) {
  const servicesConfig = isRecord(pluginConfig?.services) ? pluginConfig.services : {};
  return Object.entries(servicesConfig)
    .map(([serviceId, service]) => normalizeService(serviceId, service))
    .filter((service) => service.enabled);
}

function capabilityIdFromInput(input) {
  return String(
    input?.capabilityId ||
      input?.metadata?.capability_id ||
      input?.metadata?.capabilityId ||
      input?.request?.metadata?.capability_id ||
      input?.request?.metadata?.capabilityId ||
      input?.request?.capability_id ||
      input?.request?.capabilityId ||
      ''
  ).trim();
}

function selectedOutputMode(input, binding) {
  const supported = normalizeModes(binding.outputModes, ['text/plain']);
  const accepted = normalizeModes(input.acceptedOutputModes, []);
  if (!accepted.length) return supported[0] || 'text/plain';
  const match = accepted.find((mode) => supported.includes(mode));
  if (!match) {
    throw new Error(`No compatible output mode. requested=${accepted.join(', ')} supported=${supported.join(', ')}`);
  }
  return match;
}

function parseJsonReply(text) {
  const trimmed = String(text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) return JSON.parse(fenced[1].trim());
    throw new Error('A2A capability requested application/json, but OpenClaw did not return valid JSON.');
  }
}

function outputPartsForReply(reply, outputMode) {
  if (outputMode === 'application/json' || outputMode.endsWith('+json')) {
    return [{ data: parseJsonReply(reply), mediaType: outputMode }];
  }
  if (outputMode === 'text/plain' || outputMode.startsWith('text/')) {
    return [{ text: reply, mediaType: outputMode }];
  }
  throw new Error(`Unsupported output mode: ${outputMode}`);
}

function promptWithSkillBinding(input, binding, outputMode) {
  const acceptedOutputModes = Array.isArray(input.acceptedOutputModes)
    ? input.acceptedOutputModes.map(String).filter(Boolean)
    : [];
  return [
    'A2A capability selected by the caller:',
    `capability_id: ${binding.capabilityId}`,
    `capability_name: ${binding.capabilityName}`,
    binding.capabilityDescription ? `capability_description: ${binding.capabilityDescription}` : '',
    `input_modes: ${binding.inputModes.join(', ')}`,
    `output_modes: ${binding.outputModes.join(', ')}`,
    acceptedOutputModes.length ? `accepted_output_modes: ${acceptedOutputModes.join(', ')}` : '',
    `selected_output_mode: ${outputMode}`,
    '',
    'Local skill binding for this capability:',
    `skill_id: ${binding.skill.id}`,
    `skill_name: ${binding.skill.name}`,
    binding.skill.description ? `skill_description: ${binding.skill.description}` : '',
    '',
    'Skill instructions:',
    binding.skill.instructions,
    '',
    'Execute this request according to the selected capability and local skill. Do not guess another capability.',
    outputMode === 'application/json' || outputMode.endsWith('+json')
      ? 'If application/json is requested and the skill supports it, return only valid JSON.'
      : '',
    '',
    'User request:',
    input.content
  ].filter(Boolean).join('\n');
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

async function invokeOpenClaw(api, service, input, binding, outputMode) {
  if (!api.runtime?.agent?.runEmbeddedPiAgent) {
    throw new Error('OpenClaw embedded agent runtime is not available to the A2A skill router.');
  }

  const cfg = api.runtime.config?.current?.() || api.config;
  const agentId = service.openclawAgent || undefined;
  const contextId = String(input?.metadata?.contextId || input?.request?.contextId || input?.request?.metadata?.contextId || Date.now());
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
    prompt: promptWithSkillBinding(input, binding, outputMode),
    timeoutMs: service.timeoutSeconds * 1000,
    runTimeoutOverrideMs: service.timeoutSeconds * 1000,
    runId: `a2a-router-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    trigger: 'manual',
    disableMessageTool: true,
    sourceReplyDeliveryMode: 'none'
  });

  return collectPayloadText(result?.payloads) || 'OpenClaw task completed without text output.';
}

function createRuntime(api, services) {
  return {
    async execute(input) {
      const serviceId = normalizeString(input?.service?.id, '');
      const service = services.get(serviceId);
      if (!service) throw new Error(`No A2A skill-router service configured for service_id: ${serviceId || '(empty)'}`);
      if (!service.skillBindings.length) throw new Error(`A2A skill-router service ${service.id} has no skill bindings.`);

      const capabilityId = capabilityIdFromInput(input);
      if (!capabilityId) {
        throw new Error('A2A request requires metadata.capability_id so OpenClaw can select a bound local skill.');
      }
      const binding = service.skillBindings.find((item) => item.capabilityId === capabilityId);
      if (!binding) throw new Error(`Unknown or unbound capability_id: ${capabilityId}`);

      const outputMode = selectedOutputMode(input, binding);
      const reply = await invokeOpenClaw(api, service, input, binding, outputMode);
      return {
        artifactName: 'result',
        parts: outputPartsForReply(reply, outputMode),
        metadata: {
          capability_id: capabilityId,
          skill_id: binding.skill.id,
          output_mode: outputMode
        }
      };
    }
  };
}

export default definePluginEntry({
  id: 'openclaw-a2a-skill-router',
  name: 'OpenClaw A2A Skill Router',
  description: 'Maps A2A capability ids to local OpenClaw skill instructions.',
  register(api) {
    const services = new Map(normalizeServices(api.pluginConfig).map((service) => [service.id, service]));
    const runtime = createRuntime(api, services);
    globalThis[runtimeSymbol] = runtime;
    api.registerService?.({
      id: 'openclaw-a2a-skill-router-runtime',
      stop() {
        if (globalThis[runtimeSymbol] === runtime) {
          delete globalThis[runtimeSymbol];
        }
      }
    });
    api.logger.info?.(`[openclaw-a2a-skill-router] registered ${services.size} service(s)`);
  }
});
