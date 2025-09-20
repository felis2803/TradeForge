/* eslint-disable @typescript-eslint/ban-ts-comment */
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { parseDepthFile } from '../src/parse/depth.js';

async function collect(iter) {
  const out = [];
  for await (const item of iter) out.push(item);
  return out;
}

test('parses gzipped depth JSONL', async () => {
  const lines = [
    JSON.stringify({
      timestamp: 1620000000000,
      bids: [['100.0', '0.1']],
      asks: [['100.1', '0.2']],
    }),
    JSON.stringify({
      E: 1620000000100,
      b: [{ price: '99.9', qty: '0.5' }],
      a: [['100.3', '0.1']],
    }),
  ].join('\n');
  const buffer = gzipSync(Buffer.from(lines, 'utf8'));
  const file = join(tmpdir(), 'depth.json.gz');
  writeFileSync(file, buffer);
  // @ts-ignore branded type casting is not relevant in tests
  const depth = await collect(
    parseDepthFile(file, { symbol: 'BTCUSDT', date: '2021-05-01' }),
  );
  expect(depth).toHaveLength(2);
  expect(depth[0]?.bids[0]?.price).toBeGreaterThan(0);
  expect(depth[1]?.asks[0]?.qty).toBeGreaterThan(0);
  rmSync(file);
});
