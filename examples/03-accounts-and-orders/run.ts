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
import {
  buildDepthReader,
  buildTradesReader,
  peekFirstTradePrice,
} from '../_shared/readers.js';
import { buildMerged } from '../_shared/merge.js';
import { runScenario } from '../_shared/replay.js';
import { createLogger } from '../_shared/logging.js';
import { createAccountWithDeposit } from '../_shared/accounts.js';

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

const logger = createLogger({ prefix: '[examples/03-accounts-and-orders]' });

const DEFAULT_SYMBOL = 'BTCUSDT';

function resolveSymbol(): SymbolId {
  const raw = process.env['TF_SYMBOL'];
  const value =
    typeof raw === 'string' && raw.trim().length > 0
      ? raw.trim()
      : DEFAULT_SYMBOL;
  return value as SymbolId;
}

const SYMBOL: SymbolId = resolveSymbol();
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

function formatQty(value: QtyInt): string {
  return fromQtyInt(value, SYMBOL_CONFIG.qtyScale);
}

function formatPrice(value: PriceInt): string {
  return fromPriceInt(value, SYMBOL_CONFIG.priceScale);
}

function parseEnvString(key: string): string | undefined {
  const raw = process.env[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function resolveOrderPrices(tradeFiles: string[]): Promise<{
  buy: string;
  sell: string;
  source: 'env' | 'auto' | 'fallback';
  reference?: string;
}> {
  const envBuy = parseEnvString('TF_BUY_PRICE');
  const envSell = parseEnvString('TF_SELL_PRICE');

  if (envBuy && envSell) {
    return { buy: envBuy, sell: envSell, source: 'env' };
  }

  const FALLBACK_BUY = '10000';
  const FALLBACK_SELL = '11000';

  let buy = envBuy;
  let sell = envSell;
  let referencePrintable: string | undefined;
  let usedAuto = false;
  let usedFallback = false;

  if (!buy || !sell) {
    try {
      const rawPrice = await peekFirstTradePrice(tradeFiles);
      if (rawPrice !== undefined) {
        const normalizedRawPrice = rawPrice.trim();
        if (/^\d+$/.test(normalizedRawPrice)) {
          const referenceInt = BigInt(normalizedRawPrice);
          if (referenceInt >= 0n) {
            referencePrintable = fromPriceInt(
              referenceInt as unknown as PriceInt,
              SYMBOL_CONFIG.priceScale,
            );
          } else {
            referencePrintable = rawPrice;
          }
          const ensurePositive = (value: bigint): bigint => {
            if (value > 0n) {
              return value;
            }
            return 1n;
          };
          if (!buy && referenceInt >= 0n) {
            const adjusted = ensurePositive((referenceInt * 99n) / 100n);
            buy = fromPriceInt(
              adjusted as unknown as PriceInt,
              SYMBOL_CONFIG.priceScale,
            );
            usedAuto = true;
          }
          if (!sell && referenceInt >= 0n) {
            const adjusted = ensurePositive((referenceInt * 101n) / 100n);
            sell = fromPriceInt(
              adjusted as unknown as PriceInt,
              SYMBOL_CONFIG.priceScale,
            );
            usedAuto = true;
          }
        } else {
          referencePrintable = normalizedRawPrice;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`failed to inspect trades for reference price: ${message}`);
    }
  }

  if (!buy) {
    buy = FALLBACK_BUY;
    usedFallback = true;
  }
  if (!sell) {
    sell = FALLBACK_SELL;
    usedFallback = true;
  }

  const source: 'env' | 'auto' | 'fallback' = usedFallback
    ? 'fallback'
    : usedAuto
      ? 'auto'
      : 'env';

  const result: {
    buy: string;
    sell: string;
    source: 'env' | 'auto' | 'fallback';
    reference?: string;
  } = {
    buy,
    sell,
    source,
  };
  if (referencePrintable) {
    result.reference = referencePrintable;
  }
  return result;
}

function fractionOfQty(
  value: QtyInt,
  numerator: bigint,
  denominator: bigint,
): QtyInt {
  const raw = value as unknown as bigint;
  if (raw <= 0n) {
    return value;
  }
  let result = (raw * numerator) / denominator;
  if (result <= 0n) {
    result = 1n;
  }
  if (result > raw) {
    result = raw;
  }
  return result as unknown as QtyInt;
}

function deriveRestingBuyPrice(buyPrice: PriceInt): PriceInt {
  const raw = buyPrice as unknown as bigint;
  const delta = raw / 1000n;
  const adjusted = raw - (delta > 0n ? delta : 1n);
  const final = adjusted > 0n ? adjusted : raw;
  return final as unknown as PriceInt;
}

function formatBalances(
  balances: Record<string, { free: bigint; locked: bigint }>,
): Record<string, { free: string; locked: string }> {
  const formatted: Record<string, { free: string; locked: string }> = {};
  for (const [currency, entry] of Object.entries(balances)) {
    if (currency === SYMBOL_CONFIG.base) {
      formatted[currency] = {
        free: fromQtyInt(
          entry.free as unknown as QtyInt,
          SYMBOL_CONFIG.qtyScale,
        ),
        locked: fromQtyInt(
          entry.locked as unknown as QtyInt,
          SYMBOL_CONFIG.qtyScale,
        ),
      };
    } else if (currency === SYMBOL_CONFIG.quote) {
      formatted[currency] = {
        free: fromPriceInt(
          entry.free as unknown as PriceInt,
          SYMBOL_CONFIG.priceScale,
        ),
        locked: fromPriceInt(
          entry.locked as unknown as PriceInt,
          SYMBOL_CONFIG.priceScale,
        ),
      };
    } else {
      formatted[currency] = {
        free: entry.free.toString(),
        locked: entry.locked.toString(),
      };
    }
  }
  return formatted;
}

function resolveInputFiles(kind: 'trades' | 'depth'): string[] {
  const envKey = kind === 'trades' ? 'TF_TRADES_FILES' : 'TF_DEPTH_FILES';
  const raw = process.env[envKey];
  const list = (raw ?? '')
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (list.length > 0) {
    return list;
  }
  const fallback =
    kind === 'trades'
      ? 'examples/_smoke/mini-trades.jsonl'
      : 'examples/_smoke/mini-depth.jsonl';
  return [fallback];
}

async function main(): Promise<void> {
  logger.info('preparing merged timeline (trades + depth)');
  const tradesFiles = resolveInputFiles('trades');
  const depthFiles = resolveInputFiles('depth');

  const {
    buy: buyPriceStr,
    sell: sellPriceStr,
    source,
    reference,
  } = await resolveOrderPrices(tradesFiles);

  const qtyStr = parseEnvString('TF_QTY') ?? '0.001';
  const orderParamsLog = {
    symbol: SYMBOL as unknown as string,
    qty: qtyStr,
    buy: buyPriceStr,
    sell: sellPriceStr,
    source,
    ...(reference ? { reference } : {}),
  };
  logger.info(`resolved order params ${JSON.stringify(orderParamsLog)}`);

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
  const accountIdStr = accountId;
  logger.info(
    `created account ${accountIdStr} and deposited ${formatPrice(deposit)} ${SYMBOL_CONFIG.quote}`,
  );

  const buyQty = toQtyInt(qtyStr, SYMBOL_CONFIG.qtyScale);
  const buyPrice = toPriceInt(buyPriceStr, SYMBOL_CONFIG.priceScale);
  const buyOrder = orders.placeOrder({
    accountId: account.id,
    symbol: SYMBOL,
    type: 'LIMIT',
    side: 'BUY',
    qty: buyQty,
    price: buyPrice,
  });
  logger.info(
    `placed BUY order ${String(buyOrder.id)} -> qty=${formatQty(buyQty)}, price=${formatPrice(buyPrice)} ${SYMBOL_CONFIG.quote}`,
  );

  const targetSellQty = fractionOfQty(buyQty, 1n, 2n);
  const targetSellQtyRaw = targetSellQty as unknown as bigint;
  const sellPrice = toPriceInt(sellPriceStr, SYMBOL_CONFIG.priceScale);
  const restingBuyPrice = deriveRestingBuyPrice(buyPrice);
  let restingBuyQty = fractionOfQty(buyQty, 1n, 6n);
  const restingBuyQtyRawInitial = restingBuyQty as unknown as bigint;
  if (restingBuyQtyRawInitial >= targetSellQtyRaw) {
    const adjustedRaw = targetSellQtyRaw > 1n ? targetSellQtyRaw - 1n : 1n;
    restingBuyQty = adjustedRaw as unknown as QtyInt;
  }

  let sellOrder: Order | undefined;
  let restingBuyOrder: Order | undefined;

  const queue = createAsyncEventQueue<MergedEvent>();
  const executionTask = (async () => {
    for await (const report of executeTimeline(queue.iterable, state)) {
      if (report.kind === 'FILL' && report.fill && report.orderId) {
        const fillQtyStr = formatQty(report.fill.qty);
        const fillPriceStr = formatPrice(report.fill.price);
        logger.info(
          `fill ${String(report.orderId)} side=${report.fill.side} qty=${fillQtyStr} price=${fillPriceStr}`,
        );
      }

      if (report.kind === 'FILL' && report.orderId === buyOrder.id) {
        const current = orders.getOrder(buyOrder.id);
        const executedRaw = current.executedQty as unknown as bigint;
        if (!sellOrder && executedRaw >= targetSellQtyRaw) {
          sellOrder = orders.placeOrder({
            accountId: account.id,
            symbol: SYMBOL,
            type: 'LIMIT',
            side: 'SELL',
            qty: targetSellQty,
            price: sellPrice,
          });
          logger.info(
            `placed SELL order ${String(sellOrder.id)} -> qty=${formatQty(targetSellQty)}, price=${formatPrice(sellPrice)}`,
          );
        }
      }

      if (
        sellOrder &&
        report.kind === 'FILL' &&
        report.orderId === sellOrder.id &&
        !restingBuyOrder
      ) {
        restingBuyOrder = orders.placeOrder({
          accountId: account.id,
          symbol: SYMBOL,
          type: 'LIMIT',
          side: 'BUY',
          qty: restingBuyQty,
          price: restingBuyPrice,
        });
        logger.info(
          `placed resting BUY order ${String(restingBuyOrder.id)} -> qty=${formatQty(restingBuyQty)}, price=${formatPrice(restingBuyPrice)}`,
        );
      }
    }
  })();

  let replayError: unknown;
  try {
    const progress = await runScenario({
      timeline,
      clock: 'logical',
      limits: { maxEvents: 32 },
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

  const openOrders = orders.listOpenOrders(account.id, SYMBOL);
  if (openOrders.length > 0) {
    for (const order of openOrders) {
      logger.info(
        `canceling open order ${String(order.id)} status=${order.status}`,
      );
      orders.cancelOrder(order.id);
    }
  }

  const balances = accounts.getBalancesSnapshot(account.id);
  const formattedBalances = formatBalances(balances);
  logger.info(
    `final balances for ${accountIdStr}: ${JSON.stringify(formattedBalances)}`,
  );
  const finalOpenOrders = orders.listOpenOrders(account.id, SYMBOL).length;
  console.log('ACC_ORDERS_OK', {
    balances: formattedBalances,
    openOrdersCount: finalOpenOrders,
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`scenario failed: ${message}`);
  if (err instanceof Error && err.stack) {
    logger.debug(err.stack);
  }
  process.exit(1);
});
