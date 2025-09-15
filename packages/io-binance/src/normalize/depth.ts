/* eslint-disable */
import type {
  DepthDiff,
  SymbolId,
  SymbolScaleMap,
  OrderBookLevel,
  TimestampMs,
} from '@tradeforge/core';
import * as core from '@tradeforge/core';

export interface DepthNormalizeOpts {
  symbol: SymbolId;
  scaleOverride?: SymbolScaleMap;
  mapping?: {
    time?: string;
    bids?: string;
    asks?: string;
  };
}

export function normalizeDepth(
  raw: Record<string, any>,
  opts: DepthNormalizeOpts,
): DepthDiff {
  const mapping = {
    time: 'E',
    bids: 'b',
    asks: 'a',
    ...opts.mapping,
  };
  const scale = core.getScaleFor(opts.symbol, opts.scaleOverride);
  const ts: TimestampMs = Number(raw[mapping.time]) as TimestampMs;
  const conv = (arr: any[]): OrderBookLevel[] =>
    arr.map((p) => {
      const [price, qty] = Array.isArray(p) ? p : [p.price, p.qty];
      return {
        price: core.toPriceInt(String(price), scale.priceScale),
        qty: core.toQtyInt(String(qty), scale.qtyScale),
      };
    });
  const bids = conv(raw[mapping.bids] ?? []);
  const asks = conv(raw[mapping.asks] ?? []);
  return { ts, symbol: opts.symbol, bids, asks };
}
