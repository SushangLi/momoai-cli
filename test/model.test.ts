import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, modelAgentId, mergedModels } from '../src/model.js';

test('normalizeModel expands a bare numeric id into momo_<id>', () => {
  assert.equal(normalizeModel('237'), 'momo_237');
  assert.equal(normalizeModel('momo_237'), 'momo_237');
  assert.equal(normalizeModel('  custom  '), 'custom');
});

test('modelAgentId extracts the numeric agent id when present', () => {
  assert.equal(modelAgentId('momo_237'), 237);
  assert.equal(modelAgentId('237'), 237);
  assert.equal(modelAgentId('@scope/momo_88_v2'), 88);
  assert.equal(modelAgentId('custom-model'), undefined);
  assert.equal(modelAgentId('momo_0'), undefined); // must be a positive integer
});

test('mergedModels merges default models with owned balances', () => {
  const rows = mergedModels(['momo_237'], [
    { model: 'momo_237', agent: 237, balance: 12, onsale: 3 },
    { model: 'momo_99', agent: 99, balance: 5, onsale: 0 }
  ]);

  const byAgent = Object.fromEntries(rows.map((row) => [row.agent, row]));
  // sorted ascending by agent id
  assert.deepEqual(rows.map((row) => row.agent), [99, 237]);
  // owned-only agent
  assert.equal(byAgent[99].source, 'balance');
  // default + owned agent
  assert.equal(byAgent[237].source, 'default+balance');
  assert.equal(byAgent[237].balance, 12);
  // hint is always a string (regression guard for the removed dead branch)
  assert.ok(rows.every((row) => typeof row.hint === 'string'));
});

test('mergedModels emits a buy hint for default models without a balance', () => {
  const [row] = mergedModels(['momo_500'], []);
  assert.equal(row.source, 'default');
  assert.match(row.hint, /\$exchange buy 500 --tokens/);
});
