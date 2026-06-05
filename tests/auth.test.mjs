import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { SignJWT } from 'jose';
import { verifyInvocationAuth } from '../dist/agent/auth.js';

const secret = new TextEncoder().encode('test-secret');

async function signInvocationToken(claims = {}) {
  return new SignJWT({
    scope: 'agent.invoke',
    agent_id: 42,
    capability_id: 'gomoku_move',
    fixed_tokens: 1500,
    billing_mode: 'result',
    ...claims
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('https://platform.example.test')
    .setAudience('momoai:agent:42')
    .setSubject('user_123')
    .setJti('run_123')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);
}

describe('invocation auth', () => {
  beforeEach(() => {
    process.env.MOMOAI_API_URL = 'https://platform.example.test';
    process.env.MOMOAI_INVOCATION_JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    delete process.env.MOMOAI_API_URL;
    delete process.env.MOMOAI_INVOCATION_JWT_SECRET;
  });

  it('verifies a scoped platform invocation token', async () => {
    const token = await signInvocationToken();
    const auth = await verifyInvocationAuth(`Bearer ${token}`, 42);

    assert.equal(auth.callerUserId, 'user_123');
    assert.equal(auth.agentId, 42);
    assert.equal(auth.capabilityId, 'gomoku_move');
    assert.equal(auth.fixedTokens, 1500);
    assert.equal(auth.billingMode, 'result');
    assert.equal(auth.runId, 'run_123');
    assert.deepEqual(auth.scope, ['agent.invoke']);
  });

  it('rejects tokens without invocation scope', async () => {
    const token = await signInvocationToken({ scope: 'profile.read' });

    await assert.rejects(
      () => verifyInvocationAuth(`Bearer ${token}`, 42),
      /does not grant agent invocation scope/
    );
  });
});
