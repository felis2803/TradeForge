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

async function collectReports(
  iter: AsyncIterable<ExecutionReport>,
): Promise<ExecutionReport[]> {
  const result: ExecutionReport[] = [];
  for await (const report of iter) {
    result.push(report);
  }
  return result;
}

function tradeEvent(
  ts: number,
  price: string,
  qty: string,
  id: string,
  side: 'BUY' | 'SELL',
): MergedEvent {
  const tsMs = ts as TimestampMs;
  const priceInt = toPriceInt(price, PRICE_SCALE);
  const qtyInt = toQtyInt(qty, QTY_SCALE);
  const payload: Trade = {
    ts: tsMs,
    symbol: SYMBOL,
    price: priceInt,
    qty: qtyInt,
    side,
    id,
  };
  return {
    kind: 'trade',
    ts: tsMs,
    source: 'TRADES',
    seq: ts,
    payload,
  } satisfies MergedEvent;
}

test('SELL limit order credits quote minus collected fees across fills', () => {
  const { state, accounts, orders } = createState();
  const account = accounts.createAccount('seller-edge');
  accounts.deposit(account.id, 'BTC', toQtyInt('1', QTY_SCALE));

  const order = orders.placeOrder({
    accountId: account.id,
    symbol: SYMBOL,
    type: 'LIMIT',
    side: 'SELL',
    qty: toQtyInt('0.5', QTY_SCALE),
    price: toPriceInt('100', PRICE_SCALE),
  });
  expect(order.status).toBe('OPEN');

  orders.applyFill(order.id, {
    ts: state.now(),
    orderId: order.id,
    price: toPriceInt('101', PRICE_SCALE),
    qty: toQtyInt('0.2', QTY_SCALE),
    side: 'SELL',
    liquidity: 'TAKER',
  });
  orders.applyFill(order.id, {
    ts: state.now(),
    orderId: order.id,
    price: toPriceInt('102', PRICE_SCALE),
    qty: toQtyInt('0.3', QTY_SCALE),
    side: 'SELL',
    liquidity: 'MAKER',
  });
  orders.closeOrder(order.id, 'FILLED');

  const updated = orders.getOrder(order.id);
  expect(updated.status).toBe('FILLED');
  const firstNotional = notional('101', '0.2');
  const secondNotional = notional('102', '0.3');
  const expectedTakerFee = calcFee(firstNotional, FEE_BPS.takerBps);
  const expectedMakerFee = calcFee(secondNotional, FEE_BPS.makerBps);
  expect(updated.fees.taker).toEqual(expectedTakerFee);
  expect(updated.fees.maker).toEqual(expectedMakerFee);

  const quoteBalance = accounts.getBalance(account.id, 'USDT');
  expect(quoteBalance.locked).toBe(0n);
  const totalNotional = firstNotional + secondNotional;
  expect(quoteBalance.free).toEqual(
    totalNotional - expectedTakerFee - expectedMakerFee,
  );

  const baseBalance = accounts.getBalance(account.id, 'BTC');
  expect(baseBalance.locked).toBe(0n);
});

test('BUY limit order releases unused quote when fills execute below limit', () => {
  const { state, accounts, orders } = createState();
  const account = accounts.createAccount('buyer-edge');
  const depositAmount = toPriceInt('500', PRICE_SCALE);
  accounts.deposit(account.id, 'USDT', depositAmount);

  const order = orders.placeOrder({
    accountId: account.id,
    symbol: SYMBOL,
    type: 'LIMIT',
    side: 'BUY',
    qty: toQtyInt('0.4', QTY_SCALE),
    price: toPriceInt('110', PRICE_SCALE),
  });
  expect(order.status).toBe('OPEN');
  const reservedTotal = order.reserved?.total ?? 0n;
  expect(reservedTotal).toBeGreaterThan(0n);

  orders.applyFill(order.id, {
    ts: state.now(),
    orderId: order.id,
    price: toPriceInt('100', PRICE_SCALE),
    qty: toQtyInt('0.4', QTY_SCALE),
    side: 'BUY',
    liquidity: 'MAKER',
  });
  orders.closeOrder(order.id, 'FILLED');

  const updated = orders.getOrder(order.id);
  expect(updated.status).toBe('FILLED');
  expect(updated.reserved?.remaining).toBe(0n);

  const fillNotional = notional('100', '0.4');
  const fillFee = calcFee(fillNotional, FEE_BPS.makerBps);
  const spent = fillNotional + fillFee;

  const quoteBalance = accounts.getBalance(account.id, 'USDT');
  expect(quoteBalance.locked).toBe(0n);
  expect(quoteBalance.free).toEqual(depositAmount - spent);
});

test('executeTimeline keeps logical clock deterministic across runs', async () => {
  async function scenario(): Promise<ExecutionReport[]> {
    const { state, accounts, orders } = createState();
    const account = accounts.createAccount('deterministic');
    accounts.deposit(account.id, 'USDT', toPriceInt('300', PRICE_SCALE));
    orders.placeOrder({
      accountId: account.id,
      symbol: SYMBOL,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('0.5', QTY_SCALE),
      price: toPriceInt('100', PRICE_SCALE),
    });
    const events: MergedEvent[] = [
      tradeEvent(1, '100', '0.2', 'd1', 'SELL'),
      tradeEvent(2, '100', '0.3', 'd2', 'SELL'),
    ];
    const timeline = (async function* (): AsyncIterable<MergedEvent> {
      for (const event of events) {
        yield event;
      }
    })();
    return collectReports(executeTimeline(timeline, state));
  }

  const [first, second] = await Promise.all([scenario(), scenario()]);
  expect(first).toEqual(second);
});
