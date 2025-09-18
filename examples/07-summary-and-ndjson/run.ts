import { once } from 'node:events';
import { createWriteStream, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  executeTimeline,
  fromPriceInt,
  fromQtyInt,
  toPriceInt,
  toQtyInt,
  type MergedEvent,
  type Order,
  type ReplayProgress,
  type PriceInt,
  type QtyInt,
  type SymbolId,
} from '@tradeforge/core';
import { createAccountWithDeposit } from '../_shared/accounts.js';
import { createLogger } from '../_shared/logging.js';
import { buildMerged } from '../_shared/merge.js';
import { runScenario } from '../_shared/replay.js';
import { buildDepthReader, buildTradesReader } from '../_shared/readers.js';

type AsyncEventQueue<T> = {
  iterable: AsyncIterable<T>;
  push(value: T): void;
  close(): void;
};

function createAsyncEventQueue<T>(): AsyncEventQueue<T> {
  const values: T[] = [];
  const waiting: Array<(value: IteratorResult<T>) => void> = [];
  let closed = false;

  const resolveNext = (result: IteratorResult<T>): void => {
    const resolver = waiting.shift();
    if (resolver) {
      resolver(result);
    }
  };

  const iterable: AsyncIterable<T> = {
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
  };

  return {
    iterable,
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
          resolveNext({ value: undefined as unknown as T, done: true });
        }
      }
    },
  } satisfies AsyncEventQueue<T>;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString(10);
  }
  return value;
}

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
  const ordersList = Array.from(state.orders.values()) as Order[];
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

    const executedQty = order.executedQty as unknown as bigint;
    const cumulativeQuote = order.cumulativeQuote as unknown as bigint;
    const qty = order.qty as unknown as bigint;
    const makerFee = order.fees.maker as unknown as bigint | undefined;
    const takerFee = order.fees.taker as unknown as bigint | undefined;

    totals.fills += order.fills.length;
    totals.executedQty += executedQty;
    totals.notional += cumulativeQuote;
    if (makerFee !== undefined) {
      totals.fees.maker += makerFee;
    }
    if (takerFee !== undefined) {
      totals.fees.taker += takerFee;
    }

    return {
      id: String(order.id),
      side: order.side,
      status: order.status,
      qty,
      executedQty,
      cumulativeQuote,
      fees: {
        ...(makerFee !== undefined ? { maker: makerFee } : {}),
        ...(takerFee !== undefined ? { taker: takerFee } : {}),
      },
      fills: order.fills.length,
    };
  });

  const balances: Record<
    string,
    Record<string, { free: bigint; locked: bigint }>
  > = {};
  for (const [accountId] of state.accounts.entries()) {
    balances[accountId as unknown as string] =
      accounts.getBalancesSnapshot(accountId);
  }

  return { totals, orders: ordersSummary, balances };
}

const logger = createLogger({ prefix: '[examples/07-summary-and-ndjson]' });

const SYMBOL: SymbolId = 'BTCUSDT' as SymbolId;
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

function formatPrice(value: PriceInt): string {
  return fromPriceInt(value, SYMBOL_CONFIG.priceScale);
}

function formatQty(value: QtyInt): string {
  return fromQtyInt(value, SYMBOL_CONFIG.qtyScale);
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));

  const { path: outputPath, tempDir } = (() => {
    const explicit = process.env['TF_NDJSON_PATH'];
    if (explicit && explicit.trim().length > 0) {
      return { path: explicit.trim() };
    }
    const dir = mkdtempSync(join(tmpdir(), 'tf-ndjson-'));
    return { path: resolve(dir, 'reports.ndjson'), tempDir: dir };
  })();
  const keepNdjson = process.env['TF_KEEP_NDJSON'] === '1';
  logger.info(`NDJSON output path resolved to ${outputPath}`);

  function resolveFixture(file: string): string {
    const local = resolve(here, '../_smoke', file);
    if (existsSync(local)) {
      return local;
    }
    return resolve(here, '../../examples/_smoke', file);
  }

  const tradesPath = resolveFixture('mini-trades.jsonl');
  const depthPath = resolveFixture('mini-depth.jsonl');

  logger.info('building merged timeline from mini fixtures');
  const trades = buildTradesReader([tradesPath]);
  const depth = buildDepthReader([depthPath]);
  const timeline = buildMerged(trades, depth);

  logger.info('initializing exchange state and services');
  const state = new ExchangeState({
    symbols: { [SYMBOL as unknown as string]: SYMBOL_CONFIG },
    fee: FEE_CONFIG,
    orderbook: new StaticMockOrderbook({ best: {} }),
  });
  const accounts = new AccountsService(state);
  const orders = new OrdersService(state, accounts);

  const deposit = toPriceInt('1000', SYMBOL_CONFIG.priceScale);
  const { account, accountId } = await createAccountWithDeposit(
    {
      accounts,
      symbol: {
        id: SYMBOL as unknown as string,
        base: SYMBOL_CONFIG.base,
        quote: SYMBOL_CONFIG.quote,
      },
    },
    { quote: deposit.toString() },
  );
  logger.info(
    `created account ${accountId} with quote balance ${formatPrice(
      deposit,
    )} ${SYMBOL_CONFIG.quote}`,
  );

  const orderQty = toQtyInt('0.030', SYMBOL_CONFIG.qtyScale);
  const orderPrice = toPriceInt('27000.60', SYMBOL_CONFIG.priceScale);
  const buyOrder = orders.placeOrder({
    accountId: account.id,
    symbol: SYMBOL,
    type: 'LIMIT',
    side: 'BUY',
    qty: orderQty,
    price: orderPrice,
  });
  logger.info(
    `placed LIMIT BUY ${String(buyOrder.id)} qty=${formatQty(
      orderQty,
    )} price=${formatPrice(orderPrice)} ${SYMBOL_CONFIG.quote}`,
  );

  rmSync(outputPath, { force: true });
  const ndjsonStream = createWriteStream(outputPath, {
    encoding: 'utf8',
    flags: 'w',
  });
  const queue = createAsyncEventQueue<MergedEvent>();
  let rowsWritten = 0;

  const executionPromise = (async () => {
    try {
      for await (const report of executeTimeline(queue.iterable, state)) {
        const enriched = {
          eventType: report.kind,
          ...report,
        };
        const line = `${JSON.stringify(enriched, jsonReplacer)}\n`;
        if (!ndjsonStream.write(line)) {
          await once(ndjsonStream, 'drain');
        }
        rowsWritten += 1;
      }
    } finally {
      ndjsonStream.end();
    }
    await once(ndjsonStream, 'close');
    return rowsWritten;
  })();

  let progress: ReplayProgress | undefined;
  let replayError: unknown;
  try {
    progress = await runScenario({
      timeline,
      clock: 'logical',
      limits: { maxEvents: 24 },
      logger,
      onEvent: (event) => {
        queue.push(event);
      },
    });
    logger.info(`replay finished after ${progress.eventsOut} events`);
  } catch (err) {
    replayError = err;
  } finally {
    queue.close();
  }

  let ndjsonRows = 0;
  try {
    ndjsonRows = await executionPromise;
  } catch (err) {
    if (!replayError) {
      replayError = err;
    }
  }

  if (replayError) {
    throw replayError;
  }
  if (!progress) {
    throw new Error('replay completed without progress stats');
  }

  logger.info(`execution reports saved to ${outputPath} (${ndjsonRows} rows)`);

  const summary = {
    ...buildSummary(state, accounts),
    config: {
      symbol: SYMBOL as unknown as string,
      priceScale: SYMBOL_CONFIG.priceScale,
      qtyScale: SYMBOL_CONFIG.qtyScale,
    },
  };
  const summaryPrintable = JSON.parse(
    JSON.stringify(summary, jsonReplacer),
  ) as Record<string, unknown>;
  console.log('SUMMARY_AGGREGATED');
  console.log(JSON.stringify(summaryPrintable, null, 2));

  const fileContent = await readFile(outputPath, 'utf8');
  const rows = fileContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
  if (rows <= 0) {
    throw new Error('NDJSON output is empty');
  }

  const wallMs = Math.max(0, progress.wallLastMs - progress.wallStartMs);
  const simMs =
    progress.simStartTs !== undefined && progress.simLastTs !== undefined
      ? Math.max(0, Number(progress.simLastTs) - Number(progress.simStartTs))
      : 0;

  console.log(
    'SUMMARY_NDJSON_OK',
    JSON.stringify({
      rows,
      eventsOut: progress.eventsOut,
      wallMs,
      simMs,
      ndjsonPath: outputPath,
    }),
  );

  if (!keepNdjson) {
    try {
      rmSync(outputPath, { force: true });
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      logger.warn(
        `failed to cleanup NDJSON at ${outputPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`example failed: ${message}`);
  if (err instanceof Error && err.stack) {
    logger.debug(err.stack);
  }
  process.exit(1);
});
