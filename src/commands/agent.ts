import { readFileSync } from 'node:fs';
import { buildAgentCard, buildOasfRecord } from '../agent/card.js';
import { sendA2aMessage } from '../agent/client.js';
import { runRemoteServiceProvider } from '../agent/provider.js';
import { startAgentServer } from '../agent/server.js';
import { loadConfig, normalizeProfileName, resolveAgentConfig, saveAgentProfile } from '../config.js';
import { printJson, table } from '../format.js';
import { flagNumber, flagString } from '../parser.js';
import { publishLocalAgentListing, updateLocalAgentListing } from '../services.js';
import type { ParsedCommand } from '../parser.js';
import type { AgentCapability, AgentInstanceConfig, AgentMode, CliConfig, ResolvedAgentConfig } from '../config.js';

function usage() {
  throw new Error([
    'Usage:',
    '  $agent profile list',
    '  $agent profile set <profile> [--name <name>] [--description <text>] [--host <host>] [--port <n>] [--agent-id <id>] [--price <credits_per_k>] [--available-tokens <n>] [--capabilities <json>|--capabilities-file <path>]',
    '  $agent publish [--profile <name>] [--name <name>] [--description <text>] [--price <credits_per_k>] [--available-tokens <n>] [--capabilities <json>|--capabilities-file <path>] [--json]',
    '  $agent update-listing [--profile <name>] [--agent-id <id>] [--public|--delisted] [--name <name>] [--description <text>] [--price <credits_per_k>] [--available-tokens <n>] [--capabilities <json>|--capabilities-file <path>] [--json]',
    '  $agent serve [--profile <name>] [--mode local|remote_service] [--host 127.0.0.1] [--port 41241] [--agent-id <id>]',
    '  $agent connect [--profile <name>] [--agent-id <id>]',
    '  $agent card [--profile <name>] [--mode local|remote_service] [--json] [--agent-id <id>]',
    '  $agent oasf [--profile <name>] [--mode local|remote_service] [--json] [--agent-id <id>]',
    '  $agent call <agent-card-url-or-endpoint> <message...> [--auth <token>] [--capability <id>] [--context <id>] [--show-plan] [--json]'
  ].join('\n'));
}

function modeFlag(command: ParsedCommand, fallback: AgentMode): AgentMode {
  const mode = flagString(command.flags, 'mode') || fallback;
  if (mode !== 'local' && mode !== 'remote_service') {
    throw new Error('--mode must be local or remote_service');
  }
  return mode;
}

function agentIdFlag(command: ParsedCommand, fallback?: number) {
  const value = flagNumber(command.flags, 'agent-id') || flagNumber(command.flags, 'agent_id') || fallback;
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    throw new Error('--agent-id must be a positive integer');
  }
  return value;
}

function profileFlag(command: ParsedCommand) {
  return normalizeProfileName(flagString(command.flags, 'profile'));
}

function parseCapabilities(value: string): AgentCapability[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('--capabilities must be a JSON array.');
  }
  if (!Array.isArray(parsed)) throw new Error('--capabilities must be a JSON array.');
  const capabilities = parsed.map((capability: any) => ({
    id: String(capability.id || capability.capability_id || capability.capabilityId || '').trim(),
    name: String(capability.name || capability.id || capability.capability_id || capability.capabilityId || '').trim(),
    description: String(capability.description || '').trim(),
    fixedTokens: capability.fixedTokens === undefined && capability.fixed_tokens === undefined
      ? undefined
      : Number(capability.fixedTokens ?? capability.fixed_tokens),
    enabled: capability.enabled === undefined ? true : Boolean(capability.enabled)
  })).filter((capability) => capability.id && capability.name);
  if (!capabilities.length) throw new Error('--capabilities must include at least one capability with id and name.');
  return capabilities;
}

function capabilitiesFromFlags(command: ParsedCommand) {
  const inline = flagString(command.flags, 'capabilities');
  const file = flagString(command.flags, 'capabilities-file') || flagString(command.flags, 'capabilities_file');
  if (inline && file) throw new Error('Use either --capabilities or --capabilities-file, not both.');
  if (inline) return parseCapabilities(inline);
  if (file) return parseCapabilities(readFileSync(file, 'utf8'));
  return undefined;
}

function localProfile(config: CliConfig, profileName?: string): ResolvedAgentConfig {
  if (!profileName || profileName === 'default') return resolveAgentConfig(config, profileName);
  try {
    return resolveAgentConfig(config, profileName);
  } catch {
    return {
      ...resolveAgentConfig(config),
      profile: profileName
    };
  }
}

function agentWithFlags(config: CliConfig, command: ParsedCommand): ResolvedAgentConfig {
  const profile = profileFlag(command);
  const agent = localProfile(config, profile);
  const capabilities = capabilitiesFromFlags(command);
  const name = flagString(command.flags, 'name');
  const description = flagString(command.flags, 'description') || flagString(command.flags, 'intro');
  const host = flagString(command.flags, 'host');
  const port = flagNumber(command.flags, 'port');
  const agentId = agentIdFlag(command, agent.agentId);
  const price = flagNumber(command.flags, 'price');
  const availableTokens = flagNumber(command.flags, 'available-tokens') ?? flagNumber(command.flags, 'available_tokens');

  return {
    ...agent,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(host ? { host } : {}),
    ...(port ? { port } : {}),
    ...(agentId ? { agentId } : {}),
    ...(capabilities ? { capabilities } : {}),
    listing: {
      ...agent.listing,
      ...(price === undefined ? {} : { price }),
      ...(availableTokens === undefined ? {} : { availableTokens })
    }
  };
}

function profileUpdateFromAgent(agent: ResolvedAgentConfig, command: ParsedCommand): AgentInstanceConfig {
  const capabilities = capabilitiesFromFlags(command);
  const update: AgentInstanceConfig = {
    name: agent.name,
    description: agent.description,
    version: agent.version,
    host: agent.host,
    port: agent.port,
    agentId: agent.agentId,
    capabilities: capabilities || agent.capabilities,
    listing: agent.listing
  };
  if (agent.mode === 'remote_service') update.mode = agent.mode;
  return update;
}

function validateBillableCapabilities(agent: ResolvedAgentConfig) {
  const invalid = agent.capabilities
    .filter((capability) => capability.enabled !== false)
    .filter((capability) => !Number.isFinite(Number(capability.fixedTokens)) || Number(capability.fixedTokens) <= 0);
  if (invalid.length > 0) {
    throw new Error(`A2A listing capabilities require positive fixedTokens: ${invalid.map((capability) => capability.id).join(', ')}`);
  }
}

function isDelistedFlag(command: ParsedCommand) {
  if (command.flags.public === true && command.flags.delisted === true) {
    throw new Error('Use either --public or --delisted, not both.');
  }
  if (command.flags.public === true) return false;
  if (command.flags.delisted === true) return true;
  return undefined;
}

export async function agentCommand(command: ParsedCommand) {
  const [action, ...args] = command.args;
  const config = loadConfig();

  if (action === 'profile') {
    const [profileAction, profileName] = args;
    if (profileAction === 'list') {
      const rows = [
        resolveAgentConfig(config),
        ...Object.keys(config.agentProfiles || {}).map((name) => resolveAgentConfig(config, name))
      ].map((agent) => ({
        profile: agent.profile,
        agent: agent.agentId || '',
        name: agent.name,
        host: agent.host,
        port: agent.port,
        price: agent.listing.price,
        delisted: agent.listing.isDelisted
      }));
      return table(rows);
    }
    if (profileAction === 'set') {
      const normalizedProfile = normalizeProfileName(profileName);
      if (!normalizedProfile) throw new Error('Usage: $agent profile set <profile> [flags]');
      const agent = agentWithFlags(config, { ...command, flags: command.flags });
      saveAgentProfile(normalizedProfile, profileUpdateFromAgent({ ...agent, profile: normalizedProfile }, command));
      console.log(`Agent profile saved: ${normalizedProfile}`);
      return;
    }
    usage();
  }

  if (action === 'publish') {
    const agent = {
      ...agentWithFlags(config, command),
      mode: 'remote_service' as AgentMode
    };
    validateBillableCapabilities(agent);
    const listing = await publishLocalAgentListing(agent, {
      name: agent.name,
      description: agent.description,
      price: agent.listing.price,
      availableTokens: agent.listing.availableTokens
    });
    const savedAgent = { ...agent, agentId: Number(listing.agent_id || listing.agentId) };
    saveAgentProfile(savedAgent.profile, profileUpdateFromAgent(savedAgent, command));
    if (command.flags.json) return printJson(listing);
    console.log(`A2A remote service draft created: ${savedAgent.agentId}`);
    console.log(`profile: ${savedAgent.profile}`);
    console.log(`url: ${listing.agent_source || `https://momoai.pro/a2a/agents/${savedAgent.agentId}`}`);
    console.log(`next: $agent connect --profile ${savedAgent.profile}`);
    return;
  }

  if (action === 'update-listing') {
    const isDelisted = isDelistedFlag(command);
    const agent = {
      ...agentWithFlags(config, command),
      mode: 'remote_service' as AgentMode
    };
    validateBillableCapabilities(agent);
    const listing = await updateLocalAgentListing(agent, {
      agentId: agent.agentId,
      name: agent.name,
      description: agent.description,
      price: agent.listing.price,
      availableTokens: agent.listing.availableTokens,
      ...(isDelisted === undefined ? {} : { isDelisted })
    });
    const savedAgent = {
      ...agent,
      agentId: Number(listing.agent_id || listing.agentId || agent.agentId),
      listing: {
        ...agent.listing,
        ...(isDelisted === undefined ? {} : { isDelisted })
      }
    };
    saveAgentProfile(savedAgent.profile, profileUpdateFromAgent(savedAgent, command));
    if (command.flags.json) return printJson(listing);
    console.log(`A2A remote service listing updated: ${savedAgent.agentId}`);
    console.log(`profile: ${savedAgent.profile}`);
    console.log(`visibility: ${savedAgent.listing.isDelisted ? 'delisted' : 'public'}`);
    return;
  }

  if (action === 'serve') {
    const agent = agentWithFlags(config, command);
    const host = agent.host;
    const port = agent.port;
    const mode = modeFlag(command, agent.mode);
    if (mode === 'remote_service') {
      if (!agent.agentId) throw new Error('remote_service mode requires --agent-id, MOMOAI_AGENT_ID, or a published profile.');
      await runRemoteServiceProvider(agent);
      return;
    }

    console.log(`MOMOAI A2A agent server listening on http://${host}:${port}`);
    console.log(`mode: ${mode}`);
    console.log(`profile: ${agent.profile}`);
    console.log('Local mode does not charge a CLI agent fee and does not require platform invocation JWT.');
    await startAgentServer({ host, port, mode, agent });
    return;
  }

  if (action === 'connect') {
    const agent = agentWithFlags(config, command);
    if (!agent.agentId) throw new Error('$agent connect requires --agent-id, MOMOAI_AGENT_ID, or a published profile.');
    await runRemoteServiceProvider(agent);
    return;
  }

  if (action === 'card') {
    const agent = agentWithFlags(config, command);
    const card = buildAgentCard({
      mode: modeFlag(command, agent.mode),
      agentId: agent.agentId,
      agent
    });
    if (command.flags.json) return printJson(card);
    console.log(JSON.stringify(card, null, 2));
    return;
  }

  if (action === 'oasf') {
    const agent = agentWithFlags(config, command);
    const record = buildOasfRecord({
      mode: modeFlag(command, agent.mode),
      agentId: agent.agentId,
      agent
    });
    if (command.flags.json) return printJson(record);
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (action === 'call') {
    const endpoint = args[0];
    const content = args.slice(1).join(' ').trim();
    if (!endpoint || !content) usage();
    const result = await sendA2aMessage({
      endpoint,
      content,
      authToken: flagString(command.flags, 'auth') || config.account?.momoKey,
      capabilityId: flagString(command.flags, 'capability') || flagString(command.flags, 'capability-id') || flagString(command.flags, 'capability_id'),
      contextId: flagString(command.flags, 'context'),
      showPlan: command.flags['show-plan'] === true || command.flags.showPlan === true
    });
    if (command.flags.json) return printJson(result);
    const message = (result as any)?.status?.message;
    const text = Array.isArray(message?.parts)
      ? message.parts.map((part: any) => part.text).filter(Boolean).join('\n')
      : JSON.stringify(result, null, 2);
    console.log(text);
    return;
  }

  usage();
}
