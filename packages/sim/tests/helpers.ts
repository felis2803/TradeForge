import type {
  DepthDiff,
  OrderBook,
  OrderBookLevel,
  OrderBookSnapshot,
  Side,
  Trade,
} from '@tradeforge/sim';

export class ManualStream<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolvers: ((value: IteratorResult<T>) => void)[] = [];
  private completed = false;

  push(value: T): void {
    if (this.completed) {
      throw new Error('stream closed');
    }
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      resolve?.({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  close(): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      resolve?.({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };
  }

  private next(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) {
      const value = this.queue.shift()!;
      return Promise.resolve({ value, done: false });
    }
    if (this.completed) {
      return Promise.resolve({ value: undefined as never, done: true });
    }
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}

export class TestOrderBook implements OrderBook {
  private bids: OrderBookLevel[] = [];
  private asks: OrderBookLevel[] = [];
  private lastSeq = 0;
  private lastTs = 0;

  applyDiff(diff: DepthDiff): void {
    this.lastSeq = diff.seq;
    this.lastTs = diff.ts;
    this.bids = diff.bids
      .map(([price, qty]) => ({ price, qty }))
      .filter((l) => l.qty > 0n);
    this.asks = diff.asks
      .map(([price, qty]) => ({ price, qty }))
      .filter((l) => l.qty > 0n);
  }

  getSnapshot(depth?: number): OrderBookSnapshot {
    const limit = typeof depth === 'number' ? depth : undefined;
    const bids =
      limit !== undefined ? this.bids.slice(0, limit) : [...this.bids];
    const asks =
      limit !== undefined ? this.asks.slice(0, limit) : [...this.asks];
    return {
      bids,
      asks,
      ts: this.lastTs,
      seq: this.lastSeq,
    };
  }
}

export async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

export function trade(
  side: Side,
  price: bigint,
  qty: bigint,
  ts: number,
): Trade {
  return { side, price, qty, ts };
}

export function depth(
  ts: number,
  seq: number,
  bids: [bigint, bigint][],
  asks: [bigint, bigint][],
): DepthDiff {
  return { ts, seq, bids, asks };
}
