/* eslint-disable */
import { createJsonlCursorReader, createReader } from '@tradeforge/io-binance';
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
  loadCheckpoint,
  deserializeExchangeState,
  restoreEngineFromSnapshot,
  makeCheckpointV1,
  runReplay,
  createReplayController,
  toPriceInt,
  toQtyInt,
  type DepthEvent,
  type ExecutionReport,
  type MergedEvent,
  type Order,
  type ReplayLimits,
  type ReplayProgress,
  type SimClock,
  type SymbolId,
  type TradeEvent,
  type Trade,
  type DepthDiff,
  type CheckpointV1,
  type CoreReaderCursor,
  type MergeStartState,
} from '@tradeforge/core';
import {
  ajv as validationAjv,
  validateLogV1,
  type LogEntryV1,
} from '@tradeforge/validation';
import { existsSync } from 'fs';
import { resolve, basename } from 'path';
import { materializeFixturePath } from '../utils/materializeFixtures.js';

function stringify(value: unknown, space?: number) {
  return JSON.stringify(
    value,
    (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    space,
  );
}

function toNumericLike(value: unknown): string | number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'bigint') {
    return value.toString(10);
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  return undefined;
}

type ValidationErrors = Parameters<typeof validationAjv.errorsText>[0];

function warnValidation(kind: string, errors: ValidationErrors): void {
  if (!errors || errors.length === 0) {
    return;
  }
  const message = validationAjv.errorsText(errors, { separator: '; ' });
  console.warn(`[simulate] ${kind} validation failed: ${message}`);
}

function toExecutionReportLog(report: ExecutionReport): LogEntryV1 {
  const entry: LogEntryV1 = {
    ts: Number(report.ts),
    kind: report.kind,
  };

  if (report.orderId !== undefined) {
    entry.orderId = String(report.orderId);
  }

  if (report.fill) {
    const price = toNumericLike(report.fill.price) ?? String(report.fill.price);
    const qty = toNumericLike(report.fill.qty) ?? String(report.fill.qty);
    const fill: NonNullable<LogEntryV1['fill']> = {
      price,
      qty,
    };
    if (report.fill.ts !== undefined) {
      fill.ts = Number(report.fill.ts);
    }
    if (report.fill.orderId !== undefined) {
      fill.orderId = String(report.fill.orderId);
    }
    if (report.fill.side) {
      fill.side = report.fill.side;
    }
    if (report.fill.liquidity) {
      fill.liquidity = report.fill.liquidity;
    }
    if (report.fill.tradeRef !== undefined) {
      fill.tradeRef = report.fill.tradeRef;
    }
    if (report.fill.sourceAggressor !== undefined) {
      fill.sourceAggressor = report.fill.sourceAggressor;
    }
    entry.fill = fill;
  }

  if (report.patch) {
    const patch: NonNullable<LogEntryV1['patch']> = {};
    if (report.patch.status !== undefined) {
      patch.status = report.patch.status;
    }
    if (report.patch.executedQty !== undefined) {
      const value = toNumericLike(report.patch.executedQty);
      if (value !== undefined) {
        patch.executedQty = value;
      }
    }
    if (report.patch.cumulativeQuote !== undefined) {
      const value = toNumericLike(report.patch.cumulativeQuote);
      if (value !== undefined) {
        patch.cumulativeQuote = value;
      }
    }
    if (report.patch.fees) {
      const fees: Record<string, unknown> = {};
      if (report.patch.fees.maker !== undefined) {
        const maker = toNumericLike(report.patch.fees.maker);
        if (maker !== undefined) {
          fees['maker'] = maker;
        }
      }
      if (report.patch.fees.taker !== undefined) {
        const taker = toNumericLike(report.patch.fees.taker);
        if (taker !== undefined) {
          fees['taker'] = taker;
        }
      }
      patch.fees = fees;
    }
    if (report.patch.tsUpdated !== undefined) {
      patch.tsUpdated = Number(report.patch.tsUpdated);
    }
    if (Object.keys(patch).length > 0) {
      entry.patch = patch;
    }
  }

  return entry;
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

function createEmptyStream<T>(): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      return;
    },
  };
}

function createTradeEventStreamFromCursor(
  source: AsyncIterable<Trade> & { currentCursor?: () => unknown },
): AsyncIterable<TradeEvent> & { currentCursor: () => CoreReaderCursor } {
  if (typeof source.currentCursor !== 'function') {
    throw new Error('trade cursor source must expose currentCursor');
  }
  const getCursor = source.currentCursor.bind(source);
  return {
    currentCursor(): CoreReaderCursor {
      return normalizeCursorValue(getCursor());
    },
    async *[Symbol.asyncIterator](): AsyncIterator<TradeEvent> {
      let currentKey: string | undefined;
      let seq = 0;
      for await (const payload of source) {
        const cursor = normalizeCursorValue(getCursor());
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
  } satisfies AsyncIterable<TradeEvent> & {
    currentCursor: () => CoreReaderCursor;
  };
}

function createDepthEventStreamFromCursor(
  source: AsyncIterable<DepthDiff> & { currentCursor?: () => unknown },
): AsyncIterable<DepthEvent> & { currentCursor: () => CoreReaderCursor } {
  if (typeof source.currentCursor !== 'function') {
    throw new Error('depth cursor source must expose currentCursor');
  }
  const getCursor = source.currentCursor.bind(source);
  return {
    currentCursor(): CoreReaderCursor {
      return normalizeCursorValue(getCursor());
    },
    async *[Symbol.asyncIterator](): AsyncIterator<DepthEvent> {
      let currentKey: string | undefined;
      let seq = 0;
      for await (const payload of source) {
        const cursor = normalizeCursorValue(getCursor());
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
  } satisfies AsyncIterable<DepthEvent> & {
    currentCursor: () => CoreReaderCursor;
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

const ZIP_SUFFIX = '.zip';
const GZ_SUFFIX = '.gz';

export function normalizeFixtureBasename(value: string): string {
  const lower = value.toLowerCase();
  if (lower.endsWith(ZIP_SUFFIX)) return value.slice(0, -ZIP_SUFFIX.length);
  if (lower.endsWith(GZ_SUFFIX)) return value.slice(0, -GZ_SUFFIX.length);
  return value;
}

export async function simulate(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const wantsHelp = parseBool(args['help'], false);
  if (wantsHelp) {
    const helpText = [
      'TradeForge simulator — командный запуск симуляции.',
      '',
      'Usage:',
      '  tf simulate --trades <path>[,<path>...] [options]',
      '',
      'Data sources:',
      '  --trades <files>           Список файлов со сделками. Поддерживаются JSON/CSV/JSONL.',
      '  --depth <files>            Необязательные файлы со стаканом (для тай-брейка).',
      '  --symbol <symbol>          Торговый инструмент (по умолчанию BTCUSDT).',
      '  --format-trades <fmt>      Явный формат: auto|csv|json|jsonl.',
      '  --format-depth <fmt>       Явный формат для стакана.',
      '  --from / --to <ts>         Ограничение диапазона (Unix ms или ISO-строка).',
      '  --limit <n>                Ограничить число распечатанных отчётов при --ndjson.',
      '',
      'Execution control:',
      '  --clock <logical|wall|accel>  Режим часов. accel использует --speed (>=1).',
      '  --speed <factor>              Множитель ускоренных часов (по умолчанию 10).',
      '  --max-events <n>              Остановить после N событий.',
      '  --max-sim-ms <ms>             Ограничение по виртуальному времени.',
      '  --max-wall-ms <ms>            Ограничение по wall-clock времени.',
      '  --pause-on-start              Запустить в паузе, возобновление по Enter.',
      '  --prefer-depth-on-equal-ts    Выбрать источник для тай-брейка (по умолчанию DEPTH).',
      '  --treat-limit-as-maker        Консервативный режим: считать лимитные заявки мейкером.',
      '  --strict-conservative         Полностью отключить агрессивное исполнение.',
      '  --use-aggressor-liquidity     Разрешить использовать ликвидность агрессора.',
      '',
      'Output:',
      '  --ndjson                      Печатать execution reports построчно (NDJSON).',
      '  --summary / --no-summary      Управлять финальным агрегированным отчётом.',
      '',
      'Checkpoints:',
      '  --checkpoint-save <file>      Путь для автосохранения Checkpoint v1 во время реплея.',
      '  --cp-interval-events <n>      Интервал автосейва по событиям (0 = выкл).',
      '  --cp-interval-wall-ms <ms>    Интервал автосейва по wall-времени в миллисекундах (0 = выкл).',
      '  --checkpoint-load <file>      Загрузить Checkpoint v1 и продолжить реплей (нужны те же входные файлы).',
      '',
      'Examples:',
      '  tf simulate --trades trades.jsonl --depth depth.jsonl',
      '  tf simulate --trades trades.jsonl --checkpoint-save state.json --cp-interval-events 10000',
      '  tf simulate --checkpoint-load state.json --trades trades.jsonl --depth depth.jsonl',
    ].join('\n');
    console.log(helpText);
    return;
  }
  const checkpointLoadRaw = args['checkpoint-load'];
  const checkpointLoadPath =
    checkpointLoadRaw && checkpointLoadRaw.trim()
      ? resolve(process.cwd(), checkpointLoadRaw)
      : undefined;
  let checkpoint: CheckpointV1 | undefined;
  if (checkpointLoadPath) {
    try {
      checkpoint = await loadCheckpoint(checkpointLoadPath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `failed to load checkpoint from ${checkpointLoadPath}: ${reason}`,
      );
      process.exitCode = 1;
      return;
    }
  }
  if (checkpoint && checkpoint.version !== 1) {
    const version = checkpoint.version;
    const source = checkpointLoadPath ? ` from ${checkpointLoadPath}` : '';
    console.error(
      `unsupported checkpoint version${source}; expected version 1 but received ${version}`,
    );
    process.exitCode = 1;
    return;
  }
  const tradeFiles = resolveInputList(args['trades']);
  const depthFiles = resolveInputList(args['depth']);
  let symbol = (args['symbol'] ?? 'BTCUSDT') as SymbolId;
  if (checkpoint && checkpoint.meta?.symbol) {
    if (
      symbol !== checkpoint.meta.symbol &&
      args['symbol'] &&
      args['symbol'] !== (checkpoint.meta.symbol as unknown as string)
    ) {
      console.warn(
        `symbol argument ${symbol as unknown as string} overridden by checkpoint symbol ${
          checkpoint.meta.symbol as unknown as string
        }`,
      );
    }
    symbol = checkpoint.meta.symbol;
  }
  if (!checkpoint && tradeFiles.length === 0) {
    console.error(
      'usage: tf simulate --trades <files> [--depth <files>] [--symbol BTCUSDT] [--checkpoint-save <file>] [--checkpoint-load <file>] [--pause-on-start]',
    );
    process.exitCode = 1;
    return;
  }
  if (checkpoint) {
    if (tradeFiles.length === 0 && checkpoint.cursors.trades) {
      console.error(
        'checkpoint includes a trades cursor but no --trades files were provided; please supply the original trade inputs',
      );
      process.exitCode = 1;
      return;
    }
    if (depthFiles.length === 0 && checkpoint.cursors.depth) {
      console.error(
        'checkpoint includes a depth cursor but no --depth files were provided; please supply the original depth inputs',
      );
      process.exitCode = 1;
      return;
    }
  }
  if (checkpoint && checkpointLoadPath) {
    const nextSource = checkpoint.merge?.nextSourceOnEqualTs ?? 'auto';
    const tradeCursorBase = checkpoint.cursors.trades
      ? basename(checkpoint.cursors.trades.file)
      : 'none';
    const depthCursorBase = checkpoint.cursors.depth
      ? basename(checkpoint.cursors.depth.file)
      : 'none';
    const summaryParts = [
      `version=${checkpoint.version}`,
      `createdAt=${new Date(checkpoint.createdAtMs).toISOString()}`,
      `symbol=${checkpoint.meta.symbol}`,
      `tradesCursor=${tradeCursorBase}`,
      `depthCursor=${depthCursorBase}`,
      `nextSourceOnEqualTs=${nextSource}`,
    ];
    if (checkpoint.meta?.note) {
      summaryParts.push(`note=${checkpoint.meta.note}`);
    }
    const summary = summaryParts.join(', ');
    console.log(`loaded checkpoint from ${checkpointLoadPath} (${summary})`);
  }
  if (checkpoint) {
    const tradeCursorFile = checkpoint.cursors.trades?.file;
    if (tradeCursorFile && tradeFiles.length > 0) {
      const expected = basename(tradeCursorFile);
      const expectedNormalized = normalizeFixtureBasename(expected);
      const tradeBasenamesSet = new Set<string>();
      for (const file of tradeFiles) {
        const base = basename(file);
        tradeBasenamesSet.add(base);
        const normalized = normalizeFixtureBasename(base);
        tradeBasenamesSet.add(normalized);
      }
      const tradeBasenames = Array.from(tradeBasenamesSet);
      if (
        !tradeBasenamesSet.has(expected) &&
        !tradeBasenamesSet.has(expectedNormalized)
      ) {
        console.warn(
          `checkpoint trades cursor references ${expected} but provided --trades inputs are ${
            tradeBasenames.join(', ') || 'none'
          }; simulation may not resume correctly`,
        );
      }
    }
    const depthCursorFile = checkpoint.cursors.depth?.file;
    if (depthCursorFile && depthFiles.length > 0) {
      const expected = basename(depthCursorFile);
      const expectedNormalized = normalizeFixtureBasename(expected);
      const depthBasenamesSet = new Set<string>();
      for (const file of depthFiles) {
        const base = basename(file);
        depthBasenamesSet.add(base);
        const normalized = normalizeFixtureBasename(base);
        depthBasenamesSet.add(normalized);
      }
      const depthBasenames = Array.from(depthBasenamesSet);
      if (
        !depthBasenamesSet.has(expected) &&
        !depthBasenamesSet.has(expectedNormalized)
      ) {
        console.warn(
          `checkpoint depth cursor references ${expected} but provided --depth inputs are ${
            depthBasenames.join(', ') || 'none'
          }; simulation may not resume correctly`,
        );
      }
    }
  }
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
  const pauseOnStart = parseBool(args['pause-on-start'], false);
  const checkpointPathArg = args['checkpoint-save'];
  const cpIntervalEventsArg = parseNumberArg(args['cp-interval-events']);
  const cpIntervalWallArg = parseNumberArg(args['cp-interval-wall-ms']);
  const cpIntervalEvents =
    cpIntervalEventsArg !== undefined && cpIntervalEventsArg > 0
      ? Math.max(1, Math.floor(cpIntervalEventsArg))
      : undefined;
  const cpIntervalWallMs =
    cpIntervalWallArg !== undefined && cpIntervalWallArg > 0
      ? cpIntervalWallArg
      : undefined;
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

  let tradeReader: AsyncIterable<TradeEvent>;
  let depthReader: AsyncIterable<DepthEvent>;
  let state: ExchangeState;
  let accounts: AccountsService;
  let placed: Order[] = [];
  let priceScale: number;
  let qtyScale: number;
  const mergeStart: MergeStartState = {};

  if (checkpoint) {
    if (tradeFiles.length === 0 && !checkpoint.cursors.trades) {
      tradeReader = createEmptyStream<TradeEvent>();
    } else {
      const tradeCursor = createJsonlCursorReader({
        kind: 'trades',
        files: tradeFiles,
        symbol,
        ...(Object.keys(timeFilter).length ? { timeFilter } : {}),
        ...(checkpoint.cursors.trades
          ? { startCursor: checkpoint.cursors.trades }
          : {}),
      });
      tradeReader = createTradeEventStreamFromCursor(tradeCursor);
    }
    if (depthFiles.length === 0) {
      depthReader = createEmptyStream<DepthEvent>();
    } else {
      const depthCursor = createJsonlCursorReader({
        kind: 'depth',
        files: depthFiles,
        symbol,
        ...(Object.keys(timeFilter).length ? { timeFilter } : {}),
        ...(checkpoint.cursors.depth
          ? { startCursor: checkpoint.cursors.depth }
          : {}),
      });
      depthReader = createDepthEventStreamFromCursor(depthCursor);
    }
    const restoredState = deserializeExchangeState(checkpoint.state);
    try {
      restoreEngineFromSnapshot(checkpoint.engine, restoredState);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`failed to restore engine from checkpoint: ${reason}`);
      process.exitCode = 1;
      return;
    }
    state = restoredState;
    accounts = new AccountsService(state);
    const symbolConfig = state.getSymbolConfig(symbol);
    if (!symbolConfig) {
      console.error(
        `checkpoint state does not contain symbol configuration for ${
          symbol as unknown as string
        }`,
      );
      process.exitCode = 1;
      return;
    }
    priceScale = symbolConfig.priceScale;
    qtyScale = symbolConfig.qtyScale;
    mergeStart.nextSourceOnEqualTs = checkpoint.merge?.nextSourceOnEqualTs
      ? checkpoint.merge.nextSourceOnEqualTs
      : preferDepth
        ? 'DEPTH'
        : 'TRADES';
  } else {
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
    tradeReader = createReader(tradeOpts as any) as AsyncIterable<TradeEvent>;

    let depthSource: AsyncIterable<DepthEvent> =
      createEmptyStream<DepthEvent>();
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
      depthSource = createReader(depthOpts as any) as AsyncIterable<DepthEvent>;
    }
    depthReader = depthSource;

    const setup = setupState(symbol);
    state = setup.state;
    accounts = setup.accounts;
    placed = setup.placed;
    priceScale = setup.priceScale;
    qtyScale = setup.qtyScale;
    mergeStart.nextSourceOnEqualTs = preferDepth ? 'DEPTH' : 'TRADES';
  }

  const merged = createMergedStream(tradeReader, depthReader, mergeStart, {
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
          const entry = toExecutionReportLog(report);
          if (!validateLogV1(entry)) {
            warnValidation('execution report', validateLogV1.errors);
          }
          console.log(stringify(entry));
          printed += 1;
        }
      }
    }
  })();

  const checkpointSavePath =
    checkpointPathArg && checkpointPathArg.trim()
      ? resolve(process.cwd(), checkpointPathArg)
      : undefined;

  let lastProgressEvents = -1;
  let pendingCheckpointLogEvents: number | null = null;
  const handleProgress = (progress: ReplayProgress) => {
    if (checkpointSavePath && pendingCheckpointLogEvents !== null) {
      if (progress.eventsOut === pendingCheckpointLogEvents) {
        console.log(`checkpoint saved to ${checkpointSavePath}`);
        pendingCheckpointLogEvents = null;
      } else if (progress.eventsOut > pendingCheckpointLogEvents) {
        pendingCheckpointLogEvents = null;
      }
    }
    lastProgressEvents = progress.eventsOut;
  };

  const autoCheckpoint = checkpointSavePath
    ? {
        savePath: checkpointSavePath,
        ...(cpIntervalEvents ? { cpIntervalEvents } : {}),
        ...(cpIntervalWallMs ? { cpIntervalWallMs } : {}),
        buildCheckpoint: async () => {
          const cursors: {
            trades?: CoreReaderCursor;
            depth?: CoreReaderCursor;
          } = {};
          const tradesCursor = getCursorFromSource(
            tradeReader as unknown as DebugCursorSource,
          );
          if (tradesCursor) {
            cursors.trades = tradesCursor;
          }
          const depthCursor = getCursorFromSource(
            depthReader as unknown as DebugCursorSource,
          );
          if (depthCursor) {
            cursors.depth = depthCursor;
          }
          const mergeForCheckpoint: MergeStartState = {};
          if (mergeStart.nextSourceOnEqualTs) {
            mergeForCheckpoint.nextSourceOnEqualTs =
              mergeStart.nextSourceOnEqualTs;
          }
          pendingCheckpointLogEvents = Math.max(lastProgressEvents, 0);
          return makeCheckpointV1({
            symbol,
            state,
            cursors,
            merge: mergeForCheckpoint,
          });
        },
      }
    : undefined;

  const controller = pauseOnStart ? createReplayController() : undefined;
  let cleanupStdin: (() => void) | undefined;
  if (controller && pauseOnStart) {
    controller.pause();
    console.log('Press Enter to resume…');
    const stdin = process.stdin;
    if (typeof stdin.setEncoding === 'function') {
      stdin.setEncoding('utf8');
    }
    const setRawMode =
      typeof stdin.setRawMode === 'function'
        ? stdin.setRawMode.bind(stdin)
        : undefined;
    let cleaned = false;
    let cleanup = () => {
      /* noop */
    };
    const onResume = () => {
      controller.resume();
      cleanup();
      cleanupStdin = undefined;
    };
    cleanup = () => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      setRawMode?.(false);
      stdin.pause();
      if (typeof stdin.off === 'function') {
        stdin.off('data', onResume);
      } else {
        stdin.removeListener('data', onResume);
      }
    };
    cleanupStdin = () => {
      cleanup();
      cleanupStdin = undefined;
    };
    setRawMode?.(true);
    stdin.once('data', onResume);
    stdin.resume();
  }

  let replayStats: ReplayProgress | undefined;
  let replayError: unknown;
  try {
    replayStats = await runReplay({
      timeline: merged,
      clock,
      ...(replayLimits ? { limits: replayLimits } : {}),
      ...(controller ? { controller } : {}),
      onEvent: (event) => {
        eventQueue.push(event);
      },
      onProgress: handleProgress,
      ...(autoCheckpoint ? { autoCp: autoCheckpoint } : {}),
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

  if (cleanupStdin) {
    cleanupStdin();
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
