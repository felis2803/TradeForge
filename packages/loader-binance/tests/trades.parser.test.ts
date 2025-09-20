/* eslint-disable @typescript-eslint/ban-ts-comment */
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { parseTradesFile } from '../src/parse/trades.js';

async function collect(iter) {
  const out = [];
  for await (const item of iter) out.push(item);
  return out;
}

test('parses gzipped trade JSONL', async () => {
  const lines = [
    JSON.stringify({
      timestamp: 1620000000000,
      price: '100.01',
      quantity: '0.5',
      isBuyerMaker: false,
      tradeId: 1,
    }),
    JSON.stringify({
      time: 1620000000100,
      p: '100.02',
      q: '0.25',
      m: true,
      id: '2',
    }),
    JSON.stringify({
      time: 1620000000200,
      price: '100.03',
      quantity: '0.1',
      s: 'BTCUSDT',
      m: false,
    }),
  ].join('\n');
  const buffer = gzipSync(Buffer.from(lines, 'utf8'));
  const file = join(tmpdir(), 'trades.json.gz');
  writeFileSync(file, buffer);
  // @ts-ignore branded type casting is not relevant in tests
  const trades = await collect(
    parseTradesFile(file, { symbol: 'BTCUSDT', date: '2021-05-01' }),
  );
  expect(trades).toHaveLength(3);
  expect(trades[0]?.symbol).toBe('BTCUSDT');
  expect(trades[0]?.side).toBe('BUY');
  expect(trades[1]?.side).toBe('SELL');
  expect(trades[2]?.side).toBe('BUY');
  rmSync(file);
});
