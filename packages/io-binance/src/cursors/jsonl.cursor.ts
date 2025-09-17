import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import fg from 'fast-glob';
import unzipper from 'unzipper';
import type { DepthDiff, SymbolId, Trade } from '@tradeforge/core';
import { parseJsonl } from '../parse/jsonl.js';
import { normalizeTrade } from '../normalize/trades.js';
import { normalizeDepth } from '../normalize/depth.js';
import type {
  CursorIterable,
  JsonlCursorDepthOptions,
  JsonlCursorReaderOptions,
  JsonlCursorTradesOptions,
  ReaderCursor,
} from './types.js';

interface JsonlSource {
  file: string;
  entry?: string;
  lines: AsyncIterable<string>;
}

async function* lineSplitter(stream: Readable): AsyncIterable<string> {
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk.toString('utf8');
    let idx = buffer.indexOf('\n');
    while (idx >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      yield line;
      idx = buffer.indexOf('\n');
    }
  }
  if (buffer.length > 0) {
    yield buffer.replace(/\r$/, '');
  }
}

async function expand(files: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const file of files) {
    if (/[\\*\?]/.test(file)) {
      const found = await fg(file, { dot: false });
      out.push(...found);
    } else {
      out.push(file);
    }
  }
  return out;
}

function isJsonl(path: string): boolean {
  return path.toLowerCase().endsWith('.jsonl');
}

function isJsonlGzip(path: string): boolean {
  return path.toLowerCase().endsWith('.jsonl.gz');
}

function isJsonlZip(path: string): boolean {
  return path.toLowerCase().endsWith('.jsonl.zip');
}

function ensureSupported(path: string): void {
  if (isJsonl(path) || isJsonlGzip(path) || isJsonlZip(path)) {
    return;
  }
  throw new Error(
    `createJsonlCursorReader supports only JSONL files (*.jsonl, *.jsonl.gz, *.jsonl.zip); received: ${path}`,
  );
}

async function openRegular(path: string): Promise<JsonlSource> {
  const stream = createReadStream(path);
  stream.setEncoding('utf8');
  return { file: path, lines: lineSplitter(stream) };
}

async function openGzip(path: string): Promise<JsonlSource> {
  const stream = createReadStream(path).pipe(createGunzip());
  (stream as unknown as Readable).setEncoding('utf8');
  return { file: path, lines: lineSplitter(stream as unknown as Readable) };
}

async function openZip(path: string): Promise<JsonlSource> {
  const directory = await unzipper.Open.file(path);
  const entries = [...directory.files].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  if (entries.length !== 1) {
    throw new Error('multi-entry zip is not supported in PR-8b');
  }
  const entry = entries[0];
  if (!isJsonl(entry.path)) {
    throw new Error(
      `createJsonlCursorReader expects .jsonl entry inside zip; received: ${entry.path}`,
    );
  }
  const stream = entry.stream();
  (stream as unknown as Readable).setEncoding('utf8');
  return {
    file: path,
    entry: entry.path,
    lines: lineSplitter(stream as unknown as Readable),
  };
}

async function openSource(path: string): Promise<JsonlSource> {
  if (isJsonl(path)) return openRegular(path);
  if (isJsonlGzip(path)) return openGzip(path);
  if (isJsonlZip(path)) return openZip(path);
  ensureSupported(path);
  return openRegular(path);
}

function isWithinFrom(ts: number, from?: number): boolean {
  return from === undefined || ts >= from;
}

function isWithinTo(ts: number, to?: number): boolean {
  return to === undefined || ts <= to;
}

export function createJsonlCursorReader(
  opts: JsonlCursorTradesOptions,
): CursorIterable<Trade>;
export function createJsonlCursorReader(
  opts: JsonlCursorDepthOptions,
): CursorIterable<DepthDiff>;
export function createJsonlCursorReader(
  opts: JsonlCursorReaderOptions,
): CursorIterable<Trade | DepthDiff> {
  const filesPromise = expand(opts.files);
  const startCursor = opts.startCursor;
  if (startCursor && startCursor.recordIndex < 0) {
    throw new Error('startCursor.recordIndex must be >= 0');
  }
  const cursor: ReaderCursor = startCursor
    ? { ...startCursor }
    : { file: '', recordIndex: 0 };
  const symbol = (opts.symbol ?? ('BTCUSDT' as SymbolId)) as SymbolId;
  const isTrades = opts.kind === 'trades';
  const timeFilter = opts.timeFilter;
  const limit = opts.limit;
  const assertMonotonic = opts.assertMonotonicTimestamps ?? false;

  return {
    currentCursor(): ReaderCursor {
      return { ...cursor };
    },
    async *[Symbol.asyncIterator](): AsyncIterator<Trade | DepthDiff> {
      const files = await filesPromise;
      let emitted = 0;
      let prevTs: number | undefined;
      let startLocated = !startCursor;
      let startActivated = !startCursor;
      for (const filePath of files) {
        ensureSupported(filePath);
        const source = await openSource(filePath);
        const matchesCursor =
          startCursor &&
          filePath === startCursor.file &&
          (startCursor.entry ?? undefined) === (source.entry ?? undefined);
        if (startCursor && !startActivated) {
          if (!matchesCursor) {
            continue;
          }
          startActivated = true;
          startLocated = true;
          cursor.file = filePath;
          if (source.entry === undefined) {
            delete cursor.entry;
          } else {
            cursor.entry = source.entry;
          }
          cursor.recordIndex = startCursor.recordIndex;
        } else {
          cursor.file = filePath;
          if (source.entry === undefined) {
            delete cursor.entry;
          } else {
            cursor.entry = source.entry;
          }
          cursor.recordIndex = 0;
        }
        let skipRecords = matchesCursor ? (startCursor?.recordIndex ?? 0) : 0;
        const records = parseJsonl(source.lines) as AsyncIterable<
          Record<string, unknown>
        >;
        for await (const raw of records) {
          const normalized = isTrades
            ? normalizeTrade(raw, { symbol })
            : normalizeDepth(raw, { symbol });
          const ts = normalized.ts as unknown as number;
          if (timeFilter) {
            if (!isWithinFrom(ts, timeFilter.fromMs)) {
              continue;
            }
            if (!isWithinTo(ts, timeFilter.toMs)) {
              continue;
            }
          }
          if (skipRecords && skipRecords > 0) {
            skipRecords -= 1;
            continue;
          }
          if (assertMonotonic && prevTs !== undefined && ts < prevTs) {
            const location = source.entry ?? source.file;
            throw new Error(
              `timestamp decreased: prev=${prevTs} current=${ts} file=${location}`,
            );
          }
          prevTs = ts;
          cursor.recordIndex += 1;
          yield normalized;
          emitted += 1;
          if (limit && emitted >= limit) {
            return;
          }
        }
      }
      if (startCursor && !startLocated) {
        throw new Error(
          `startCursor file not found in provided files: ${startCursor.file}`,
        );
      }
    },
  };
}
