import {
  createRealtimeEngine,
  type DepthDiff,
  type Trade,
} from '@tradeforge/sim';
import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  type Fill,
  type Order,
  type PlaceOrderInput,
  type PriceInt,
  type QtyInt,
  type SymbolId,
} from '@tradeforge/core';
import { ManualStream, depth, flushMicrotasks, trade } from './helpers.js';

describe('createRealtimeEngine adapter', () => {
  const symbol = 'BTCUSDT' as SymbolId;

  function setup() {
    const state = new ExchangeState({
      symbols: {
        [symbol as unknown as string]: {
          base: 'BTC',
          quote: 'USDT',
          priceScale: 0,
          qtyScale: 0,
        },
      },
      fee: { makerBps: 0, takerBps: 0 },
      orderbook: new StaticMockOrderbook({
        best: {
          [symbol as unknown as string]: {
            bestBid: 100n as PriceInt,
            bestAsk: 100n as PriceInt,
          },
        },
      }),
    });
    const accounts = new AccountsService(state);
    const orders = new OrdersService(state, accounts);
    const depthStream = new ManualStream<DepthDiff>();
    const tradeStream = new ManualStream<Trade>();
    const adapter = createRealtimeEngine({
      symbol,
      state,
      accounts,
      orders,
      streams: {
        depth: { stream: depthStream, close: () => depthStream.close() },
        trades: { stream: tradeStream, close: () => tradeStream.close() },
      },
    });
    return { adapter, accounts, orders, depthStream, tradeStream };
  }

  it('fills limit orders after qualifying trades and updates state', async () => {
    const { adapter, accounts, orders, depthStream, tradeStream } = setup();
    const account = accounts.createAccount();
    accounts.deposit(account.id, 'USDT', 1_000n);

    const orderInput: PlaceOrderInput = {
      accountId: account.id,
      symbol,
      type: 'LIMIT',
      side: 'BUY',
      qty: 2n as QtyInt,
      price: 100n as PriceInt,
    };

    const fills: Array<{ order: Order; fill: Fill }> = [];
    const unsubscribe = adapter.on('orderFilled', (payload) => {
      fills.push(payload);
    });

    depthStream.push(depth(1, 1, [], [[100n, 5n]]));
    await flushMicrotasks();

    const placed = adapter.placeOrder(orderInput);
    expect(placed.status).toBe('OPEN');

    tradeStream.push(trade('SELL', 100n, 2n, 2));
    await flushMicrotasks();

    const stored = orders.getOrder(placed.id);
    expect(stored.status).toBe('FILLED');
    expect(stored.executedQty).toBe(2n as QtyInt);
    expect(fills).toHaveLength(1);
    expect(fills[0].fill.qty).toBe(2n as QtyInt);
    expect(fills[0].order.status).toBe('FILLED');

    const balances = accounts.getBalancesSnapshot(account.id);
    expect(balances.BTC?.free).toBe(2n);
    expect(balances.USDT?.free).toBe(800n);
    expect(balances.USDT?.locked ?? 0n).toBe(0n);

    unsubscribe();
    await adapter.close();
  });

  it('executes market sells immediately on available bids', async () => {
    const { adapter, accounts, orders, depthStream } = setup();
    const account = accounts.createAccount();
    accounts.deposit(account.id, 'BTC', 5n);

    depthStream.push(depth(1, 1, [[100n, 10n]], []));
    await flushMicrotasks();

    const orderInput: PlaceOrderInput = {
      accountId: account.id,
      symbol,
      type: 'MARKET',
      side: 'SELL',
      qty: 3n as QtyInt,
    };

    const placed = adapter.placeOrder(orderInput);
    await flushMicrotasks();

    const stored = orders.getOrder(placed.id);
    expect(stored.status).toBe('FILLED');
    expect(stored.executedQty).toBe(3n as QtyInt);

    const balances = accounts.getBalancesSnapshot(account.id);
    expect(balances.BTC?.free).toBe(2n);
    expect(balances.USDT?.free).toBe(300n);

    await adapter.close();
  });
});
