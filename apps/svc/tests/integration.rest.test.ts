import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';

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
    expect(body.status).toBe('REJECTED');
    expect(body.rejectReason).toBe('UNSUPPORTED_EXECUTION');
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
