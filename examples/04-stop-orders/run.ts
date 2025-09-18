import { resolve } from 'node:path';
import process from 'node:process';
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
  type PriceInt,
  type QtyInt,
  type SymbolId,
} from '@tradeforge/core';
import { buildDepthReader, buildTradesReader } from '../_shared/readers.js';
import { buildMerged } from '../_shared/merge.js';
import { createLogger } from '../_shared/logging.js';
import { createAccountWithDeposit } from '../_shared/accounts.js';
import { runScenario } from '../_shared/replay.js';

const logger = createLogger({ prefix: '[examples/04-stop-orders]' });

const DEFAULT_SYMBOL = 'BTCUSDT';
const SYMBOL = (process.env['TF_SYMBOL']?.trim() || DEFAULT_SYMBOL) as SymbolId;

const SYMBOL_CONFIG = {
  base: 'BTC',
  quote: 'USDT',
  priceScale: 5,
  qtyScale: 6,
};

const FEE_CONFIG = { makerBps: 0, takerBps: 0 };

function splitFiles(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveFileList(
  envValue: string | undefined,
  fallback: string[],
): string[] {
  const envEntries = splitFiles(envValue);
  const chosen = envEntries.length > 0 ? envEntries : fallback;
  return chosen.map((file) => resolve(file));
}

function formatPrice(value: PriceInt): string {
  return fromPriceInt(value, SYMBOL_CONFIG.priceScale);
}

function formatQty(value: QtyInt): string {
  return fromQtyInt(value, SYMBOL_CONFIG.qtyScale);
}

function calcRemainingQty(order: Order): QtyInt {
  const total = order.qty as unknown as bigint;
  const executed = order.executedQty as unknown as bigint;
  const remaining = total - executed;
  const positive = remaining > 0n ? remaining : 0n;
  return positive as unknown as QtyInt;
}

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
          return new Promise((resolveNextValue) => {
            waiting.push(resolveNextValue);
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
      if (closed) {
        return;
      }
      if (waiting.length > 0) {
        resolveNext({ value, done: false });
        return;
      }
      values.push(value);
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      if (waiting.length > 0) {
        while (waiting.length > 0) {
          resolveNext({ value: undefined as unknown as T, done: true });
        }
      }
    },
  } satisfies AsyncEventQueue<T>;
}

async function main(): Promise<void> {
  const tradesFiles = resolveFileList(process.env['TF_TRADES_FILES'], [
    resolve('examples', '_smoke', 'mini-trades.jsonl'),
  ]);
  const depthFiles = resolveFileList(process.env['TF_DEPTH_FILES'], [
    resolve('examples', '_smoke', 'mini-depth.jsonl'),
  ]);

  logger.info(
    `using trades=${tradesFiles.join(', ')} depth=${depthFiles.join(', ')}`,
  );

  const trades = buildTradesReader(tradesFiles);
  const depth = buildDepthReader(depthFiles);
  const timeline = buildMerged(trades, depth);

  const state = new ExchangeState({
    symbols: { [SYMBOL as unknown as string]: SYMBOL_CONFIG },
    fee: FEE_CONFIG,
    orderbook: new StaticMockOrderbook({ best: {} }),
  });

  const accounts = new AccountsService(state);
  const orders = new OrdersService(state, accounts);

  const baseDeposit = toQtyInt('0.100', SYMBOL_CONFIG.qtyScale);
  const quoteDeposit = toPriceInt('2000', SYMBOL_CONFIG.priceScale);

  const { account, accountId } = await createAccountWithDeposit(
    {
      accounts,
      symbol: {
        id: SYMBOL as unknown as string,
        base: SYMBOL_CONFIG.base,
        quote: SYMBOL_CONFIG.quote,
      },
    },
    {
      base: baseDeposit.toString(),
      quote: quoteDeposit.toString(),
    },
  );

  logger.info(
    `created account ${accountId} -> base=${formatQty(baseDeposit)} ${SYMBOL_CONFIG.base}, quote=${formatPrice(quoteDeposit)} ${SYMBOL_CONFIG.quote}`,
  );

  const stopMarketQty = toQtyInt('0.020', SYMBOL_CONFIG.qtyScale);
  const stopMarketTrigger = toPriceInt('27000.12', SYMBOL_CONFIG.priceScale);
  const stopMarket = orders.placeOrder({
    accountId: account.id,
    symbol: SYMBOL,
    type: 'STOP_MARKET',
    side: 'SELL',
    qty: stopMarketQty,
    triggerPrice: stopMarketTrigger,
    triggerDirection: 'DOWN',
  });
  const stopMarketId = String(stopMarket.id);
  logger.info(
    `[${stopMarketId}] placed STOP_MARKET SELL qty=${formatQty(stopMarketQty)} trigger=${formatPrice(stopMarketTrigger)} direction=DOWN`,
  );

  const stopLimitQty = toQtyInt('0.040', SYMBOL_CONFIG.qtyScale);
  const stopLimitPrice = toPriceInt('27000.45', SYMBOL_CONFIG.priceScale);
  const stopLimitTrigger = toPriceInt('27000.50', SYMBOL_CONFIG.priceScale);
  const stopLimit = orders.placeOrder({
    accountId: account.id,
    symbol: SYMBOL,
    type: 'STOP_LIMIT',
    side: 'BUY',
    qty: stopLimitQty,
    price: stopLimitPrice,
    triggerPrice: stopLimitTrigger,
    triggerDirection: 'UP',
  });
  const stopLimitId = String(stopLimit.id);
  logger.info(
    `[${stopLimitId}] placed STOP_LIMIT BUY qty=${formatQty(stopLimitQty)} limit=${formatPrice(stopLimitPrice)} trigger=${formatPrice(stopLimitTrigger)} direction=UP`,
  );

  const orderMeta = new Map<string, { label: string }>([
    [stopMarketId, { label: 'STOP_MARKET SELL' }],
    [stopLimitId, { label: 'STOP_LIMIT BUY' }],
  ]);
  const activationLogged = new Set<string>();
  let stopLimitCanceled = false;

  const queue = createAsyncEventQueue<MergedEvent>();

  const executionTask = (async () => {
    for await (const report of executeTimeline(queue.iterable, state)) {
      if (report.kind === 'END') {
        break;
      }
      if (!report.orderId) {
        continue;
      }
      const key = String(report.orderId);
      const meta = orderMeta.get(key);
      const current = orders.getOrder(report.orderId);

      if (current.activated && !activationLogged.has(key)) {
        activationLogged.add(key);
        const newType = current.type;
        logger.info(
          `[${meta?.label ?? key}] activated -> now type=${newType} status=${current.status}`,
        );
      }

      if (report.kind === 'FILL' && report.fill) {
        const fillQty = formatQty(report.fill.qty);
        const fillPrice = formatPrice(report.fill.price);
        logger.info(
          `[${meta?.label ?? key}] fill qty=${fillQty} price=${fillPrice} status=${current.status}`,
        );

        if (
          meta?.label === 'STOP_LIMIT BUY' &&
          !stopLimitCanceled &&
          current.status === 'PARTIALLY_FILLED'
        ) {
          const canceled = orders.cancelOrder(report.orderId);
          stopLimitCanceled = true;
          const executedQty = formatQty(canceled.executedQty);
          const totalQty = formatQty(canceled.qty);
          const remainingQty = formatQty(calcRemainingQty(canceled));
          logger.info(
            `[${meta.label}] canceled after partial fill -> status=${canceled.status} executed=${executedQty}/${totalQty} remaining=${remainingQty}`,
          );
        }
      }
    }
  })();

  let replayError: unknown;
  let progressEvents: number | undefined;
  try {
    const progress = await runScenario({
      timeline,
      clock: 'logical',
      limits: { maxEvents: 64 },
      logger,
      onEvent: (event) => {
        queue.push(event);
      },
    });
    progressEvents = progress.eventsOut;
  } catch (err) {
    replayError = err;
  } finally {
    queue.close();
  }

  await executionTask;

  if (progressEvents !== undefined) {
    logger.info(`timeline replay completed after ${progressEvents} events`);
  }

  if (replayError) {
    throw replayError;
  }

  const finalStopMarket = orders.getOrder(stopMarket.id);
  const finalStopLimit = orders.getOrder(stopLimit.id);

  const finalTriggered = [finalStopMarket, finalStopLimit].filter(
    (order) => order.activated,
  ).length;
  const finalCanceled = [finalStopMarket, finalStopLimit].filter(
    (order) => order.status === 'CANCELED',
  ).length;

  const printOrderSummary = (order: Order, label: string): void => {
    const executed = formatQty(order.executedQty);
    const total = formatQty(order.qty);
    const remaining = formatQty(calcRemainingQty(order));
    const activation = order.activated ? 'yes' : 'no';
    const pricePart =
      order.price !== undefined
        ? ` price=${formatPrice(order.price)}`
        : order.type === 'MARKET'
          ? ' price=MARKET'
          : '';
    const triggerPart = order.triggerPrice
      ? ` trigger=${formatPrice(order.triggerPrice)} direction=${
          order.triggerDirection ?? '-'
        }`
      : '';
    logger.info(
      `[${label}] final status=${order.status} activated=${activation} type=${order.type}${pricePart}${triggerPart} executed=${executed}/${total} remaining=${remaining}`,
    );
  };

  printOrderSummary(finalStopMarket, 'STOP_MARKET SELL');
  printOrderSummary(finalStopLimit, 'STOP_LIMIT BUY');

  console.log('STOP_ORDERS_OK', {
    placed: orderMeta.size,
    triggered: finalTriggered,
    canceled: finalCanceled,
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`stop orders scenario failed: ${message}`);
  if (err instanceof Error && err.stack) {
    logger.debug(err.stack);
  }
  process.exit(1);
});
