import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCommand, tokenize } from '../dist/parser.js';

describe('parser', () => {
  it('tokenizes quoted arguments and escaped quotes', () => {
    assert.deepEqual(
      tokenize('agent call "https://example.test/a2a" "say \\"hello\\"" --json'),
      ['agent', 'call', 'https://example.test/a2a', 'say "hello"', '--json']
    );
  });

  it('parses command arguments, boolean flags, and valued flags', () => {
    assert.deepEqual(parseCommand('$exchange buy 42 --tokens 1000 --max-price=12.5 --json'), {
      name: 'exchange',
      args: ['buy', '42'],
      flags: {
        tokens: '1000',
        'max-price': '12.5',
        json: true
      }
    });
  });

  it('rejects non-command input', () => {
    assert.throws(() => parseCommand('hello'), /Commands must begin with \$/);
  });
});
