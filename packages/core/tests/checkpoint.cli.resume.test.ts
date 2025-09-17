import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  createMergedStream,
  createLogicalClock,
  executeTimeline,
  runReplay,
  makeCheckpointV1,
  saveCheckpoint,
  toPriceInt,
  toQtyInt,
  type SymbolId,
  type TradeEvent,
  type DepthEvent,
  type MergedEvent,
  type CoreReaderCursor,
  type MergeStartState,
  type Trade,
  type DepthDiff,
} from '@tradeforge/core';
import {
  createJsonlCursorReader,
  type CursorIterable,
  type ReaderCursor,
} from '../../io-binance/src/index.js';
import { simulate } from '../../../apps/cli/src/commands/simulate.js';

const SYMBOL = 'BTCUSDT' as SymbolId;
const TRADES_FILE = resolve(
  process.cwd(),
  'packages/io-binance/tests/fixtures/trades.jsonl',
);
const DEPTH_FILE = resolve(
  process.cwd(),
  'packages/io-binance/tests/fixtures/depth.jsonl',
);
const MERGE_OPTIONS = { preferDepthOnEqualTs: true } as const;

interface AsyncEventQueue<T> {
  iterable: AsyncIterable<T>;
  push(value: T): void;
  close(): void;
}

function createAsyncEventQueue<T>(): AsyncEventQueue<T> {
  const values: T[] = [];
  const waiting: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  function resolveNext(result: IteratorResult<T>): void {
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
              resolveNext({ value: undefined as unknown as T, done: true });
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
        resolveNext({ value, done: false });
      } else {
        values.push(value);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      while (waiting.length > 0) {
        resolveNext({ value: undefined as unknown as T, done: true });
      }
    },
  };
}

function takeEvents<T>(
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
  } satisfies AsyncIterable<T>;
}

function setupCliState(symbol: SymbolId): ExchangeState {
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
  const buyAccount = accounts.createAccount('cli-sim-buy');
  const sellAccount = accounts.createAccount('cli-sim-sell');
  accounts.deposit(buyAccount.id, 'USDT', toPriceInt('100000', priceScale));
  accounts.deposit(sellAccount.id, 'BTC', toQtyInt('2', qtyScale));
  orders.placeOrder({
    accountId: buyAccount.id,
    symbol,
    type: 'LIMIT',
    side: 'BUY',
    qty: toQtyInt('0.4', qtyScale),
    price: toPriceInt('10010', priceScale),
  });
  orders.placeOrder({
    accountId: sellAccount.id,
    symbol,
    type: 'LIMIT',
    side: 'SELL',
    qty: toQtyInt('0.15', qtyScale),
    price: toPriceInt('10005', priceScale),
  });
  return state;
}

function toCoreCursor(
  cursor: ReaderCursor | undefined,
): CoreReaderCursor | undefined {
  if (!cursor) return undefined;
  const normalized: CoreReaderCursor = {
    file: cursor.file,
    recordIndex: cursor.recordIndex,
  };
  if (cursor.entry) {
    normalized.entry = cursor.entry;
  }
  return normalized;
}

function wrapTradeCursor(
  source: CursorIterable<Trade>,
): CursorIterable<TradeEvent> {
  return {
    currentCursor(): ReaderCursor {
      return source.currentCursor();
    },
    async *[Symbol.asyncIterator](): AsyncIterator<TradeEvent> {
      let currentKey: string | undefined;
      let seq = 0;
      for await (const payload of source) {
        const cursor = source.currentCursor();
        const entry = cursor.entry ?? basename(cursor.file);
        const key = `${cursor.file}::${cursor.entry ?? ''}`;
        if (key !== currentKey) {
          currentKey = key;
          seq = 0;
        }
        const event: TradeEvent = {
          kind: 'trade',
          ts: payload.ts,
          payload,
          source: 'TRADES',
          seq: seq++,
        };
        if (entry) {
          event.entry = entry;
        }
        yield event;
      }
    },
  } satisfies CursorIterable<TradeEvent>;
}

function wrapDepthCursor(
  source: CursorIterable<DepthDiff>,
): CursorIterable<DepthEvent> {
  return {
    currentCursor(): ReaderCursor {
      return source.currentCursor();
    },
    async *[Symbol.asyncIterator](): AsyncIterator<DepthEvent> {
      let currentKey: string | undefined;
      let seq = 0;
      for await (const payload of source) {
        const cursor = source.currentCursor();
        const entry = cursor.entry ?? basename(cursor.file);
        const key = `${cursor.file}::${cursor.entry ?? ''}`;
        if (key !== currentKey) {
          currentKey = key;
          seq = 0;
        }
        const event: DepthEvent = {
          kind: 'depth',
          ts: payload.ts,
          payload,
          source: 'DEPTH',
          seq: seq++,
        };
        if (entry) {
          event.entry = entry;
        }
        yield event;
      }
    },
  } satisfies CursorIterable<DepthEvent>;
}

async function runSimulationTimeline(
  timeline: AsyncIterable<MergedEvent>,
  state: ExchangeState,
  limitEvents?: number,
): Promise<void> {
  const queue = createAsyncEventQueue<MergedEvent>();
  const execution = executeTimeline(queue.iterable, state, {
    treatLimitAsMaker: true,
    participationFactor: 1,
    useAggressorForLiquidity: false,
  });
  const executionPromise = (async () => {
    for await (const report of execution) {
      void report;
    }
  })();
  const clock = createLogicalClock();
  const timelineToRun =
    limitEvents !== undefined ? takeEvents(timeline, limitEvents) : timeline;
  await runReplay({
    timeline: timelineToRun,
    clock,
    onEvent: (event) => {
      queue.push(event);
    },
  });
  queue.close();
  await executionPromise;
}

async function createCheckpointFixture(limitEvents = 2): Promise<{
  checkpointPath: string;
  cleanup: () => Promise<void>;
}> {
  const state = setupCliState(SYMBOL);
  const tradeCursor = createJsonlCursorReader({
    kind: 'trades',
    files: [TRADES_FILE],
    symbol: SYMBOL,
  });
  const depthCursor = createJsonlCursorReader({
    kind: 'depth',
    files: [DEPTH_FILE],
    symbol: SYMBOL,
  });
  const tradeStream = wrapTradeCursor(tradeCursor);
  const depthStream = wrapDepthCursor(depthCursor);
  const mergeStart: MergeStartState = { nextSourceOnEqualTs: 'DEPTH' };
  const timeline = createMergedStream(
    tradeStream,
    depthStream,
    mergeStart,
    MERGE_OPTIONS,
  );
  await runSimulationTimeline(timeline, state, limitEvents);
  const cursors: { trades?: CoreReaderCursor; depth?: CoreReaderCursor } = {};
  const tradesCursor = toCoreCursor(tradeCursor.currentCursor());
  if (tradesCursor) {
    cursors.trades = tradesCursor;
  }
  const depthCursorValue = toCoreCursor(depthCursor.currentCursor());
  if (depthCursorValue) {
    cursors.depth = depthCursorValue;
  }
  const checkpoint = makeCheckpointV1({
    symbol: SYMBOL,
    state,
    cursors,
    merge: mergeStart,
  });
  const dir = await mkdtemp(join(tmpdir(), 'tf-cli-resume-'));
  const checkpointPath = join(dir, 'resume.json');
  await saveCheckpoint(checkpointPath, checkpoint);
  return {
    checkpointPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

async function runCli(args: string[]): Promise<{
  logs: string[];
  errors: string[];
  exitCode: number | undefined;
}> {
  const logs: string[] = [];
  const errors: string[] = [];
  const logSpy = jest
    .spyOn(console, 'log')
    .mockImplementation((...items: unknown[]) => {
      logs.push(items.map((item) => String(item)).join(' '));
    });
  const errorSpy = jest
    .spyOn(console, 'error')
    .mockImplementation((...items: unknown[]) => {
      errors.push(items.map((item) => String(item)).join(' '));
    });
  const previousExit = process.exitCode;
  process.exitCode = undefined;
  try {
    await simulate(args);
  } finally {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  }
  const exitCode = process.exitCode;
  process.exitCode = previousExit ?? undefined;
  return { logs, errors, exitCode };
}

interface ResumeSummary {
  totals: unknown;
  orders: unknown;
  balances: unknown;
  config: { priceScale: unknown; qtyScale: unknown };
}

function parseSummary(lines: string[]): ResumeSummary {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const candidate = lines[i]?.trim();
    if (candidate && candidate.startsWith('{')) {
      return JSON.parse(candidate) as ResumeSummary;
    }
  }
  throw new Error('summary JSON not found in CLI output');
}

describe('CLI checkpoint resume', () => {
  test('resume from checkpoint matches baseline summary', async () => {
    const baseline = await runCli([
      '--trades',
      TRADES_FILE,
      '--depth',
      DEPTH_FILE,
      '--clock',
      'logical',
      '--summary',
    ]);
    expect(baseline.exitCode ?? 0).toBe(0);
    const baselineSummary = parseSummary(baseline.logs);

    const { checkpointPath, cleanup } = await createCheckpointFixture(2);
    try {
      const resumed = await runCli([
        '--trades',
        TRADES_FILE,
        '--depth',
        DEPTH_FILE,
        '--clock',
        'logical',
        '--checkpoint-load',
        checkpointPath,
        '--summary',
      ]);
      expect(resumed.exitCode ?? 0).toBe(0);
      const resumedSummary = parseSummary(resumed.logs);
      expect(resumedSummary.totals).toEqual(baselineSummary.totals);
      expect(resumedSummary.orders).toEqual(baselineSummary.orders);
      expect(resumedSummary.balances).toEqual(baselineSummary.balances);
      expect(resumedSummary.config.priceScale).toEqual(
        baselineSummary.config.priceScale,
      );
      expect(resumedSummary.config.qtyScale).toEqual(
        baselineSummary.config.qtyScale,
      );
    } finally {
      await cleanup();
    }
  });

  test('fails when trades inputs are missing for checkpoint', async () => {
    const { checkpointPath, cleanup } = await createCheckpointFixture(2);
    try {
      const result = await runCli([
        '--depth',
        DEPTH_FILE,
        '--clock',
        'logical',
        '--checkpoint-load',
        checkpointPath,
      ]);
      expect(result.exitCode).toBe(1);
      expect(
        result.errors.some((line) => line.includes('--trades')),
      ).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  test('fails on unsupported checkpoint version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tf-cli-invalid-cp-'));
    const checkpointPath = join(dir, 'invalid.json');
    await writeFile(checkpointPath, JSON.stringify({ version: 2 }), 'utf8');
    try {
      const result = await runCli([
        '--trades',
        TRADES_FILE,
        '--depth',
        DEPTH_FILE,
        '--clock',
        'logical',
        '--checkpoint-load',
        checkpointPath,
      ]);
      expect(result.exitCode).toBe(1);
      expect(
        result.errors.some((line) =>
          line.includes('unsupported checkpoint version'),
        ),
      ).toBeTruthy();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
