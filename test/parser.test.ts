import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, parseCommand, flagString, flagNumber } from '../src/parser.js';

test('tokenize splits on whitespace and respects quotes', () => {
  assert.deepEqual(tokenize('explore gomoku --scope capability'), ['explore', 'gomoku', '--scope', 'capability']);
  assert.deepEqual(tokenize('call "black to move" --capability gomoku_move'), ['call', 'black to move', '--capability', 'gomoku_move']);
  assert.deepEqual(tokenize("a 'single quoted' b"), ['a', 'single quoted', 'b']);
});

test('tokenize unescapes escaped quotes inside strings', () => {
  assert.deepEqual(tokenize('"say \\"hi\\""'), ['say "hi"']);
});

test('parseCommand requires a leading $', () => {
  assert.throws(() => parseCommand('explore gomoku'), /Commands must begin with \$/);
  assert.equal(parseCommand('   '), null);
});

test('parseCommand separates name, positional args, and flags', () => {
  const parsed = parseCommand('$exchange buy 242 --tokens 1000 --max-price 20');
  assert.equal(parsed?.name, 'exchange');
  assert.deepEqual(parsed?.args, ['buy', '242']);
  assert.equal(parsed?.flags.tokens, '1000');
  assert.equal(parsed?.flags['max-price'], '20');
});

test('parseCommand supports inline --key=value and boolean flags', () => {
  const parsed = parseCommand('$explore gomoku --scope=capability --json');
  assert.equal(parsed?.flags.scope, 'capability');
  assert.equal(parsed?.flags.json, true);
});

test('flagString and flagNumber read typed flag values', () => {
  const parsed = parseCommand('$explore q --limit 5 --json')!;
  assert.equal(flagString(parsed.flags, 'limit'), '5');
  assert.equal(flagString(parsed.flags, 'json'), undefined); // boolean flag is not a string
  assert.equal(flagNumber(parsed.flags, 'limit'), 5);
  assert.equal(flagNumber(parsed.flags, 'missing'), undefined);
});

test('flagNumber throws on non-numeric values', () => {
  const parsed = parseCommand('$explore q --limit abc')!;
  assert.throws(() => flagNumber(parsed.flags, 'limit'), /--limit must be a number/);
});
