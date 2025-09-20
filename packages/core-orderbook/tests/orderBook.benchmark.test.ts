import { performance } from 'node:perf_hooks';
import { OrderBook } from '@tradeforge/core-orderbook';

describe('OrderBook performance', () => {
  it('applies 100k updates in under 500ms', () => {
    const book = new OrderBook();
    const start = performance.now();

    for (let i = 0; i < 100_000; i += 1) {
      const side = i % 2 === 0 ? 'bid' : 'ask';
      const price = 1_000 + (i % 200);
      const size = ((i % 10) + 1) / 10;

      book.updateLevel(side, price, size);

      if (i % 25 === 0) {
        book.updateLevel(side, price, 0);
      }
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
