import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  createLogicalClock,
  createMergedStream,
  executeTimeline,
  runReplay,
  toPriceInt,
  toQtyInt,
  type CursorIterable as CoreCursorIterable,
  type DepthEvent,
  type ExecutionReport,
  type MergeStartState,
  type MergedEvent,
  type Order,
  type ReplayLimits,
  type ReplayProgress,
  type SymbolId,
  type TradeEvent,
} from '@tradeforge/core';
import {
  createJsonlCursorReader,
  type CursorIterable as JsonlCursor,
  type DepthDiff,
  type ReaderCursor,
  type Trade,
} from '@tradeforge/io-binance';
import { createLogger } from '../_shared/logging.js';

const NDJSON_PATH = '/tmp/tf.reports.ndjson';
const DEFAULT_TRADES = 'examples/_smoke/mini-trades.jsonl';
const DEFAULT_DEPTH = 'examples/_smoke/mini-depth.jsonl';
const SYMBOL = 'BTCUSDT' as SymbolId;

const logger = createLogger({ prefix: '[examples/07-summary-and-ndjson]' });

type AsyncEventQueue<T> = {
  iterable: AsyncIterable<T>;
  push(value: T): void;
  close(): void;
};

type SummaryTotals = {
  orders: {
    total: number;
    filled: number;
    partiallyFilled: number;
    canceled: number;
  };
  fills: number;
  executedQty: bigint;
  notional: bigint;
  fees: { maker: bigint; taker: bigint };
};

type SummaryResult = {
  totals: SummaryTotals;
  orders: Array<{
    id: string;
    side: string;
    status: string;
    qty: bigint;
    executedQty: bigint;
    cumulativeQuote: bigint;
    fees: { maker?: bigint; taker?: bigint };
    fills: number;
  }>;
  balances: Record<string, Record<string, { free: bigint; locked: bigint }>>;
};

type RunResult = {
  progress: ReplayProgress;
  rows: number;
  summary: SummaryResult & {
    config: {
      symbol: SymbolId;
      priceScale: number;
      qtyScale: number;
      ordersSeeded: Array<{
        id: Order['id'];
        side: Order['side'];
        qty: Order['qty'];
        price?: Order['price'];
      }>;
    };
  };
  ndjsonPath: string;
};

function stringify(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    (_key, val) => (typeof val === 'bigint' ? val.toString() : val),
    space,
  );
}

function createAsyncEventQueue<T>(): AsyncEventQueue<T> {
  const values: T[] = [];
  const waiting: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  function flushWaiters(result: IteratorResult<T>): void {
    const resolver = waiting.shift();
    if (resolver) {
      resolver(result);
    }
  }

  return {
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next(): Promise<IteratorResult<T>> {
            if (values.length > 0) {
              const value = values.shift()!;
              return Promise.resolve({ value, done: false });
            }
            if (closed) {
              return Promise.resolve({
                value: undefined as unknown as T,
                done: true,
              });
            }
            return new Promise((resolve) => {
              waiting.push(resolve);
            });
          },
          return(): Promise<IteratorResult<T>> {
            closed = true;
            values.length = 0;
            while (waiting.length > 0) {
              flushWaiters({ value: undefined as unknown as T, done: true });
            }
            return Promise.resolve({
              value: undefined as unknown as T,
              done: true,
            });
          },
        } satisfies AsyncIterator<T>;
      },
    },
    push(value: T) {
      if (closed) return;
      if (waiting.length > 0) {
        flushWaiters({ value, done: false });
      } else {
        values.push(value);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      while (waiting.length > 0) {
        flushWaiters({ value: undefined as unknown as T, done: true });
      }
    },
  };
}

function splitFilesEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,:]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function ensureAbsolute(files: string[]): string[] {
  return files.map((file) => resolve(file));
}

function resolveFileList(
  envValue: string | undefined,
  fallback: string,
): string[] {
  const entries = splitFilesEnv(envValue);
  if (entries.length === 0) {
    return [resolve(fallback)];
  }
  return ensureAbsolute(entries);
}

function wrapTrades(
  source: JsonlCursor<Trade>,
): CoreCursorIterable<TradeEvent> {
  return {
    currentCursor(): ReaderCursor {
      return source.currentCursor();
    },
    async *[Symbol.asyncIterator](): AsyncIterator<TradeEvent> {
      let lastKey: string | undefined;
      let seq = 0;
      for await (const payload of source) {
        const cursor = source.currentCursor();
        const key = `${cursor.file}::${cursor.entry ?? ''}`;
        if (key !== lastKey) {
          lastKey = key;
          seq = 0;
        }
        const event: TradeEvent = {
          kind: 'trade',
          ts: payload.ts,
          payload,
          source: 'TRADES',
          seq: seq++,
        };
        if (cursor.entry) {
          event.entry = cursor.entry;
        }
        yield event;
      }
    },
  } satisfies CoreCursorIterable<TradeEvent>;
}

function wrapDepth(
  source: JsonlCursor<DepthDiff>,
): CoreCursorIterable<DepthEvent> {
  return {
    currentCursor(): ReaderCursor {
      return source.currentCursor();
    },
    async *[Symbol.asyncIterator](): AsyncIterator<DepthEvent> {
      let lastKey: string | undefined;
      let seq = 0;
      for await (const payload of source) {
        const cursor = source.currentCursor();
        const key = `${cursor.file}::${cursor.entry ?? ''}`;
        if (key !== lastKey) {
          lastKey = key;
          seq = 0;
        }
        const event: DepthEvent = {
          kind: 'depth',
          ts: payload.ts,
          payload,
          source: 'DEPTH',
          seq: seq++,
        };
        if (cursor.entry) {
          event.entry = cursor.entry;
        }
        yield event;
      }
    },
  } satisfies CoreCursorIterable<DepthEvent>;
}

function parseMaxEvents(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 200;
  }
  return Math.floor(parsed);
}

function setupState(symbol: SymbolId): {
  state: ExchangeState;
  accounts: AccountsService;
  priceScale: number;
  qtyScale: number;
  seeded: Order[];
} {
  const priceScale = 5;
  const qtyScale = 6;
  const state = new ExchangeState({
    symbols: {
      [symbol as unknown as string]: {
        base: 'BTC',
        quote: 'USDT',
        priceScale,
        qtyScale,
      },
    },
    fee: { makerBps: 10, takerBps: 20 },
    orderbook: new StaticMockOrderbook({ best: {} }),
  });
  const accounts = new AccountsService(state);
  const orders = new OrdersService(state, accounts);
  const buyAccount = accounts.createAccount('ex07-buy');
  const sellAccount = accounts.createAccount('ex07-sell');
  accounts.deposit(buyAccount.id, 'USDT', toPriceInt('100000', priceScale));
  accounts.deposit(sellAccount.id, 'BTC', toQtyInt('2', qtyScale));
  const seeded: Order[] = [];
  seeded.push(
    orders.placeOrder({
      accountId: buyAccount.id,
      symbol,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('0.4', qtyScale),
      price: toPriceInt('10010', priceScale),
    }),
  );
  seeded.push(
    orders.placeOrder({
      accountId: sellAccount.id,
      symbol,
      type: 'LIMIT',
      side: 'SELL',
      qty: toQtyInt('0.15', qtyScale),
      price: toPriceInt('10005', priceScale),
    }),
  );
  return { state, accounts, priceScale, qtyScale, seeded };
}

function buildSummary(
  state: ExchangeState,
  accounts: AccountsService,
): SummaryResult {
  const ordersList = Array.from(state.orders.values());
  const totals: SummaryTotals = {
    orders: {
      total: ordersList.length,
      filled: 0,
      partiallyFilled: 0,
      canceled: 0,
    },
    fills: 0,
    executedQty: 0n,
    notional: 0n,
    fees: { maker: 0n, taker: 0n },
  };
  const ordersSummary = ordersList.map((order) => {
    if (order.status === 'FILLED') totals.orders.filled += 1;
    if (order.status === 'PARTIALLY_FILLED') totals.orders.partiallyFilled += 1;
    if (order.status === 'CANCELED') totals.orders.canceled += 1;
    totals.fills += order.fills.length;
    totals.executedQty += order.executedQty as unknown as bigint;
    totals.notional += order.cumulativeQuote as unknown as bigint;
    totals.fees.maker += order.fees.maker ?? 0n;
    totals.fees.taker += order.fees.taker ?? 0n;
    return {
      id: order.id as unknown as string,
      side: order.side,
      status: order.status,
      qty: order.qty as unknown as bigint,
      executedQty: order.executedQty as unknown as bigint,
      cumulativeQuote: order.cumulativeQuote as unknown as bigint,
      fees: { ...order.fees },
      fills: order.fills.length,
    };
  });
  const balances: Record<
    string,
    Record<string, { free: bigint; locked: bigint }>
  > = {};
  for (const [id] of state.accounts.entries()) {
    balances[id as unknown as string] = accounts.getBalancesSnapshot(id);
  }
  return { totals, orders: ordersSummary, balances };
}

async function writeReports(
  iterable: AsyncIterable<ExecutionReport>,
  filePath: string,
): Promise<number> {
  const handle = await open(filePath, 'w');
  let rows = 0;
  try {
    for await (const report of iterable) {
      const line = stringify(report);
      await handle.write(`${line}\n`);
      rows += 1;
    }
  } finally {
    await handle.close();
  }
  return rows;
}

export async function run(): Promise<RunResult> {
  const tradeFiles = resolveFileList(
    process.env['TF_TRADES_FILES'],
    DEFAULT_TRADES,
  );
  const depthFiles = resolveFileList(
    process.env['TF_DEPTH_FILES'],
    DEFAULT_DEPTH,
  );
  const maxEvents = parseMaxEvents(process.env['TF_MAX_EVENTS']);
  logger.info(
    `trades=${tradeFiles.join(', ')} depth=${depthFiles.join(', ')} maxEvents=${maxEvents}`,
  );
  logger.info(`NDJSON output -> ${NDJSON_PATH}`);

  const tradeReader = wrapTrades(
    createJsonlCursorReader({ kind: 'trades', files: tradeFiles }),
  );
  const depthReader = wrapDepth(
    createJsonlCursorReader({ kind: 'depth', files: depthFiles }),
  );

  const { state, accounts, priceScale, qtyScale, seeded } = setupState(SYMBOL);
  const queue = createAsyncEventQueue<MergedEvent>();
  const execution = executeTimeline(queue.iterable, state);
  const writerPromise = writeReports(execution, NDJSON_PATH);

  const mergeStart: MergeStartState = { nextSourceOnEqualTs: 'DEPTH' };
  const timeline = createMergedStream(tradeReader, depthReader, mergeStart, {
    preferDepthOnEqualTs: true,
  });

  const limits: ReplayLimits = { maxEvents };
  const clock = createLogicalClock();

  let progress: ReplayProgress;
  try {
    progress = await runReplay({
      timeline,
      clock,
      limits,
      onEvent: (event) => {
        queue.push(event);
      },
      onProgress: (stats) => {
        logger.progress(stats);
      },
    });
  } finally {
    queue.close();
  }

  const written = await writerPromise;
  if (written === 0) {
    logger.warn('no execution reports captured — check inputs or filters');
  } else {
    logger.info(`execution reports captured: ${written}`);
  }

  const summary = buildSummary(state, accounts);
  const summaryWithConfig = {
    ...summary,
    config: {
      symbol: SYMBOL,
      priceScale,
      qtyScale,
      ordersSeeded: seeded.map((order) => ({
        id: order.id,
        side: order.side,
        qty: order.qty,
        price: order.price,
      })),
    },
  };

  console.log('SUMMARY_JSON');
  console.log(stringify(summaryWithConfig, 2));

  const raw = await readFile(NDJSON_PATH, 'utf8');
  const rows = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;

  const wallMs = Math.max(0, progress.wallLastMs - progress.wallStartMs);
  const simMs =
    progress.simStartTs !== undefined && progress.simLastTs !== undefined
      ? Math.max(0, Number(progress.simLastTs) - Number(progress.simStartTs))
      : 0;

  console.log('SUMMARY_NDJSON_OK', {
    rows,
    eventsOut: progress.eventsOut,
    wallMs,
    simMs,
  });

  return {
    progress,
    rows,
    summary: summaryWithConfig,
    ndjsonPath: NDJSON_PATH,
  } satisfies RunResult;
}

async function main(): Promise<void> {
  try {
    await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('SUMMARY_NDJSON_FAILED', message);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

const invokedFromCli =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1]!)).href === import.meta.url;

if (invokedFromCli) {
  void main();
}
