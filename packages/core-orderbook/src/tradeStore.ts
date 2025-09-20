import { Trade, TradeIteratorOptions } from './types.js';

const isPositive = (value: number): boolean =>
  Number.isFinite(value) && value > 0;

export class TradeStore {
  private readonly trades: Readonly<Trade>[] = [];

  append(trade: Trade): Readonly<Trade> {
    if (!isPositive(trade.price)) {
      throw new Error(`Invalid trade price: ${trade.price}`);
    }

    if (!isPositive(trade.size)) {
      throw new Error(`Invalid trade size: ${trade.size}`);
    }

    if (!Number.isFinite(trade.timestamp)) {
      throw new Error(`Invalid trade timestamp: ${trade.timestamp}`);
    }

    if (trade.side !== 'bid' && trade.side !== 'ask') {
      throw new Error(`Invalid trade side: ${trade.side}`);
    }

    if (this.trades.length > 0) {
      const lastTimestamp = this.trades[this.trades.length - 1].timestamp;
      if (trade.timestamp < lastTimestamp) {
        throw new Error(
          'Trades must be appended in non-decreasing timestamp order',
        );
      }
    }

    const entry: Readonly<Trade> = Object.freeze({ ...trade });
    this.trades.push(entry);
    return entry;
  }

  *iterate(
    options: TradeIteratorOptions = {},
  ): IterableIterator<Readonly<Trade>> {
    const { fromTimestamp, toTimestamp, limit } = options;
    if (limit !== undefined && limit <= 0) {
      return;
    }
    let emitted = 0;

    for (const trade of this.trades) {
      if (fromTimestamp !== undefined && trade.timestamp < fromTimestamp) {
        continue;
      }

      if (toTimestamp !== undefined && trade.timestamp > toTimestamp) {
        continue;
      }

      yield trade;
      emitted += 1;

      if (limit !== undefined && emitted >= limit) {
        break;
      }
    }
  }

  clear(): void {
    this.trades.length = 0;
  }

  get size(): number {
    return this.trades.length;
  }
}
