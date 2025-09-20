import type {
  Trade,
  SymbolId,
  SymbolScaleMap,
  TimestampMs,
  Side,
} from '@tradeforge/core';
import { getScaleFor, toPriceInt, toQtyInt } from '@tradeforge/core';
import type { TradeStreamOptions } from '../types.js';
import { readJsonLinesGzip } from './jsonl.js';

interface RawTradeRecord {
  [key: string]: unknown;
}

function extractTime(raw: RawTradeRecord): unknown {
  return (
    raw.time ??
    raw.timestamp ??
    raw.T ??
    raw.ts ??
    raw.tradeTime ??
    raw.eventTime ??
    raw.date
  );
}

function extractPrice(raw: RawTradeRecord): unknown {
  return raw.price ?? raw.p ?? raw.P ?? raw.lastPrice;
}

function extractQty(raw: RawTradeRecord): unknown {
  return raw.qty ?? raw.q ?? raw.Q ?? raw.quantity ?? raw.baseQty;
}

function extractId(raw: RawTradeRecord): unknown {
  return raw.id ?? raw.tradeId ?? raw.t ?? raw.uid ?? raw.eventId;
}

function extractSide(raw: RawTradeRecord): string | undefined {
  const side = raw.side ?? raw.S;
  if (typeof side === 'string') {
    const normalized = side.trim().toUpperCase();
    if (normalized === 'BUY' || normalized === 'SELL') {
      return normalized;
    }
  }
  const isBuyerMaker = raw.isBuyerMaker ?? raw.m ?? raw.M;
  if (typeof isBuyerMaker === 'boolean') {
    return isBuyerMaker ? 'SELL' : 'BUY';
  }
  if (typeof isBuyerMaker === 'string') {
    const lowered = isBuyerMaker.toLowerCase();
    if (lowered === 'true' || lowered === '1') return 'SELL';
    if (lowered === 'false' || lowered === '0') return 'BUY';
  }
  return undefined;
}

function normalizeMappedTrade(
  mapped: Record<string, unknown>,
  symbol: SymbolId,
  scaleOverride?: SymbolScaleMap,
): Trade {
  const scale = getScaleFor(symbol, scaleOverride);
  const tsValue = Number(mapped.time);
  if (!Number.isFinite(tsValue)) {
    throw new Error(`Trade timestamp is invalid: ${mapped.time}`);
  }
  const ts = tsValue as TimestampMs;
  const price = toPriceInt(String(mapped.price), scale.priceScale);
  const qty = toQtyInt(String(mapped.qty), scale.qtyScale);
  const trade: Trade = {
    ts,
    symbol,
    price,
    qty,
  };
  const side = mapped.side;
  if (typeof side === 'string') {
    trade.side = side.toUpperCase() as Side;
    trade.aggressor = trade.side;
  }
  const id = mapped.id;
  if (id !== undefined) {
    trade.id = String(id);
  }
  return trade;
}

function mapTradeRecord(raw: RawTradeRecord): Record<string, unknown> {
  const time = extractTime(raw);
  const price = extractPrice(raw);
  const qty = extractQty(raw);
  if (time === undefined || price === undefined || qty === undefined) {
    throw new Error(`Invalid trade record: ${JSON.stringify(raw)}`);
  }
  const payload: Record<string, unknown> = {
    time,
    price,
    qty,
  };
  const id = extractId(raw);
  if (id !== undefined) payload.id = id;
  const side = extractSide(raw);
  if (side) payload.side = side;
  return payload;
}

export async function* parseTradesFile(
  path: string,
  opts: TradeStreamOptions,
): AsyncIterable<Trade> {
  for await (const raw of readJsonLinesGzip(path)) {
    const mapped = mapTradeRecord(raw as RawTradeRecord);
    yield normalizeMappedTrade(mapped, opts.symbol, opts.scaleOverride);
  }
}
