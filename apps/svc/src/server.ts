import Fastify, { type FastifyInstance } from 'fastify';
import {
  AccountsService,
  ExchangeState,
  OrdersService,
  StaticMockOrderbook,
  type FeeConfig,
  type SymbolConfig,
  toPriceInt,
} from '@tradeforge/core';
import { registerAccountsRoutes } from './routes/accounts.js';
import { registerOrdersRoutes } from './routes/orders.js';

export interface ServiceContext {
  state: ExchangeState;
  accounts: AccountsService;
  orders: OrdersService;
}

const BTCUSDT_CONFIG: SymbolConfig = {
  base: 'BTC',
  quote: 'USDT',
  priceScale: 5,
  qtyScale: 6,
};

const DEFAULT_SYMBOLS: Record<string, SymbolConfig> = {
  BTCUSDT: BTCUSDT_CONFIG,
};

const DEFAULT_FEE: FeeConfig = {
  makerBps: 5,
  takerBps: 7,
};

function createDefaultState(): ExchangeState {
  const orderbook = new StaticMockOrderbook({
    best: {
      BTCUSDT: {
        bestBid: toPriceInt('27000', BTCUSDT_CONFIG.priceScale),
        bestAsk: toPriceInt('27001', BTCUSDT_CONFIG.priceScale),
      },
    },
  });
  return new ExchangeState({
    symbols: DEFAULT_SYMBOLS,
    fee: DEFAULT_FEE,
    orderbook,
  });
}

export function createServices(): ServiceContext {
  const state = createDefaultState();
  const accounts = new AccountsService(state);
  const orders = new OrdersService(state, accounts);
  return { state, accounts, orders };
}

export function createServer(): FastifyInstance {
  const services = createServices();
  const app = Fastify({ logger: false });

  registerAccountsRoutes(app, services);
  registerOrdersRoutes(app, services);

  return app;
}

export async function startServer(): Promise<FastifyInstance> {
  const server = createServer();
  await server.ready();
  const port = Number(process.env['PORT'] ?? 3000);
  const host = process.env['HOST'] ?? '0.0.0.0';
  await server.listen({ port, host });

  console.log(`svc listening on http://${host}:${port}`);
  return server;
}

const invokedPath = process.argv[1] ?? '';
if (invokedPath.endsWith('server.ts') || invokedPath.endsWith('server.js')) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
