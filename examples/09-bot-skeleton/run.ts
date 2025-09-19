import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  createAcceleratedClock,
  createLogicalClock,
  createWallClock,
  executeTimeline,
  fromPriceInt,
  fromQtyInt,
  runReplay,
  toPriceInt,
  toQtyInt,
  type Balances,
  type MergedEvent,
  type OrderId,
  type PriceInt,
  type QtyInt,
  type ReplayLimits,
  type ReplayProgress,
  type SimClock,
  type SymbolId,
} from '@tradeforge/core';
import {
  ajv as validationAjv,
  validateLogV1,
  type LogEntryV1,
} from '@tradeforge/validation';

import { createAccountWithDeposit } from '../_shared/accounts.js';
import { buildMerged } from '../_shared/merge.js';
import { buildDepthReader, buildTradesReader } from '../_shared/readers.js';
import { createBookState, updateBook } from './lib/book.js';
import { createMetrics } from './lib/metrics.js';
import {
  reconcile,
  type ExistingOrderView,
  type OrderIntent,
} from './lib/intent.js';
import { makeXorShift32 } from './lib/rng.js';
import {
  capQtyByBalance,
  canPlace,
  type RiskContext,
} from './strategy/risk.js';
import {
  resolveSignal,
  updateEma,
  type CrossSignal,
  type EmaTracker,
} from './strategy/ema.js';

const DEFAULT_SYMBOL = 'BTCUSDT';
const DEFAULT_TRADES = ['examples/_smoke/mini-trades.jsonl'];
const DEFAULT_DEPTH = ['examples/_smoke/mini-depth.jsonl'];
const DEFAULT_QTY = '0.001';
const DEFAULT_SPREAD_BPS = 5;
const DEFAULT_EMA_FAST = 12;
const DEFAULT_EMA_SLOW = 26;
const DEFAULT_SEED = 42;
const DEFAULT_MIN_ACTION_INTERVAL_MS = 200;

const SYMBOL_CONFIG = {
  base: 'BTC',
  quote: 'USDT',
  priceScale: 5,
  qtyScale: 6,
};

const FEE_CONFIG = {
  makerBps: 5,
  takerBps: 7,
};

interface NdjsonLogger {
  write(entry: unknown): void;
  close(): Promise<void>;
  readonly path: string;
}

type ValidationErrors = Parameters<typeof validationAjv.errorsText>[0];

function warnSchema(kind: string, errors: ValidationErrors): void {
  if (!errors || errors.length === 0) {
    return;
  }
  const message = validationAjv.errorsText(errors, { separator: '; ' });
  console.warn(`[bot ndjson] ${kind} validation failed: ${message}`);
}

function writeLogEntry(logger: NdjsonLogger, entry: LogEntryV1): void {
  if (!validateLogV1(entry)) {
    warnSchema('log', validateLogV1.errors);
  }
  logger.write(entry);
}

interface BotConfig {
  symbol: SymbolId;
  tradesFiles: string[];
  depthFiles: string[];
  qty: string;
  spreadBps: number;
  emaFast: number;
  emaSlow: number;
  seed: number;
  clock: 'logical' | 'accelerated' | 'wall';
  speed?: number;
  limits: ReplayLimits;
  verbose: boolean;
  ndjsonPath?: string;
  minActionGapMs: number;
  replaceAsCancelPlace: boolean;
  keepNdjson: boolean;
}

interface AsyncEventQueue<T> {
  iterable: AsyncIterable<T>;
  push(value: T): void;
  close(): void;
}

function createAsyncEventQueue<T>(): AsyncEventQueue<T> {
  const values: T[] = [];
  const waiters: Array<(value: IteratorResult<T>) => void> = [];
  let closed = false;

  const iterator: AsyncIterable<T> = {
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
          return new Promise<IteratorResult<T>>((resolve) => {
            waiters.push(resolve);
          });
        },
        return(): Promise<IteratorResult<T>> {
          closed = true;
          values.length = 0;
          while (waiters.length > 0) {
            const resolve = waiters.shift();
            resolve?.({ value: undefined as unknown as T, done: true });
          }
          return Promise.resolve({
            value: undefined as unknown as T,
            done: true,
          });
        },
      } satisfies AsyncIterator<T>;
    },
  };

  return {
    iterable: iterator,
    push(value: T) {
      if (closed) {
        return;
      }
      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value, done: false });
        return;
      }
      values.push(value);
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter?.({ value: undefined as unknown as T, done: true });
      }
    },
  } satisfies AsyncEventQueue<T>;
}

function parseEnvString(key: string): string | undefined {
  const raw = process.env[key];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseEnvInt(key: string, fallback: number): number {
  const raw = parseEnvString(key);
  if (!raw) {
    return fallback;
  }
  const num = Number.parseInt(raw, 10);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return num;
}

function parseEnvBool(key: string): boolean {
  return parseEnvString(key) === '1';
}

function parseClock(value?: string): BotConfig['clock'] {
  if (!value) {
    return 'logical';
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'wall') {
    return 'wall';
  }
  if (normalized === 'accelerated') {
    return 'accelerated';
  }
  return 'logical';
}

function parseFileList(key: string, fallback: string[]): string[] {
  const raw = parseEnvString(key);
  if (!raw) {
    return fallback;
  }
  const parts = raw
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : fallback;
}

async function createNdjsonLogger(path: string): Promise<NdjsonLogger> {
  const resolved = resolve(path);
  const dir = dirname(resolved);
  await mkdir(dir, { recursive: true });
  const stream = createWriteStream(resolved, { encoding: 'utf8' });
  let closed = false;
  return {
    write(entry: unknown) {
      if (closed) {
        return;
      }
      stream.write(`${JSON.stringify(entry)}\n`);
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      stream.end();
      await once(stream, 'close');
    },
    get path() {
      return resolved;
    },
  } satisfies NdjsonLogger;
}

async function cleanupNdjson(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code && code !== 'ENOENT') {
      throw err;
    }
  }
  const dir = dirname(path);
  if (!dir || dir === '.' || dir === '/' || dir === path) {
    return;
  }
  try {
    const entries = await readdir(dir);
    if (entries.length === 0) {
      await rm(dir, { recursive: false });
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (
      code &&
      code !== 'ENOENT' &&
      code !== 'ENOTEMPTY' &&
      code !== 'EEXIST'
    ) {
      throw err;
    }
  }
}

function buildLimits(): ReplayLimits {
  const maxEventsRaw = parseEnvString('TF_MAX_EVENTS');
  const maxSimRaw = parseEnvString('TF_MAX_SIM_MS');
  const maxWallRaw = parseEnvString('TF_MAX_WALL_MS');
  const limits: ReplayLimits = {};
  if (maxEventsRaw) {
    const value = Number(maxEventsRaw);
    if (Number.isFinite(value) && value > 0) {
      limits.maxEvents = Math.floor(value);
    }
  }
  if (maxSimRaw) {
    const value = Number(maxSimRaw);
    if (Number.isFinite(value) && value > 0) {
      limits.maxSimTimeMs = value;
    }
  }
  if (maxWallRaw) {
    const value = Number(maxWallRaw);
    if (Number.isFinite(value) && value > 0) {
      limits.maxWallTimeMs = value;
    }
  }
  return limits;
}

function loadConfig(): BotConfig {
  const symbolRaw = parseEnvString('TF_SYMBOL') ?? DEFAULT_SYMBOL;
  const symbol = symbolRaw as SymbolId;
  const tradesFiles = parseFileList('TF_TRADES_FILES', DEFAULT_TRADES);
  const depthFiles = parseFileList('TF_DEPTH_FILES', DEFAULT_DEPTH);
  const qty = parseEnvString('TF_QTY') ?? DEFAULT_QTY;
  const spreadBps = Math.max(
    0,
    parseEnvInt('TF_SPREAD_BPS', DEFAULT_SPREAD_BPS),
  );
  const emaFast = Math.max(1, parseEnvInt('TF_EMA_FAST', DEFAULT_EMA_FAST));
  const emaSlow = Math.max(1, parseEnvInt('TF_EMA_SLOW', DEFAULT_EMA_SLOW));
  const seed = parseEnvInt('TF_SEED', DEFAULT_SEED);
  const clock = parseClock(parseEnvString('TF_CLOCK'));
  const speedRaw = parseEnvString('TF_SPEED');
  const limits = buildLimits();
  const verbose = parseEnvBool('TF_VERBOSE');
  const ndjsonPath = parseEnvString('TF_NDJSON_PATH');
  const minActionGapMs = Math.max(
    0,
    parseEnvInt('TF_MIN_ACTION_MS', DEFAULT_MIN_ACTION_INTERVAL_MS),
  );
  const replaceAsCancelPlace = parseEnvBool('TF_REPLACE_AS_CANCEL_PLACE');
  const keepNdjson = parseEnvBool('TF_KEEP_NDJSON');
  const base: BotConfig = {
    symbol,
    tradesFiles,
    depthFiles,
    qty,
    spreadBps,
    emaFast,
    emaSlow,
    seed,
    clock,
    limits,
    verbose,
    minActionGapMs,
    replaceAsCancelPlace,
    keepNdjson,
  };
  const speedValue = speedRaw ? Number(speedRaw) : undefined;
  if (
    Number.isFinite(speedValue) &&
    speedValue !== undefined &&
    speedValue > 0
  ) {
    base.speed = speedValue;
  }
  if (ndjsonPath) {
    base.ndjsonPath = ndjsonPath;
  }
  return base;
}

function buildClock(
  clockKind: BotConfig['clock'],
  speed?: number,
): {
  clock: SimClock;
  desc: string;
} {
  if (clockKind === 'wall') {
    const clock = createWallClock();
    return { clock, desc: clock.desc() };
  }
  if (clockKind === 'accelerated') {
    const effectiveSpeed = speed && speed > 0 ? speed : undefined;
    const clock = createAcceleratedClock(effectiveSpeed ?? 10);
    return { clock, desc: clock.desc() };
  }
  const clock = createLogicalClock();
  return { clock, desc: clock.desc() };
}

function formatPrice(value: PriceInt): string {
  return fromPriceInt(value, SYMBOL_CONFIG.priceScale);
}

function formatQty(value: QtyInt): string {
  return fromQtyInt(value, SYMBOL_CONFIG.qtyScale);
}

function applySpread(
  mid: PriceInt,
  spreadBps: number,
  side: 'BUY' | 'SELL',
): PriceInt {
  const base = 10000n;
  const spread = BigInt(Math.max(0, spreadBps));
  const midRaw = mid as unknown as bigint;
  const effective =
    side === 'BUY' ? base - (spread > base ? base : spread) : base + spread;
  const adjusted = (midRaw * effective) / base;
  const safe = adjusted <= 0n ? 1n : adjusted;
  return safe as unknown as PriceInt;
}

function buildExistingOrder(
  order:
    | {
        id: unknown;
        side: 'BUY' | 'SELL';
        price?: PriceInt;
        qty: QtyInt;
      }
    | undefined,
): ExistingOrderView | undefined {
  if (!order || order.price === undefined) {
    return undefined;
  }
  return {
    id: String(order.id ?? ''),
    side: order.side,
    price: formatPrice(order.price),
    qty: formatQty(order.qty),
  } satisfies ExistingOrderView;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const prng = makeXorShift32(config.seed);
  const sessionId = Math.floor(prng() * 1e9)
    .toString(16)
    .padStart(8, '0');

  const tradeReader = buildTradesReader(config.tradesFiles);
  const depthReader = buildDepthReader(config.depthFiles);
  const timeline = buildMerged(tradeReader, depthReader);

  const exchange = new ExchangeState({
    symbols: { [config.symbol as unknown as string]: SYMBOL_CONFIG },
    fee: FEE_CONFIG,
    orderbook: new StaticMockOrderbook({ best: {} }),
  });
  const accounts = new AccountsService(exchange);
  const orders = new OrdersService(exchange, accounts);

  const quoteDeposit = toPriceInt('1000', SYMBOL_CONFIG.priceScale);
  const quoteDepositRaw = quoteDeposit as unknown as bigint;
  const { account } = await createAccountWithDeposit(
    {
      accounts,
      symbol: {
        id: config.symbol,
        base: SYMBOL_CONFIG.base,
        quote: SYMBOL_CONFIG.quote,
      },
    },
    { quote: quoteDepositRaw.toString(10) },
  );

  const metrics = createMetrics();
  const book = createBookState();
  const emaFast: EmaTracker = { window: config.emaFast };
  const emaSlow: EmaTracker = { window: config.emaSlow };
  let lastSignal: CrossSignal = 'FLAT';
  let lastActionSimTs: number | undefined;
  let waitingForMarketLogged = false;

  const queue = createAsyncEventQueue<MergedEvent>();
  let ndjsonLogger: NdjsonLogger | undefined;

  const executionTask = (async () => {
    for await (const report of executeTimeline(queue.iterable, exchange)) {
      if (report.kind === 'FILL') {
        metrics.onFill(report);
        if (config.verbose && report.fill) {
          const priceStr = formatPrice(report.fill.price);
          const qtyStr = formatQty(report.fill.qty);
          console.log(
            '[bot] fill',
            JSON.stringify({
              orderId: report.orderId ? String(report.orderId) : undefined,
              side: report.fill.side,
              price: priceStr,
              qty: qtyStr,
              liquidity: report.fill.liquidity,
            }),
          );
        }
        if (report.fill && ndjsonLogger) {
          writeLogEntry(ndjsonLogger, {
            ts: Number(report.ts ?? 0),
            kind: 'fill',
            session: sessionId,
            orderId: report.orderId ? String(report.orderId) : undefined,
            fill: {
              side: report.fill.side,
              price: formatPrice(report.fill.price),
              qty: formatQty(report.fill.qty),
              liquidity: report.fill.liquidity,
              tradeRef: report.fill.tradeRef,
            },
          });
        }
      }
    }
  })();

  try {
    if (config.ndjsonPath) {
      ndjsonLogger = await createNdjsonLogger(config.ndjsonPath);
    }

    const desiredQty = toQtyInt(config.qty, SYMBOL_CONFIG.qtyScale);
    const limits = config.limits;
    const { clock } = buildClock(config.clock, config.speed);

    const snapshotRiskContext = (): RiskContext => ({
      balances: {
        base: accounts.getBalance(account.id, SYMBOL_CONFIG.base),
        quote: accounts.getBalance(account.id, SYMBOL_CONFIG.quote),
      },
      qtyScale: SYMBOL_CONFIG.qtyScale,
      makerFeeBps: FEE_CONFIG.makerBps,
    });

    const convertIntent = (
      intent: OrderIntent,
    ): {
      priceInt: PriceInt;
      qtyInt: QtyInt;
    } => ({
      priceInt: toPriceInt(intent.price, SYMBOL_CONFIG.priceScale),
      qtyInt: toQtyInt(intent.qty, SYMBOL_CONFIG.qtyScale),
    });

    let replayError: unknown;
    let progress: ReplayProgress | undefined;

    try {
      progress = await runReplay({
        timeline,
        clock,
        limits: {
          ...limits,
        },
        onEvent: async (event: MergedEvent) => {
          queue.push(event);
          updateBook(book, event);

          if (!book.marketReady) {
            if (!waitingForMarketLogged) {
              console.log('[bot] waiting for market data');
              waitingForMarketLogged = true;
            }
            return;
          }

          const mid = book.mid ?? book.lastTrade;
          if (!mid) {
            return;
          }

          const fast = updateEma(emaFast, mid);
          const slow = updateEma(emaSlow, mid);
          const signal = resolveSignal(fast, slow);
          if (signal !== lastSignal && config.verbose) {
            console.log(
              '[bot] signal-change',
              JSON.stringify({
                ts: Number(event.ts),
                previous: lastSignal,
                next: signal,
              }),
            );
          }
          lastSignal = signal;

          const midStr = formatPrice(mid);

          const openOrders = orders.listOpenOrders(account.id, config.symbol);
          const existing = buildExistingOrder(openOrders[0]);

          const riskContext: RiskContext = snapshotRiskContext();

          let desired: OrderIntent | undefined;
          if (signal !== 'FLAT') {
            const price = applySpread(mid, config.spreadBps, signal);
            const cappedQty = capQtyByBalance(
              desiredQty,
              price,
              signal,
              riskContext,
            );
            if (canPlace(signal, riskContext, cappedQty, price)) {
              desired = {
                side: signal,
                price: formatPrice(price),
                qty: formatQty(cappedQty),
              };
            }
          }

          const now = Number(event.ts);
          const reconcileInput: Parameters<typeof reconcile>[0] = {
            now,
            minActionGapMs: config.minActionGapMs,
            replaceAsCancelPlace: config.replaceAsCancelPlace,
            verbose: config.verbose,
            ...(lastActionSimTs !== undefined ? { lastActionSimTs } : {}),
            ...(desired ? { want: desired } : {}),
            ...(existing ? { existing } : {}),
          };
          const { actions, nextActionTs } = reconcile(reconcileInput);

          if (config.verbose) {
            console.log(
              '[bot] decision',
              JSON.stringify({
                ts: now,
                mid: midStr,
                signal,
                desired,
                existing,
                actions: actions.map((action) => action.kind),
              }),
            );
          }

          if (actions.length === 0) {
            return;
          }

          let performedAction = false;

          for (const action of actions) {
            if (action.kind === 'cancel') {
              orders.cancelOrder(action.orderId as unknown as OrderId);
              metrics.onCancel();
              performedAction = true;
              if (ndjsonLogger) {
                writeLogEntry(ndjsonLogger, {
                  ts: now,
                  kind: 'action',
                  session: sessionId,
                  action: { type: 'cancel', orderId: action.orderId },
                });
              }
              continue;
            }

            const { priceInt, qtyInt } = convertIntent(action.intent);
            const logBlocked = (stage: 'place' | 'replace') => {
              const reason =
                action.intent.side === 'BUY'
                  ? 'insufficient-quote'
                  : 'insufficient-base';
              console.warn(
                '[bot] risk-blocked',
                JSON.stringify({
                  ts: now,
                  stage,
                  reason,
                  side: action.intent.side,
                  price: action.intent.price,
                  qty: action.intent.qty,
                }),
              );
            };

            if (action.kind === 'replace') {
              orders.cancelOrder(action.orderId as unknown as OrderId);
              metrics.onCancel();
              performedAction = true;
              if (ndjsonLogger) {
                writeLogEntry(ndjsonLogger, {
                  ts: now,
                  kind: 'action',
                  session: sessionId,
                  action: {
                    type: 'cancel',
                    orderId: action.orderId,
                    reason: 'replace',
                  },
                });
              }
              const postCancelContext = snapshotRiskContext();
              if (
                !canPlace(
                  action.intent.side,
                  postCancelContext,
                  qtyInt,
                  priceInt,
                )
              ) {
                logBlocked('replace');
                continue;
              }
              const placed = orders.placeOrder({
                accountId: account.id,
                symbol: config.symbol,
                type: 'LIMIT',
                side: action.intent.side,
                price: priceInt,
                qty: qtyInt,
              });
              metrics.onPlace();
              performedAction = true;
              if (ndjsonLogger) {
                writeLogEntry(ndjsonLogger, {
                  ts: now,
                  kind: 'action',
                  session: sessionId,
                  action: {
                    type: 'place',
                    mode: 'replace',
                    orderId: String(placed.id),
                    side: placed.side,
                    price: action.intent.price,
                    qty: action.intent.qty,
                  },
                });
              }
              continue;
            }

            if (action.kind === 'place') {
              const context = snapshotRiskContext();
              if (!canPlace(action.intent.side, context, qtyInt, priceInt)) {
                logBlocked('place');
                continue;
              }
              const placed = orders.placeOrder({
                accountId: account.id,
                symbol: config.symbol,
                type: 'LIMIT',
                side: action.intent.side,
                price: priceInt,
                qty: qtyInt,
              });
              metrics.onPlace();
              performedAction = true;
              if (ndjsonLogger) {
                writeLogEntry(ndjsonLogger, {
                  ts: now,
                  kind: 'action',
                  session: sessionId,
                  action: {
                    type: 'place',
                    orderId: String(placed.id),
                    side: placed.side,
                    price: action.intent.price,
                    qty: action.intent.qty,
                  },
                });
              }
            }
          }

          if (performedAction) {
            const effectiveTs = nextActionTs ?? now;
            lastActionSimTs = effectiveTs;
          }
        },
      });
    } catch (err) {
      replayError = err;
    } finally {
      queue.close();
    }

    try {
      await executionTask;
    } catch (err) {
      if (!replayError) {
        replayError = err;
      }
    }

    if (replayError) {
      throw replayError;
    }

    const balances = accounts.getBalancesSnapshot(account.id);
    const lastPrice = book.lastTrade ?? book.mid;
    const finalizeParams: Parameters<typeof metrics.finalize>[0] = {
      balances: balances as Record<string, Balances>,
      baseCurrency: SYMBOL_CONFIG.base,
      quoteCurrency: SYMBOL_CONFIG.quote,
      priceScale: SYMBOL_CONFIG.priceScale,
      qtyScale: SYMBOL_CONFIG.qtyScale,
      initialQuote: quoteDepositRaw,
      ...(lastPrice !== undefined ? { lastPrice } : {}),
    };
    const summary = metrics.finalize(finalizeParams);

    if (ndjsonLogger) {
      writeLogEntry(ndjsonLogger, {
        ts: Date.now(),
        kind: 'summary',
        session: sessionId,
        summary,
      });
    }

    const payload = JSON.stringify(summary);
    console.log(`BOT_OK ${payload}`);

    if (config.verbose && progress) {
      const wallMs = Math.max(0, progress.wallLastMs - progress.wallStartMs);
      const simMs =
        progress.simStartTs !== undefined && progress.simLastTs !== undefined
          ? Math.max(
              0,
              Number(progress.simLastTs) - Number(progress.simStartTs),
            )
          : 0;
      console.log(
        '[bot] replay',
        JSON.stringify({ events: progress.eventsOut, wallMs, simMs }),
      );
    }
  } finally {
    if (ndjsonLogger) {
      await ndjsonLogger.close();
      if (config.ndjsonPath && !config.keepNdjson) {
        await cleanupNdjson(ndjsonLogger.path);
      }
    }
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('BOT_FAILED', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
