import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  deserializeExchangeState,
  restoreEngineFromSnapshot,
  serializeExchangeState,
  snapshotEngine,
  toPriceInt,
  toQtyInt,
  type Account,
  type Order,
  type SymbolId,
} from '../src/index';

const SYMBOL = 'BTCUSDT' as SymbolId;
const PRICE_SCALE = 5;
const QTY_SCALE = 6;

function createState(): {
  state: ExchangeState;
  accounts: AccountsService;
  orders: OrdersService;
  buyAccount: Account;
  sellAccount: Account;
  buyOrder: Order;
  stopOrder: Order;
} {
  const state = new ExchangeState({
    symbols: {
      [SYMBOL as unknown as string]: {
        base: 'BTC',
        quote: 'USDT',
        priceScale: PRICE_SCALE,
        qtyScale: QTY_SCALE,
      },
    },
    fee: { makerBps: 10, takerBps: 20 },
    orderbook: new StaticMockOrderbook({ best: {} }),
  });
  const accounts = new AccountsService(state);
  const orders = new OrdersService(state, accounts);
  const buyAccount = accounts.createAccount('serialize-buy');
  const sellAccount = accounts.createAccount('serialize-sell');
  accounts.deposit(buyAccount.id, 'USDT', toPriceInt('100000', PRICE_SCALE));
  accounts.deposit(sellAccount.id, 'BTC', toQtyInt('2', QTY_SCALE));
  const buyOrder = orders.placeOrder({
    accountId: buyAccount.id,
    symbol: SYMBOL,
    type: 'LIMIT',
    side: 'BUY',
    qty: toQtyInt('0.4', QTY_SCALE),
    price: toPriceInt('10010', PRICE_SCALE),
  });
  const stopOrder = orders.placeOrder({
    accountId: buyAccount.id,
    symbol: SYMBOL,
    type: 'STOP_LIMIT',
    side: 'BUY',
    qty: toQtyInt('0.2', QTY_SCALE),
    price: toPriceInt('10030', PRICE_SCALE),
    triggerPrice: toPriceInt('10020', PRICE_SCALE),
    triggerDirection: 'UP',
  });
  void stopOrder;
  const sellOrder = orders.placeOrder({
    accountId: sellAccount.id,
    symbol: SYMBOL,
    type: 'LIMIT',
    side: 'SELL',
    qty: toQtyInt('0.15', QTY_SCALE),
    price: toPriceInt('10005', PRICE_SCALE),
  });
  void sellOrder;
  const fill = {
    ts: state.now(),
    orderId: buyOrder.id,
    price: toPriceInt('10005', PRICE_SCALE),
    qty: toQtyInt('0.1', QTY_SCALE),
    side: buyOrder.side,
    liquidity: 'TAKER' as const,
  };
  orders.applyFill(buyOrder.id, fill);
  return {
    state,
    accounts,
    orders,
    buyAccount,
    sellAccount,
    buyOrder,
    stopOrder,
  };
}

test('serialize and deserialize exchange state with engine snapshot', () => {
  const { state, buyAccount, sellAccount, buyOrder, stopOrder } = createState();
  const snapshot = snapshotEngine(state);
  const serialized = serializeExchangeState(state);
  const restored = deserializeExchangeState(serialized);
  restoreEngineFromSnapshot(snapshot, restored);

  const restoredSerialized = serializeExchangeState(restored);
  expect(restoredSerialized).toEqual(serialized);

  const restoredBuy = restored.orders.get(buyOrder.id);
  expect(restoredBuy).toBeDefined();
  expect(restoredBuy?.executedQty).toEqual(buyOrder.executedQty);
  expect(restoredBuy?.cumulativeQuote).toEqual(buyOrder.cumulativeQuote);
  expect(restoredBuy?.fees.taker).toEqual(buyOrder.fees.taker);
  expect(restoredBuy?.status).toBe('PARTIALLY_FILLED');
  expect(restoredBuy?.reserved?.remaining).toEqual(
    buyOrder.reserved?.remaining,
  );

  const restoredStop = restored.orders.get(stopOrder.id);
  expect(restoredStop?.activated).toBe(false);
  expect(restored.stopOrders.has(stopOrder.id)).toBe(true);

  const buyBalances = state.accounts.get(buyAccount.id)?.balances.get('USDT');
  const restoredBuyBalances = restored.accounts
    .get(buyAccount.id)
    ?.balances.get('USDT');
  expect(restoredBuyBalances).toEqual(buyBalances);

  const sellBalances = state.accounts.get(sellAccount.id)?.balances.get('BTC');
  const restoredSellBalances = restored.accounts
    .get(sellAccount.id)
    ?.balances.get('BTC');
  expect(restoredSellBalances).toEqual(sellBalances);

  const restoredOpenOrderIds = Array.from(restored.openOrders.keys()).map(
    (id) => id as unknown as string,
  );
  expect(restoredOpenOrderIds).toEqual(snapshot.openOrderIds);
  const restoredStopOrderIds = Array.from(restored.stopOrders.keys()).map(
    (id) => id as unknown as string,
  );
  expect(restoredStopOrderIds).toEqual(snapshot.stopOrderIds);

  const originalCounters = state as unknown as {
    accountSeq: number;
    orderSeq: number;
    tsCounter: number;
  };
  const restoredCounters = restored as unknown as {
    accountSeq: number;
    orderSeq: number;
    tsCounter: number;
  };
  expect(restoredCounters.accountSeq).toBe(originalCounters.accountSeq);
  expect(restoredCounters.orderSeq).toBe(originalCounters.orderSeq);
  expect(restoredCounters.tsCounter).toBe(originalCounters.tsCounter);
});
