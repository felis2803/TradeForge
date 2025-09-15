/* eslint-disable */
import type {
  Trade,
  SymbolId,
  TimestampMs,
  Side,
  SymbolScaleMap,
} from '@tradeforge/core';
import * as core from '@tradeforge/core';

export interface TradeNormalizeOpts {
  symbol: SymbolId;
  scaleOverride?: SymbolScaleMap;
  mapping?: {
    time?: string;
    price?: string;
    qty?: string;
    side?: string;
    id?: string;
  };
}

export function normalizeTrade(
  raw: Record<string, any>,
  opts: TradeNormalizeOpts,
): Trade {
  const mapping = {
    time: 'time',
    price: 'price',
    qty: 'qty',
    side: 'side',
    id: 'id',
    ...opts.mapping,
  };
  const scale = core.getScaleFor(opts.symbol, opts.scaleOverride);
  const tsVal = raw[mapping.time];
  const ts: TimestampMs = Number(tsVal) as TimestampMs;
  const price = core.toPriceInt(String(raw[mapping.price]), scale.priceScale);
  const qty = core.toQtyInt(String(raw[mapping.qty]), scale.qtyScale);
  const sideRaw = raw[mapping.side];
  const sideVal =
    sideRaw === undefined ? undefined : (String(sideRaw).toUpperCase() as Side);
  const id =
    raw[mapping.id] !== undefined ? String(raw[mapping.id]) : undefined;
  const trade: Trade = { ts, symbol: opts.symbol, price, qty };
  if (sideVal !== undefined) trade.side = sideVal;
  if (id !== undefined) trade.id = id;
  return trade;
}
