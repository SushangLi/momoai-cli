import { createRemoteJWKSet, jwtVerify } from 'jose';
import { loadConfig } from '../config.js';

export interface InvocationAuth {
  token: string;
  callerUserId: string;
  agentId?: number;
  capabilityId?: string;
  fixedTokens?: number;
  billingMode?: string;
  runId?: string;
  scope: string[];
  claims: Record<string, unknown>;
}

function splitScopes(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  return [];
}

function bearerToken(header: string | undefined) {
  return header?.replace(/^Bearer\s+/i, '').trim() || '';
}

function encodedSecret() {
  const secret = process.env.MOMOAI_INVOCATION_JWT_SECRET;
  return secret ? new TextEncoder().encode(secret) : undefined;
}

export async function verifyInvocationAuth(authorizationHeader: string | undefined, expectedAgentId?: number): Promise<InvocationAuth> {
  const token = bearerToken(authorizationHeader);
  if (!token) {
    throw new Error('Missing platform invocation token');
  }

  const config = loadConfig();
  const audienceAgentId = expectedAgentId || config.agent.agentId;
  const audience = audienceAgentId
    ? `momoai:agent:${audienceAgentId}`
    : undefined;
  const sharedSecret = encodedSecret();
  const jwksUrl = `${config.apiUrl}/api/a2a/jwks`;

  const verifyOptions = {
    ...(audience ? { audience } : {}),
    issuer: config.apiUrl
  };

  const verification = sharedSecret
    ? await jwtVerify(token, sharedSecret, verifyOptions)
    : await jwtVerify(token, createRemoteJWKSet(new URL(jwksUrl)), verifyOptions);

  const payload = verification.payload as Record<string, unknown>;
  const scopes = splitScopes(payload.scope);
  if (!scopes.includes('agent.invoke') && !scopes.includes('agent.subinvoke')) {
    throw new Error('Invocation token does not grant agent invocation scope');
  }

  const agentId = typeof payload.agent_id === 'number' ? payload.agent_id : Number(payload.agent_id || undefined) || undefined;
  if (expectedAgentId && agentId && agentId !== expectedAgentId) {
    throw new Error('Invocation token target agent does not match this provider');
  }

  const callerUserId = String(payload.sub || '');
  if (!callerUserId) {
    throw new Error('Invocation token is missing caller subject');
  }

  return {
    token,
    callerUserId,
    agentId,
    capabilityId: typeof payload.capability_id === 'string' ? payload.capability_id : undefined,
    fixedTokens: payload.fixed_tokens === undefined ? undefined : Number(payload.fixed_tokens),
    billingMode: typeof payload.billing_mode === 'string' ? payload.billing_mode : undefined,
    runId: typeof payload.jti === 'string' ? payload.jti : typeof payload.run_id === 'string' ? payload.run_id : undefined,
    scope: scopes,
    claims: payload
  };
}
