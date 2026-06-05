import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAgentCard, buildMarketCard } from '../dist/agent/card.js';

const demoAgent = {
  profile: 'demo',
  mode: 'local',
  serviceType: 'websocket',
  providerRuntime: 'cli',
  name: 'Demo Agent',
  description: 'A deterministic test agent.',
  version: '0.1.0',
  host: '127.0.0.1',
  port: 41241,
  capabilities: [
    {
      id: 'gomoku_move',
      name: 'Gomoku move',
      description: 'Return the next move.',
      fixedTokens: 1500,
      enabled: true,
      inputModes: ['application/json', 'text/plain'],
      outputModes: ['application/json']
    },
    {
      id: 'disabled_capability',
      name: 'Disabled capability',
      description: 'Should not be rendered.',
      enabled: false
    }
  ],
  listing: {
    price: 10,
    availableTokens: 1000000,
    isDelisted: true
  }
};

describe('agent cards', () => {
  it('renders enabled A2A skills and local interfaces', () => {
    const card = buildAgentCard({
      mode: 'local',
      localBaseUrl: 'http://127.0.0.1:41241',
      agent: demoAgent
    });

    assert.equal(card.name, 'Demo Agent');
    assert.equal(card.supportedInterfaces[0].url, 'http://127.0.0.1:41241/a2a');
    assert.deepEqual(card.skills.map((skill) => skill.id), ['gomoku_move']);
    assert.deepEqual(card.defaultOutputModes, ['application/json']);
    assert.deepEqual(card.securityRequirements, []);
  });

  it('keeps MOMOAI market metadata separate from the Agent Card', () => {
    const marketCard = buildMarketCard({
      mode: 'local',
      localBaseUrl: 'http://127.0.0.1:41241',
      agent: demoAgent
    });

    assert.equal(marketCard.schema_version, 'momoai.a2a.market.v1');
    assert.equal(marketCard.standard_a2a.endpoint_url, 'http://127.0.0.1:41241/a2a');
    assert.equal(marketCard.momoai_market.charge_when, 'task_completed');
    assert.deepEqual(
      marketCard.momoai_market.capabilities.map((capability) => ({
        id: capability.id,
        fixedTokens: capability.fixedTokens
      })),
      [{ id: 'gomoku_move', fixedTokens: 1500 }]
    );
  });
});
