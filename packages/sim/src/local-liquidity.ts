import type {
  FillEvent,
  OrderBookLevel,
  OrderBookSnapshot,
  Side,
} from './types.js';

type BookSide = 'bids' | 'asks';

function mapForOrderSide(side: Side): BookSide {
  return side === 'BUY' ? 'asks' : 'bids';
}

function cloneLevels(levels: OrderBookLevel[]): OrderBookLevel[] {
  return levels.map((level) => ({ price: level.price, qty: level.qty }));
}

export class LocalLiquidityTracker {
  private readonly consumed: Record<BookSide, Map<bigint, bigint>> = {
    bids: new Map(),
    asks: new Map(),
  };

  reset(): void {
    this.consumed.bids.clear();
    this.consumed.asks.clear();
  }

  apply(snapshot: OrderBookSnapshot): OrderBookSnapshot {
    const bidsConsumed = this.consumed.bids.size > 0;
    const asksConsumed = this.consumed.asks.size > 0;
    if (!bidsConsumed && !asksConsumed) {
      return {
        ...snapshot,
        bids: cloneLevels(snapshot.bids),
        asks: cloneLevels(snapshot.asks),
      };
    }
    return {
      ...snapshot,
      bids: this.adjustSide(snapshot.bids, this.consumed.bids, bidsConsumed),
      asks: this.adjustSide(snapshot.asks, this.consumed.asks, asksConsumed),
    };
  }

  recordConsumption(
    side: Side,
    fills: ReadonlyArray<Pick<FillEvent, 'price' | 'qty'>>,
  ): void {
    if (fills.length === 0) {
      return;
    }
    const bookSide = mapForOrderSide(side);
    const ledger = this.consumed[bookSide];
    for (const fill of fills) {
      if (fill.qty <= 0n) {
        continue;
      }
      const current = ledger.get(fill.price) ?? 0n;
      ledger.set(fill.price, current + fill.qty);
    }
  }

  private adjustSide(
    levels: OrderBookLevel[],
    ledger: Map<bigint, bigint>,
    hasConsumption: boolean,
  ): OrderBookLevel[] {
    if (!hasConsumption) {
      return cloneLevels(levels);
    }
    const adjusted: OrderBookLevel[] = [];
    for (const level of levels) {
      const consumed = ledger.get(level.price) ?? 0n;
      const remaining = level.qty - consumed;
      if (remaining > 0n) {
        adjusted.push({ price: level.price, qty: remaining });
      }
    }
    return adjusted;
  }
}
