/* eslint-disable */
import { createReader } from '../src/index.js';
import { fromPriceInt } from '@tradeforge/core';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';

async function collect(iter: AsyncIterable<any>): Promise<any[]> {
  const out: any[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

test('depth jsonl', async () => {
  const reader = createReader({
    kind: 'depth',
    files: ['packages/io-binance/tests/fixtures/depth.jsonl'],
  });
  const diffs = await collect(reader);
  expect(diffs).toHaveLength(2);
  expect(diffs[0]?.kind).toBe('depth');
  expect(diffs[0]?.source).toBe('DEPTH');
  expect(fromPriceInt((diffs[0] as any).payload.bids[0].price, 5)).toBe(
    '10000',
  );
});

test('gz limit and time filter', async () => {
  const fixtures = 'packages/io-binance/tests/fixtures';
  const gzPath = join(tmpdir(), 'depth.jsonl.gz');
  writeFileSync(gzPath, gzipSync(readFileSync(join(fixtures, 'depth.jsonl'))));
  const reader = createReader({
    kind: 'depth',
    files: [gzPath],
    limit: 1,
    timeFilter: { fromMs: 1577836800000 },
  });
  const diffs = await collect(reader);
  expect(diffs).toHaveLength(1);
  expect(Number((diffs[0] as any).ts)).toBe(1577836800000);
  expect((diffs[0] as any).seq).toBe(0);
  rmSync(gzPath);
});
