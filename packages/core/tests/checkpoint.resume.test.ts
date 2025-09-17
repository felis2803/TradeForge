import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AccountsService,
  CoreReaderCursor,
  CursorIterable,
  DepthEvent,
  ExchangeState,
  MergeStartState,
  MergedEvent,
  OrdersService,
  StaticMockOrderbook,
  SymbolId,
  TradeEvent,
  TimestampMs,
  createMergedStream,
  executeTimeline,
  loadCheckpoint,
  makeCheckpointV1,
  resumeFromCheckpoint,
  saveCheckpoint,
  serializeExchangeState,
  toPriceInt,
  toQtyInt,
} from '../src/index';

const SYMBOL = 'BTCUSDT' as SymbolId;
const PRICE_SCALE = 5;
const QTY_SCALE = 6;
const TRADE_FILE = 'trades-fixture.jsonl';
const DEPTH_FILE = 'depth-fixture.jsonl';

interface TradeRecord {
  ts: number;
  price: ReturnType<typeof toPriceInt>;
  qty: ReturnType<typeof toQtyInt>;
  side: 'BUY' | 'SELL';
  aggressor: 'BUY' | 'SELL';
  id: string;
}

interface DepthRecord {
  ts: number;
  bids: Array<{
    price: ReturnType<typeof toPriceInt>;
    qty: ReturnType<typeof toQtyInt>;
  }>;
  asks: Array<{
    price: ReturnType<typeof toPriceInt>;
    qty: ReturnType<typeof toQtyInt>;
  }>;
}

const TRADE_DATA: TradeRecord[] = [
  {
    ts: 1,
    price: toPriceInt('10005', PRICE_SCALE),
    qty: toQtyInt('0.10', QTY_SCALE),
    side: 'SELL',
    aggressor: 'SELL',
    id: 'T1',
  },
  {
    ts: 2,
    price: toPriceInt('10004', PRICE_SCALE),
    qty: toQtyInt('0.05', QTY_SCALE),
    side: 'SELL',
    aggressor: 'SELL',
    id: 'T2',
  },
  {
    ts: 3,
    price: toPriceInt('10006', PRICE_SCALE),
    qty: toQtyInt('0.15', QTY_SCALE),
    side: 'SELL',
    aggressor: 'SELL',
    id: 'T3',
  },
  {
    ts: 4,
    price: toPriceInt('10007', PRICE_SCALE),
    qty: toQtyInt('0.10', QTY_SCALE),
    side: 'SELL',
    aggressor: 'SELL',
    id: 'T4',
  },
  {
    ts: 5,
    price: toPriceInt('10008', PRICE_SCALE),
    qty: toQtyInt('0.05', QTY_SCALE),
    side: 'SELL',
    aggressor: 'SELL',
    id: 'T5',
  },
];

const DEPTH_DATA: DepthRecord[] = [
  {
    ts: 3,
    bids: [
      {
        price: toPriceInt('10001', PRICE_SCALE),
        qty: toQtyInt('0.80', QTY_SCALE),
      },
    ],
    asks: [],
  },
  {
    ts: 4,
    bids: [
      {
        price: toPriceInt('10002', PRICE_SCALE),
        qty: toQtyInt('0.60', QTY_SCALE),
      },
    ],
    asks: [],
  },
  {
    ts: 5,
    bids: [
      {
        price: toPriceInt('10003', PRICE_SCALE),
        qty: toQtyInt('0.40', QTY_SCALE),
      },
    ],
    asks: [],
  },
];

function toTimestamp(value: number): TimestampMs {
  return value as TimestampMs;
}

function getCursor(
  source: { currentCursor?: () => unknown } | undefined,
): CoreReaderCursor | undefined {
  if (!source || typeof source.currentCursor !== 'function') {
    return undefined;
  }
  const raw = source.currentCursor();
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const value = raw as Partial<CoreReaderCursor>;
  if (typeof value.file !== 'string' || typeof value.recordIndex !== 'number') {
    return undefined;
  }
  const normalized: CoreReaderCursor = {
    file: value.file,
    recordIndex: value.recordIndex,
  };
  if (typeof value.entry === 'string') {
    normalized.entry = value.entry;
  }
  return normalized;
}

function buildTrades(cursor?: CoreReaderCursor): CursorIterable<TradeEvent> {
  if (cursor && cursor.file !== TRADE_FILE) {
    throw new Error(`unexpected trade cursor file: ${cursor.file}`);
  }
  const startIndex = cursor?.recordIndex ?? 0;
  if (startIndex < 0 || startIndex > TRADE_DATA.length) {
    throw new Error('invalid trade cursor record index');
  }
  let nextIndex = startIndex;
  return {
    currentCursor(): CoreReaderCursor {
      const base: CoreReaderCursor = {
        file: TRADE_FILE,
        recordIndex: nextIndex,
      };
      return base;
    },
    async *[Symbol.asyncIterator](): AsyncIterator<TradeEvent> {
      for (let idx = startIndex; idx < TRADE_DATA.length; idx += 1) {
        const record = TRADE_DATA[idx]!;
        const ts = toTimestamp(record.ts);
        const event: TradeEvent = {
          kind: 'trade',
          ts,
          payload: {
            ts,
            symbol: SYMBOL,
            price: record.price,
            qty: record.qty,
            side: record.side,
            aggressor: record.aggressor,
            id: record.id,
          },
          source: 'TRADES',
          seq: idx,
          entry: TRADE_FILE,
        };
        nextIndex = idx + 1;
        yield event;
      }
    },
  } satisfies CursorIterable<TradeEvent>;
}

function buildDepth(cursor?: CoreReaderCursor): CursorIterable<DepthEvent> {
  if (cursor && cursor.file !== DEPTH_FILE) {
    throw new Error(`unexpected depth cursor file: ${cursor.file}`);
  }
  const startIndex = cursor?.recordIndex ?? 0;
  if (startIndex < 0 || startIndex > DEPTH_DATA.length) {
    throw new Error('invalid depth cursor record index');
  }
  let nextIndex = startIndex;
  return {
    currentCursor(): CoreReaderCursor {
      const base: CoreReaderCursor = {
        file: DEPTH_FILE,
        recordIndex: nextIndex,
      };
      return base;
    },
    async *[Symbol.asyncIterator](): AsyncIterator<DepthEvent> {
      for (let idx = startIndex; idx < DEPTH_DATA.length; idx += 1) {
        const record = DEPTH_DATA[idx]!;
        const ts = toTimestamp(record.ts);
        const event: DepthEvent = {
          kind: 'depth',
          ts,
          payload: {
            ts,
            symbol: SYMBOL,
            bids: record.bids.map((level) => ({
              price: level.price,
              qty: level.qty,
            })),
            asks: record.asks.map((level) => ({
              price: level.price,
              qty: level.qty,
            })),
          },
          source: 'DEPTH',
          seq: idx,
          entry: DEPTH_FILE,
        };
        nextIndex = idx + 1;
        yield event;
      }
    },
  } satisfies CursorIterable<DepthEvent>;
}

function takeAsync<T>(
  iterable: AsyncIterable<T>,
  limit: number,
): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      const iterator = iterable[Symbol.asyncIterator]();
      let taken = 0;
      try {
        while (taken < limit) {
          const next = await iterator.next();
          if (next.done) {
            return;
          }
          yield next.value;
          taken += 1;
        }
      } finally {
        if (iterator.return) {
          await iterator.return();
        }
      }
    },
  };
}

function setupSimulationState(): {
  state: ExchangeState;
  accounts: AccountsService;
  orders: OrdersService;
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
  const buyAccount = accounts.createAccount('resume-buy');
  const sellAccount = accounts.createAccount('resume-sell');
  accounts.deposit(buyAccount.id, 'USDT', toPriceInt('100000', PRICE_SCALE));
  accounts.deposit(sellAccount.id, 'BTC', toQtyInt('2', QTY_SCALE));
  orders.placeOrder({
    accountId: buyAccount.id,
    symbol: SYMBOL,
    type: 'LIMIT',
    side: 'BUY',
    qty: toQtyInt('0.4', QTY_SCALE),
    price: toPriceInt('10010', PRICE_SCALE),
  });
  orders.placeOrder({
    accountId: sellAccount.id,
    symbol: SYMBOL,
    type: 'LIMIT',
    side: 'SELL',
    qty: toQtyInt('0.15', QTY_SCALE),
    price: toPriceInt('10005', PRICE_SCALE),
  });
  return { state, accounts, orders };
}

async function drainExecution(
  timeline: AsyncIterable<MergedEvent>,
  state: ExchangeState,
): Promise<void> {
  for await (const report of executeTimeline(timeline, state)) {
    void report;
  }
}

test('resume from checkpoint produces identical final state', async () => {
  const mergeStart: MergeStartState = { nextSourceOnEqualTs: 'TRADES' };
  const mergeOptions = { preferDepthOnEqualTs: true } as const;

  const baselineEnv = setupSimulationState();
  const baselineTimeline = createMergedStream(
    buildTrades(),
    buildDepth(),
    mergeStart,
    mergeOptions,
  );
  await drainExecution(baselineTimeline, baselineEnv.state);
  const baselineSerialized = serializeExchangeState(baselineEnv.state);

  const checkpointEnv = setupSimulationState();
  const tradesReader = buildTrades();
  const depthReader = buildDepth();
  const partialTimeline = createMergedStream(
    tradesReader,
    depthReader,
    mergeStart,
    mergeOptions,
  );
  await drainExecution(takeAsync(partialTimeline, 2), checkpointEnv.state);
  const cursors: { trades?: CoreReaderCursor; depth?: CoreReaderCursor } = {};
  const tradeCursor = getCursor(tradesReader);
  if (tradeCursor) {
    cursors.trades = tradeCursor;
  }
  const depthCursor = getCursor(depthReader);
  if (depthCursor) {
    cursors.depth = depthCursor;
  }
  expect(cursors.trades?.recordIndex).toBe(2);

  const checkpoint = makeCheckpointV1({
    symbol: SYMBOL,
    state: checkpointEnv.state,
    cursors,
    merge: mergeStart,
  });

  const tempDir = await mkdtemp(join(tmpdir(), 'tf-checkpoint-'));
  const filePath = join(tempDir, 'cp.json');
  try {
    await saveCheckpoint(filePath, checkpoint);
    const loadedCheckpoint = await loadCheckpoint(filePath);
    const resumed = await resumeFromCheckpoint(loadedCheckpoint, {
      buildTrades: (cursor) => buildTrades(cursor),
      buildDepth: (cursor) => buildDepth(cursor),
      createMerged: (trades, depth, start) =>
        createMergedStream(
          trades as CursorIterable<TradeEvent> | AsyncIterable<TradeEvent>,
          depth as CursorIterable<DepthEvent> | AsyncIterable<DepthEvent>,
          start,
          mergeOptions,
        ),
      continueRun: async (timeline, state) => {
        await drainExecution(timeline as AsyncIterable<MergedEvent>, state);
      },
    });
    const resumedSerialized = serializeExchangeState(resumed.state);
    expect(resumedSerialized).toEqual(baselineSerialized);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
