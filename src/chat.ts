import { AgentRuntime } from './agent/runtime.js';
import type { AgentRuntimeEvent } from './agent/runtime.js';
import { tokenize } from './parser.js';
import type { ConfirmTool } from './tools.js';

export interface SendChatOptions {
  showAgentTrace?: boolean;
}

const hideTraceFlags = new Set(['--hide-agent-trace', '--no-agent-trace']);

function extractChatOptions(content: string, options: SendChatOptions = {}) {
  const tokens = tokenize(content);
  const showAgentTrace = options.showAgentTrace ?? !tokens.some((token) => hideTraceFlags.has(token));
  const cleaned = content.replace(/(^|\s)--(?:hide-agent-trace|no-agent-trace)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    content: cleaned || content,
    showAgentTrace
  };
}

function formatObservation(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  return text.length > 2400 ? `${text.slice(0, 2400)}\n...` : text;
}

function printAgentTrace(event: AgentRuntimeEvent) {
  if (event.type === 'plan') {
    console.log(`Plan: ${event.id}`);
    console.log(event.text);
    return;
  }
  if (event.type === 'tool_call') {
    console.log(`Tool call: ${event.name}`);
    return;
  }
  console.log(`Observe: ${event.tool}`);
  console.log(formatObservation(event.result));
}

export async function sendChat(content: string, confirmTool?: ConfirmTool, options: SendChatOptions = {}) {
  const parsed = extractChatOptions(content, options);
  const reporter = parsed.showAgentTrace ? printAgentTrace : undefined;
  const result = await new AgentRuntime(confirmTool, reporter).run({ content: parsed.content });
  console.log(result.content);
}
