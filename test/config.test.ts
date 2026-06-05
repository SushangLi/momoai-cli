import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAgentServiceType,
  normalizeAgentProviderRuntime,
  normalizeProfileName,
  normalizeCapabilitySkill
} from '../src/config.js';

test('normalizeAgentServiceType maps aliases and rejects unknown values', () => {
  assert.equal(normalizeAgentServiceType(undefined), 'websocket');
  assert.equal(normalizeAgentServiceType(''), 'websocket');
  assert.equal(normalizeAgentServiceType('websocket'), 'websocket');
  assert.equal(normalizeAgentServiceType('funnel'), 'funnel');
  assert.equal(normalizeAgentServiceType('polling'), 'websocket'); // legacy alias
  assert.equal(normalizeAgentServiceType('http'), 'funnel'); // legacy alias
  assert.throws(() => normalizeAgentServiceType('grpc'), /Invalid agent service type/);
});

test('normalizeAgentProviderRuntime defaults to cli and rejects unknown values', () => {
  assert.equal(normalizeAgentProviderRuntime(undefined), 'cli');
  assert.equal(normalizeAgentProviderRuntime('cli'), 'cli');
  assert.equal(normalizeAgentProviderRuntime('external'), 'external');
  assert.throws(() => normalizeAgentProviderRuntime('cloud'), /Invalid agent provider runtime/);
});

test('normalizeProfileName trims, validates charset, and rejects bad names', () => {
  assert.equal(normalizeProfileName('  openclaw '), 'openclaw');
  assert.equal(normalizeProfileName(''), undefined);
  assert.equal(normalizeProfileName(undefined), undefined);
  assert.throws(() => normalizeProfileName('has space'), /1-64 characters/);
  assert.throws(() => normalizeProfileName('a'.repeat(65)), /1-64 characters/);
});

test('normalizeCapabilitySkill reads nested and snake_case skill shapes', () => {
  const fromNested = normalizeCapabilitySkill({
    id: 'gomoku_move',
    skill: { id: 'play', name: 'Play', instructions: '  make the best move  ' }
  });
  assert.equal(fromNested?.id, 'play');
  assert.equal(fromNested?.name, 'Play');
  assert.equal(fromNested?.instructions, 'make the best move');

  const fromFlat = normalizeCapabilitySkill({
    id: 'cap',
    skill_id: 'flat_skill',
    skill_instructions: 'do the thing'
  });
  assert.equal(fromFlat?.id, 'flat_skill');
  assert.equal(fromFlat?.instructions, 'do the thing');
});

test('normalizeCapabilitySkill falls back to the capability id and returns undefined when empty', () => {
  const inherited = normalizeCapabilitySkill({ id: 'cap_only', instructions: 'go' });
  assert.equal(inherited?.id, 'cap_only');
  assert.equal(inherited?.instructions, 'go');
  assert.equal(normalizeCapabilitySkill({ id: 'cap' }), undefined);
});
