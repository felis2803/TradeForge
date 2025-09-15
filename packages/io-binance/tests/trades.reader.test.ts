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

test('csv reading', async () => {
  const reader = createReader({
    kind: 'trades',
    files: ['packages/io-binance/tests/fixtures/trades.csv'],
  });
  const trades = await collect(reader);
  expect(trades).toHaveLength(3);
  expect(fromPriceInt((trades[0] as any).price, 5)).toBe('10000.01');
});

test('jsonl limit', async () => {
  const reader = createReader({
    kind: 'trades',
    files: ['packages/io-binance/tests/fixtures/trades.jsonl'],
    limit: 2,
  });
  const trades = await collect(reader);
  expect(trades).toHaveLength(2);
});

test('json array with time filter', async () => {
  const reader = createReader({
    kind: 'trades',
    files: ['packages/io-binance/tests/fixtures/trades.json'],
    timeFilter: { fromMs: 1577836800050 },
  });
  const trades = await collect(reader);
  expect(trades).toHaveLength(1);
  expect((trades[0] as any).ts).toBe(1577836800100);
});

test('gz and zip', async () => {
  const fixtures = 'packages/io-binance/tests/fixtures';
  const gzPath = join(tmpdir(), 'trades.csv.gz');
  writeFileSync(gzPath, gzipSync(readFileSync(join(fixtures, 'trades.csv'))));
  const zipBase64 =
    'UEsDBBQAAAAIAEt5L1u1V/BPZwAAAOEAAAAMABwAdHJhZGVzLmpzb25sVVQJAANdLMhoXSzIaHV4' +
    'CwABBAAAAAAEAAAAAKtWykxRslIyVNJRKijKTE4FsQ2AQM8AJFRYUgkUMNAzBbJLMnOBsoam5uYW' +
    'xmYWIDUGOkrFmSkgLU6hkUq1XNUQs4xQzTI0QDLIEItBhkgGBbv6+CBMMkY1yQjiEJhZRljMMsJw' +
    'FABQSwECHgMUAAAACABLeS9btVfwT2cAAADhAAAADAAYAAAAAAABAAAApIEAAAAAdHJhZGVzLmpz' +
    'b25sVVQFAANdLMhodXgLAAEEAAAAAAQAAAAAUEsFBgAAAAABAAEAUgAAAK0AAAAAAA==';
  const zipPath = join(tmpdir(), 'trades.jsonl.zip');
  writeFileSync(zipPath, Buffer.from(zipBase64, 'base64'));

  const reader = createReader({
    kind: 'trades',
    files: [gzPath, zipPath],
  });
  const trades = await collect(reader);
  expect(trades).toHaveLength(6);
  rmSync(gzPath);
  rmSync(zipPath);
});

test('assertMonotonicTimestamps', async () => {
  const reader = createReader({
    kind: 'trades',
    files: ['packages/io-binance/tests/fixtures/trades.nonmono.csv'],
    assertMonotonicTimestamps: true,
  });
  await expect(async () => {
    for await (const _ of reader) {
      /* noop */
    }
  }).rejects.toThrow(/timestamp decreased/);
});
