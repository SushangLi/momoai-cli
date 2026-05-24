import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { MomoClient } from '../client.js';
import { loadConfig } from '../config.js';
import { estimateTokens } from './token.js';

type StoredMessage = Record<string, unknown>;

interface MemoryState {
  contextId: string;
  summary: string;
  messages: StoredMessage[];
  updatedAt: string;
}

export interface MemorySnapshot {
  contextId: string;
  summary: string;
  messages: StoredMessage[];
  index: string;
}

function memoryRoot() {
  const configured = loadConfig().memory.path;
  return configured || join(homedir(), '.momoai-cli', 'memory');
}

function safeContextId(contextId: string) {
  return contextId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'default';
}

function contextDir(contextId: string) {
  return join(memoryRoot(), 'contexts', safeContextId(contextId));
}

function statePath(contextId: string) {
  return join(contextDir(contextId), 'state.json');
}

function detailPath(contextId: string) {
  return join(contextDir(contextId), 'detail.md');
}

function summaryPath(contextId: string) {
  return join(contextDir(contextId), 'summary.md');
}

function indexPath() {
  return join(memoryRoot(), 'index.md');
}

function readText(path: string, fallback = '') {
  if (!existsSync(path)) return fallback;
  return readFileSync(path, 'utf8');
}

function readState(contextId: string): MemoryState {
  const path = statePath(contextId);
  if (!existsSync(path)) {
    return {
      contextId,
      summary: '',
      messages: [],
      updatedAt: new Date().toISOString()
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<MemoryState>;
    return {
      contextId,
      summary: String(parsed.summary || ''),
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      updatedAt: String(parsed.updatedAt || new Date().toISOString())
    };
  } catch {
    return {
      contextId,
      summary: '',
      messages: [],
      updatedAt: new Date().toISOString()
    };
  }
}

function writeState(state: MemoryState) {
  const dir = contextDir(state.contextId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(state.contextId), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(summaryPath(state.contextId), renderSummary(state), { mode: 0o600 });
  updateIndex(state);
}

function updateIndex(state: MemoryState) {
  const path = indexPath();
  mkdirSync(dirname(path), { recursive: true });
  const current = readText(path, '# MOMOAI Agent Memory Index\n\n');
  const line = `- ${state.contextId}: updated ${state.updatedAt}; ${state.summary.split(/\r?\n/)[0] || 'no summary yet'}`;
  const lines = current
    .split(/\r?\n/)
    .filter((existing) => !existing.startsWith(`- ${state.contextId}:`));
  lines.push(line);
  writeFileSync(path, `${lines.filter(Boolean).join('\n')}\n`, { mode: 0o600 });
}

function renderSummary(state: MemoryState) {
  return [
    `# Context ${state.contextId}`,
    '',
    `Updated: ${state.updatedAt}`,
    '',
    '## Abstract Memory',
    '',
    state.summary || '(empty)',
    ''
  ].join('\n');
}

function appendDetail(contextId: string, title: string, body: string) {
  const path = detailPath(contextId);
  mkdirSync(dirname(path), { recursive: true });
  const current = readText(path, `# Context ${contextId} Detailed Memory\n\n`);
  const next = [
    current.trimEnd(),
    '',
    `## ${title}`,
    '',
    body.trim(),
    ''
  ].join('\n');
  writeFileSync(path, next, { mode: 0o600 });
}

function keepRecentMessages(messages: StoredMessage[], budget: number) {
  const kept: StoredMessage[] = [];
  let total = 0;
  for (const message of [...messages].reverse()) {
    const size = estimateTokens(message);
    if (kept.length > 0 && total + size > budget) break;
    kept.push(message);
    total += size;
  }
  return kept.reverse();
}

async function summarizeContext(state: MemoryState, invocationToken?: string) {
  const config = loadConfig();
  const prompt = [
    'Summarize this agent context into durable abstract memory.',
    'Keep stable facts, user preferences, decisions, open tasks, and tool/agent outcomes.',
    'Be concise and use Markdown bullets.',
    '',
    'Existing abstract memory:',
    state.summary || '(empty)',
    '',
    'Conversation/messages to compress:',
    JSON.stringify(state.messages)
  ].join('\n');

  try {
    const response = await new MomoClient().request<any>('/v1/chat/completions', {
      authToken: invocationToken,
      body: {
        model: config.model,
        messages: [
          { role: 'system', content: 'You maintain durable memory for an autonomous agent.' },
          { role: 'user', content: prompt }
        ]
      }
    });
    const summary = response.choices?.[0]?.message?.content;
    if (typeof summary === 'string' && summary.trim()) {
      return summary.trim();
    }
  } catch {
    // Fall through to deterministic fallback so compression never blocks a run.
  }

  return [
    state.summary,
    '',
    '- Compression fallback: model summarization failed.',
    `- Retained recent messages at ${new Date().toISOString()}.`
  ].filter(Boolean).join('\n').trim();
}

export class AgentMemory {
  load(contextId: string): MemorySnapshot {
    const state = readState(contextId);
    return {
      contextId,
      summary: state.summary,
      messages: state.messages,
      index: readText(indexPath(), '# MOMOAI Agent Memory Index\n')
    };
  }

  async saveRun(contextId: string, nextMessages: StoredMessage[], detail: string, invocationToken?: string) {
    const config = loadConfig();
    const state = readState(contextId);
    state.messages = nextMessages;
    state.updatedAt = new Date().toISOString();

    appendDetail(contextId, state.updatedAt, detail);

    if (estimateTokens(state.messages) >= config.memory.contextTokenLimit) {
      state.summary = await summarizeContext(state, invocationToken);
      state.messages = keepRecentMessages(state.messages, config.memory.recentTokenBudget);
      appendDetail(contextId, 'Automatic Compression', [
        `Approximate context exceeded ${config.memory.contextTokenLimit} tokens.`,
        '',
        '## New Abstract Memory',
        '',
        state.summary
      ].join('\n'));
    }

    writeState(state);
  }
}
