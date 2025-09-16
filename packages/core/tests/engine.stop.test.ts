import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  executeTimeline,
  toPriceInt,
  toQtyInt,
  type ExecutionReport,
  type MergedEvent,
  type SymbolId,
  type TimestampMs,
  type Trade,
} from '../src/index';

const SYMBOL = 'BTCUSDT' as SymbolId;
const PRICE_SCALE = 2;
const QTY_SCALE = 3;

function createState() {
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
  return { state, accounts, orders };
}

function tradeEvent(
  ts: number,
  price: string,
  qty: string,
  id?: string,
  aggressor?: 'BUY' | 'SELL',
): MergedEvent {
  const tsMs = ts as TimestampMs;
  const trade: Trade = {
    ts: tsMs,
    symbol: SYMBOL,
    price: toPriceInt(price, PRICE_SCALE),
    qty: toQtyInt(qty, QTY_SCALE),
  };
  if (id !== undefined) trade.id = id;
  if (aggressor) trade.aggressor = aggressor;
  return {
    kind: 'trade',
    ts: tsMs,
    source: 'TRADES',
    seq: ts,
    payload: trade,
  } satisfies MergedEvent;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) {
    result.push(item);
  }
  return result;
}

describe('stop orders', () => {
  it('activates STOP_LIMIT and fills as limit after trigger', async () => {
    const { state, accounts, orders } = createState();
    const buyer = accounts.createAccount('stop-limit-buyer');
    accounts.deposit(buyer.id, 'USDT', toPriceInt('2000', PRICE_SCALE));

    const stopLimit = orders.placeOrder({
      accountId: buyer.id,
      symbol: SYMBOL,
      type: 'STOP_LIMIT',
      side: 'BUY',
      qty: toQtyInt('1.000', QTY_SCALE),
      triggerPrice: toPriceInt('100', PRICE_SCALE),
      triggerDirection: 'UP',
      price: toPriceInt('101', PRICE_SCALE),
    });

    expect(stopLimit.status).toBe('OPEN');
    expect(stopLimit.activated).toBe(false);

    const events = [
      tradeEvent(1, '99', '0.400', 't1', 'SELL'),
      tradeEvent(2, '100', '0.600', 't2', 'SELL'),
      tradeEvent(3, '101', '0.400', 't3', 'SELL'),
    ];

    await collect(
      executeTimeline(
        (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        state,
      ),
    );

    const updated = orders.getOrder(stopLimit.id);
    expect(updated.type).toBe('LIMIT');
    expect(updated.activated).toBe(true);
    expect(updated.status).toBe('FILLED');
    expect(updated.executedQty).toEqual(toQtyInt('1.000', QTY_SCALE));
    expect(updated.fills).toHaveLength(2);
    expect(updated.fills[0]?.price).toEqual(toPriceInt('100', PRICE_SCALE));
    expect(state.stopOrders.has(stopLimit.id)).toBe(false);
  });

  it('activates STOP_MARKET sell and fills using aggressor liquidity', async () => {
    const { state, accounts, orders } = createState();
    const seller = accounts.createAccount('stop-market-seller');
    accounts.deposit(seller.id, 'BTC', toQtyInt('1.000', QTY_SCALE));

    const stopMarket = orders.placeOrder({
      accountId: seller.id,
      symbol: SYMBOL,
      type: 'STOP_MARKET',
      side: 'SELL',
      qty: toQtyInt('0.400', QTY_SCALE),
      triggerPrice: toPriceInt('100', PRICE_SCALE),
      triggerDirection: 'DOWN',
    });

    const reports = await collect(
      executeTimeline(
        (async function* () {
          yield tradeEvent(1, '100', '0.500', 'm1', 'BUY');
        })(),
        state,
        { useAggressorForLiquidity: true },
      ),
    );

    const fillReports = reports.filter(
      (report): report is ExecutionReport & { kind: 'FILL' } =>
        report.kind === 'FILL',
    );
    expect(fillReports).toHaveLength(1);

    const updated = orders.getOrder(stopMarket.id);
    expect(updated.type).toBe('MARKET');
    expect(updated.activated).toBe(true);
    expect(updated.status).toBe('FILLED');
    const fill = updated.fills[0];
    expect(fill?.liquidity).toBe('MAKER');
    expect(fill?.sourceAggressor).toBe('BUY');
    expect(updated.fees.maker).toBeDefined();
    expect(updated.fees.taker).toBeUndefined();
  });

  it('assigns maker/taker based on aggressor when enabled', async () => {
    const { state, accounts, orders } = createState();
    const buyAccount = accounts.createAccount('aggr-buy');
    const sellAccount = accounts.createAccount('aggr-sell');
    accounts.deposit(buyAccount.id, 'USDT', toPriceInt('500', PRICE_SCALE));
    accounts.deposit(sellAccount.id, 'BTC', toQtyInt('1.000', QTY_SCALE));

    const sellOrder = orders.placeOrder({
      accountId: sellAccount.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'SELL',
      qty: toQtyInt('0.200', QTY_SCALE),
      price: toPriceInt('100', PRICE_SCALE),
    });
    const buyOrder = orders.placeOrder({
      accountId: buyAccount.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('0.200', QTY_SCALE),
      price: toPriceInt('100', PRICE_SCALE),
    });

    await collect(
      executeTimeline(
        (async function* () {
          yield tradeEvent(1, '101', '0.200', 'g1', 'BUY');
          yield tradeEvent(2, '99', '0.200', 'g2', 'BUY');
        })(),
        state,
        { useAggressorForLiquidity: true },
      ),
    );

    const updatedSell = orders.getOrder(sellOrder.id);
    const updatedBuy = orders.getOrder(buyOrder.id);

    expect(updatedSell.fills[0]?.liquidity).toBe('MAKER');
    expect(updatedSell.fees.maker).toBeGreaterThan(0n);
    expect(updatedSell.fees.taker).toBeUndefined();

    expect(updatedBuy.fills[0]?.liquidity).toBe('TAKER');
    expect(updatedBuy.fees.taker).toBeGreaterThan(0n);
    expect(updatedBuy.fees.maker).toBeUndefined();
  });

  it('skips fills when participation factor is strict conservative', async () => {
    const { state, accounts, orders } = createState();
    const account = accounts.createAccount('strict');
    accounts.deposit(account.id, 'USDT', toPriceInt('500', PRICE_SCALE));

    const limitOrder = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('0.300', QTY_SCALE),
      price: toPriceInt('100', PRICE_SCALE),
    });

    const reports = await collect(
      executeTimeline(
        (async function* () {
          yield tradeEvent(1, '99', '0.500', 's1', 'SELL');
        })(),
        state,
        { participationFactor: 0 },
      ),
    );

    expect(reports.filter((report) => report.kind === 'FILL')).toHaveLength(0);
    const updated = orders.getOrder(limitOrder.id);
    expect(updated.status).toBe('OPEN');
    expect(updated.executedQty).toEqual(toQtyInt('0', QTY_SCALE));
    expect(updated.fills).toHaveLength(0);
  });

  it('cancels stop order before activation and releases reservation', () => {
    const { state, accounts, orders } = createState();
    const seller = accounts.createAccount('cancel-stop');
    accounts.deposit(seller.id, 'BTC', toQtyInt('1.000', QTY_SCALE));

    const stopOrder = orders.placeOrder({
      accountId: seller.id,
      symbol: SYMBOL,
      type: 'STOP_LIMIT',
      side: 'SELL',
      qty: toQtyInt('0.500', QTY_SCALE),
      triggerPrice: toPriceInt('95', PRICE_SCALE),
      triggerDirection: 'DOWN',
      price: toPriceInt('94', PRICE_SCALE),
    });

    expect(state.stopOrders.has(stopOrder.id)).toBe(true);
    orders.cancelOrder(stopOrder.id);
    expect(state.stopOrders.has(stopOrder.id)).toBe(false);
    const balance = accounts.getBalance(seller.id, 'BTC');
    expect(balance.locked).toEqual(0n);
    expect(balance.free).toEqual(toQtyInt('1.000', QTY_SCALE));
    const canceled = orders.getOrder(stopOrder.id);
    expect(canceled.status).toBe('CANCELED');
  });
});
