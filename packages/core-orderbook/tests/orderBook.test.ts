import { OrderBook } from '@tradeforge/core-orderbook';
import type { Level } from '@tradeforge/core-orderbook';

describe('OrderBook basic operations', () => {
  it('adds, updates and removes levels correctly', () => {
    const book = new OrderBook();

    expect(book.getBestBid()).toBeNull();
    expect(book.getBestAsk()).toBeNull();

    book.updateLevel('bid', 100, 5);
    book.updateLevel('ask', 101, 2);

    expect(book.getBestBid()).toEqual({ price: 100, size: 5 });
    expect(book.getBestAsk()).toEqual({ price: 101, size: 2 });

    book.updateLevel('bid', 100, 3);
    expect(book.getBestBid()).toEqual({ price: 100, size: 3 });

    book.updateLevel('bid', 100, 0);
    expect(book.getBestBid()).toBeNull();
  });

  it('returns sorted snapshot', () => {
    const book = new OrderBook();

    book.updateLevel('bid', 101, 2);
    book.updateLevel('bid', 100, 1);
    book.updateLevel('bid', 102, 3);
    book.updateLevel('ask', 103, 4);
    book.updateLevel('ask', 104, 5);
    book.updateLevel('ask', 102.5, 1.5);

    const snapshot = book.getSnapshot();

    expect(snapshot.bids).toEqual<Level[]>([
      { price: 102, size: 3 },
      { price: 101, size: 2 },
      { price: 100, size: 1 },
    ]);

    expect(snapshot.asks).toEqual<Level[]>([
      { price: 102.5, size: 1.5 },
      { price: 103, size: 4 },
      { price: 104, size: 5 },
    ]);

    expect(snapshot.bestBid).toEqual({ price: 102, size: 3 });
    expect(snapshot.bestAsk).toEqual({ price: 102.5, size: 1.5 });
  });

  it('emits update events and supports unsubscribe', () => {
    const book = new OrderBook();
    const updates: unknown[] = [];

    const unsubscribe = book.onUpdate((update) => {
      updates.push(update);
    });

    book.updateLevel('bid', 99, 0.5);
    book.updateLevel('ask', 101, 1.25);

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ side: 'bid', price: 99, size: 0.5 });
    expect(updates[1]).toMatchObject({ side: 'ask', price: 101, size: 1.25 });

    unsubscribe();

    book.updateLevel('bid', 98, 0.75);
    expect(updates).toHaveLength(2);
  });

  it('applies L2 diff updates and tracks metadata', () => {
    const book = new OrderBook();

    book.applyDiff({
      sequence: 10,
      timestamp: 1_000,
      bids: [
        { price: 100, size: 1 },
        { price: 99.5, size: 2 },
      ],
      asks: [
        { price: 101, size: 1.5 },
        { price: 102, size: 3 },
      ],
    });

    book.applyDiff({
      sequence: 11,
      timestamp: 2_000,
      bids: [
        { price: 100, size: 0 },
        { price: 98.5, size: 4 },
      ],
      asks: [{ price: 101, size: 1 }],
    });

    const snapshot = book.getSnapshot();

    expect(snapshot.sequence).toBe(11);
    expect(snapshot.timestamp).toBe(2_000);
    expect(snapshot.bestBid).toEqual({ price: 99.5, size: 2 });
    expect(snapshot.bestAsk).toEqual({ price: 101, size: 1 });
  });

  it('records trades and exposes iterator', () => {
    const book = new OrderBook();
    const seen: unknown[] = [];

    const unsubscribe = book.onTrade((trade) => {
      seen.push(trade);
    });

    book.recordTrade({ price: 101, size: 0.3, side: 'ask', timestamp: 1 });
    book.recordTrade({ price: 100.5, size: 0.6, side: 'bid', timestamp: 2 });

    expect(seen).toHaveLength(2);

    const window = Array.from(book.iterateTrades({ fromTimestamp: 2 }));
    expect(window).toHaveLength(1);
    expect(window[0]).toMatchObject({ price: 100.5, size: 0.6, side: 'bid' });

    unsubscribe();
    book.recordTrade({ price: 100.75, size: 0.2, side: 'ask', timestamp: 3 });
    expect(seen).toHaveLength(2);
  });
});
