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
  type Order,
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
    fee: { makerBps: 0, takerBps: 0 },
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
  side?: 'BUY' | 'SELL',
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
  if (side) {
    payload.side = side;
  }
  if (id !== undefined) {
    payload.id = id;
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

function assertOrderSnapshot(order: Order) {
  expect(order.fills).toBeDefined();
  expect(Array.isArray(order.fills)).toBe(true);
}

describe('executeTimeline Time-In-Force', () => {
  it('partially fills IOC order and cancels remaining volume on same trade', async () => {
    const { state, accounts, orders } = createState();
    const account = accounts.createAccount('ioc-partial');
    accounts.deposit(account.id, 'USDT', toPriceInt('500', PRICE_SCALE));

    const order = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('1.000', QTY_SCALE),
      price: toPriceInt('101', PRICE_SCALE),
      tif: 'IOC',
    });
    expect(order.status).toBe('OPEN');

    const reports = await collect(
      executeTimeline(
        (async function* () {
          yield tradeEvent(10, '101', '0.600', 'ioc-fill', 'SELL');
        })(),
        state,
      ),
    );

    expect(reports).toHaveLength(3);
    const [fillReport, cancelReport, endReport] = reports as [
      ExecutionReport,
      ExecutionReport,
      ExecutionReport,
    ];
    expect(fillReport.kind).toBe('FILL');
    expect(fillReport.orderId).toBe(order.id);
    expect(fillReport.fill?.qty).toEqual(toQtyInt('0.600', QTY_SCALE));
    expect(cancelReport.kind).toBe('ORDER_UPDATED');
    expect(cancelReport.orderId).toBe(order.id);
    expect(cancelReport.patch?.status).toBe('CANCELED');
    expect(endReport.kind).toBe('END');

    const updated = orders.getOrder(order.id);
    assertOrderSnapshot(updated);
    expect(updated.status).toBe('CANCELED');
    expect(updated.executedQty).toEqual(toQtyInt('0.600', QTY_SCALE));
    expect(updated.fills).toHaveLength(1);

    const quoteBalance = accounts.getBalance(account.id, 'USDT');
    expect(quoteBalance.locked).toBe(0n);
    expect(updated.reserved?.remaining ?? 0n).toBe(0n);
  });

  it('cancels IOC order when price does not cross limit', async () => {
    const { state, accounts, orders } = createState();
    const account = accounts.createAccount('ioc-no-cross');
    accounts.deposit(account.id, 'USDT', toPriceInt('500', PRICE_SCALE));

    const order = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('1.000', QTY_SCALE),
      price: toPriceInt('100', PRICE_SCALE),
      tif: 'IOC',
    });
    expect(order.status).toBe('OPEN');

    const reports = await collect(
      executeTimeline(
        (async function* () {
          yield tradeEvent(12, '102', '1.000', 'ioc-skip', 'SELL');
        })(),
        state,
      ),
    );

    expect(reports).toHaveLength(2);
    const [cancelReport, endReport] = reports as [
      ExecutionReport,
      ExecutionReport,
    ];
    expect(cancelReport.kind).toBe('ORDER_UPDATED');
    expect(cancelReport.orderId).toBe(order.id);
    expect(cancelReport.patch?.status).toBe('CANCELED');
    expect(endReport.kind).toBe('END');

    const updated = orders.getOrder(order.id);
    assertOrderSnapshot(updated);
    expect(updated.status).toBe('CANCELED');
    expect(updated.executedQty).toEqual(toQtyInt('0', QTY_SCALE));
    expect(updated.fills).toHaveLength(0);

    const quoteBalance = accounts.getBalance(account.id, 'USDT');
    expect(quoteBalance.locked).toBe(0n);
  });

  it('fully fills FOK order when liquidity is sufficient', async () => {
    const { state, accounts, orders } = createState();
    const account = accounts.createAccount('fok-fill');
    accounts.deposit(account.id, 'USDT', toPriceInt('500', PRICE_SCALE));

    const order = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('0.500', QTY_SCALE),
      price: toPriceInt('101', PRICE_SCALE),
      tif: 'FOK',
    });
    expect(order.status).toBe('OPEN');

    const reports = await collect(
      executeTimeline(
        (async function* () {
          yield tradeEvent(14, '101', '0.500', 'fok-ok', 'SELL');
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
    expect(fillReport.fill?.qty).toEqual(toQtyInt('0.500', QTY_SCALE));
    expect(endReport.kind).toBe('END');

    const updated = orders.getOrder(order.id);
    assertOrderSnapshot(updated);
    expect(updated.status).toBe('FILLED');
    expect(updated.executedQty).toEqual(toQtyInt('0.500', QTY_SCALE));
    expect(updated.fills).toHaveLength(1);

    const quoteBalance = accounts.getBalance(account.id, 'USDT');
    expect(quoteBalance.locked).toBe(0n);
  });

  it('cancels FOK order when available liquidity is insufficient', async () => {
    const { state, accounts, orders } = createState();
    const account = accounts.createAccount('fok-cancel');
    accounts.deposit(account.id, 'USDT', toPriceInt('500', PRICE_SCALE));

    const order = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('1.000', QTY_SCALE),
      price: toPriceInt('101', PRICE_SCALE),
      tif: 'FOK',
    });
    expect(order.status).toBe('OPEN');

    const reports = await collect(
      executeTimeline(
        (async function* () {
          yield tradeEvent(16, '101', '0.600', 'fok-fail', 'SELL');
        })(),
        state,
      ),
    );

    expect(reports).toHaveLength(2);
    const [cancelReport, endReport] = reports as [
      ExecutionReport,
      ExecutionReport,
    ];
    expect(cancelReport.kind).toBe('ORDER_UPDATED');
    expect(cancelReport.orderId).toBe(order.id);
    expect(cancelReport.patch?.status).toBe('CANCELED');
    expect(endReport.kind).toBe('END');

    const updated = orders.getOrder(order.id);
    assertOrderSnapshot(updated);
    expect(updated.status).toBe('CANCELED');
    expect(updated.executedQty).toEqual(toQtyInt('0', QTY_SCALE));
    expect(updated.fills).toHaveLength(0);

    const quoteBalance = accounts.getBalance(account.id, 'USDT');
    expect(quoteBalance.locked).toBe(0n);
  });

  it('activates STOP_LIMIT IOC order and cancels remaining quantity after trade', async () => {
    const { state, accounts, orders } = createState();
    const account = accounts.createAccount('stop-ioc');
    accounts.deposit(account.id, 'USDT', toPriceInt('500', PRICE_SCALE));

    const stopOrder = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'STOP_LIMIT',
      side: 'BUY',
      qty: toQtyInt('1.000', QTY_SCALE),
      price: toPriceInt('101', PRICE_SCALE),
      triggerPrice: toPriceInt('101', PRICE_SCALE),
      triggerDirection: 'UP',
      tif: 'IOC',
    });
    expect(stopOrder.status).toBe('OPEN');
    expect(stopOrder.activated).toBe(false);

    const reports = await collect(
      executeTimeline(
        (async function* () {
          yield tradeEvent(20, '101', '0.400', 'stop-hit', 'SELL');
        })(),
        state,
      ),
    );

    expect(reports).toHaveLength(3);
    const [fillReport, cancelReport, endReport] = reports as [
      ExecutionReport,
      ExecutionReport,
      ExecutionReport,
    ];
    expect(fillReport.kind).toBe('FILL');
    expect(fillReport.orderId).toBe(stopOrder.id);
    expect(fillReport.fill?.qty).toEqual(toQtyInt('0.400', QTY_SCALE));
    expect(cancelReport.kind).toBe('ORDER_UPDATED');
    expect(cancelReport.orderId).toBe(stopOrder.id);
    expect(cancelReport.patch?.status).toBe('CANCELED');
    expect(endReport.kind).toBe('END');

    const updated = orders.getOrder(stopOrder.id);
    assertOrderSnapshot(updated);
    expect(updated.activated).toBe(true);
    expect(updated.type).toBe('LIMIT');
    expect(updated.status).toBe('CANCELED');
    expect(updated.executedQty).toEqual(toQtyInt('0.400', QTY_SCALE));
    expect(updated.fills).toHaveLength(1);

    const quoteBalance = accounts.getBalance(account.id, 'USDT');
    expect(quoteBalance.locked).toBe(0n);
    expect(updated.reserved?.remaining ?? 0n).toBe(0n);
  });
});
