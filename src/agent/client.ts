import { JsonRpcTransport } from '@a2a-js/sdk/client';
import type { JsonRpcRequest } from './types.js';

function normalizeBaseUrl(input: string) {
  return input.replace(/\/$/, '');
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: any = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }
  if (!response.ok) {
    const message = payload.error?.message || payload.error || payload.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function resolveA2aEndpoint(input: string) {
  const trimmed = input.trim();
  if (/\/(?:momoai\/)?a2a(?:\/|$)/.test(trimmed)) return normalizeBaseUrl(trimmed);
  try {
    const url = new URL(trimmed);
    if (/\/a2a\/agents\/[^/]+\/?$/.test(url.pathname)) {
      return normalizeBaseUrl(trimmed);
    }
  } catch {
    // Fall through to agent-card resolution for relative or invalid input.
  }
  if (trimmed.includes('/.well-known/agent-card.json')) {
    const card = await fetchJson(trimmed);
    if (!card.url) throw new Error('Agent card does not include a url');
    return String(card.url);
  }

  const baseUrl = normalizeBaseUrl(trimmed);
  const card = await fetchJson(`${baseUrl}/.well-known/agent-card.json`).catch(() => null);
  if (card?.url) return String(card.url);
  return `${baseUrl}/a2a`;
}

export async function sendA2aMessage(options: {
  endpoint: string;
  content: string;
  authToken?: string;
  capabilityId?: string;
  contextId?: string;
  showPlan?: boolean;
  acceptedOutputModes?: string[];
}) {
  const endpoint = await resolveA2aEndpoint(options.endpoint);
  const fetchImpl: typeof fetch = (input, init = {}) => {
    const headers = new Headers(init.headers);
    if (options.authToken) headers.set('Authorization', `Bearer ${options.authToken}`);
    return fetch(input, { ...init, headers });
  };
  const transport = new JsonRpcTransport({ endpoint, fetchImpl });
  return transport.sendMessage({
    message: {
      kind: 'message',
      messageId: `cli_${Date.now()}`,
      role: 'user',
      parts: [{ kind: 'text', text: options.content }],
      ...(options.contextId ? { contextId: options.contextId } : {})
    },
    ...(options.acceptedOutputModes?.length
      ? { configuration: { acceptedOutputModes: options.acceptedOutputModes } }
      : {}),
    metadata: {
      capability_id: options.capabilityId,
      contextId: options.contextId,
      showPlan: options.showPlan
    }
  });
}

export async function sendA2aMessageLegacy(options: {
  endpoint: string;
  content: string;
  authToken?: string;
  capabilityId?: string;
  contextId?: string;
  showPlan?: boolean;
  acceptedOutputModes?: string[];
}) {
  const endpoint = await resolveA2aEndpoint(options.endpoint);
  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: `cli_${Date.now()}`,
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: options.content }]
      },
      ...(options.acceptedOutputModes?.length
        ? { configuration: { acceptedOutputModes: options.acceptedOutputModes } }
        : {}),
      metadata: {
        capability_id: options.capabilityId,
        contextId: options.contextId,
        showPlan: options.showPlan
      }
    }
  };

  const response = await fetchJson(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {})
    },
    body: JSON.stringify(request)
  });

  if (response.error) {
    throw new Error(response.error.message || 'A2A call failed');
  }

  return response.result;
}
