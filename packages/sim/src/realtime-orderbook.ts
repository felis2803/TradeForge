import type {
  DepthDiff,
  OrderBook,
  OrderBookLevel,
  OrderBookSnapshot,
} from './types.js';

type BookSideMap = Map<string, bigint>;

type SortDirection = 'ASC' | 'DESC';

function toKey(price: bigint): string {
  return price.toString();
}

function applyUpdates(
  store: BookSideMap,
  updates: ReadonlyArray<[bigint, bigint]>,
): void {
  for (const [price, qty] of updates) {
    const key = toKey(price);
    if (qty > 0n) {
      store.set(key, qty);
    } else {
      store.delete(key);
    }
  }
}

function collectLevels(
  store: BookSideMap,
  direction: SortDirection,
  depth?: number,
): OrderBookLevel[] {
  if (store.size === 0) {
    return [];
  }
  const entries: OrderBookLevel[] = [];
  for (const [priceStr, qty] of store.entries()) {
    if (qty <= 0n) {
      continue;
    }
    entries.push({ price: BigInt(priceStr), qty });
  }
  entries.sort((a, b) => {
    if (a.price === b.price) {
      return 0;
    }
    if (direction === 'ASC') {
      return a.price < b.price ? -1 : 1;
    }
    return a.price > b.price ? -1 : 1;
  });
  if (depth === undefined) {
    return entries;
  }
  if (depth <= 0) {
    return [];
  }
  return entries.slice(0, depth);
}

export class RealtimeOrderBook implements OrderBook {
  private readonly bids: BookSideMap = new Map();
  private readonly asks: BookSideMap = new Map();
  private lastTs?: number;
  private lastSeq?: number;

  applyDiff(diff: DepthDiff): void {
    this.lastTs = diff.ts;
    this.lastSeq = diff.seq;
    if (diff.bids.length > 0) {
      applyUpdates(this.bids, diff.bids);
    }
    if (diff.asks.length > 0) {
      applyUpdates(this.asks, diff.asks);
    }
  }

  getSnapshot(depth?: number): OrderBookSnapshot {
    const bids = collectLevels(this.bids, 'DESC', depth);
    const asks = collectLevels(this.asks, 'ASC', depth);
    const snapshot: OrderBookSnapshot = { bids, asks };
    if (this.lastTs !== undefined) {
      snapshot.ts = this.lastTs;
    }
    if (this.lastSeq !== undefined) {
      snapshot.seq = this.lastSeq;
    }
    return snapshot;
  }
}
