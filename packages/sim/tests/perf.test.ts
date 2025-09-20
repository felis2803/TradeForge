import { createEngine } from '@tradeforge/sim';
import {
  ManualStream,
  TestOrderBook,
  flushMicrotasks,
  depth,
  trade,
} from './helpers.js';

const EVENT_COUNT = 5000;
const SOFT_LIMIT_MS = 5000;

describe('performance (soft)', () => {
  it('processes a burst of events within the soft budget', async () => {
    const depthStream = new ManualStream<ReturnType<typeof depth>>();
    const tradeStream = new ManualStream<ReturnType<typeof trade>>();
    const book = new TestOrderBook();
    const engine = createEngine({
      streams: { trades: tradeStream, depth: depthStream },
      book,
      liquidity: { maxSlippageLevels: 5, rejectOnExhaustedLiquidity: false },
    });

    const started = Date.now();
    for (let i = 0; i < EVENT_COUNT; i += 1) {
      depthStream.push(depth(100 + i, i, [[99n, 3n]], [[101n, 3n]]));
      tradeStream.push(trade(i % 2 === 0 ? 'BUY' : 'SELL', 100n, 1n, 200 + i));
    }

    for (let i = 0; i < 5; i += 1) {
      await flushMicrotasks();
    }

    await engine.close();
    const finished = Date.now();
    const duration = finished - started;

    expect(duration).toBeLessThan(SOFT_LIMIT_MS);
  });
});
