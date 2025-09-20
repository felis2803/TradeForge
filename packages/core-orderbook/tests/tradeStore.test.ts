import { TradeStore } from '@tradeforge/core-orderbook';

describe('TradeStore', () => {
  it('appends trades in chronological order', () => {
    const store = new TradeStore();

    store.append({ price: 100, size: 0.5, side: 'bid', timestamp: 1 });
    store.append({ price: 101, size: 0.75, side: 'ask', timestamp: 2 });

    expect(Array.from(store.iterate())).toHaveLength(2);
    expect(store.size).toBe(2);

    expect(() =>
      store.append({ price: 99, size: 1, side: 'bid', timestamp: 2 }),
    ).not.toThrow();

    expect(() =>
      store.append({ price: 98, size: 1, side: 'ask', timestamp: 0 }),
    ).toThrow('Trades must be appended in non-decreasing timestamp order');

    expect(() =>
      store.append({
        price: 103,
        size: 0.1,
        side: 'invalid' as never,
        timestamp: 4,
      }),
    ).toThrow('Invalid trade side');
  });

  it('filters trades by time window and limit', () => {
    const store = new TradeStore();

    store.append({ price: 100, size: 0.5, side: 'bid', timestamp: 1 });
    store.append({ price: 101, size: 0.75, side: 'ask', timestamp: 2 });
    store.append({ price: 102, size: 0.25, side: 'bid', timestamp: 3 });

    const window = Array.from(
      store.iterate({ fromTimestamp: 2, toTimestamp: 3 }),
    );
    expect(window).toHaveLength(2);

    const limited = Array.from(store.iterate({ limit: 1 }));
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ price: 100, size: 0.5 });
  });
});
