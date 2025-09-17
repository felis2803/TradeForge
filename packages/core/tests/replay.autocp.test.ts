import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as checkpointModule from '../src/replay/checkpoint.js';
import {
  runReplay,
  type CheckpointV1,
  type MergedEvent,
  type PriceInt,
  type QtyInt,
  type ReplayProgress,
  type SimClock,
  type SymbolId,
  type TimestampMs,
} from '../src/index';

type AutoProgressLog = number[];

const SYMBOL = 'TEST' as SymbolId;
const ZERO_PRICE = 0n as PriceInt;
const ZERO_QTY = 0n as QtyInt;

class ManualClock implements SimClock {
  #now: number;

  constructor(start = 0) {
    this.#now = start;
  }

  desc(): string {
    return 'manual';
  }

  now(): number {
    return this.#now;
  }

  async tickUntil(target: number): Promise<void> {
    if (target > this.#now) {
      this.#now = target;
    }
  }
}

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

function createDummyCheckpoint(): CheckpointV1 {
  return {
    version: 1,
    createdAtMs: Date.now(),
    meta: { symbol: SYMBOL },
    cursors: {},
    merge: {},
    engine: { openOrderIds: [], stopOrderIds: [] },
    state: {
      config: {
        symbols: {},
        fee: { makerBps: 0, takerBps: 0 },
        counters: { accountSeq: 0, orderSeq: 0, tsCounter: 0 },
      },
      accounts: {},
      orders: {},
    },
  } satisfies CheckpointV1;
}

function collectRepeatedProgressValues(logs: AutoProgressLog): number {
  return logs.reduce((count, value, index) => {
    if (index === 0) return count;
    return logs[index - 1] === value ? count + 1 : count;
  }, 0);
}

describe('runReplay auto-checkpoints', () => {
  it('saves checkpoint after configured number of events', async () => {
    const events = Array.from({ length: 9 }, (_, idx) =>
      tradeEvent(1_000 + idx * 100, idx + 1),
    );
    const tempDir = await mkdtemp(join(tmpdir(), 'tf-autocp-events-'));
    const savePath = join(tempDir, 'cp.json');
    const buildSpy = jest.fn(async () => createDummyCheckpoint());
    const progressLog: AutoProgressLog = [];

    try {
      const stats = await runReplay({
        timeline: timelineFrom(events),
        clock: new ManualClock(0),
        autoCp: {
          savePath,
          cpIntervalEvents: 3,
          buildCheckpoint: buildSpy,
        },
        onProgress: (progress: ReplayProgress) => {
          progressLog.push(progress.eventsOut);
        },
      });

      expect(stats.eventsOut).toBe(events.length);
      expect(buildSpy).toHaveBeenCalledTimes(3);
      expect(collectRepeatedProgressValues(progressLog)).toBe(3);

      const raw = await readFile(savePath, 'utf8');
      const parsed = JSON.parse(raw) as CheckpointV1;
      expect(parsed.version).toBe(1);
      expect(parsed.meta.symbol).toBe(String(SYMBOL));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('saves checkpoint based on wall time interval', async () => {
    const events = [
      tradeEvent(1_000, 1),
      tradeEvent(1_100, 2),
      tradeEvent(1_300, 3),
      tradeEvent(1_600, 4),
      tradeEvent(1_900, 5),
    ];
    const tempDir = await mkdtemp(join(tmpdir(), 'tf-autocp-wall-'));
    const savePath = join(tempDir, 'cp.json');
    const buildSpy = jest.fn(async () => createDummyCheckpoint());

    try {
      const stats = await runReplay({
        timeline: timelineFrom(events),
        clock: new ManualClock(0),
        autoCp: {
          savePath,
          cpIntervalWallMs: 200,
          buildCheckpoint: buildSpy,
        },
      });

      expect(stats.eventsOut).toBe(events.length);
      expect(buildSpy).toHaveBeenCalledTimes(4);

      const raw = await readFile(savePath, 'utf8');
      const parsed = JSON.parse(raw) as CheckpointV1;
      expect(parsed.meta.symbol).toBe(String(SYMBOL));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('logs a warning and continues when save fails', async () => {
    const events = [
      tradeEvent(1_000, 1),
      tradeEvent(1_200, 2),
      tradeEvent(1_400, 3),
      tradeEvent(1_600, 4),
    ];
    const buildSpy = jest.fn(async () => createDummyCheckpoint());
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const saveSpy = jest
      .spyOn(checkpointModule, 'saveCheckpoint')
      .mockRejectedValue(new Error('disk full'));

    try {
      const stats = await runReplay({
        timeline: timelineFrom(events),
        clock: new ManualClock(0),
        autoCp: {
          savePath: join(tmpdir(), 'should-not-exist.json'),
          cpIntervalEvents: 2,
          buildCheckpoint: buildSpy,
        },
      });

      expect(stats.eventsOut).toBe(events.length);
      expect(buildSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      saveSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('stops when wall time limit is reached', async () => {
    const events = Array.from({ length: 6 }, (_, idx) =>
      tradeEvent(1_000 + idx * 150, idx + 1),
    );
    const tempDir = await mkdtemp(join(tmpdir(), 'tf-autocp-limit-'));
    const savePath = join(tempDir, 'cp.json');
    const buildSpy = jest.fn(async () => createDummyCheckpoint());

    try {
      const stats = await runReplay({
        timeline: timelineFrom(events),
        clock: new ManualClock(0),
        limits: { maxWallTimeMs: 350 },
        autoCp: {
          savePath,
          cpIntervalEvents: 2,
          buildCheckpoint: buildSpy,
        },
      });

      expect(stats.eventsOut).toBeLessThan(events.length);
      expect(buildSpy).toHaveBeenCalledTimes(1);

      const raw = await readFile(savePath, 'utf8');
      const parsed = JSON.parse(raw) as CheckpointV1;
      expect(parsed.version).toBe(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
