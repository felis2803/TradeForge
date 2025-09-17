import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJsonlCursorReader } from '../src/index.js';

const TRADES_FILE = 'packages/io-binance/tests/fixtures/trades.jsonl';
const MULTI_ENTRY_ZIP_BASE64 =
  'UEsDBAoAAAAAAKBjMVt5okfBCQAAAAkAAAAHABwAYS5qc29ubFVUCQADi6nKaIupymh1eAsAAQQAAAAABAAAAAB7InRzIjoxfQp' +
  'QSwMECgAAAAAAoGMxWyAcAcMJAAAACQAAAAcAHABiLmpzb25sVVQJAAOLqcpoi6nKaHV4CwABBAAAAAAEAAAAAHsidHMiOjJ9Cl' +
  'BLAQIeAwoAAAAAAKBjMVt5okfBCQAAAAkAAAAHABgAAAAAAAEAAACkgQAAAABhLmpzb25sVVQFAAOLqcpodXgLAAEEAAAAAAQAAA' +
  'AAUEsBAh4DCgAAAAAAoGMxWyAcAcMJAAAACQAAAAcAGAAAAAAAAQAAAKSBSgAAAGIuanNvbmxVVAUAA4upymh1eAsAAQQAAAAABA' +
  'AAAAABQSwUGAAAAAAIAAgCaAAAAlAAAAAAA';

let tempDir: string | undefined;
let multiEntryZipPath: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'tf-jsonl-errors-'));
  multiEntryZipPath = join(tempDir, 'multi-entry.jsonl.zip');
  await writeFile(
    multiEntryZipPath,
    Buffer.from(MULTI_ENTRY_ZIP_BASE64, 'base64'),
  );
});

afterAll(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('startCursor with negative recordIndex is rejected immediately', () => {
  expect(() =>
    createJsonlCursorReader({
      kind: 'trades',
      files: [TRADES_FILE],
      startCursor: { file: TRADES_FILE, recordIndex: -5 },
    }),
  ).toThrow('startCursor.recordIndex must be >= 0');
});

test('unsupported extensions mention JSONL in the error', async () => {
  await expect(
    (async () => {
      const reader = createJsonlCursorReader({
        kind: 'trades',
        files: [join(tempDir!, 'invalid.csv')],
      });
      for await (const _ of reader) {
        void _;
      }
    })(),
  ).rejects.toThrow('supports only JSONL files');

  await expect(
    (async () => {
      const reader = createJsonlCursorReader({
        kind: 'trades',
        files: [join(tempDir!, 'invalid.json')],
      });
      for await (const _ of reader) {
        void _;
      }
    })(),
  ).rejects.toThrow('supports only JSONL files');
});

test('zip files with multiple entries are rejected', async () => {
  await expect(
    (async () => {
      const reader = createJsonlCursorReader({
        kind: 'trades',
        files: [multiEntryZipPath],
      });
      for await (const _ of reader) {
        void _;
      }
    })(),
  ).rejects.toThrow('multi-entry zip not supported');
});

test('timeFilter increments cursor only for emitted records', async () => {
  const reader = createJsonlCursorReader({
    kind: 'trades',
    files: [TRADES_FILE],
    timeFilter: { fromMs: 1577836800100 },
  });
  let count = 0;
  for await (const _ of reader) {
    void _;
    count += 1;
  }
  const cursor = reader.currentCursor();
  expect(count).toBe(2);
  expect(cursor.recordIndex).toBe(2);
  expect(cursor.file).toBe(TRADES_FILE);
});
