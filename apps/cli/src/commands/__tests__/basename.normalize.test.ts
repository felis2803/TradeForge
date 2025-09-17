import { normalizeFixtureBasename } from '../simulate.js';

const normalize = (value: string): string => normalizeFixtureBasename(value);

test('normalizeFixtureBasename keeps .jsonl unchanged', () => {
  expect(normalize('trades.jsonl')).toBe('trades.jsonl');
});

test('normalizeFixtureBasename strips gzip suffix', () => {
  expect(normalize('trades.jsonl.gz')).toBe('trades.jsonl');
});

test('normalizeFixtureBasename strips zip suffix', () => {
  expect(normalize('trades.jsonl.zip')).toBe('trades.jsonl');
});

test('normalizeFixtureBasename is case-insensitive for compression suffix', () => {
  expect(normalize('TRADES.JSONL.GZ')).toBe('TRADES.JSONL');
});
