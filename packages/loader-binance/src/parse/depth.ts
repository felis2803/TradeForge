import type {
  DepthDiff,
  SymbolId,
  SymbolScaleMap,
  TimestampMs,
} from '@tradeforge/core';
import { getScaleFor, toPriceInt, toQtyInt } from '@tradeforge/core';
import type { DepthStreamOptions } from '../types.js';
import { readJsonLinesGzip } from './jsonl.js';

interface RawDepthRecord {
  [key: string]: unknown;
}

type LevelInput = [unknown, unknown] | { price?: unknown; qty?: unknown };

function toTimestamp(raw: RawDepthRecord): TimestampMs {
  const source =
    raw.E ??
    raw.eventTime ??
    raw.timestamp ??
    raw.ts ??
    raw.time ??
    raw.T ??
    raw.date;
  const value = Number(source);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid depth timestamp: ${JSON.stringify(raw)}`);
  }
  return value as TimestampMs;
}

function toLevels(input: unknown): LevelInput[] {
  if (!Array.isArray(input)) return [];
  return input as LevelInput[];
}

function buildLevel(
  level: LevelInput,
  priceScale: number,
  qtyScale: number,
): { price: number; qty: number } {
  const priceSource = Array.isArray(level) ? level[0] : level.price;
  const qtySource = Array.isArray(level) ? level[1] : level.qty;
  const price = toPriceInt(String(priceSource ?? '0'), priceScale);
  const qty = toQtyInt(String(qtySource ?? '0'), qtyScale);
  return { price, qty };
}

function mapDepthRecord(
  raw: RawDepthRecord,
  symbol: SymbolId,
  scaleOverride?: SymbolScaleMap,
): DepthDiff {
  const ts = toTimestamp(raw);
  const scale = getScaleFor(symbol, scaleOverride);
  const mapLevel = (level: LevelInput) =>
    buildLevel(level, scale.priceScale, scale.qtyScale);
  const bids = toLevels(raw.b ?? raw.bids ?? raw.Bids).map(mapLevel);
  const asks = toLevels(raw.a ?? raw.asks ?? raw.Asks).map(mapLevel);
  return { ts, symbol, bids, asks };
}

export async function* parseDepthFile(
  path: string,
  opts: DepthStreamOptions,
): AsyncIterable<DepthDiff> {
  for await (const raw of readJsonLinesGzip(path)) {
    yield mapDepthRecord(
      raw as RawDepthRecord,
      opts.symbol,
      opts.scaleOverride,
    );
  }
}
