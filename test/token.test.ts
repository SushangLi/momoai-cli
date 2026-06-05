import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, makeId } from '../src/agent/token.js';

test('estimateTokens approximates ~4 chars per token', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2); // ceil(5 / 4)
  // non-strings are JSON-stringified first
  assert.equal(estimateTokens({ a: 1 }), estimateTokens(JSON.stringify({ a: 1 })));
});

test('makeId returns prefixed, unique-ish ids', () => {
  const a = makeId('plan');
  const b = makeId('plan');
  assert.match(a, /^plan_/);
  assert.notEqual(a, b);
});
