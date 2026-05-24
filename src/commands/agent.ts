import { buildAgentCard, buildOasfRecord } from '../agent/card.js';
import { sendA2aMessage } from '../agent/client.js';
import { runRemoteServiceProvider } from '../agent/provider.js';
import { startAgentServer } from '../agent/server.js';
import { loadConfig } from '../config.js';
import { printJson } from '../format.js';
import { flagNumber, flagString } from '../parser.js';
import type { ParsedCommand } from '../parser.js';
import type { AgentMode } from '../config.js';

function usage() {
  throw new Error([
    'Usage:',
    '  $agent serve [--mode local|remote_service] [--host 127.0.0.1] [--port 41241] [--agent-id <id>]',
    '  $agent connect --agent-id <id>',
    '  $agent card [--mode local|remote_service] [--json] [--agent-id <id>]',
    '  $agent oasf [--mode local|remote_service] [--json] [--agent-id <id>]',
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

export async function agentCommand(command: ParsedCommand) {
  const [action, ...args] = command.args;
  const config = loadConfig();

  if (action === 'serve') {
    const host = flagString(command.flags, 'host') || config.agent.host;
    const port = flagNumber(command.flags, 'port') || config.agent.port;
    const mode = modeFlag(command, config.agent.mode);
    if (mode === 'remote_service') {
      const agentId = agentIdFlag(command, config.agent.agentId);
      if (!agentId) throw new Error('remote_service mode requires --agent-id or MOMOAI_AGENT_ID.');
      await runRemoteServiceProvider(agentId);
      return;
    }

    console.log(`MOMOAI A2A agent server listening on http://${host}:${port}`);
    console.log(`mode: ${mode}`);
    console.log('Local mode does not charge a CLI agent fee and does not require platform invocation JWT.');
    await startAgentServer({ host, port, mode });
    return;
  }

  if (action === 'connect') {
    const agentId = agentIdFlag(command, config.agent.agentId);
    if (!agentId) throw new Error('$agent connect requires --agent-id or MOMOAI_AGENT_ID.');
    await runRemoteServiceProvider(agentId);
    return;
  }

  if (action === 'card') {
    const card = buildAgentCard({
      mode: modeFlag(command, config.agent.mode),
      agentId: agentIdFlag(command, config.agent.agentId)
    });
    if (command.flags.json) return printJson(card);
    console.log(JSON.stringify(card, null, 2));
    return;
  }

  if (action === 'oasf') {
    const record = buildOasfRecord({
      mode: modeFlag(command, config.agent.mode),
      agentId: agentIdFlag(command, config.agent.agentId)
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
