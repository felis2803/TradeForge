import type {
  PriceInt,
  QtyInt,
  SymbolId,
  TimestampMs,
} from '../types/index.js';

export interface OrderbookBest {
  bestBid?: PriceInt;
  bestAsk?: PriceInt;
}

export interface OrderbookTrade {
  ts: TimestampMs;
  price: PriceInt;
  qty: QtyInt;
  side: 'BUY' | 'SELL';
}

export interface OrderbookProvider {
  getBest(symbol: SymbolId): OrderbookBest;
  streamTrades(symbol: SymbolId): AsyncIterable<OrderbookTrade>;
}

export interface StaticMockOrderbookConfig {
  best: Record<string, OrderbookBest>;
}

export class StaticMockOrderbook implements OrderbookProvider {
  private readonly best: Record<string, OrderbookBest>;

  constructor(config: StaticMockOrderbookConfig) {
    this.best = { ...config.best };
  }

  getBest(symbol: SymbolId): OrderbookBest {
    const entry = this.best[symbol as unknown as string];
    return entry ? { ...entry } : {};
  }

  async *streamTrades(symbol: SymbolId): AsyncIterable<OrderbookTrade> {
    void symbol;
    // Static mock emits no trades; future PRs may extend this.
  }
}
