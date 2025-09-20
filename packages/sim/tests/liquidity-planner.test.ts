import { LiquidityPlanner, OrderStore } from '@tradeforge/sim';
import type { OrderBookSnapshot } from '@tradeforge/sim';

describe('LiquidityPlanner', () => {
  function createSnapshot(): OrderBookSnapshot {
    return {
      bids: [
        { price: 119n, qty: 3n },
        { price: 118n, qty: 4n },
      ],
      asks: [
        { price: 121n, qty: 2n },
        { price: 122n, qty: 5n },
      ],
    };
  }

  it('selects ask levels for limit buy within price', () => {
    const store = new OrderStore();
    const order = store.create(
      'o1',
      { type: 'LIMIT', side: 'BUY', qty: 4n, price: 122n },
      0,
    );
    const planner = new LiquidityPlanner();
    const plan = planner.planLimit(order, createSnapshot());
    expect(plan.levels).toEqual([
      { price: 121n, qty: 2n },
      { price: 122n, qty: 2n },
    ]);
    expect(plan.exhausted).toBe(false);
  });

  it('ignores levels worse than limit price', () => {
    const store = new OrderStore();
    const order = store.create(
      'o2',
      { type: 'LIMIT', side: 'BUY', qty: 5n, price: 121n },
      0,
    );
    const planner = new LiquidityPlanner();
    const plan = planner.planLimit(order, createSnapshot());
    expect(plan.levels).toEqual([{ price: 121n, qty: 2n }]);
    expect(plan.exhausted).toBe(true);
  });

  it('respects slippage levels for market', () => {
    const store = new OrderStore();
    const order = store.create(
      'o3',
      { type: 'MARKET', side: 'BUY', qty: 6n },
      0,
    );
    const planner = new LiquidityPlanner({ maxSlippageLevels: 1 });
    const plan = planner.planMarket(order, createSnapshot());
    expect(plan.levels).toEqual([{ price: 121n, qty: 2n }]);
    expect(plan.exhausted).toBe(true);
  });
});
