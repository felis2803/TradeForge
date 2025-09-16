/* eslint-disable */
import { createReader } from '@tradeforge/io-binance';
import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  createMergedStream,
  executeTimeline,
  toPriceInt,
  toQtyInt,
  type DepthEvent,
  type ExecutionReport,
  type Order,
  type SymbolId,
  type TradeEvent,
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
  for await (const report of executeTimeline(merged, state, {
    treatLimitAsMaker: treatAsMaker,
  })) {
    reports.push(report);
    if (ndjson) {
      if (limit === undefined || printed < limit) {
        console.log(stringify(report));
        printed += 1;
      }
    }
  }

  if (!ndjson && reports.length === 0) {
    console.log('no execution reports emitted (check filters or inputs)');
  }

  if (printSummary) {
    const summary = buildSummary(state, accounts);
    summary['config'] = {
      symbol,
      priceScale,
      qtyScale,
      ordersSeeded: placed.map((o) => ({
        id: o.id,
        side: o.side,
        qty: o.qty,
        price: o.price,
      })),
    };
    console.log(stringify(summary, 2));
  }
}
