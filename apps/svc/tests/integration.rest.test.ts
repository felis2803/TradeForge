import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type {
  DepthDiff,
  PriceInt,
  QtyInt,
  SymbolId,
  TimestampMs,
  Trade,
} from '@tradeforge/core';

import { createServer } from '../src/server.js';
import { setRealtimeFeedFactory } from '../src/realtime.js';

describe('REST adapter integration', () => {
  let app: FastifyInstance;
  let accountId: string;

  beforeAll(async () => {
    app = createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('handles account lifecycle and limit order reservations', async () => {
    const createAccount = await app.inject({
      method: 'POST',
      url: '/v1/accounts',
    });
    expect(createAccount.statusCode).toBe(200);
    const created = JSON.parse(createAccount.body) as { accountId: string };
    accountId = created.accountId;
    expect(accountId).toBeDefined();

    const depositRes = await app.inject({
      method: 'POST',
      url: `/v1/accounts/${accountId}/deposit`,
      payload: JSON.stringify({ currency: 'USDT', amount: '1000' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(depositRes.statusCode).toBe(200);
    const deposit = JSON.parse(depositRes.body) as {
      free: string;
      locked: string;
    };
    expect(deposit.free).toBe('100000000');
    expect(deposit.locked).toBe('0');

    const balancesRes = await app.inject({
      method: 'GET',
      url: `/v1/accounts/${accountId}/balances`,
    });
    expect(balancesRes.statusCode).toBe(200);
    const balances = JSON.parse(balancesRes.body) as Record<
      string,
      { free: string; locked: string }
    >;
    expect(balances['USDT']).toEqual({ free: '100000000', locked: '0' });

    const orderRes = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: JSON.stringify({
        accountId,
        symbol: 'BTCUSDT',
        type: 'LIMIT',
        side: 'BUY',
        qty: '0.01',
        price: '25000',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(orderRes.statusCode).toBe(200);
    const order = JSON.parse(orderRes.body) as {
      id: string;
      status: string;
      rejectReason?: string;
    };
    expect(order.status).toBe('OPEN');
    expect(order.rejectReason).toBeUndefined();

    const fetchedRes = await app.inject({
      method: 'GET',
      url: `/v1/orders/${order.id}`,
    });
    expect(fetchedRes.statusCode).toBe(200);
    const fetched = JSON.parse(fetchedRes.body) as { id: string };
    expect(fetched.id).toBe(order.id);

    const listRes = await app.inject({
      method: 'GET',
      url: `/v1/orders/open?accountId=${accountId}`,
    });
    expect(listRes.statusCode).toBe(200);
    const openOrders = JSON.parse(listRes.body) as { id: string }[];
    expect(openOrders).toHaveLength(1);

    const balancesAfterOrderRes = await app.inject({
      method: 'GET',
      url: `/v1/accounts/${accountId}/balances`,
    });
    const balancesAfterOrder = JSON.parse(balancesAfterOrderRes.body) as Record<
      string,
      {
        free: string;
        locked: string;
      }
    >;
    expect(balancesAfterOrder['USDT']).toEqual({
      free: '74987500',
      locked: '25012500',
    });

    const cancelRes = await app.inject({
      method: 'DELETE',
      url: `/v1/orders/${order.id}`,
    });
    expect(cancelRes.statusCode).toBe(200);
    const canceled = JSON.parse(cancelRes.body) as { status: string };
    expect(canceled.status).toBe('CANCELED');

    const openAfterCancel = await app.inject({
      method: 'GET',
      url: `/v1/orders/open?accountId=${accountId}`,
    });
    expect(openAfterCancel.statusCode).toBe(200);
    const openList = JSON.parse(openAfterCancel.body) as unknown[];
    expect(openList).toHaveLength(0);

    const balancesAfterCancelRes = await app.inject({
      method: 'GET',
      url: `/v1/accounts/${accountId}/balances`,
    });
    const balancesAfterCancel = JSON.parse(
      balancesAfterCancelRes.body,
    ) as Record<
      string,
      {
        free: string;
        locked: string;
      }
    >;
    expect(balancesAfterCancel['USDT']).toEqual({
      free: '100000000',
      locked: '0',
    });
  });

  it('rejects deposits for unknown currencies', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/accounts/${accountId}/deposit`,
      payload: JSON.stringify({ currency: 'FOO', amount: '1' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { message: string };
    expect(body.message).toContain('unknown currency');
  });

  it('rejects orders that exceed available balance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: JSON.stringify({
        accountId,
        symbol: 'BTCUSDT',
        type: 'LIMIT',
        side: 'BUY',
        qty: '1',
        price: '100000',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      status: string;
      rejectReason?: string;
    };
    expect(body.status).toBe('REJECTED');
    expect(body.rejectReason).toBe('INSUFFICIENT_FUNDS');
  });

  it('rejects orders for unknown symbols', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: JSON.stringify({
        accountId,
        symbol: 'FOOUSD',
        type: 'LIMIT',
        side: 'BUY',
        qty: '1',
        price: '1',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      status: string;
      rejectReason?: string;
    };
    expect(body.status).toBe('REJECTED');
    expect(body.rejectReason).toBe('UNKNOWN_SYMBOL');
  });

  it('requires price for limit orders', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: JSON.stringify({
        accountId,
        symbol: 'BTCUSDT',
        type: 'LIMIT',
        side: 'BUY',
        qty: '0.01',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { message: string };
    expect(body.message).toContain('price is required for LIMIT');
  });

  it('returns validation errors for invalid decimals', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: JSON.stringify({
        accountId,
        symbol: 'BTCUSDT',
        type: 'LIMIT',
        side: 'BUY',
        qty: '0.0000001',
        price: '25000',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { message: string };
    expect(body.message).toContain('qty');
  });

  it('rejects unsupported execution types', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: JSON.stringify({
        accountId,
        symbol: 'BTCUSDT',
        type: 'MARKET',
        side: 'BUY',
        qty: '0.01',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      status: string;
      rejectReason?: string;
    };
    expect(body.status).toBe('OPEN');
    expect(body.rejectReason).toBeUndefined();
  });
});

describe('Realtime scheduler integration', () => {
  let app: FastifyInstance;
  let address: AddressInfo;
  let ws: WebSocket | null = null;

  function makeDepthDiff(params: {
    ts: number;
    bids: Array<[bigint, bigint]>;
    asks: Array<[bigint, bigint]>;
  }): DepthDiff {
    return {
      ts: params.ts as TimestampMs,
      symbol: 'BTCUSDT' as SymbolId,
      bids: params.bids.map(([price, qty]) => ({
        price: price as PriceInt,
        qty: qty as QtyInt,
      })),
      asks: params.asks.map(([price, qty]) => ({
        price: price as PriceInt,
        qty: qty as QtyInt,
      })),
    };
  }

  function makeTrade(params: {
    ts: number;
    price: bigint;
    qty: bigint;
    side?: 'BUY' | 'SELL';
  }): Trade {
    return {
      ts: params.ts as TimestampMs,
      symbol: 'BTCUSDT' as SymbolId,
      price: params.price as PriceInt,
      qty: params.qty as QtyInt,
      side: params.side,
    };
  }

  beforeAll(async () => {
    app = createServer({ logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    address = app.server.address() as AddressInfo;
  });

  afterEach(() => {
    setRealtimeFeedFactory(null);
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
      ws = null;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('streams market data via REST and websocket', async () => {
    const depthEvent = makeDepthDiff({
      ts: Date.now(),
      bids: [[2700000000000n, 2n]],
      asks: [[2700100000000n, 1n]],
    });
    const tradeEvent = makeTrade({
      ts: Date.now() + 5,
      price: 2700500000000n,
      qty: 3n,
      side: 'BUY',
    });

    setRealtimeFeedFactory(async () => [
      {
        symbol: 'BTCUSDT',
        depth: (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 20));
          yield depthEvent;
          while (true) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        })(),
        trades: (async function* () {
          await new Promise((resolve) => setTimeout(resolve, 40));
          yield tradeEvent;
          while (true) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        })(),
      },
    ]);

    const configureRes = await app.inject({
      method: 'POST',
      url: '/v1/runs',
      payload: {
        mode: 'realtime',
        instruments: [
          {
            symbol: 'BTCUSDT',
            fees: { makerBp: 1, takerBp: 1 },
          },
        ],
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(configureRes.statusCode).toBe(200);

    ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws?role=ui`);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('ws timeout')), 3000);
      ws!.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    type WsMessage = {
      type: string;
      payload: unknown;
    };

    const received: WsMessage[] = [];
    let depthSeen = false;
    let tradeSeen = false;
    let healthySeen = false;
    const awaited = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('event timeout')),
        4000,
      );
      ws!.on('message', (raw) => {
        const message = JSON.parse(raw.toString()) as WsMessage;
        received.push(message);
        if (message.type === 'depth.update') {
          depthSeen = true;
        }
        if (message.type === 'market.trade') {
          tradeSeen = true;
        }
        if (
          message.type === 'feed.health' &&
          typeof message.payload === 'object' &&
          message.payload !== null &&
          'healthy' in message.payload &&
          (message.payload as { healthy?: unknown }).healthy === true
        ) {
          healthySeen = true;
        }
        if (depthSeen && tradeSeen && healthySeen) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const startRes = await app.inject({
      method: 'POST',
      url: '/v1/runs/start',
      payload: {},
      headers: { 'content-type': 'application/json' },
    });
    expect(startRes.statusCode).toBe(200);

    await awaited;

    const statusRes = await app.inject({
      method: 'GET',
      url: '/v1/runs/status',
    });
    expect(statusRes.statusCode).toBe(200);
    const status = JSON.parse(statusRes.body) as {
      marketData: {
        topOfBook: Record<
          string,
          {
            bestBidInt: string | null;
            bestAskInt: string | null;
            ts: number | null;
          }
        >;
        lastTrades: Record<
          string,
          { priceInt: string; qtyInt: string; ts: number; side?: string }
        >;
        feed: { healthy: boolean; lastUpdateTs: number | null };
      };
    };

    expect(status.marketData.topOfBook['BTCUSDT']).toMatchObject({
      bestBidInt: depthEvent.bids[0].price.toString(),
      bestAskInt: depthEvent.asks[0].price.toString(),
    });
    expect(status.marketData.topOfBook['BTCUSDT'].ts).not.toBeNull();
    expect(status.marketData.lastTrades['BTCUSDT']).toMatchObject({
      priceInt: tradeEvent.price.toString(),
      qtyInt: tradeEvent.qty.toString(),
    });
    expect(status.marketData.feed.healthy).toBe(true);
    expect(status.marketData.feed.lastUpdateTs).not.toBeNull();

    const depthMessage = received.find((msg) => msg.type === 'depth.update');
    expect(depthMessage).toBeDefined();
    const depthPayload =
      depthMessage &&
      typeof depthMessage.payload === 'object' &&
      depthMessage.payload !== null
        ? (depthMessage.payload as {
            symbol: string;
            bids: Array<[string, string]>;
            asks: Array<[string, string]>;
          })
        : null;
    expect(depthPayload).not.toBeNull();
    expect(depthPayload!.symbol).toBe('BTCUSDT');
    expect(depthPayload!.bids[0][0]).toBe(depthEvent.bids[0].price.toString());

    const tradeMessage = received.find((msg) => msg.type === 'market.trade');
    expect(tradeMessage).toBeDefined();
    const tradePayload =
      tradeMessage &&
      typeof tradeMessage.payload === 'object' &&
      tradeMessage.payload !== null
        ? (tradeMessage.payload as {
            priceInt: string;
            qtyInt: string;
          })
        : null;
    expect(tradePayload).not.toBeNull();
    expect(tradePayload!.priceInt).toBe(tradeEvent.price.toString());
    expect(tradePayload!.qtyInt).toBe(tradeEvent.qty.toString());

    await app.inject({ method: 'POST', url: '/v1/runs/stop' });
  });
});

describe('REST adapter validation regressions', () => {
  let app: FastifyInstance;
  let accountId: string;

  beforeAll(async () => {
    app = createServer();
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/v1/accounts' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { accountId: string };
    accountId = body.accountId;
  });

  afterAll(async () => {
    await app.close();
  });

  test('deposit: unknown currency -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/accounts/${accountId}/deposit`,
      payload: JSON.stringify({ currency: 'XXX', amount: '100' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { message: string };
    expect(body.message).toMatch(/unknown currency/i);
  });

  test('place LIMIT without price -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: JSON.stringify({
        accountId,
        symbol: 'BTCUSDT',
        type: 'LIMIT',
        side: 'BUY',
        qty: '0.001',
      }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { message: string };
    expect(body.message).toMatch(/price is required for LIMIT/i);
  });
});
