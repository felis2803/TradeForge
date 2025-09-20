import { createEngine } from '@tradeforge/sim';
import type { EngineEvents } from '@tradeforge/sim';
import {
  ManualStream,
  TestOrderBook,
  flushMicrotasks,
  depth,
  trade,
} from './helpers.js';

interface RecordedEvent {
  type: keyof EngineEvents;
  payload: unknown;
}

function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => [k, normalize(v)],
    );
    return Object.fromEntries(entries);
  }
  return value;
}

async function runScenario(): Promise<RecordedEvent[]> {
  const depthStream = new ManualStream<ReturnType<typeof depth>>();
  const tradeStream = new ManualStream<ReturnType<typeof trade>>();
  const book = new TestOrderBook();
  const engine = createEngine({
    streams: { trades: tradeStream, depth: depthStream },
    book,
    liquidity: { maxSlippageLevels: 2, rejectOnExhaustedLiquidity: false },
  });

  const events: RecordedEvent[] = [];
  const record = <E extends keyof EngineEvents>(
    type: E,
    payload: Parameters<EngineEvents[E]>[0],
  ) => {
    events.push({ type, payload: normalize(payload) });
  };

  engine.on('orderAccepted', (o) => record('orderAccepted', o));
  engine.on('orderUpdated', (o) => record('orderUpdated', o));
  engine.on('orderFilled', (f) => record('orderFilled', f));
  engine.on('orderCanceled', (o) => record('orderCanceled', o));
  engine.on('orderRejected', (r) => record('orderRejected', r));
  engine.on('tradeSeen', (t) => record('tradeSeen', t));

  depthStream.push(
    depth(
      1,
      1,
      [[99n, 4n]],
      [
        [101n, 5n],
        [102n, 5n],
      ],
    ),
  );
  await flushMicrotasks();

  const limitBuy = engine.submitOrder({
    type: 'LIMIT',
    side: 'BUY',
    qty: 3n,
    price: 101n,
  });
  await flushMicrotasks();
  engine.submitOrder({ type: 'LIMIT', side: 'SELL', qty: 2n, price: 100n });
  await flushMicrotasks();
  engine.submitOrder({ type: 'MARKET', side: 'BUY', qty: 4n });
  await flushMicrotasks();

  tradeStream.push(trade('SELL', 100n, 1n, 2));
  await flushMicrotasks();
  tradeStream.push(trade('BUY', 101n, 1n, 3));
  await flushMicrotasks();

  depthStream.push(depth(4, 2, [[100n, 4n]], [[101n, 3n]]));
  await flushMicrotasks();

  engine.cancelOrder(limitBuy);
  await flushMicrotasks();

  await engine.close();
  depthStream.close();
  tradeStream.close();

  return events;
}

describe('determinism', () => {
  it('produces identical event sequence for repeated runs', async () => {
    const first = await runScenario();
    const second = await runScenario();
    expect(second).toEqual(first);
  });
});
