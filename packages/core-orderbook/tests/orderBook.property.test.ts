import fc from 'fast-check';
import { OrderBook } from '@tradeforge/core-orderbook';
import type { Level, Side } from '@tradeforge/core-orderbook';

describe('OrderBook property based diff application', () => {
  const operationArb = fc.record({
    side: fc.constantFrom<Side>('bid', 'ask'),
    price: fc
      .integer({ min: 10_000, max: 10_100 })
      .map((value) => Number((value / 100).toFixed(2))),
    size: fc
      .integer({ min: 0, max: 1_000 })
      .map((value) => Number((value / 100).toFixed(4))),
  });

  it('matches naive map implementation after arbitrary diffs', () => {
    fc.assert(
      fc.property(
        fc.array(operationArb, { minLength: 1, maxLength: 200 }),
        (operations) => {
          const book = new OrderBook();
          const expected: Record<Side, Map<number, number>> = {
            bid: new Map(),
            ask: new Map(),
          };

          for (const op of operations) {
            book.updateLevel(op.side, op.price, op.size);

            const map = expected[op.side];
            if (op.size <= 0) {
              map.delete(op.price);
            } else {
              map.set(op.price, op.size);
            }
          }

          const snapshot = book.getSnapshot();

          const expectedBids = Array.from(expected.bid.entries())
            .map(([price, size]) => ({ price, size }))
            .sort((a, b) => b.price - a.price);

          const expectedAsks = Array.from(expected.ask.entries())
            .map(([price, size]) => ({ price, size }))
            .sort((a, b) => a.price - b.price);

          expect(snapshot.bids).toEqual<Level[]>(expectedBids);
          expect(snapshot.asks).toEqual<Level[]>(expectedAsks);
          expect(snapshot.bestBid).toEqual(expectedBids[0] ?? null);
          expect(snapshot.bestAsk).toEqual(expectedAsks[0] ?? null);
        },
      ),
      { numRuns: 50 },
    );
  });
});
