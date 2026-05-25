import type { AgentMode, ResolvedAgentConfig } from '../config.js';

export interface AgentRunInput {
  content: string;
  mode?: AgentMode;
  capabilityId?: string;
  contextId?: string;
  showPlan?: boolean;
  invocationToken?: string;
  agent?: ResolvedAgentConfig;
}

export interface AgentRunResult {
  contextId: string;
  taskId?: string;
  content: string;
  plan?: {
    id: string;
    text: string;
  };
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface A2aMessagePart {
  kind?: string;
  type?: string;
  text?: string;
  data?: unknown;
  raw?: unknown;
  bytes?: string;
  uri?: string;
  url?: string;
  mimeType?: string;
  name?: string;
  file?: {
    bytes?: string;
    uri?: string;
    url?: string;
    mimeType?: string;
    name?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface A2aMessage {
  role?: string;
  parts?: A2aMessagePart[];
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}
