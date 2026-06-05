import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { maskSecret, truncate } from '../dist/format.js';

describe('format helpers', () => {
  it('masks long secrets while preserving short edge hints', () => {
    assert.equal(maskSecret('abcdefghijklmnopqrstuvwxyz'), 'abcd...wxyz');
  });

  it('masks short or missing secrets', () => {
    assert.equal(maskSecret('secret'), 's...t');
    assert.equal(maskSecret(''), '(not set)');
    assert.equal(maskSecret(undefined), '(not set)');
  });

  it('truncates long display values without touching short values', () => {
    assert.equal(truncate('short', 10), 'short');
    assert.equal(truncate('abcdefghijklmnopqrstuvwxyz', 10), 'abcdefg...');
  });
});
