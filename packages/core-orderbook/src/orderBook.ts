import { PriceLevels } from './priceLevels.js';
import { TradeStore } from './tradeStore.js';
import {
  Level,
  OrderBookDiff,
  OrderBookSnapshot,
  Side,
  Trade,
  TradeIteratorOptions,
  TradeListener,
  UpdateListener,
} from './types.js';

interface Meta {
  sequence?: number;
  timestamp?: number;
}

export interface SnapshotSeed {
  bids?: Level[];
  asks?: Level[];
  sequence?: number;
  timestamp?: number;
}

export class OrderBook {
  private readonly bids = new PriceLevels('bid');
  private readonly asks = new PriceLevels('ask');
  private readonly trades = new TradeStore();
  private readonly updateListeners = new Set<UpdateListener>();
  private readonly tradeListeners = new Set<TradeListener>();

  private lastSequence: number | null = null;
  private lastTimestamp: number | null = null;

  constructor(seed?: SnapshotSeed) {
    if (seed) {
      this.setSnapshot(seed);
    }
  }

  get sequence(): number | null {
    return this.lastSequence;
  }

  get timestamp(): number | null {
    return this.lastTimestamp;
  }

  clear(): void {
    this.bids.clear();
    this.asks.clear();
    this.trades.clear();
    this.lastSequence = null;
    this.lastTimestamp = null;
  }

  setSnapshot(snapshot: SnapshotSeed): void {
    this.bids.clear();
    this.asks.clear();

    for (const level of snapshot.bids ?? []) {
      if (level.size > 0) {
        this.bids.set(level.price, level.size);
      }
    }

    for (const level of snapshot.asks ?? []) {
      if (level.size > 0) {
        this.asks.set(level.price, level.size);
      }
    }

    this.lastSequence = snapshot.sequence ?? null;
    this.lastTimestamp = snapshot.timestamp ?? null;
  }

  applyDiff(diff: OrderBookDiff): void {
    const meta: Meta = {};

    if (diff.sequence !== undefined) {
      meta.sequence = diff.sequence;
    }

    if (diff.timestamp !== undefined) {
      meta.timestamp = diff.timestamp;
    }

    if (meta.sequence !== undefined || meta.timestamp !== undefined) {
      this.updateMeta(meta);
    }

    for (const update of diff.bids ?? []) {
      this.updateLevel('bid', update.price, update.size, meta);
    }

    for (const update of diff.asks ?? []) {
      this.updateLevel('ask', update.price, update.size, meta);
    }
  }

  updateLevel(side: Side, price: number, size: number, meta?: Meta): boolean {
    this.updateMeta(meta);

    const levels = side === 'bid' ? this.bids : this.asks;

    if (size <= 0) {
      const removed = levels.delete(price);
      if (removed) {
        this.emitUpdate({ side, price, size: 0 });
      }
      return removed;
    }

    levels.set(price, size);
    this.emitUpdate({ side, price, size });
    return true;
  }

  recordTrade(trade: Trade): Readonly<Trade> {
    const entry = this.trades.append(trade);
    if (trade.sequence !== undefined || trade.timestamp !== undefined) {
      this.updateMeta({ sequence: trade.sequence, timestamp: trade.timestamp });
    }
    this.emitTrade(entry);
    return entry;
  }

  *iterateTrades(
    options: TradeIteratorOptions = {},
  ): IterableIterator<Readonly<Trade>> {
    yield* this.trades.iterate(options);
  }

  getBestBid(): Level | null {
    return this.bids.best();
  }

  getBestAsk(): Level | null {
    return this.asks.best();
  }

  getSnapshot(depth?: number): OrderBookSnapshot {
    const bids = this.bids.toArray(depth);
    const asks = this.asks.toArray(depth);
    const bestBid = this.bids.best();
    const bestAsk = this.asks.best();

    return {
      bids,
      asks,
      bestBid,
      bestAsk,
      sequence: this.lastSequence,
      timestamp: this.lastTimestamp,
    };
  }

  onUpdate(listener: UpdateListener): () => void {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  onTrade(listener: TradeListener): () => void {
    this.tradeListeners.add(listener);
    return () => {
      this.tradeListeners.delete(listener);
    };
  }

  private updateMeta(meta?: Meta): void {
    if (!meta) {
      return;
    }

    if (meta.sequence !== undefined) {
      this.lastSequence = meta.sequence;
    }

    if (meta.timestamp !== undefined) {
      this.lastTimestamp = meta.timestamp;
    }
  }

  private emitUpdate(update: {
    side: Side;
    price: number;
    size: number;
  }): void {
    if (this.updateListeners.size === 0) {
      return;
    }

    const payload = Object.freeze({
      ...update,
      sequence: this.lastSequence,
      timestamp: this.lastTimestamp,
    });

    for (const listener of this.updateListeners) {
      listener(payload);
    }
  }

  private emitTrade(trade: Readonly<Trade>): void {
    if (this.tradeListeners.size === 0) {
      return;
    }

    for (const listener of this.tradeListeners) {
      listener(trade);
    }
  }
}
