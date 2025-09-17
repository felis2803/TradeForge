/* eslint-disable */
import { createJsonlCursorReader } from '../src/index.js';
import type { Trade } from '@tradeforge/core';

async function collectTrades(iter: AsyncIterable<Trade>): Promise<Trade[]> {
  const out: Trade[] = [];
  for await (const value of iter) out.push(value);
  return out;
}

function projectTrade(trade: Trade): unknown[] {
  return [
    trade.ts,
    trade.price,
    trade.qty,
    trade.side ?? null,
    trade.id ?? null,
  ];
}

const TRADES_FILE = 'packages/io-binance/tests/fixtures/trades.jsonl';

test('jsonl cursor resumes trades stream without gaps', async () => {
  const fullReader = createJsonlCursorReader({
    kind: 'trades',
    files: [TRADES_FILE],
  });
  const full = await collectTrades(fullReader);

  const headReader = createJsonlCursorReader({
    kind: 'trades',
    files: [TRADES_FILE],
  });
  let cursor = headReader.currentCursor();
  let count = 0;
  for await (const _ of headReader) {
    count += 1;
    cursor = headReader.currentCursor();
    if (count === 2) break;
  }
  expect(cursor.recordIndex).toBe(2);
  expect(cursor.file).toBe(TRADES_FILE);

  const tailReader = createJsonlCursorReader({
    kind: 'trades',
    files: [TRADES_FILE],
    startCursor: cursor,
  });
  const tail = await collectTrades(tailReader);
  const expectedTail = full.slice(cursor.recordIndex);
  expect(tail.map(projectTrade)).toEqual(expectedTail.map(projectTrade));
});

test('startCursor with recordIndex=0 yields full dataset', async () => {
  const baseline = await collectTrades(
    createJsonlCursorReader({ kind: 'trades', files: [TRADES_FILE] }),
  );
  const resumed = await collectTrades(
    createJsonlCursorReader({
      kind: 'trades',
      files: [TRADES_FILE],
      startCursor: { file: TRADES_FILE, recordIndex: 0 },
    }),
  );
  expect(resumed.map(projectTrade)).toEqual(baseline.map(projectTrade));
});

test('startCursor with negative recordIndex throws', () => {
  expect(() =>
    createJsonlCursorReader({
      kind: 'trades',
      files: [TRADES_FILE],
      startCursor: { file: TRADES_FILE, recordIndex: -1 },
    }),
  ).toThrow(/recordIndex must be >= 0/);
});

test('unsupported formats are rejected', async () => {
  await expect(async () => {
    const reader = createJsonlCursorReader({
      kind: 'trades',
      files: ['packages/io-binance/tests/fixtures/trades.csv'],
    });
    for await (const _ of reader) {
      /* noop */
    }
  }).rejects.toThrow(/JSONL/);

  await expect(async () => {
    const reader = createJsonlCursorReader({
      kind: 'trades',
      files: ['packages/io-binance/tests/fixtures/trades.json'],
    });
    for await (const _ of reader) {
      /* noop */
    }
  }).rejects.toThrow(/JSONL/);
});
