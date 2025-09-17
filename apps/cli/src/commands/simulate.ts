/* eslint-disable */
import { createReader } from '@tradeforge/io-binance';
import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  createAcceleratedClock,
  createLogicalClock,
  createMergedStream,
  createWallClock,
  executeTimeline,
  makeCheckpointV1,
  runReplayBasic,
  toPriceInt,
  toQtyInt,
  type DepthEvent,
  type ExecutionReport,
  type MergedEvent,
  type Order,
  type ReplayLimits,
  type ReplayStats,
  type SimClock,
  type SymbolId,
  type TradeEvent,
  type CheckpointV1,
  type CoreReaderCursor,
  type MergeStartState,
} from '@tradeforge/core';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { materializeFixturePath } from '../utils/materializeFixtures.js';

function stringify(value: unknown, space?: number) {
  return JSON.stringify(
    value,
    (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    space,
  );
}

function parseArgs(argv: string[]): Record<string, string> {
  const res: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        const key = a.slice(2, eq);
        const val = a.slice(eq + 1);
        res[key] = val;
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      const val = next && !next.startsWith('--') ? argv[++i]! : 'true';
      res[key] = val;
    }
  }
  return res;
}

function resolveInputList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((f) => {
      const candidates = [
        resolve(process.cwd(), f),
        resolve(process.cwd(), '..', f),
        resolve(process.cwd(), '..', '..', f),
      ];
      for (const candidate of candidates) {
        const ensured = materializeFixturePath(candidate);
        if (existsSync(ensured)) return ensured;
      }
      const fallback = materializeFixturePath(
        candidates[0] ?? resolve(process.cwd(), f),
      );
      return fallback;
    });
}

function parseTime(value?: string): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isNaN(num) ? undefined : num;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const lower = value.toLowerCase();
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  return defaultValue;
}

function parseNumberArg(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : undefined;
}

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
              resolveNext({
                value: undefined as unknown as T,
                done: true,
              });
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
      if (waiting.length > 0) {
        while (waiting.length > 0) {
          resolveNext({
            value: undefined as unknown as T,
            done: true,
          });
        }
      }
    },
  };
}

function createEmptyStream(): AsyncIterable<DepthEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      return;
    },
  };
}

function setupState(symbol: SymbolId) {
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
  const placed: Order[] = [];
  placed.push(
    orders.placeOrder({
      accountId: buyAccount.id,
      symbol,
      type: 'LIMIT',
      side: 'BUY',
      qty: toQtyInt('0.4', qtyScale),
      price: toPriceInt('10010', priceScale),
    }),
  );
  placed.push(
    orders.placeOrder({
      accountId: sellAccount.id,
      symbol,
      type: 'LIMIT',
      side: 'SELL',
      qty: toQtyInt('0.15', qtyScale),
      price: toPriceInt('10005', priceScale),
    }),
  );
  return { state, accounts, orders, placed, priceScale, qtyScale };
}

interface SummaryTotals {
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
}

function buildSummary(
  state: ExchangeState,
  accounts: AccountsService,
): {
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
} {
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

type DebugCursorSource = { currentCursor?: () => unknown };

function normalizeCursorValue(raw: unknown): CoreReaderCursor {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid cursor value');
  }
  const record = raw as Record<string, unknown>;
  const file = record['file'];
  const recordIndex = record['recordIndex'];
  if (typeof file !== 'string' || typeof recordIndex !== 'number') {
    throw new Error('cursor must contain file:string and recordIndex:number');
  }
  const cursor: CoreReaderCursor = { file, recordIndex };
  const entryValue = record['entry'];
  if (typeof entryValue === 'string') {
    cursor.entry = entryValue;
  }
  return cursor;
}

function getCursorFromSource(
  source?: DebugCursorSource,
): CoreReaderCursor | undefined {
  if (!source || typeof source.currentCursor !== 'function') {
    return undefined;
  }
  const current = source.currentCursor();
  if (!current) {
    return undefined;
  }
  return normalizeCursorValue(current);
}

const debugCheckpointHelpers = process.env['TF_DEBUG_CP']
  ? {
      collectCursors(readers: {
        trades?: DebugCursorSource;
        depth?: DebugCursorSource;
      }): { trades?: CoreReaderCursor; depth?: CoreReaderCursor } {
        const result: { trades?: CoreReaderCursor; depth?: CoreReaderCursor } =
          {};
        const trades = getCursorFromSource(readers.trades);
        if (trades) {
          result.trades = trades;
        }
        const depth = getCursorFromSource(readers.depth);
        if (depth) {
          result.depth = depth;
        }
        return result;
      },
      makeCheckpoint(params: {
        symbol: SymbolId;
        state: ExchangeState;
        cursors: { trades?: CoreReaderCursor; depth?: CoreReaderCursor };
        merge?: MergeStartState;
        note?: string;
      }): CheckpointV1 {
        const payload: Parameters<typeof makeCheckpointV1>[0] = {
          symbol: params.symbol,
          state: params.state,
          cursors: params.cursors,
        };
        if (params.merge) {
          payload.merge = params.merge;
        }
        if (params.note) {
          payload.note = params.note;
        }
        return makeCheckpointV1(payload);
      },
    }
  : undefined;

export const __debugCheckpoint = debugCheckpointHelpers;

export async function simulate(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const tradeFiles = resolveInputList(args['trades']);
  if (tradeFiles.length === 0) {
    console.error(
      'usage: tf simulate --trades <files> [--depth <files>] [--symbol BTCUSDT]',
    );
    process.exitCode = 1;
    return;
  }
  const depthFiles = resolveInputList(args['depth']);
  const symbol = (args['symbol'] ?? 'BTCUSDT') as SymbolId;
  const limit = args['limit'] ? Number(args['limit']) : undefined;
  const fromMs = parseTime(args['from']);
  const toMs = parseTime(args['to']);
  const ndjson = parseBool(args['ndjson'], false);
  const printSummary = parseBool(args['summary'], true);
  const preferDepth = parseBool(args['prefer-depth-on-equal-ts'], true);
  const treatAsMaker = parseBool(args['treat-limit-as-maker'], true);
  const strictConservative = parseBool(args['strict-conservative'], false);
  const useAggressorLiquidity = parseBool(
    args['use-aggressor-liquidity'],
    false,
  );
  const clockMode = (args['clock'] ?? 'logical').toLowerCase();
  const speedArg = parseNumberArg(args['speed']);
  const maxEventsArg = parseNumberArg(args['max-events']);
  const maxSimMsArg = parseNumberArg(args['max-sim-ms']);
  const maxWallMsArg = parseNumberArg(args['max-wall-ms']);
  let clock: SimClock;
  switch (clockMode) {
    case 'wall':
      clock = createWallClock();
      break;
    case 'accel':
    case 'accelerated': {
      const speed = Math.max(speedArg ?? 10, 0);
      clock = createAcceleratedClock(speed);
      break;
    }
    case 'logical':
      clock = createLogicalClock();
      break;
    default:
      console.warn(`unknown clock "${clockMode}", falling back to logical`);
      clock = createLogicalClock();
      break;
  }
  const limits: ReplayLimits = {};
  if (maxEventsArg !== undefined && maxEventsArg >= 0) {
    limits.maxEvents = Math.floor(maxEventsArg);
  }
  if (maxSimMsArg !== undefined && maxSimMsArg >= 0) {
    limits.maxSimTimeMs = maxSimMsArg;
  }
  if (maxWallMsArg !== undefined && maxWallMsArg >= 0) {
    limits.maxWallTimeMs = maxWallMsArg;
  }
  const replayLimits: ReplayLimits | undefined =
    Object.keys(limits).length > 0 ? limits : undefined;
  const timeFilter: { fromMs?: number; toMs?: number } = {};
  if (fromMs !== undefined) timeFilter.fromMs = fromMs;
  if (toMs !== undefined) timeFilter.toMs = toMs;

  const tradeOpts: Record<string, unknown> = {
    kind: 'trades',
    files: tradeFiles,
    symbol,
    format: args['format-trades'] ?? 'auto',
    internalTag: 'TRADES',
  };
  if (Object.keys(timeFilter).length) {
    tradeOpts['timeFilter'] = timeFilter;
  }
  const tradeReader = createReader(
    tradeOpts as any,
  ) as AsyncIterable<TradeEvent>;

  let depthReader: AsyncIterable<DepthEvent> = createEmptyStream();
  if (depthFiles.length > 0) {
    const depthOpts: Record<string, unknown> = {
      kind: 'depth',
      files: depthFiles,
      symbol,
      format: args['format-depth'] ?? 'auto',
      internalTag: 'DEPTH',
    };
    if (Object.keys(timeFilter).length) {
      depthOpts['timeFilter'] = timeFilter;
    }
    depthReader = createReader(depthOpts as any) as AsyncIterable<DepthEvent>;
  }

  const { state, accounts, placed, priceScale, qtyScale } = setupState(symbol);
  const merged = createMergedStream(tradeReader, depthReader, {
    preferDepthOnEqualTs: preferDepth,
  });

  const reports: ExecutionReport[] = [];
  let printed = 0;
  const eventQueue = createAsyncEventQueue<MergedEvent>();
  const execution = executeTimeline(eventQueue.iterable, state, {
    treatLimitAsMaker: treatAsMaker,
    participationFactor: strictConservative ? 0 : 1,
    useAggressorForLiquidity: useAggressorLiquidity,
  });
  const executionPromise = (async () => {
    for await (const report of execution) {
      reports.push(report);
      if (ndjson) {
        if (limit === undefined || printed < limit) {
          console.log(stringify(report));
          printed += 1;
        }
      }
    }
  })();

  let replayStats: ReplayStats | undefined;
  let replayError: unknown;
  try {
    replayStats = await runReplayBasic({
      timeline: merged,
      clock,
      ...(replayLimits ? { limits: replayLimits } : {}),
      onEvent: (event) => {
        eventQueue.push(event);
      },
    });
  } catch (err) {
    replayError = err;
  } finally {
    eventQueue.close();
  }

  try {
    await executionPromise;
  } catch (err) {
    if (!replayError) {
      replayError = err;
    }
  }

  if (replayError) {
    throw replayError;
  }
  if (!replayStats) {
    throw new Error('replay aborted without stats');
  }
  const stats = replayStats;

  if (!ndjson && reports.length === 0) {
    console.log('no execution reports emitted (check filters or inputs)');
  }

  const simDurationMs =
    stats.simStartTs !== undefined && stats.simLastTs !== undefined
      ? Number(stats.simLastTs) - Number(stats.simStartTs)
      : 0;
  const wallDurationMs = stats.wallLastMs - stats.wallStartMs;
  const replaySummary = {
    clock: clock.desc(),
    eventsOut: stats.eventsOut,
    simDurationMs,
    wallDurationMs,
  } satisfies Record<string, unknown>;
  console.log(stringify(replaySummary, 2));

  if (printSummary) {
    const summary = buildSummary(state, accounts);
    const summaryWithConfig = {
      ...summary,
      config: {
        symbol,
        priceScale,
        qtyScale,
        ordersSeeded: placed.map((o) => ({
          id: o.id,
          side: o.side,
          qty: o.qty,
          price: o.price,
        })),
      },
    };
    console.log(stringify(summaryWithConfig, 2));
  }
}
