import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  calcFee,
  executeTimeline,
  toPriceInt,
  toQtyInt,
  type ExecutionReport,
  type MergedEvent,
  type Order,
  type OrderbookBest,
  type SymbolId,
  type TimestampMs,
  type Trade,
} from '../src/index';

const SYMBOL = 'BTCUSDT' as SymbolId;
const PRICE_SCALE = 2;
const QTY_SCALE = 3;
const FEE_BPS = { makerBps: 10, takerBps: 20 } as const;
const QTY_DENOM = BigInt(10 ** QTY_SCALE);

function rawPrice(value: string): bigint {
  return toPriceInt(value, PRICE_SCALE) as unknown as bigint;
}

function rawQty(value: string): bigint {
  return toQtyInt(value, QTY_SCALE) as unknown as bigint;
}

function notional(price: string, qty: string): bigint {
  return (rawPrice(price) * rawQty(qty)) / QTY_DENOM;
}

function createState(options: { best?: Record<string, OrderbookBest> } = {}) {
  const state = new ExchangeState({
    symbols: {
      [SYMBOL as unknown as string]: {
        base: 'BTC',
        quote: 'USDT',
        priceScale: PRICE_SCALE,
        qtyScale: QTY_SCALE,
      },
    },
    fee: { makerBps: FEE_BPS.makerBps, takerBps: FEE_BPS.takerBps },
    orderbook: new StaticMockOrderbook({ best: options.best ?? {} }),
  });
  const accounts = new AccountsService(state);
  const orders = new OrdersService(state, accounts);
  return { state, accounts, orders };
}

function tradeEvent(
  ts: number,
  price: string,
  qty: string,
  opts: { id?: string; side?: 'BUY' | 'SELL'; aggressor?: 'BUY' | 'SELL' } = {},
): MergedEvent {
  const tsMs = ts as TimestampMs;
  const priceInt = toPriceInt(price, PRICE_SCALE);
  const qtyInt = toQtyInt(qty, QTY_SCALE);
  const payload: Trade = {
    ts: tsMs,
    symbol: SYMBOL,
    price: priceInt,
    qty: qtyInt,
  };
  if (opts.side) {
    payload.side = opts.side;
  }
  if (opts.aggressor) {
    payload.aggressor = opts.aggressor;
  }
  if (opts.id !== undefined) {
    payload.id = opts.id;
  }
  return {
    kind: 'trade',
    ts: tsMs,
    source: 'TRADES',
    seq: ts,
    payload,
  } satisfies MergedEvent;
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) {
    result.push(item);
  }
  return result;
}

function expectOrderSnapshot(order: Order) {
  expect(order.fills).toBeDefined();
  expect(Array.isArray(order.fills)).toBe(true);
}

describe('executeTimeline: MARKET orders', () => {
  it('fills BUY MARKET order on first matching trade with taker fees', async () => {
    const { state, accounts, orders } = createState();
    const buyer = accounts.createAccount('buyer');
    const deposit = rawPrice('1000');
    accounts.deposit(buyer.id, 'USDT', deposit);

    const qty = toQtyInt('1', QTY_SCALE);
    const order = orders.placeOrder({
      accountId: buyer.id,
      symbol: SYMBOL,
      type: 'MARKET',
      side: 'BUY',
      qty,
    });
    expect(order.status).toBe('OPEN');

    const events: MergedEvent[] = [
      tradeEvent(1, '100', '1', { id: 'm1', side: 'BUY' }),
    ];

    const reports = await collect(
      executeTimeline(
        (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        state,
      ),
    );

    expect(reports).toHaveLength(2);
    const [fillReport, endReport] = reports as [
      ExecutionReport,
      ExecutionReport,
    ];
    expect(fillReport.kind).toBe('FILL');
    expect(fillReport.orderId).toBe(order.id);
    expect(fillReport.fill?.qty).toEqual(qty);
    expect(fillReport.fill?.price).toEqual(toPriceInt('100', PRICE_SCALE));
    expect(fillReport.fill?.liquidity).toBe('TAKER');
    expect(endReport.kind).toBe('END');

    const updated = orders.getOrder(order.id);
    expectOrderSnapshot(updated);
    expect(updated.status).toBe('FILLED');
    expect(updated.executedQty).toEqual(qty);
    const expectedNotional = notional('100', '1');
    expect(updated.cumulativeQuote).toEqual(
      expectedNotional as unknown as Order['cumulativeQuote'],
    );
    const expectedFee = calcFee(expectedNotional, FEE_BPS.takerBps);
    expect(updated.fees.taker).toEqual(expectedFee);

    const baseBalance = accounts.getBalance(buyer.id, 'BTC');
    const quoteBalance = accounts.getBalance(buyer.id, 'USDT');
    expect(baseBalance.free).toEqual(rawQty('1'));
    expect(baseBalance.locked).toBe(0n);
    const expectedSpend = expectedNotional + expectedFee;
    expect(quoteBalance.locked).toBe(0n);
    expect(quoteBalance.free).toEqual(deposit - expectedSpend);
    expect(updated.reserved?.remaining ?? 0n).toBe(0n);
    expect(updated.reserved?.total).toEqual(expectedSpend);
  });

  it('fills SELL MARKET order across multiple trades', async () => {
    const { state, accounts, orders } = createState();
    const seller = accounts.createAccount('seller');
    accounts.deposit(seller.id, 'BTC', rawQty('1.2'));

    const qty = toQtyInt('1', QTY_SCALE);
    const order = orders.placeOrder({
      accountId: seller.id,
      symbol: SYMBOL,
      type: 'MARKET',
      side: 'SELL',
      qty,
    });
    expect(order.status).toBe('OPEN');
    expect(order.reserved?.remaining).toEqual(rawQty('1'));

    const events = [
      tradeEvent(1, '100', '0.4', { id: 's1', side: 'SELL' }),
      tradeEvent(2, '101', '0.6', { id: 's2', side: 'SELL' }),
    ];

    const reports = await collect(
      executeTimeline(
        (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        state,
      ),
    );

    expect(reports).toHaveLength(3);
    const [firstFill, secondFill] = reports as [
      ExecutionReport,
      ExecutionReport,
    ];
    expect(firstFill.kind).toBe('FILL');
    expect(firstFill.orderId).toBe(order.id);
    expect(firstFill.fill?.qty).toEqual(toQtyInt('0.4', QTY_SCALE));
    expect(secondFill.kind).toBe('FILL');
    expect(secondFill.fill?.qty).toEqual(toQtyInt('0.6', QTY_SCALE));

    const updated = orders.getOrder(order.id);
    expectOrderSnapshot(updated);
    expect(updated.status).toBe('FILLED');
    expect(updated.executedQty).toEqual(qty);
    expect(updated.fills).toHaveLength(2);

    const notionalFirst = notional('100', '0.4');
    const notionalSecond = notional('101', '0.6');
    const totalNotional = notionalFirst + notionalSecond;
    expect(updated.cumulativeQuote).toEqual(
      totalNotional as unknown as Order['cumulativeQuote'],
    );
    const totalFee =
      calcFee(notionalFirst, FEE_BPS.takerBps) +
      calcFee(notionalSecond, FEE_BPS.takerBps);
    expect(updated.fees.taker).toEqual(totalFee);

    const baseBalance = accounts.getBalance(seller.id, 'BTC');
    const quoteBalance = accounts.getBalance(seller.id, 'USDT');
    expect(baseBalance.locked).toBe(0n);
    expect(baseBalance.free).toEqual(rawQty('0.2'));
    expect(quoteBalance.locked).toBe(0n);
    expect(quoteBalance.free).toEqual(totalNotional - totalFee);
    expect(updated.reserved?.remaining ?? 0n).toBe(0n);
  });

  it('keeps MARKET order open when the first trade has no matching liquidity', async () => {
    const { state, accounts, orders } = createState();
    const competingBuyer = accounts.createAccount('resting-buyer');
    accounts.deposit(competingBuyer.id, 'USDT', rawPrice('1000'));
    const restingOrder = orders.placeOrder({
      accountId: competingBuyer.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('0.5', QTY_SCALE),
      price: toPriceInt('105', PRICE_SCALE),
    });
    const buyer = accounts.createAccount('waiting-buyer');
    const deposit = rawPrice('1000');
    accounts.deposit(buyer.id, 'USDT', deposit);

    const qty = toQtyInt('0.5', QTY_SCALE);
    const order = orders.placeOrder({
      accountId: buyer.id,
      symbol: SYMBOL,
      type: 'MARKET',
      side: 'BUY',
      qty,
    });
    expect(order.status).toBe('OPEN');

    const events = [
      tradeEvent(1, '100', '0.5', { id: 'x1', side: 'SELL' }),
      tradeEvent(2, '102', '0.5', { id: 'x2', side: 'BUY' }),
    ];

    const reports = await collect(
      executeTimeline(
        (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        state,
      ),
    );

    const orderFillReports = reports.filter(
      (report): report is ExecutionReport & { kind: 'FILL' } =>
        report.kind === 'FILL' && report.orderId === order.id,
    );
    expect(orderFillReports).toHaveLength(1);
    expect(orderFillReports[0]?.fill?.tradeRef).toBe('x2');
    expect(
      reports.filter(
        (report) =>
          report.kind === 'ORDER_UPDATED' && report.orderId === order.id,
      ),
    ).toHaveLength(0);

    const restingUpdated = orders.getOrder(restingOrder.id);
    expect(restingUpdated.status).toBe('FILLED');
    const updated = orders.getOrder(order.id);
    expect(updated.status).toBe('FILLED');
    expect(updated.executedQty).toEqual(qty);
    expect(updated.fills).toHaveLength(1);
  });

  it('cancels remaining quantity for MARKET+IOC after partial fill', async () => {
    const { state, accounts, orders } = createState();
    const buyer = accounts.createAccount('ioc-buyer');
    const deposit = rawPrice('1000');
    accounts.deposit(buyer.id, 'USDT', deposit);

    const order = orders.placeOrder({
      accountId: buyer.id,
      symbol: SYMBOL,
      type: 'MARKET',
      side: 'BUY',
      qty: toQtyInt('1', QTY_SCALE),
      tif: 'IOC',
    });
    expect(order.status).toBe('OPEN');

    const events = [tradeEvent(1, '100', '0.4', { id: 'ioc1', side: 'BUY' })];

    const reports = await collect(
      executeTimeline(
        (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        state,
      ),
    );

    expect(reports).toHaveLength(3);
    const fills = reports.filter((report) => report.kind === 'FILL');
    expect(fills).toHaveLength(1);
    const cancelReports = reports.filter(
      (report) => report.kind === 'ORDER_UPDATED',
    );
    expect(cancelReports).toHaveLength(1);
    expect(cancelReports[0]?.patch?.status).toBe('CANCELED');
    expect(cancelReports[0]?.orderId).toBe(order.id);

    const updated = orders.getOrder(order.id);
    expect(updated.status).toBe('CANCELED');
    expect(updated.executedQty).toEqual(toQtyInt('0.4', QTY_SCALE));
    expect(updated.reserved?.remaining ?? 0n).toBe(0n);
    const balances = accounts.getBalance(buyer.id, 'USDT');
    expect(balances.locked).toBe(0n);
  });

  it('activates STOP_MARKET order and executes in the triggering trade', async () => {
    const { state, accounts, orders } = createState();
    const buyer = accounts.createAccount('stop-buyer');
    const deposit = rawPrice('2000');
    accounts.deposit(buyer.id, 'USDT', deposit);

    const qty = toQtyInt('0.6', QTY_SCALE);
    const stopOrder = orders.placeOrder({
      accountId: buyer.id,
      symbol: SYMBOL,
      type: 'STOP_MARKET',
      side: 'BUY',
      qty,
      triggerPrice: toPriceInt('101', PRICE_SCALE),
      triggerDirection: 'UP',
    });
    expect(stopOrder.status).toBe('OPEN');
    expect(stopOrder.activated).toBe(false);

    const events = [
      tradeEvent(1, '100', '0.5', { id: 'pre', side: 'SELL' }),
      tradeEvent(2, '102', '0.6', { id: 'trigger', side: 'BUY' }),
    ];

    const reports = await collect(
      executeTimeline(
        (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        state,
      ),
    );

    const fillReports = reports.filter((report) => report.kind === 'FILL');
    expect(fillReports).toHaveLength(1);
    expect(fillReports[0]?.orderId).toBe(stopOrder.id);
    expect(fillReports[0]?.fill?.qty).toEqual(qty);

    const updated = orders.getOrder(stopOrder.id);
    expect(updated.status).toBe('FILLED');
    expect(updated.executedQty).toEqual(qty);
    const fee = calcFee(notional('102', '0.6'), FEE_BPS.takerBps);
    expect(updated.fees.taker).toEqual(fee);
    expect(updated.reserved?.remaining ?? 0n).toBe(0n);
  });

  it('partially fills STOP_MARKET+IOC and cancels the remainder', async () => {
    const { state, accounts, orders } = createState();
    const buyer = accounts.createAccount('stop-ioc-buyer');
    const deposit = rawPrice('2000');
    accounts.deposit(buyer.id, 'USDT', deposit);

    const qty = toQtyInt('1', QTY_SCALE);
    const stopOrder = orders.placeOrder({
      accountId: buyer.id,
      symbol: SYMBOL,
      type: 'STOP_MARKET',
      side: 'BUY',
      qty,
      tif: 'IOC',
      triggerPrice: toPriceInt('100', PRICE_SCALE),
      triggerDirection: 'UP',
    });
    expect(stopOrder.status).toBe('OPEN');

    const events = [tradeEvent(100, '100', '0.4', { id: 'sioc', side: 'BUY' })];

    const reports = await collect(
      executeTimeline(
        (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        state,
      ),
    );

    const fills = reports.filter((report) => report.kind === 'FILL');
    expect(fills).toHaveLength(1);
    expect(fills[0]?.fill?.qty).toEqual(toQtyInt('0.4', QTY_SCALE));
    expect(fills[0]?.orderId).toBe(stopOrder.id);
    const cancels = reports.filter((report) => report.kind === 'ORDER_UPDATED');
    expect(cancels).toHaveLength(1);
    expect(cancels[0]?.orderId).toBe(stopOrder.id);
    expect(cancels[0]?.patch?.status).toBe('CANCELED');
    expect(reports.filter((report) => report.kind === 'END')).toHaveLength(1);

    const updated = orders.getOrder(stopOrder.id);
    expect(updated.status).toBe('CANCELED');
    expect(updated.executedQty).toEqual(toQtyInt('0.4', QTY_SCALE));
    expect(updated.fees.taker).toEqual(
      calcFee(notional('100', '0.4'), FEE_BPS.takerBps),
    );
    expect(updated.reserved?.remaining ?? 0n).toBe(0n);
    const balances = accounts.getBalance(buyer.id, 'USDT');
    expect(balances.locked).toBe(0n);
    const partialNotional = notional('100', '0.4');
    const totalSpend =
      partialNotional + calcFee(partialNotional, FEE_BPS.takerBps);
    expect(balances.free).toEqual(deposit - totalSpend);
  });

  it('resolves priority deterministically when LIMIT and MARKET share a side', async () => {
    const { state, accounts, orders } = createState();
    const sellerLimit = accounts.createAccount('limit-seller');
    const sellerMarket = accounts.createAccount('market-seller');
    accounts.deposit(sellerLimit.id, 'BTC', rawQty('0.5'));
    accounts.deposit(sellerMarket.id, 'BTC', rawQty('1'));

    const limitOrder = orders.placeOrder({
      accountId: sellerLimit.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'SELL',
      qty: toQtyInt('0.5', QTY_SCALE),
      price: toPriceInt('99', PRICE_SCALE),
    });
    const marketOrder = orders.placeOrder({
      accountId: sellerMarket.id,
      symbol: SYMBOL,
      type: 'MARKET',
      side: 'SELL',
      qty: toQtyInt('1', QTY_SCALE),
    });

    const events = [tradeEvent(1, '100', '1.5')];

    const reports = await collect(
      executeTimeline(
        (async function* () {
          for (const event of events) {
            yield event;
          }
        })(),
        state,
      ),
    );

    const fillReports = reports.filter((report) => report.kind === 'FILL');
    expect(fillReports).toHaveLength(2);
    expect(fillReports[0]?.orderId).toBe(limitOrder.id);
    expect(fillReports[0]?.fill?.qty).toEqual(toQtyInt('0.5', QTY_SCALE));
    expect(fillReports[1]?.orderId).toBe(marketOrder.id);
    expect(fillReports[1]?.fill?.qty).toEqual(toQtyInt('1', QTY_SCALE));

    const updatedLimit = orders.getOrder(limitOrder.id);
    const updatedMarket = orders.getOrder(marketOrder.id);
    expect(updatedLimit.status).toBe('FILLED');
    expect(updatedMarket.status).toBe('FILLED');
  });

  it('reserves quote for BUY MARKET across partial fills and refunds leftover quote', async () => {
    const bestAsk = toPriceInt('120', PRICE_SCALE);
    const { state, accounts, orders } = createState({
      best: { [SYMBOL as unknown as string]: { bestAsk } },
    });
    const buyer = accounts.createAccount('partial-buyer');
    const deposit = rawPrice('5000');
    accounts.deposit(buyer.id, 'USDT', deposit);

    const qty = toQtyInt('1', QTY_SCALE);
    const order = orders.placeOrder({
      accountId: buyer.id,
      symbol: SYMBOL,
      type: 'MARKET',
      side: 'BUY',
      qty,
    });
    expect(order.status).toBe('OPEN');

    const expectedInitialNotional = notional('120', '1');
    const expectedInitialFee = calcFee(
      expectedInitialNotional,
      FEE_BPS.takerBps,
    );
    const expectedInitialLock = expectedInitialNotional + expectedInitialFee;
    expect(order.reserved?.currency).toBe('USDT');
    expect(order.reserved?.total).toEqual(expectedInitialLock);
    expect(order.reserved?.remaining).toEqual(expectedInitialLock);
    const balanceAfterPlacement = accounts.getBalance(buyer.id, 'USDT');
    expect(balanceAfterPlacement.locked).toEqual(expectedInitialLock);
    expect(balanceAfterPlacement.free).toEqual(deposit - expectedInitialLock);

    const events = [
      tradeEvent(1, '100', '0.4', { id: 'p1', side: 'BUY' }),
      tradeEvent(2, '110', '0.3', { id: 'p2', side: 'BUY' }),
      tradeEvent(3, '115', '0.3', { id: 'p3', side: 'BUY' }),
    ];

    async function* stream() {
      for (const event of events) {
        yield event;
      }
    }

    const iterator = executeTimeline(stream(), state)[Symbol.asyncIterator]();

    const notionals = [
      notional('100', '0.4'),
      notional('110', '0.3'),
      notional('115', '0.3'),
    ];
    const fees = notionals.map((value) => calcFee(value, FEE_BPS.takerBps));
    const spends = notionals.map((value, index) => value + fees[index]!);

    const firstFill = await iterator.next();
    expect(firstFill.value?.kind).toBe('FILL');
    expect(firstFill.value?.fill?.qty).toEqual(toQtyInt('0.4', QTY_SCALE));
    const balancesAfterFirst = accounts.getBalance(buyer.id, 'USDT');
    expect(balancesAfterFirst.locked).toEqual(expectedInitialLock - spends[0]!);
    expect(balancesAfterFirst.free).toEqual(deposit - expectedInitialLock);

    const secondFill = await iterator.next();
    expect(secondFill.value?.kind).toBe('FILL');
    expect(secondFill.value?.fill?.qty).toEqual(toQtyInt('0.3', QTY_SCALE));
    const balancesAfterSecond = accounts.getBalance(buyer.id, 'USDT');
    expect(balancesAfterSecond.locked).toEqual(
      expectedInitialLock - spends[0]! - spends[1]!,
    );
    expect(balancesAfterSecond.free).toEqual(deposit - expectedInitialLock);

    const thirdFill = await iterator.next();
    expect(thirdFill.value?.kind).toBe('FILL');
    expect(thirdFill.value?.fill?.qty).toEqual(toQtyInt('0.3', QTY_SCALE));
    const balancesAfterThird = accounts.getBalance(buyer.id, 'USDT');
    expect(balancesAfterThird.locked).toEqual(
      expectedInitialLock - spends[0]! - spends[1]! - spends[2]!,
    );

    const endReport = await iterator.next();
    expect(endReport.value?.kind).toBe('END');
    const done = await iterator.next();
    expect(done.done).toBe(true);

    const updated = orders.getOrder(order.id);
    expectOrderSnapshot(updated);
    expect(updated.status).toBe('FILLED');
    expect(updated.executedQty).toEqual(qty);
    expect(updated.fills).toHaveLength(3);

    const totalNotional = notionals.reduce((acc, value) => acc + value, 0n);
    const totalFee = fees.reduce((acc, value) => acc + value, 0n);
    expect(updated.cumulativeQuote).toEqual(
      totalNotional as unknown as Order['cumulativeQuote'],
    );
    expect(updated.fees.taker).toEqual(totalFee);
    expect(updated.reserved?.total).toEqual(expectedInitialLock);
    expect(updated.reserved?.remaining ?? 0n).toBe(0n);

    const quoteBalance = accounts.getBalance(buyer.id, 'USDT');
    expect(quoteBalance.locked).toBe(0n);
    expect(quoteBalance.free).toEqual(deposit - totalNotional - totalFee);
    const baseBalance = accounts.getBalance(buyer.id, 'BTC');
    expect(baseBalance.free).toEqual(rawQty('1'));
  });
});
