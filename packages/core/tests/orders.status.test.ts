import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  toPriceInt,
  toQtyInt,
  type Fill,
  type Order,
  type OrderbookBest,
  type SymbolId,
  type TimestampMs,
} from '../src/index';

const SYMBOL = 'BTCUSDT' as SymbolId;
const PRICE_SCALE = 2;
const QTY_SCALE = 3;

function createServices(best?: Record<string, OrderbookBest>) {
  const state = new ExchangeState({
    symbols: {
      [SYMBOL as unknown as string]: {
        base: 'BTC',
        quote: 'USDT',
        priceScale: PRICE_SCALE,
        qtyScale: QTY_SCALE,
      },
    },
    fee: { makerBps: 0, takerBps: 0 },
    orderbook: new StaticMockOrderbook({ best: best ?? {} }),
  });
  const accounts = new AccountsService(state);
  const orders = new OrdersService(state, accounts);
  return { state, accounts, orders };
}

function makeFill(order: Order, qty: string, price: string): Fill {
  return {
    ts: Date.now() as TimestampMs,
    orderId: order.id,
    price: toPriceInt(price, PRICE_SCALE),
    qty: toQtyInt(qty, QTY_SCALE),
    side: order.side,
    liquidity: 'MAKER',
  };
}

describe('OrdersService status lifecycle', () => {
  it('tracks new → partial → filled lifecycle with accurate metadata', () => {
    const { accounts, orders } = createServices({
      [SYMBOL]: { bestBid: 0n, bestAsk: 0n },
    });
    const account = accounts.createAccount();
    accounts.deposit(account.id, 'USDT', 1_000_000n);

    const placed = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('2', QTY_SCALE),
      price: toPriceInt('1000', PRICE_SCALE),
      tif: 'GTC',
    });

    expect(placed.status).toBe('OPEN');
    expect(placed.symbol).toBe(SYMBOL);
    expect(placed.qty).toBe(toQtyInt('2', QTY_SCALE));
    expect(placed.price).toBe(toPriceInt('1000', PRICE_SCALE));
    expect(placed.tsCreated).toBe(placed.tsUpdated);

    const partial = orders.applyFill(placed.id, makeFill(placed, '1', '1000'));
    expect(partial.status).toBe('PARTIALLY_FILLED');
    expect(partial.executedQty).toBe(toQtyInt('1', QTY_SCALE));
    expect(partial.tsUpdated).toBeGreaterThanOrEqual(placed.tsUpdated);

    const filled = orders.applyFill(placed.id, makeFill(placed, '1', '995'));
    expect(filled.status).toBe('FILLED');
    expect(filled.executedQty).toBe(toQtyInt('2', QTY_SCALE));
    expect(filled.cumulativeQuote).toBe(toPriceInt('1995', PRICE_SCALE));
    expect(filled.fills).toHaveLength(2);
    expect(filled.tsUpdated).toBeGreaterThanOrEqual(partial.tsUpdated);

    const balance = accounts.getBalancesSnapshot(account.id);
    expect(balance.BTC?.free).toBe(
      toQtyInt('2', QTY_SCALE) as unknown as bigint,
    );
    expect(balance.USDT?.locked ?? 0n).toBeLessThan(1_000_000n);
  });

  it('handles cancellations, rejections, and open-order filtering', () => {
    const { accounts, orders } = createServices();
    const account = accounts.createAccount();
    accounts.deposit(account.id, 'USDT', 1_000_000n);
    accounts.deposit(account.id, 'BTC', 10_000n);

    const cancelTarget = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'SELL',
      qty: toQtyInt('5', QTY_SCALE),
      price: toPriceInt('1200', PRICE_SCALE),
      tif: 'GTC',
    });
    const openBeforeCancel = orders.listOpenOrders(account.id);
    expect(openBeforeCancel.map((o) => o.id)).toContain(cancelTarget.id);

    const cancelled = orders.cancelOrder(cancelTarget.id);
    expect(cancelled.status).toBe('CANCELED');
    expect(orders.listOpenOrders(account.id)).toHaveLength(0);

    const rejected = orders.placeOrder({
      accountId: account.id,
      symbol: 'UNKNOWN' as SymbolId,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('1', QTY_SCALE),
      price: toPriceInt('100', PRICE_SCALE),
      tif: 'GTC',
    });
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectReason).toBe('UNKNOWN_SYMBOL');

    const ethOrder = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('3', QTY_SCALE),
      price: toPriceInt('900', PRICE_SCALE),
      tif: 'GTC',
    });
    const filtered = orders.listOpenOrders(account.id, SYMBOL);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe(ethOrder.id);

    const unfiltered = orders.listOpenOrders(account.id);
    expect(unfiltered.map((o) => o.id)).toContain(ethOrder.id);
  });
});
