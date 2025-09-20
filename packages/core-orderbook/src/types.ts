export type Side = 'bid' | 'ask';

export interface Level {
  price: number;
  size: number;
}

export interface LevelWithSide extends Level {
  side: Side;
}

export interface OrderBookDiff {
  bids?: Level[];
  asks?: Level[];
  sequence?: number;
  timestamp?: number;
}

export interface OrderBookSnapshot {
  bids: Level[];
  asks: Level[];
  bestBid: Level | null;
  bestAsk: Level | null;
  sequence: number | null;
  timestamp: number | null;
}

export interface Trade {
  id?: string;
  price: number;
  size: number;
  side: Side;
  timestamp: number;
  sequence?: number;
}

export interface TradeIteratorOptions {
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
}

export type UpdateListener = (
  update: LevelWithSide & {
    sequence: number | null;
    timestamp: number | null;
  },
) => void;

export type TradeListener = (trade: Readonly<Trade>) => void;
