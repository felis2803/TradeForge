import { ConservativeGate, OrderStore, type Trade } from '@tradeforge/sim';

function createLimitOrder(side: 'BUY' | 'SELL', price: bigint) {
  const store = new OrderStore();
  const order = store.create(
    'ord-1',
    {
      type: 'LIMIT',
      side,
      qty: 10n,
      price,
    },
    0,
  );
  return order;
}

describe('ConservativeGate', () => {
  it('blocks limit orders until qualifying trade arrives', () => {
    const gate = new ConservativeGate();
    const order = createLimitOrder('BUY', 100n);
    expect(gate.isLimitAllowed(order, 1000)).toBe(false);
    const trade: Trade = { ts: 1000, price: 99n, qty: 1n, side: 'SELL' };
    gate.updateTrade(trade);
    expect(gate.isLimitAllowed(order, 1000)).toBe(true);
  });

  it('respects staleness window', () => {
    const gate = new ConservativeGate({ tradeStalenessMs: 100 });
    const order = createLimitOrder('SELL', 120n);
    gate.updateTrade({ ts: 1000, price: 121n, qty: 1n, side: 'BUY' });
    expect(gate.isLimitAllowed(order, 1050)).toBe(true);
    expect(gate.isLimitAllowed(order, 1201)).toBe(false);
  });

  it('disables conservative mode when configured', () => {
    const gate = new ConservativeGate({ enableConservativeForLimit: false });
    const order = createLimitOrder('BUY', 100n);
    expect(gate.isLimitAllowed(order, 0)).toBe(true);
  });
});
