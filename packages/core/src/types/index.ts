import type { brand } from './brands.js';

export type TimestampMs = brand<number, 'TimestampMs'>;
export type SymbolId = brand<string, 'SymbolId'>;
export type OrderId = brand<string, 'OrderId'>;
export type Side = 'BUY' | 'SELL';
export type Liquidity = 'MAKER' | 'TAKER';
export type PriceInt = brand<bigint, 'PriceInt'>;
export type QtyInt = brand<bigint, 'QtyInt'>;
export type NotionalInt = brand<bigint, 'NotionalInt'>;

export interface Trade {
  ts: TimestampMs;
  symbol: SymbolId;
  price: PriceInt;
  qty: QtyInt;
  side?: Side;
  id?: string;
}

export type DepthSide = 'bids' | 'asks';

export interface OrderBookLevel {
  price: PriceInt;
  qty: QtyInt;
}

export interface DepthDiff {
  ts: TimestampMs;
  symbol: SymbolId;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface Scale {
  priceScale: number;
  qtyScale: number;
}

export interface SymbolScaleMap {
  [symbol: string]: Scale;
}
