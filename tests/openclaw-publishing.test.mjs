import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeOpenClawCapabilityList,
  validateGenericOpenClawCapabilities
} from '../dist/agent/openclaw-publishing.js';

function agentWithCapabilities(capabilities) {
  return {
    profile: 'openclaw',
    mode: 'remote_service',
    serviceType: 'websocket',
    providerRuntime: 'external',
    name: 'OpenClaw Demo',
    description: 'OpenClaw A2A publishing test.',
    version: '0.1.0',
    host: '127.0.0.1',
    port: 41241,
    capabilities,
    listing: {
      price: 10,
      availableTokens: 1000000,
      isDelisted: true
    }
  };
}

describe('OpenClaw publishing validation', () => {
  it('normalizes explicit capability metadata from reviewer-provided JSON', () => {
    const capabilities = normalizeOpenClawCapabilityList([
      {
        capability_id: 'gomoku_move',
        name: 'Gomoku move',
        description: 'Return the next move.',
        fixed_tokens: 1500,
        input_modes: ['text/plain', 'application/json', 'text/plain'],
        output_modes: ['application/json'],
        skill: {
          id: 'gomoku_skill',
          description: 'Return the next move.',
          instructions: 'Use the local Gomoku skill.'
        }
      }
    ]);

    assert.deepEqual(capabilities, [
      {
        id: 'gomoku_move',
        name: 'Gomoku move',
        description: 'Return the next move.',
        fixedTokens: 1500,
        enabled: true,
        inputModes: ['text/plain', 'application/json'],
        outputModes: ['application/json'],
        formatContract: undefined,
        handler: undefined,
        skill: {
          id: 'gomoku_skill',
          description: 'Return the next move.',
          instructions: 'Use the local Gomoku skill.'
        }
      }
    ]);
  });

  it('accepts generic skill-router capabilities with positive result-token pricing', () => {
    assert.doesNotThrow(() => validateGenericOpenClawCapabilities(agentWithCapabilities([
      {
        id: 'gomoku_move',
        name: 'Gomoku move',
        description: 'Return the next move.',
        fixedTokens: 1500,
        enabled: true,
        skill: {
          id: 'gomoku_skill',
          instructions: 'Use the local Gomoku skill.'
        }
      }
    ])));
  });

  it('rejects unpriced, unbound, or capability-specific plugin publishing', () => {
    assert.throws(
      () => validateGenericOpenClawCapabilities(agentWithCapabilities([
        {
          id: 'bad_price',
          name: 'Bad price',
          description: 'Invalid price.',
          fixedTokens: 0,
          enabled: true,
          skill: {
            id: 'bad_price',
            instructions: 'Handle it.'
          }
        }
      ])),
      /positive fixedTokens/
    );

    assert.throws(
      () => validateGenericOpenClawCapabilities(agentWithCapabilities([
        {
          id: 'unbound',
          name: 'Unbound',
          description: 'No local skill.',
          fixedTokens: 1000,
          enabled: true
        }
      ])),
      /local skill binding/
    );

    assert.throws(
      () => validateGenericOpenClawCapabilities(agentWithCapabilities([
        {
          id: 'plugin_specific',
          name: 'Plugin specific',
          description: 'Should be rejected.',
          fixedTokens: 1000,
          enabled: true,
          handler: { type: 'http', path: '/plugin-specific' },
          skill: {
            id: 'plugin_specific',
            instructions: 'Handle it.'
          }
        }
      ])),
      /generic skill router only/
    );
  });
});
