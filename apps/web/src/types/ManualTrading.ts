// Type definitions for Manual Trading feature

export interface Order {
  id: string;
  type: string;
  instrument: string;
  size: number;
  price?: number;
  status: 'active' | 'filled' | 'cancelled';
}

export interface Position {
  instrument: string;
  size: number;
  avgPrice: number;
  liqPrice: number;
}

export interface TradeRow {
  time: string;
  timestamp: number;
  side: 'buy' | 'sell';
  price: number;
  size: number;
}

export interface DepthRow {
  price: number;
  size: number;
}

export interface OrderBookSnapshot {
  bids: DepthRow[];
  asks: DepthRow[];
}

export interface ChartPoint {
  price: number;
  label: string;
}

export interface TickerSnapshot {
  last: number;
  change: number;
  volume: number;
  high: number;
  low: number;
}

export interface InstrumentProfile {
  basePrice: number;
  volatility: number;
  baseVolume: number;
}

export type DataMode = 'history' | 'realtime';
export type PlaybackSpeed = '0.25x' | '0.5x' | '1x' | '2x' | '4x';
