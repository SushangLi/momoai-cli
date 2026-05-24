import { readFileSync } from 'node:fs';
import { buildAgentCard, buildOasfRecord } from '../agent/card.js';
import { sendA2aMessage } from '../agent/client.js';
import { installOpenClawA2a } from '../agent/openclaw.js';
import { exposeViaTailscaleFunnel } from '../agent/tailscale.js';
import { runRemoteServiceProvider } from '../agent/provider.js';
import { startAgentServer } from '../agent/server.js';
import { loadConfig, normalizeAgentProviderRuntime, normalizeAgentServiceType, normalizeProfileName, resolveAgentConfig, saveAgentProfile } from '../config.js';
import { printJson, table } from '../format.js';
import { flagNumber, flagString } from '../parser.js';
import { publishLocalAgentListing, updateLocalAgentListing } from '../services.js';
import type { ParsedCommand } from '../parser.js';
import type { AgentCapability, AgentInstanceConfig, AgentMode, AgentProviderRuntime, AgentServiceType, CliConfig, ResolvedAgentConfig } from '../config.js';

function usage() {
  throw new Error([
    'Usage:',
    '  $agent profile list',
    '  $agent profile set <profile> [--name <name>] [--description <text>] [--host <host>] [--port <n>] [--agent-id <id>] [--service websocket|funnel] [--provider-runtime cli|external] [--provider-url <url>] [--price <credits_per_k>] [--available-tokens <n>] [--capabilities <json>|--capabilities-file <path>]',
    '  $agent publish [--profile <name>] [--name <name>] [--description <text>] [--service websocket|funnel] [--provider-runtime cli|external] [--provider-url <url>] [--price <credits_per_k>] [--available-tokens <n>] [--capabilities <json>|--capabilities-file <path>] [--json]',
    '  $agent update-listing [--profile <name>] [--agent-id <id>] [--public|--delisted] [--name <name>] [--description <text>] [--service websocket|funnel] [--provider-runtime cli|external] [--provider-url <url>] [--price <credits_per_k>] [--available-tokens <n>] [--capabilities <json>|--capabilities-file <path>] [--json]',
    '  $agent serve [--profile <name>] [--mode local|remote_service] [--host 127.0.0.1] [--port 41241] [--agent-id <id>] [--service websocket|funnel] [--provider-runtime cli|external] [--provider-url <url>]',
    '  $agent connect [--profile <name>] [--agent-id <id>] [--service websocket|funnel] [--provider-runtime cli|external] [--provider-url <url>]',
    '  $agent expose tailscale [--profile <name>] [--kind cli|openclaw|custom] [--local-base-url http://127.0.0.1:18789] [--provider-path /momoai/a2a/<name>] [--paths <comma-list>] [--include-standard] [--dry-run] [--disable]',
    '  $agent openclaw install-a2a [--profile <name>] [--agent-id <id>] [--service websocket|funnel] [--gateway-base-url http://127.0.0.1:18789] [--standard-plugin-source <source>] [--skip-standard-plugin] [--upstream-path /a2a/<name>] [--protected-path /momoai/a2a/<name>] [--provider-url <url>] [--allow-unauthenticated] [--restart]',
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

function serviceTypeFlag(command: ParsedCommand, fallback: AgentServiceType): AgentServiceType {
  return normalizeAgentServiceType(
    flagString(command.flags, 'service') ||
      flagString(command.flags, 'service-type') ||
      flagString(command.flags, 'service_type') ||
      fallback
  );
}

function explicitServiceTypeFlag(command: ParsedCommand): AgentServiceType | undefined {
  const value =
    flagString(command.flags, 'service') ||
    flagString(command.flags, 'service-type') ||
    flagString(command.flags, 'service_type');
  return value ? normalizeAgentServiceType(value) : undefined;
}

function providerRuntimeFlag(command: ParsedCommand, fallback: AgentProviderRuntime): AgentProviderRuntime {
  return normalizeAgentProviderRuntime(
    flagString(command.flags, 'provider-runtime') ||
      flagString(command.flags, 'provider_runtime') ||
      flagString(command.flags, 'runtime') ||
      fallback
  );
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
  const serviceType = serviceTypeFlag(command, agent.serviceType);
  const providerRuntime = providerRuntimeFlag(command, agent.providerRuntime);
  const providerUrl = flagString(command.flags, 'provider-url') || flagString(command.flags, 'provider_url');
  const price = flagNumber(command.flags, 'price');
  const availableTokens = flagNumber(command.flags, 'available-tokens') ?? flagNumber(command.flags, 'available_tokens');

  return {
    ...agent,
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(host ? { host } : {}),
    ...(port ? { port } : {}),
    ...(agentId ? { agentId } : {}),
    serviceType,
    providerRuntime,
    ...(providerUrl ? { providerUrl: providerUrl.trim().replace(/\/$/, '') } : {}),
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
    serviceType: agent.serviceType,
    providerRuntime: agent.providerRuntime,
    ...(agent.providerUrl ? { providerUrl: agent.providerUrl } : {}),
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
        service: agent.serviceType,
        runtime: agent.providerRuntime,
        name: agent.name,
        host: agent.host,
        port: agent.port,
        providerUrl: agent.providerUrl || '',
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
    if (savedAgent.providerRuntime === 'external') {
      console.log('note: external runtime registration exits after the platform endpoint is recorded.');
    }
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

  if (action === 'expose') {
    const [exposeAction] = args;
    if (exposeAction !== 'tailscale') usage();
    const kind = flagString(command.flags, 'kind') || 'cli';
    if (kind !== 'cli' && kind !== 'openclaw' && kind !== 'custom') {
      throw new Error('--kind must be cli, openclaw, or custom');
    }
    const agent = {
      ...agentWithFlags(config, {
        ...command,
        flags: {
          ...command.flags,
          service: 'funnel',
          'provider-runtime': kind === 'openclaw' || kind === 'custom' ? 'external' : 'cli'
        }
      }),
      mode: 'remote_service' as AgentMode,
      serviceType: 'funnel' as AgentServiceType,
      providerRuntime: kind === 'openclaw' || kind === 'custom' ? 'external' as AgentProviderRuntime : 'cli' as AgentProviderRuntime
    };
    const pathsFlag = flagString(command.flags, 'paths');
    const result = await exposeViaTailscaleFunnel(agent, {
      tailscaleBin: flagString(command.flags, 'tailscale-bin') || flagString(command.flags, 'tailscale_bin'),
      kind,
      localBaseUrl: flagString(command.flags, 'local-base-url') || flagString(command.flags, 'local_base_url') || flagString(command.flags, 'gateway-base-url') || flagString(command.flags, 'gateway_base_url'),
      hostname: flagString(command.flags, 'hostname'),
      httpsPort: flagNumber(command.flags, 'https-port') || flagNumber(command.flags, 'https_port'),
      serviceId: flagString(command.flags, 'service-id') || flagString(command.flags, 'service_id') || agent.profile,
      providerPath: flagString(command.flags, 'provider-path') || flagString(command.flags, 'provider_path') || flagString(command.flags, 'protected-path') || flagString(command.flags, 'protected_path'),
      upstreamPath: flagString(command.flags, 'upstream-path') || flagString(command.flags, 'upstream_path') || flagString(command.flags, 'path'),
      agentCardPath: flagString(command.flags, 'agent-card-path') || flagString(command.flags, 'agent_card_path') || flagString(command.flags, 'card-path') || flagString(command.flags, 'card_path'),
      marketPath: flagString(command.flags, 'market-path') || flagString(command.flags, 'market_path'),
      oasfPath: flagString(command.flags, 'oasf-path') || flagString(command.flags, 'oasf_path'),
      paths: pathsFlag ? pathsFlag.split(',').map((path) => path.trim()).filter(Boolean) : undefined,
      includeStandard: command.flags['include-standard'] === true || command.flags.include_standard === true,
      disable: command.flags.disable === true,
      dryRun: command.flags['dry-run'] === true || command.flags.dry_run === true
    });
    if (result.providerUrl && !result.disabled) {
      saveAgentProfile(agent.profile, profileUpdateFromAgent({ ...agent, providerUrl: result.providerUrl }, command));
    }
    if (command.flags.json) return printJson(result);
    console.log(result.disabled ? 'Tailscale Funnel exposure removed.' : 'Tailscale Funnel exposure prepared.');
    console.log(`profile: ${agent.profile}`);
    console.log(`kind: ${result.kind}`);
    console.log(`local base url: ${result.localBaseUrl}`);
    if (result.publicBaseUrl) console.log(`public base url: ${result.publicBaseUrl}`);
    if (result.providerUrl) console.log(`provider url: ${result.providerUrl}`);
    for (const path of result.paths) {
      console.log(`${path.executed ? 'configured' : 'dry-run'}: ${path.path} -> ${path.target}`);
    }
    if (!result.hostname) {
      console.log('note: tailscale hostname was not detected; run tailscale status --json after login or pass --hostname.');
    }
    return;
  }

  if (action === 'openclaw') {
    const [openclawAction] = args;
    if (openclawAction !== 'install-a2a') usage();
    const baseAgent = agentWithFlags(config, command);
    const serviceType = explicitServiceTypeFlag(command) || 'websocket';
    const agent = {
      ...baseAgent,
      mode: 'remote_service' as AgentMode,
      serviceType,
      providerRuntime: 'external' as AgentProviderRuntime
    };
    validateBillableCapabilities(agent);
    const result = await installOpenClawA2a(agent, {
      openclawBin: flagString(command.flags, 'openclaw-bin') || flagString(command.flags, 'openclaw_bin'),
      gatewayBaseUrl: flagString(command.flags, 'gateway-base-url') || flagString(command.flags, 'gateway_base_url') || flagString(command.flags, 'base-url') || flagString(command.flags, 'base_url'),
      standardPluginSource:
        flagString(command.flags, 'standard-plugin-source') ||
        flagString(command.flags, 'standard_plugin_source') ||
        flagString(command.flags, 'official-a2a-plugin-source') ||
        flagString(command.flags, 'official_a2a_plugin_source') ||
        flagString(command.flags, 'a2a-plugin-source') ||
        flagString(command.flags, 'a2a_plugin_source'),
      skipStandardPlugin: command.flags['skip-standard-plugin'] === true || command.flags.skip_standard_plugin === true,
      serviceId: flagString(command.flags, 'service-id') || flagString(command.flags, 'service_id') || agent.profile,
      upstreamPath: flagString(command.flags, 'upstream-path') || flagString(command.flags, 'upstream_path') || flagString(command.flags, 'path'),
      protectedPath: flagString(command.flags, 'protected-path') || flagString(command.flags, 'protected_path'),
      agentCardPath: flagString(command.flags, 'agent-card-path') || flagString(command.flags, 'agent_card_path') || flagString(command.flags, 'card-path') || flagString(command.flags, 'card_path'),
      marketPath: flagString(command.flags, 'market-path') || flagString(command.flags, 'market_path'),
      oasfPath: flagString(command.flags, 'oasf-path') || flagString(command.flags, 'oasf_path'),
      providerUrl: agent.providerUrl,
      serviceType: agent.serviceType,
      requirePlatformAuth: command.flags['allow-unauthenticated'] === true || command.flags.allow_unauthenticated === true ? false : true,
      forwardAuthorization: command.flags['forward-authorization'] === true || command.flags.forward_authorization === true,
      restart: command.flags.restart === true
    });
    const savedAgent = {
      ...agent,
      ...(agent.providerUrl ? { providerUrl: agent.providerUrl } : {})
    };
    saveAgentProfile(savedAgent.profile, profileUpdateFromAgent(savedAgent, command));
    console.log('OpenClaw A2A stack prepared.');
    console.log(`profile: ${agent.profile}`);
    console.log(`openclaw service: ${result.serviceId}`);
    console.log(`service type: ${result.serviceType}`);
    console.log(`standard plugin source: ${result.standardPluginSource}`);
    console.log(`standard plugin installed: ${result.standardPluginInstalled ? 'yes' : 'no'}`);
    console.log(`standard a2a endpoint: ${result.localStandardA2aUrl}`);
    console.log(`momoai protected provider endpoint: ${result.localProtectedProviderUrl}`);
    console.log(`standard agent card: ${result.localAgentCardUrl}`);
    console.log(`momoai market card: ${result.localMarketCardUrl}`);
    if (result.providerRegistration) {
      console.log(`provider node: ${result.providerRegistration.node_id}`);
      if (result.providerRegistration.relay_url) console.log(`relay url: ${result.providerRegistration.relay_url}`);
    } else {
      console.log('provider node: not registered (no agent id configured)');
    }
    if (agent.providerUrl) console.log(`registered provider url in profile: ${agent.providerUrl}`);
    if (!result.restarted) console.log('next: restart OpenClaw Gateway or run again with --restart.');
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
    const payload = result as any;
    const message = payload?.kind === 'message' ? payload : payload?.status?.message;
    const text = Array.isArray(message?.parts)
      ? message.parts.map((part: any) => part.text).filter(Boolean).join('\n')
      : JSON.stringify(result, null, 2);
    console.log(text);
    return;
  }

  usage();
}
