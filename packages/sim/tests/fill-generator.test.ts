import { FillGenerator, OrderStore } from '@tradeforge/sim';
import type { PlannedLevel } from '@tradeforge/sim';

describe('FillGenerator', () => {
  it('splits quantity across levels', () => {
    const store = new OrderStore();
    const order = store.create(
      'fill-1',
      { type: 'LIMIT', side: 'BUY', qty: 5n, price: 130n },
      0,
    );
    const generator = new FillGenerator();
    const plan: PlannedLevel[] = [
      { price: 129n, qty: 3n },
      { price: 128n, qty: 3n },
    ];
    const result = generator.generate(order, plan, 1000);
    expect(result.totalFilled).toBe(5n);
    expect(result.remaining).toBe(0n);
    expect(result.fills).toEqual([
      {
        orderId: 'fill-1',
        side: 'BUY',
        price: 129n,
        qty: 3n,
        ts: 1000,
        levelIndex: 0,
      },
      {
        orderId: 'fill-1',
        side: 'BUY',
        price: 128n,
        qty: 2n,
        ts: 1000,
        levelIndex: 1,
      },
    ]);
  });

  it('returns zero fills when no liquidity', () => {
    const store = new OrderStore();
    const order = store.create(
      'fill-2',
      { type: 'LIMIT', side: 'SELL', qty: 2n, price: 120n },
      0,
    );
    const generator = new FillGenerator();
    const plan: PlannedLevel[] = [];
    const result = generator.generate(order, plan, 1000);
    expect(result.totalFilled).toBe(0n);
    expect(result.remaining).toBe(2n);
    expect(result.fills).toHaveLength(0);
  });
});
