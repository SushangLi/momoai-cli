import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  buildProviderRegistrationPayload,
  normalizeWebSocketRelayUrl
} from '../dist/agent/provider.js';

function demoAgent(overrides = {}) {
  return {
    profile: 'demo',
    mode: 'remote_service',
    serviceType: 'websocket',
    providerRuntime: 'cli',
    name: 'Demo Provider',
    description: 'A provider relay test agent.',
    version: '0.1.0',
    host: '127.0.0.1',
    port: 41241,
    agentId: 42,
    capabilities: [
      {
        id: 'gomoku_move',
        name: 'Gomoku move',
        description: 'Return the next move.',
        fixedTokens: 1500,
        enabled: true,
        inputModes: ['text/plain'],
        outputModes: ['application/json']
      },
      {
        id: 'off',
        name: 'Disabled',
        description: 'Disabled capability.',
        enabled: false,
        fixedTokens: 1
      }
    ],
    listing: {
      price: 10,
      availableTokens: 1000000,
      isDelisted: true
    },
    ...overrides
  };
}

describe('provider relay registration', () => {
  beforeEach(() => {
    process.env.MOMOAI_API_URL = 'https://platform.example.test';
  });

  afterEach(() => {
    delete process.env.MOMOAI_API_URL;
  });

  it('normalizes relay URLs to WebSocket schemes', () => {
    assert.equal(normalizeWebSocketRelayUrl('https://platform.example.test/relay'), 'wss://platform.example.test/relay');
    assert.equal(normalizeWebSocketRelayUrl('http://127.0.0.1:3000/relay'), 'ws://127.0.0.1:3000/relay');
    assert.throws(() => normalizeWebSocketRelayUrl('ftp://platform.example.test/relay'), /Invalid WebSocket relay URL/);
  });

  it('builds provider registration payload with card and billable capabilities', () => {
    const payload = buildProviderRegistrationPayload(demoAgent());

    assert.equal(payload.agent_id, 42);
    assert.equal(payload.service_type, 'websocket');
    assert.equal(payload.card.supportedInterfaces[0].url, 'https://platform.example.test/a2a/agents/42');
    assert.deepEqual(payload.capabilities.map((capability) => capability.id), ['gomoku_move']);
    assert.deepEqual(payload.market_capabilities.map((capability) => ({
      id: capability.id,
      fixedTokens: capability.fixedTokens,
      outputModes: capability.outputModes
    })), [
      {
        id: 'gomoku_move',
        fixedTokens: 1500,
        outputModes: ['application/json']
      }
    ]);
  });

  it('requires a reachable URL for external funnel providers', () => {
    assert.throws(
      () => buildProviderRegistrationPayload(demoAgent({
        serviceType: 'funnel',
        providerRuntime: 'external',
        providerUrl: undefined
      })),
      /requires --provider-url/
    );
  });
});
