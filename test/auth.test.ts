import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { verifyInvocationAuth } from '../src/agent/auth.js';

const ISSUER = 'https://platform.test';
const SECRET_TEXT = 'unit-test-invocation-secret';
const secret = new TextEncoder().encode(SECRET_TEXT);
const AGENT_ID = 7;

before(() => {
  // Use the shared-secret verification path so the test needs no JWKS network call.
  process.env.MOMOAI_INVOCATION_JWT_SECRET = SECRET_TEXT;
  process.env.MOMOAI_API_URL = ISSUER;
});

async function signToken(claims: Record<string, unknown>, audienceAgentId = AGENT_ID) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(claims.sub ?? 'caller-user'))
    .setIssuer(ISSUER)
    .setAudience(`momoai:agent:${audienceAgentId}`)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);
}

test('verifyInvocationAuth accepts a well-formed invocation token', async () => {
  const token = await signToken({
    sub: 'user-123',
    scope: 'agent.invoke',
    agent_id: AGENT_ID,
    capability_id: 'gomoku_move',
    fixed_tokens: 1000,
    billing_mode: 'result'
  });

  const auth = await verifyInvocationAuth(`Bearer ${token}`, AGENT_ID);
  assert.equal(auth.callerUserId, 'user-123');
  assert.equal(auth.agentId, AGENT_ID);
  assert.equal(auth.capabilityId, 'gomoku_move');
  assert.equal(auth.fixedTokens, 1000);
  assert.ok(auth.scope.includes('agent.invoke'));
});

test('verifyInvocationAuth rejects a missing token', async () => {
  await assert.rejects(() => verifyInvocationAuth(undefined, AGENT_ID), /Missing platform invocation token/);
});

test('verifyInvocationAuth rejects a token without an invocation scope', async () => {
  const token = await signToken({ sub: 'user-1', scope: 'profile.read', agent_id: AGENT_ID });
  await assert.rejects(() => verifyInvocationAuth(`Bearer ${token}`, AGENT_ID), /agent invocation scope/);
});

test('verifyInvocationAuth rejects a token whose agent does not match the provider', async () => {
  // Audience matches the expected provider, but the agent_id claim points elsewhere.
  const token = await signToken({ sub: 'user-1', scope: 'agent.invoke', agent_id: 999 });
  await assert.rejects(() => verifyInvocationAuth(`Bearer ${token}`, AGENT_ID), /target agent does not match/);
});

test('verifyInvocationAuth rejects a token signed with the wrong secret', async () => {
  const token = await new SignJWT({ sub: 'user-1', scope: 'agent.invoke', agent_id: AGENT_ID })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
    .setIssuer(ISSUER)
    .setAudience(`momoai:agent:${AGENT_ID}`)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('a-different-secret'));

  await assert.rejects(() => verifyInvocationAuth(`Bearer ${token}`, AGENT_ID));
});
