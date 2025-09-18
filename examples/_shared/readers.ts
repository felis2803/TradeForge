import { basename } from 'node:path';
import { createJsonlCursorReader } from '@tradeforge/io-binance';
import type {
  CursorIterable,
  JsonlCursorDepthOptions,
  JsonlCursorTradesOptions,
} from '@tradeforge/io-binance';
import type {
  CoreReaderCursor,
  DepthDiff,
  DepthEvent,
  Trade,
  TradeEvent,
} from '@tradeforge/core';

function parseList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseTime(value?: string): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^-?\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : undefined;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function resolveFiles(input: string[], envValue?: string): string[] {
  const explicit = input.map((f) => f.trim()).filter(Boolean);
  const fallback = parseList(envValue);
  if (explicit.length > 0) {
    return explicit;
  }
  return fallback;
}

function ensureFiles(kind: string, files: string[]): string[] {
  if (files.length === 0) {
    throw new Error(
      `no ${kind} files provided. Set TF_${kind.toUpperCase()}_FILES or pass a non-empty array`,
    );
  }
  return files;
}

function buildTimeFilter(): { fromMs?: number; toMs?: number } | undefined {
  const fromMs = parseTime(process.env['TF_TIME_FROM']);
  const toMs = parseTime(process.env['TF_TIME_TO']);
  const filter: { fromMs?: number; toMs?: number } = {};
  if (fromMs !== undefined) {
    filter.fromMs = fromMs;
  }
  if (toMs !== undefined) {
    filter.toMs = toMs;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

function normalizeCursorValue(raw: unknown): CoreReaderCursor {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid cursor value');
  }
  const record = raw as Record<string, unknown>;
  const file = record['file'];
  const recordIndex = record['recordIndex'];
  if (typeof file !== 'string' || typeof recordIndex !== 'number') {
    throw new Error('cursor must contain file:string and recordIndex:number');
  }
  const cursor: CoreReaderCursor = { file, recordIndex };
  const entry = record['entry'];
  if (typeof entry === 'string') {
    cursor.entry = entry;
  }
  return cursor;
}

function wrapTradeCursor(
  source: CursorIterable<Trade>,
): CursorIterable<TradeEvent> {
  if (typeof source.currentCursor !== 'function') {
    throw new Error('trade cursor source must expose currentCursor');
  }
  const getCursor = source.currentCursor.bind(source);
  return {
    currentCursor(): CoreReaderCursor {
      return normalizeCursorValue(getCursor());
    },
    async *[Symbol.asyncIterator](): AsyncIterator<TradeEvent> {
      let currentKey: string | undefined;
      let seq = 0;
      for await (const payload of source) {
        const cursor = normalizeCursorValue(getCursor());
        const entry = cursor.entry ?? basename(cursor.file);
        const key = `${cursor.file}::${cursor.entry ?? ''}`;
        if (key !== currentKey) {
          currentKey = key;
          seq = 0;
        }
        const event: TradeEvent = {
          kind: 'trade',
          ts: payload.ts,
          payload,
          source: 'TRADES',
          seq: seq++,
        };
        if (entry) {
          event.entry = entry;
        }
        yield event;
      }
    },
  } satisfies CursorIterable<TradeEvent>;
}

function wrapDepthCursor(
  source: CursorIterable<DepthDiff>,
): CursorIterable<DepthEvent> {
  if (typeof source.currentCursor !== 'function') {
    throw new Error('depth cursor source must expose currentCursor');
  }
  const getCursor = source.currentCursor.bind(source);
  return {
    currentCursor(): CoreReaderCursor {
      return normalizeCursorValue(getCursor());
    },
    async *[Symbol.asyncIterator](): AsyncIterator<DepthEvent> {
      let currentKey: string | undefined;
      let seq = 0;
      for await (const payload of source) {
        const cursor = normalizeCursorValue(getCursor());
        const entry = cursor.entry ?? basename(cursor.file);
        const key = `${cursor.file}::${cursor.entry ?? ''}`;
        if (key !== currentKey) {
          currentKey = key;
          seq = 0;
        }
        const event: DepthEvent = {
          kind: 'depth',
          ts: payload.ts,
          payload,
          source: 'DEPTH',
          seq: seq++,
        };
        if (entry) {
          event.entry = entry;
        }
        yield event;
      }
    },
  } satisfies CursorIterable<DepthEvent>;
}

export function buildTradesReader(
  files: string[],
  startCursor?: CoreReaderCursor,
): CursorIterable<TradeEvent> {
  const resolved = ensureFiles(
    'trades',
    resolveFiles(files, process.env['TF_TRADES_FILES']),
  );
  const options: JsonlCursorTradesOptions = {
    kind: 'trades',
    files: resolved,
  };
  if (startCursor) {
    options.startCursor = startCursor;
  }
  const timeFilter = buildTimeFilter();
  if (timeFilter) {
    options.timeFilter = timeFilter;
  }
  const cursor = createJsonlCursorReader(options);
  return wrapTradeCursor(cursor);
}

export async function peekFirstTradePrice(
  files: string[],
): Promise<string | undefined> {
  const resolved = ensureFiles(
    'trades',
    resolveFiles(files, process.env['TF_TRADES_FILES']),
  );
  const options: JsonlCursorTradesOptions = {
    kind: 'trades',
    files: resolved,
    limit: 1,
  };
  const cursor = createJsonlCursorReader(options);
  const iterator = cursor[Symbol.asyncIterator]();
  const close = (cursor as { close?: () => Promise<void> | void }).close?.bind(
    cursor,
  );
  let failed = false;
  try {
    const { value, done } = await iterator.next();
    if (done || !value) {
      return undefined;
    }
    const trade = value as Trade;
    const rawPrice = trade.price as unknown;
    if (typeof rawPrice === 'bigint') {
      return rawPrice.toString(10);
    }
    if (rawPrice !== undefined && rawPrice !== null) {
      return String(rawPrice);
    }
    return undefined;
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    let releaseError: unknown;
    if (typeof iterator.return === 'function') {
      try {
        await iterator.return();
      } catch (err) {
        releaseError ??= err;
      }
    }
    if (close) {
      try {
        await close();
      } catch (err) {
        releaseError ??= err;
      }
    }
    if (!failed && releaseError) {
      throw releaseError;
    }
  }
}

export function buildDepthReader(
  files: string[],
  startCursor?: CoreReaderCursor,
): CursorIterable<DepthEvent> {
  const resolved = ensureFiles(
    'depth',
    resolveFiles(files, process.env['TF_DEPTH_FILES']),
  );
  const options: JsonlCursorDepthOptions = {
    kind: 'depth',
    files: resolved,
  };
  if (startCursor) {
    options.startCursor = startCursor;
  }
  const timeFilter = buildTimeFilter();
  if (timeFilter) {
    options.timeFilter = timeFilter;
  }
  const cursor = createJsonlCursorReader(options);
  return wrapDepthCursor(cursor);
}
