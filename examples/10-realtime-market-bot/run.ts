import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  type Balances,
  type Fill,
  type Order,
  type PriceInt,
  type QtyInt,
  type SymbolId,
} from '@tradeforge/core';
import {
  createRealtimeEngine,
  type DepthDiff,
  type RealtimeEngineOptions,
  type Trade,
} from '@tradeforge/sim';

const SYMBOL = 'BTCUSDT' as SymbolId;

const SYMBOL_CONFIG = {
  base: 'BTC',
  quote: 'USDT',
  priceScale: 0,
  qtyScale: 0,
};

const FEE_CONFIG = {
  makerBps: 0,
  takerBps: 0,
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createDepthStream(): AsyncIterable<DepthDiff> {
  async function* generator(): AsyncGenerator<DepthDiff> {
    const start = Date.now();
    let seq = 1;
    const events: Array<{
      waitMs: number;
      bids: [bigint, bigint][];
      asks: [bigint, bigint][];
    }> = [
      {
        waitMs: 0,
        bids: [
          [99n, 5n],
          [98n, 8n],
        ],
        asks: [
          [101n, 5n],
          [102n, 6n],
        ],
      },
      {
        waitMs: 500,
        bids: [
          [100n, 4n],
          [99n, 5n],
        ],
        asks: [
          [102n, 6n],
          [103n, 5n],
        ],
      },
      {
        waitMs: 500,
        bids: [
          [101n, 5n],
          [100n, 5n],
        ],
        asks: [
          [103n, 5n],
          [104n, 5n],
        ],
      },
    ];

    for (const { waitMs, bids, asks } of events) {
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      yield {
        ts: start + seq * 100,
        seq,
        bids,
        asks,
      };
      seq += 1;
    }
  }

  return generator();
}

function createTradesStream(): AsyncIterable<Trade> {
  async function* generator(): AsyncGenerator<Trade> {
    const start = Date.now();
    const trades: Array<{
      waitMs: number;
      trade: Trade;
    }> = [
      {
        waitMs: 250,
        trade: { ts: start + 250, side: 'BUY', price: 101n, qty: 1n },
      },
      {
        waitMs: 400,
        trade: { ts: start + 650, side: 'SELL', price: 102n, qty: 1n },
      },
      {
        waitMs: 400,
        trade: { ts: start + 1050, side: 'BUY', price: 103n, qty: 1n },
      },
    ];

    for (const { waitMs, trade } of trades) {
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      yield trade;
    }
  }

  return generator();
}

function formatBalances(
  balances: Record<string, Balances>,
): Record<string, string> {
  const entries = Object.entries(balances).map(([currency, balance]) => {
    const free = balance.free.toString();
    const locked = balance.locked.toString();
    return [currency, `${free} free / ${locked} locked`];
  });
  return Object.fromEntries(entries);
}

export default async function run(): Promise<void> {
  console.log('Bootstrapping realtime market bot example...');

  const state = new ExchangeState({
    symbols: { [SYMBOL as unknown as string]: SYMBOL_CONFIG },
    fee: FEE_CONFIG,
    orderbook: new StaticMockOrderbook({
      best: {
        [SYMBOL as unknown as string]: {
          bestBid: 100n as PriceInt,
          bestAsk: 101n as PriceInt,
        },
      },
    }),
  });
  const accounts = new AccountsService(state);
  const orders = new OrdersService(state, accounts);

  const adapter = createRealtimeEngine({
    symbol: SYMBOL,
    state: state as unknown as RealtimeEngineOptions['state'],
    accounts: accounts as unknown as RealtimeEngineOptions['accounts'],
    orders: orders as unknown as RealtimeEngineOptions['orders'],
    streams: {
      depth: { stream: createDepthStream() },
      trades: { stream: createTradesStream() },
    },
  });

  const account = accounts.createAccount('demo-api-key');
  const quoteDeposit = 10_000n;
  accounts.deposit(account.id, SYMBOL_CONFIG.quote, quoteDeposit);
  console.log(
    `Created account ${String(account.id)} with ${quoteDeposit} ${SYMBOL_CONFIG.quote} on balance`,
  );

  adapter.on('tradeSeen', (trade: Trade) => {
    console.log(
      `Trade seen on feed: side=${trade.side} price=${trade.price} qty=${trade.qty}`,
    );
  });

  adapter.on('orderFilled', ({ order, fill }: { order: Order; fill: Fill }) => {
    console.log(
      `Fill: order=${String(order.id)} side=${fill.side} qty=${fill.qty} price=${fill.price}`,
    );
  });

  console.log('Waiting for order book warm-up...');
  await sleep(300);

  console.log('Placing market BUY for 2 BTC...');
  const buyQty = 2n as QtyInt;
  adapter.placeOrder({
    accountId: account.id,
    symbol: SYMBOL,
    type: 'MARKET',
    side: 'BUY',
    qty: buyQty,
  });

  await sleep(800);

  console.log('Placing market SELL for 1 BTC...');
  const sellQty = 1n as QtyInt;
  adapter.placeOrder({
    accountId: account.id,
    symbol: SYMBOL,
    type: 'MARKET',
    side: 'SELL',
    qty: sellQty,
  });

  await sleep(800);

  const balances = accounts.getBalancesSnapshot(account.id);
  console.log('Final balances:', formatBalances(balances));

  await adapter.close();
  console.log('Realtime engine closed. Example finished.');
}

if (process.argv[1] && process.argv[1].endsWith('run.ts')) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
