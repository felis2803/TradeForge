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
    fee: { makerBps: FEE_BPS.makerBps, takerBps: FEE_BPS.takerBps },
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

describe('executeTimeline', () => {
  it('partially fills BUY limit order and tracks fees/balances', async () => {
    const { state, accounts, orders } = createState();
    const account = accounts.createAccount('buyer');
    const depositAmount = toPriceInt('200', PRICE_SCALE);
    accounts.deposit(account.id, 'USDT', depositAmount);

    const order = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('1', QTY_SCALE),
      price: toPriceInt('100', PRICE_SCALE),
    });
    expect(order.status).toBe('OPEN');

    const events: MergedEvent[] = [
      tradeEvent(1, '99', '0.3', 't1', 'SELL'),
      tradeEvent(2, '101', '0.5', 't2', 'BUY'),
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
    expect(fillReport.fill?.qty).toEqual(toQtyInt('0.3', QTY_SCALE));
    expect(fillReport.fill?.price).toEqual(toPriceInt('99', PRICE_SCALE));
    expect(fillReport.patch?.status).toBe('PARTIALLY_FILLED');
    expect(endReport.kind).toBe('END');

    const updated = orders.getOrder(order.id);
    assertOrderSnapshot(updated);
    expect(updated.status).toBe('PARTIALLY_FILLED');
    expect(updated.executedQty).toEqual(toQtyInt('0.3', QTY_SCALE));
    expect(updated.fills).toHaveLength(1);

    const expectedNotional = notional('99', '0.3');
    expect(updated.cumulativeQuote).toEqual(
      expectedNotional as unknown as Order['cumulativeQuote'],
    );
    const expectedFee = calcFee(expectedNotional, FEE_BPS.makerBps);
    expect(updated.fees.maker).toEqual(expectedFee);

    const quoteBalance = accounts.getBalance(account.id, 'USDT');
    const baseBalance = accounts.getBalance(account.id, 'BTC');
    expect(baseBalance.free).toEqual(toQtyInt('0.3', QTY_SCALE));
    expect(quoteBalance.locked).toEqual(updated.reserved?.remaining ?? 0n);
    const reservedTotal = updated.reserved?.total ?? 0n;
    expect(reservedTotal).toBeGreaterThan(updated.reserved?.remaining ?? 0n);
  });

  it('fills SELL limit order across multiple trades and releases locked base', async () => {
    const { state, accounts, orders } = createState();
    const account = accounts.createAccount('seller');
    const baseDeposit = toQtyInt('1', QTY_SCALE);
    accounts.deposit(account.id, 'BTC', baseDeposit);

    const order = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'SELL',
      qty: toQtyInt('0.6', QTY_SCALE),
      price: toPriceInt('100', PRICE_SCALE),
    });
    expect(order.status).toBe('OPEN');

    const events = [
      tradeEvent(1, '101', '0.4', 's1', 'BUY'),
      tradeEvent(2, '100', '0.2', 's2', 'BUY'),
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

    const updated = orders.getOrder(order.id);
    assertOrderSnapshot(updated);
    expect(updated.status).toBe('FILLED');
    expect(updated.executedQty).toEqual(toQtyInt('0.6', QTY_SCALE));
    expect(updated.fills).toHaveLength(2);

    const firstNotional = notional('101', '0.4');
    const secondNotional = notional('100', '0.2');
    const totalNotional = firstNotional + secondNotional;
    expect(updated.cumulativeQuote).toEqual(
      totalNotional as unknown as Order['cumulativeQuote'],
    );
    const expectedFee =
      calcFee(firstNotional, FEE_BPS.makerBps) +
      calcFee(secondNotional, FEE_BPS.makerBps);
    expect(updated.fees.maker).toEqual(expectedFee);

    const quoteBalance = accounts.getBalance(account.id, 'USDT');
    const baseBalance = accounts.getBalance(account.id, 'BTC');
    expect(baseBalance.locked).toBe(0n);
    expect(updated.reserved?.remaining).toBe(0n);
    expect(quoteBalance.free).toEqual(totalNotional - expectedFee);
  });

  it('returns unused quote reserve after BUY order fills below limit price', async () => {
    const { state, accounts, orders } = createState();
    const account = accounts.createAccount('buyer-fill');
    accounts.deposit(account.id, 'USDT', toPriceInt('500', PRICE_SCALE));

    const order = orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('0.2', QTY_SCALE),
      price: toPriceInt('110', PRICE_SCALE),
    });
    expect(order.status).toBe('OPEN');

    await collect(
      executeTimeline(
        (async function* () {
          yield tradeEvent(1, '100', '0.2', 'b1', 'SELL');
        })(),
        state,
      ),
    );

    const updated = orders.getOrder(order.id);
    expect(updated.status).toBe('FILLED');
    expect(updated.reserved?.remaining).toBe(0n);
    expect(updated.fills).toHaveLength(1);

    const quoteBalance = accounts.getBalance(account.id, 'USDT');
    const fillNotional = notional('100', '0.2');
    const fee = calcFee(fillNotional, FEE_BPS.makerBps);
    const spent = fillNotional + fee;
    expect(quoteBalance.locked).toBe(0n);
    expect(quoteBalance.free).toEqual(toPriceInt('500', PRICE_SCALE) - spent);
  });

  it('produces deterministic reports for identical timelines', async () => {
    const scenario = () => {
      const { state, accounts, orders } = createState();
      const account = accounts.createAccount('det');
      accounts.deposit(account.id, 'USDT', toPriceInt('300', PRICE_SCALE));
      orders.placeOrder({
        accountId: account.id,
        symbol: SYMBOL,
        type: 'LIMIT',
        side: 'BUY',
        qty: toQtyInt('0.5', QTY_SCALE),
        price: toPriceInt('100', PRICE_SCALE),
      });
      const events = [
        tradeEvent(1, '100', '0.2', 'd1', 'SELL'),
        tradeEvent(2, '100', '0.3', 'd2', 'SELL'),
      ];
      return collect(
        executeTimeline(
          (async function* () {
            for (const event of events) {
              yield event;
            }
          })(),
          state,
        ),
      );
    };

    const [first, second] = await Promise.all([scenario(), scenario()]);
    expect(first).toEqual(second);
  });
});
