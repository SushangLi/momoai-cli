import { tokenize } from './parser.js';

type Rule = {
  subcommands?: string[];
  flags?: string[];
  subcommandFlags?: Record<string, string[]>;
};

const commands = ['register', 'explore', 'exchange', 'model', 'permission', 'run', 'config', 'agent', 'help', 'quit'];

const rules: Record<string, Rule> = {
  register: {
    subcommands: []
  },
  explore: {
    flags: ['--limit', '--scope', '--input-mode', '--output-mode', '--max-fixed-tokens', '--online-only', '--json']
  },
  exchange: {
    subcommands: ['balance', 'owned', 'listings', 'buy', 'sell'],
    flags: ['--json', '--agent', '--tokens', '--max-price', '--price'],
    subcommandFlags: {
      balance: ['--json'],
      owned: ['--json'],
      listings: ['--agent', '--json'],
      buy: ['--tokens', '--max-price'],
      sell: ['--tokens', '--price']
    }
  },
  model: {
    subcommands: []
  },
  permission: {
    subcommands: ['part', 'full']
  },
  run: {
    flags: ['--json']
  },
  agent: {
    subcommands: ['profile', 'publish', 'update-listing', 'serve', 'connect', 'expose', 'openclaw', 'card', 'market-card', 'call'],
    flags: ['--profile', '--mode', '--host', '--port', '--agent-id', '--service', '--provider-runtime', '--provider-url', '--name', '--description', '--price', '--available-tokens', '--capabilities', '--capabilities-file', '--public', '--delisted', '--auth', '--capability', '--output-mode', '--context', '--show-plan', '--gateway-base-url', '--local-base-url', '--openclaw-bin', '--standard-plugin-source', '--official-a2a-plugin-source', '--skip-standard-plugin', '--upstream-path', '--protected-path', '--provider-path', '--agent-card-path', '--market-path', '--path', '--paths', '--card-path', '--service-id', '--kind', '--hostname', '--https-port', '--include-standard', '--disable', '--dry-run', '--allow-unauthenticated', '--forward-authorization', '--restart', '--json'],
    subcommandFlags: {
      profile: ['--name', '--description', '--host', '--port', '--agent-id', '--service', '--provider-runtime', '--provider-url', '--price', '--available-tokens', '--capabilities', '--capabilities-file'],
      publish: ['--profile', '--name', '--description', '--service', '--provider-runtime', '--provider-url', '--price', '--available-tokens', '--capabilities', '--capabilities-file', '--json'],
      'update-listing': ['--profile', '--agent-id', '--public', '--delisted', '--name', '--description', '--service', '--provider-runtime', '--provider-url', '--price', '--available-tokens', '--capabilities', '--capabilities-file', '--json'],
      serve: ['--profile', '--mode', '--host', '--port', '--agent-id', '--service', '--provider-runtime', '--provider-url'],
      connect: ['--profile', '--agent-id', '--service', '--provider-runtime', '--provider-url'],
      expose: ['--profile', '--kind', '--local-base-url', '--gateway-base-url', '--provider-path', '--protected-path', '--upstream-path', '--agent-card-path', '--market-path', '--paths', '--include-standard', '--hostname', '--https-port', '--service-id', '--disable', '--dry-run', '--json'],
      openclaw: ['--profile', '--agent-id', '--service', '--provider-url', '--name', '--description', '--price', '--available-tokens', '--capabilities', '--capabilities-file', '--gateway-base-url', '--openclaw-bin', '--standard-plugin-source', '--official-a2a-plugin-source', '--skip-standard-plugin', '--upstream-path', '--protected-path', '--agent-card-path', '--market-path', '--path', '--card-path', '--service-id', '--allow-unauthenticated', '--forward-authorization', '--restart', '--public', '--json'],
      card: ['--profile', '--mode', '--agent-id', '--json'],
      'market-card': ['--profile', '--mode', '--agent-id', '--json'],
      call: ['--auth', '--capability', '--output-mode', '--context', '--show-plan', '--json']
    }
  },
  config: {
    subcommands: ['show', 'reset'],
    subcommandFlags: {},
  }
};

const configResetKeys = ['key'];

function currentToken(line: string) {
  if (line.endsWith(' ')) return '';
  return line.split(/\s/).pop() || '';
}

function completeFrom(values: string[], token: string, prefix = ''): [string[], string] {
  const matches = values
    .filter((value) => value.startsWith(token))
    .map((value) => `${prefix}${value} `);
  return [matches.length ? matches : values.map((value) => `${prefix}${value} `), token ? `${prefix}${token}` : ''];
}

export function completer(line: string): [string[], string] {
  const trimmedStart = line.trimStart();
  const token = currentToken(line);

  if (!trimmedStart.startsWith('$')) {
    return completeFrom(commands, token, '$');
  }

  const withoutDollar = trimmedStart.slice(1);
  const tokens = tokenize(withoutDollar);
  const endsWithSpace = line.endsWith(' ');

  if (tokens.length === 0 || (!endsWithSpace && tokens.length === 1)) {
    const partial = tokens[0] || token.replace(/^\$/, '');
    return completeFrom(commands, partial, '$');
  }

  const command = tokens[0];
  const rule = rules[command];
  if (!rule) {
    return [[], token];
  }

  const args = tokens.slice(1);
  const activeToken = endsWithSpace ? '' : token;
  const activeArgIndex = endsWithSpace ? args.length : Math.max(args.length - 1, 0);
  const firstArg = args[0];
  if (command === 'config' && firstArg === 'reset' && activeArgIndex === 1) {
    return completeFrom(configResetKeys, activeToken);
  }

  if (activeToken.startsWith('--')) {
    const flags = rule.subcommandFlags?.[firstArg] || rule.flags || [];
    return completeFrom(flags, activeToken);
  }

  if (activeArgIndex === 0 && rule.subcommands?.length) {
    return completeFrom(rule.subcommands, activeToken);
  }

  if (activeToken === '') {
    const flags = rule.subcommandFlags?.[firstArg] || rule.flags || [];
    return [flags.map((flag) => `${flag} `), ''];
  }

  return [[], activeToken];
}
