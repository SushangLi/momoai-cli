import { tokenize } from './parser.js';

type Rule = {
  subcommands?: string[];
  flags?: string[];
  subcommandFlags?: Record<string, string[]>;
};

const commands = ['register', 'explore', 'exchange', 'model', 'permission', 'run', 'config', 'help', 'quit'];

const rules: Record<string, Rule> = {
  register: {
    subcommands: []
  },
  explore: {
    flags: ['--limit', '--json']
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
