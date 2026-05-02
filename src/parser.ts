export interface ParsedCommand {
  name: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(input))) {
    tokens.push((match[1] || match[2] || match[3]).replace(/\\(["'])/g, '$1'));
  }

  return tokens;
}

export function parseCommand(line: string): ParsedCommand | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('$')) {
    throw new Error('Commands must begin with $.');
  }

  const tokens = tokenize(trimmed.slice(1));
  if (tokens.length === 0) return null;

  const [name, ...rest] = tokens;
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      args.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split(/=(.*)/s).filter(Boolean);
    if (inlineValue !== undefined) {
      flags[rawKey] = inlineValue;
      continue;
    }

    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      flags[rawKey] = next;
      index += 1;
    } else {
      flags[rawKey] = true;
    }
  }

  return { name, args, flags };
}

export function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function flagNumber(flags: Record<string, string | boolean>, name: string): number | undefined {
  const value = flagString(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}
