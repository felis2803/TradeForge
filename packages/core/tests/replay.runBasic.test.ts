import {
  createAcceleratedClock,
  createLogicalClock,
  createWallClock,
  runReplayBasic,
  type MergedEvent,
  type PriceInt,
  type QtyInt,
  type ReplayStats,
  type SymbolId,
  type TimestampMs,
} from '../src/index';

const SYMBOL = 'TEST' as SymbolId;
const ZERO_PRICE = 0n as PriceInt;
const ZERO_QTY = 0n as QtyInt;

function tradeEvent(ts: number, seq = ts): MergedEvent {
  const tsMs = ts as TimestampMs;
  return {
    kind: 'trade',
    ts: tsMs,
    source: 'TRADES',
    seq,
    payload: {
      ts: tsMs,
      symbol: SYMBOL,
      price: ZERO_PRICE,
      qty: ZERO_QTY,
    },
  } satisfies MergedEvent;
}

function timelineFrom(events: MergedEvent[]): AsyncIterable<MergedEvent> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<MergedEvent> {
      for (const event of events) {
        yield event;
      }
    },
  };
}

async function resolveWithTimers(
  promise: Promise<ReplayStats>,
  stepMs: number,
  maxSteps = 10_000,
): Promise<ReplayStats> {
  let resolved = false;
  promise.then(() => {
    resolved = true;
  });
  let steps = 0;
  while (!resolved) {
    if (steps++ >= maxSteps) {
      throw new Error('timers did not resolve within expected bounds');
    }
    jest.advanceTimersByTime(stepMs);
    await Promise.resolve();
  }
  return promise;
}

describe('runReplayBasic', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('stops after reaching maxEvents', async () => {
    const events = Array.from({ length: 8 }, (_, idx) =>
      tradeEvent(1_000 + idx * 100),
    );
    const processed: number[] = [];
    const stats = await runReplayBasic({
      timeline: timelineFrom(events),
      clock: createLogicalClock(),
      limits: { maxEvents: 5 },
      onEvent: (event) => {
        processed.push(Number(event.ts));
      },
    });
    expect(processed).toHaveLength(5);
    expect(stats.eventsOut).toBe(5);
    expect(stats.simStartTs).toBe(events[0]?.ts);
    expect(stats.simLastTs).toBe(events[4]?.ts);
  });

  it('enforces maxSimTimeMs using logical clock', async () => {
    const events = [
      tradeEvent(1_000),
      tradeEvent(1_300),
      tradeEvent(1_600),
      tradeEvent(2_400),
    ];
    const processed: number[] = [];
    const stats = await runReplayBasic({
      timeline: timelineFrom(events),
      clock: createLogicalClock(),
      limits: { maxSimTimeMs: 600 },
      onEvent: (event) => {
        processed.push(Number(event.ts));
      },
    });
    expect(processed).toEqual([1_000, 1_300, 1_600]);
    expect(stats.eventsOut).toBe(3);
    expect(stats.simStartTs).toBe(events[0]?.ts);
    expect(stats.simLastTs).toBe(events[2]?.ts);
  });

  it('stops when wall time limit is reached', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const events = [
      tradeEvent(1_000),
      tradeEvent(1_100),
      tradeEvent(1_200),
      tradeEvent(1_300),
    ];
    const processed: number[] = [];
    const statsPromise = runReplayBasic({
      timeline: timelineFrom(events),
      clock: createWallClock(),
      limits: { maxWallTimeMs: 150 },
      onEvent: (event) => {
        processed.push(Number(event.ts));
      },
    });
    await Promise.resolve();
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    const stats = await statsPromise;
    expect(processed).toEqual([1_000, 1_100]);
    expect(stats.eventsOut).toBe(2);
    expect(stats.simLastTs).toBe(events[1]?.ts);
    expect(stats.wallLastMs - stats.wallStartMs).toBeLessThanOrEqual(150);
  });

  it('accelerated clock completes faster than wall clock', async () => {
    jest.useFakeTimers();
    const events = [tradeEvent(1_000), tradeEvent(2_000), tradeEvent(3_000)];

    jest.setSystemTime(0);
    const wallStatsPromise = runReplayBasic({
      timeline: timelineFrom(events),
      clock: createWallClock(),
    });
    const wallStats = await resolveWithTimers(wallStatsPromise, 100);

    jest.setSystemTime(0);
    jest.clearAllTimers();
    const accelStatsPromise = runReplayBasic({
      timeline: timelineFrom(events),
      clock: createAcceleratedClock(10),
    });
    const accelStats = await resolveWithTimers(accelStatsPromise, 10);

    expect(accelStats.eventsOut).toBe(wallStats.eventsOut);
    expect(
      Number(accelStats.simLastTs ?? 0) - Number(accelStats.simStartTs ?? 0),
    ).toBe(
      Number(wallStats.simLastTs ?? 0) - Number(wallStats.simStartTs ?? 0),
    );
    expect(accelStats.wallLastMs - accelStats.wallStartMs).toBeLessThan(
      wallStats.wallLastMs - wallStats.wallStartMs,
    );
  });

  it('returns initial stats when no events are emitted', async () => {
    const stats = await runReplayBasic({
      timeline: timelineFrom([]),
      clock: createLogicalClock(),
    });
    expect(stats.eventsOut).toBe(0);
    expect(stats.simStartTs).toBeUndefined();
    expect(stats.simLastTs).toBeUndefined();
    expect(stats.wallLastMs).toBeGreaterThanOrEqual(stats.wallStartMs);
  });
});
