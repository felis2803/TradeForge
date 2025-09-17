/* eslint-disable */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { DepthDiff } from '@tradeforge/core';
import { createJsonlCursorReader } from '../src/index.js';

async function collectDepth(
  iter: AsyncIterable<DepthDiff>,
): Promise<DepthDiff[]> {
  const out: DepthDiff[] = [];
  for await (const value of iter) out.push(value);
  return out;
}

function projectDepth(diff: DepthDiff): unknown {
  return {
    ts: diff.ts,
    bids: diff.bids.map((b) => [b.price, b.qty]),
    asks: diff.asks.map((a) => [a.price, a.qty]),
  };
}

const DEPTH_JSONL = 'packages/io-binance/tests/fixtures/depth.jsonl';
const DEPTH_ZIP_BASE64 =
  'UEsDBBQAAAAIAAAAIVDhcvb0RgAAAIgAAAALAAAAZGVwdGguanNvbmyrVnJVsjI0NTe3MDazMAAB' +
  'HaUkJavoaCVDEEfPQElHyRBIxsbqKCXCxA0h4gZ6pkDxWq5qVDMMUc0whKq1RDMDJm4CNgMAUEsB' +
  'AhQDFAAAAAgAAAAhUOFy9vRGAAAAiAAAAAsAAAAAAAAAAAAAAIABAAAAAGRlcHRoLmpzb25sUEsF' +
  'BgAAAAABAAEAOQAAAG8AAAAAAA==';

let tempDir: string | undefined;
let depthGzPath!: string;
let depthZipPath!: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tf-depth-cursor-'));
  const payload = await readFile(DEPTH_JSONL);
  depthGzPath = join(tempDir, 'depth.jsonl.gz');
  await writeFile(depthGzPath, gzipSync(payload));
  depthZipPath = join(tempDir, 'depth.jsonl.zip');
  await writeFile(depthZipPath, Buffer.from(DEPTH_ZIP_BASE64, 'base64'));
});

afterAll(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('depth gz reader resumes from cursor', async () => {
  const baseline = await collectDepth(
    createJsonlCursorReader({ kind: 'depth', files: [depthGzPath] }),
  );
  const headReader = createJsonlCursorReader({
    kind: 'depth',
    files: [depthGzPath],
  });
  let cursor = headReader.currentCursor();
  let count = 0;
  for await (const _ of headReader) {
    count += 1;
    cursor = headReader.currentCursor();
    if (count === 1) break;
  }
  expect(cursor.recordIndex).toBe(1);
  expect(cursor.file).toBe(depthGzPath);

  const tailReader = createJsonlCursorReader({
    kind: 'depth',
    files: [depthGzPath],
    startCursor: cursor,
  });
  const tail = await collectDepth(tailReader);
  const expectedTail = baseline.slice(cursor.recordIndex);
  expect(tail.map(projectDepth)).toEqual(expectedTail.map(projectDepth));
});

test('depth zip reader exposes entry in cursor and resumes', async () => {
  const baseline = await collectDepth(
    createJsonlCursorReader({ kind: 'depth', files: [depthZipPath] }),
  );
  const headReader = createJsonlCursorReader({
    kind: 'depth',
    files: [depthZipPath],
  });
  let cursor = headReader.currentCursor();
  let count = 0;
  for await (const _ of headReader) {
    count += 1;
    cursor = headReader.currentCursor();
    if (count === 1) break;
  }
  expect(cursor.recordIndex).toBe(1);
  expect(cursor.file).toBe(depthZipPath);
  expect(cursor.entry).toBe('depth.jsonl');

  const tailReader = createJsonlCursorReader({
    kind: 'depth',
    files: [depthZipPath],
    startCursor: cursor,
  });
  const tail = await collectDepth(tailReader);
  const expectedTail = baseline.slice(cursor.recordIndex);
  expect(tail.map(projectDepth)).toEqual(expectedTail.map(projectDepth));
});

test('time filter applies before cursor increment', async () => {
  const reader = createJsonlCursorReader({
    kind: 'depth',
    files: [DEPTH_JSONL],
    timeFilter: { fromMs: 1577836800100 },
  });
  const values = await collectDepth(reader);
  expect(values).toHaveLength(1);
  expect(values[0]?.ts).toBe(1577836800100);
});
