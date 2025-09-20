import {
  createEngine,
  type EngineEvents,
  type OrderView,
} from '@tradeforge/sim';
import type { FillEvent, RejectEvent } from '@tradeforge/sim';
import {
  ManualStream,
  TestOrderBook,
  flushMicrotasks,
  trade,
  depth,
} from './helpers.js';

function captureEvents() {
  const log: Array<{ type: keyof EngineEvents; payload: unknown }> = [];
  return {
    log,
    hook(engine: ReturnType<typeof createEngine>) {
      engine.on('orderAccepted', (order) =>
        log.push({ type: 'orderAccepted', payload: order }),
      );
      engine.on('orderUpdated', (order) =>
        log.push({ type: 'orderUpdated', payload: order }),
      );
      engine.on('orderFilled', (fill) =>
        log.push({ type: 'orderFilled', payload: fill }),
      );
      engine.on('orderCanceled', (order) =>
        log.push({ type: 'orderCanceled', payload: order }),
      );
      engine.on('orderRejected', (rej) =>
        log.push({ type: 'orderRejected', payload: rej }),
      );
      engine.on('tradeSeen', (t) =>
        log.push({ type: 'tradeSeen', payload: t }),
      );
    },
  };
}

describe('Engine integration', () => {
  async function createTestEngine(
    config?: Parameters<typeof createEngine>[0]['liquidity'],
  ) {
    const depthStream = new ManualStream<ReturnType<typeof depth>>();
    const tradeStream = new ManualStream<ReturnType<typeof trade>>();
    const book = new TestOrderBook();
    const engine = createEngine({
      streams: { trades: tradeStream, depth: depthStream },
      book,
      liquidity: config,
    });
    return { engine, depthStream, tradeStream, book };
  }

  it('AC-1: buy limit waits for qualifying trade', async () => {
    const { engine, depthStream, tradeStream } = await createTestEngine();
    const events = captureEvents();
    events.hook(engine);

    depthStream.push(depth(1, 1, [], [[100n, 5n]]));
    await flushMicrotasks();

    const orderId = engine.submitOrder({
      type: 'LIMIT',
      side: 'BUY',
      qty: 3n,
      price: 100n,
    });
    await flushMicrotasks();

    expect(events.log.filter((e) => e.type === 'orderFilled')).toHaveLength(0);

    tradeStream.push(trade('SELL', 99n, 1n, 2));
    await flushMicrotasks();

    const fills = events.log
      .filter((e) => e.type === 'orderFilled')
      .map((e) => e.payload as FillEvent);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ orderId, price: 100n, qty: 3n });

    await engine.close();
    depthStream.close();
    tradeStream.close();
  });

  it('AC-2: sell limit executes only on trade at or above price', async () => {
    const { engine, depthStream, tradeStream } = await createTestEngine();
    const events = captureEvents();
    events.hook(engine);

    depthStream.push(depth(1, 1, [[120n, 4n]], []));
    await flushMicrotasks();

    const orderId = engine.submitOrder({
      type: 'LIMIT',
      side: 'SELL',
      qty: 2n,
      price: 120n,
    });
    await flushMicrotasks();

    tradeStream.push(trade('BUY', 119n, 1n, 2));
    await flushMicrotasks();
    expect(events.log.filter((e) => e.type === 'orderFilled')).toHaveLength(0);

    tradeStream.push(trade('BUY', 120n, 1n, 3));
    await flushMicrotasks();

    const fills = events.log
      .filter((e) => e.type === 'orderFilled')
      .map((e) => e.payload as FillEvent);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ orderId, price: 120n, qty: 2n });

    await engine.close();
    depthStream.close();
    tradeStream.close();
  });

  it('AC-3: market executes immediately on available liquidity', async () => {
    const { engine, depthStream, tradeStream } = await createTestEngine();
    const events = captureEvents();
    events.hook(engine);

    depthStream.push(
      depth(
        1,
        1,
        [],
        [
          [100n, 5n],
          [101n, 5n],
        ],
      ),
    );
    await flushMicrotasks();

    const orderId = engine.submitOrder({
      type: 'MARKET',
      side: 'BUY',
      qty: 4n,
    });
    await flushMicrotasks();

    const fills = events.log
      .filter((e) => e.type === 'orderFilled')
      .map((e) => e.payload as FillEvent);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ orderId, price: 100n, qty: 4n });
    expect(events.log.some((e) => e.type === 'tradeSeen')).toBe(false);

    await engine.close();
    depthStream.close();
    tradeStream.close();
  });

  it('does not reuse consumed liquidity without new depth data', async () => {
    const { engine, depthStream, tradeStream } = await createTestEngine();
    const events = captureEvents();
    events.hook(engine);

    depthStream.push(depth(1, 1, [], [[100n, 1n]]));
    await flushMicrotasks();

    const firstOrder = engine.submitOrder({
      type: 'MARKET',
      side: 'BUY',
      qty: 1n,
    });
    await flushMicrotasks();

    const afterFirst = events.log
      .filter((e) => e.type === 'orderFilled')
      .map((e) => e.payload as FillEvent)
      .filter((f) => f.orderId === firstOrder);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toMatchObject({ price: 100n, qty: 1n });

    const secondOrder = engine.submitOrder({
      type: 'MARKET',
      side: 'BUY',
      qty: 1n,
    });
    await flushMicrotasks();

    const afterSecond = events.log
      .filter((e) => e.type === 'orderFilled')
      .map((e) => e.payload as FillEvent)
      .filter((f) => f.orderId === secondOrder);
    expect(afterSecond).toHaveLength(0);

    await engine.close();
    depthStream.close();
    tradeStream.close();
  });

  it('AC-4: market respects slippage window and keeps remainder', async () => {
    const { engine, depthStream, tradeStream } = await createTestEngine({
      maxSlippageLevels: 1,
      rejectOnExhaustedLiquidity: false,
    });
    const events = captureEvents();
    events.hook(engine);

    depthStream.push(
      depth(
        1,
        1,
        [],
        [
          [100n, 2n],
          [101n, 5n],
        ],
      ),
    );
    await flushMicrotasks();

    const orderId = engine.submitOrder({
      type: 'MARKET',
      side: 'BUY',
      qty: 4n,
    });
    await flushMicrotasks();

    const fills = events.log
      .filter((e) => e.type === 'orderFilled')
      .map((e) => e.payload as FillEvent);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ orderId, price: 100n, qty: 2n });

    const updates = events.log
      .filter((e) => e.type === 'orderUpdated')
      .map((e) => e.payload as OrderView)
      .filter((o) => o.id === orderId);
    expect(updates[updates.length - 1]).toMatchObject({
      status: 'PARTIALLY_FILLED',
      remainingQty: 2n,
    });

    await engine.close();
    depthStream.close();
    tradeStream.close();
  });

  it('rejects market remainder when configured', async () => {
    const { engine, depthStream, tradeStream } = await createTestEngine({
      maxSlippageLevels: 1,
      rejectOnExhaustedLiquidity: true,
    });
    const events = captureEvents();
    events.hook(engine);

    depthStream.push(depth(1, 1, [], [[100n, 1n]]));
    await flushMicrotasks();

    const orderId = engine.submitOrder({
      type: 'MARKET',
      side: 'BUY',
      qty: 3n,
    });
    await flushMicrotasks();

    const rejects = events.log
      .filter((e) => e.type === 'orderRejected')
      .map((e) => e.payload as RejectEvent);
    expect(rejects).toHaveLength(1);
    expect(rejects[0]).toMatchObject({ orderId, reason: 'NO_LIQUIDITY' });

    await engine.close();
    depthStream.close();
    tradeStream.close();
  });

  it('supports cancel before trade', async () => {
    const { engine, depthStream, tradeStream } = await createTestEngine();
    const events = captureEvents();
    events.hook(engine);

    depthStream.push(depth(1, 1, [], [[100n, 5n]]));
    await flushMicrotasks();

    const orderId = engine.submitOrder({
      type: 'LIMIT',
      side: 'BUY',
      qty: 3n,
      price: 100n,
    });
    await flushMicrotasks();

    const canceled = engine.cancelOrder(orderId);
    expect(canceled).toBe(true);
    await flushMicrotasks();

    tradeStream.push(trade('SELL', 99n, 1n, 2));
    await flushMicrotasks();

    const fills = events.log.filter((e) => e.type === 'orderFilled');
    expect(fills).toHaveLength(0);
    expect(events.log.some((e) => e.type === 'orderCanceled')).toBe(true);

    await engine.close();
    depthStream.close();
    tradeStream.close();
  });
});
