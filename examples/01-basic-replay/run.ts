import { basename, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  createAcceleratedClock,
  createLogicalClock,
  createMergedStream,
  createWallClock,
  runReplay,
  type CursorIterable as CoreCursorIterable,
  type DepthEvent,
  type MergeStartState,
  type MergedEvent,
  type ReplayLimits,
  type ReplayProgress,
  type SimClock,
  type TradeEvent,
} from '@tradeforge/core';
import {
  createJsonlCursorReader,
  type CursorIterable as JsonlCursor,
  type DepthDiff,
  type ReaderCursor,
  type Trade,
} from '@tradeforge/io-binance';
import { createLogger, formatProgress } from '../_shared/logging.js';

const logger = createLogger({ prefix: '[examples/01-basic-replay]' });

function parseList(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }
  const parts = value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return fallback;
  }
  return parts;
}

function ensureAbsolute(files: string[]): string[] {
  return files.map((file) => resolve(file));
}

function getEntry(cursor: ReaderCursor): string | undefined {
  if (cursor.entry && cursor.entry.trim().length > 0) {
    return cursor.entry;
  }
  return basename(cursor.file);
}

function wrapTrades(
  source: JsonlCursor<Trade>,
): CoreCursorIterable<TradeEvent> {
  return {
    currentCursor(): ReaderCursor {
      return source.currentCursor();
    },
    async *[Symbol.asyncIterator](): AsyncIterator<TradeEvent> {
      let lastKey: string | undefined;
      let seq = 0;
      for await (const payload of source) {
        const cursor = source.currentCursor();
        const key = `${cursor.file}::${cursor.entry ?? ''}`;
        if (key !== lastKey) {
          lastKey = key;
          seq = 0;
        }
        const event: TradeEvent = {
          kind: 'trade',
          ts: payload.ts,
          payload,
          source: 'TRADES',
          seq: seq++,
        };
        const entry = getEntry(cursor);
        if (entry) {
          event.entry = entry;
        }
        yield event;
      }
    },
  } satisfies CoreCursorIterable<TradeEvent>;
}

function wrapDepth(
  source: JsonlCursor<DepthDiff>,
): CoreCursorIterable<DepthEvent> {
  return {
    currentCursor(): ReaderCursor {
      return source.currentCursor();
    },
    async *[Symbol.asyncIterator](): AsyncIterator<DepthEvent> {
      let lastKey: string | undefined;
      let seq = 0;
      for await (const payload of source) {
        const cursor = source.currentCursor();
        const key = `${cursor.file}::${cursor.entry ?? ''}`;
        if (key !== lastKey) {
          lastKey = key;
          seq = 0;
        }
        const event: DepthEvent = {
          kind: 'depth',
          ts: payload.ts,
          payload,
          source: 'DEPTH',
          seq: seq++,
        };
        const entry = getEntry(cursor);
        if (entry) {
          event.entry = entry;
        }
        yield event;
      }
    },
  } satisfies CoreCursorIterable<DepthEvent>;
}

type ClockKind = 'logical' | 'wall' | 'accelerated';

type ParsedClock = {
  clock: SimClock;
  kind: ClockKind;
  desc: string;
};

function parseClock(value: string | undefined): ClockKind {
  const normalized = value?.toLowerCase();
  if (normalized === 'wall' || normalized === 'accelerated') {
    return normalized;
  }
  return 'logical';
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function buildClock(clock: ClockKind): ParsedClock {
  if (clock === 'wall') {
    const built = createWallClock();
    return { clock: built, kind: clock, desc: built.desc() };
  }
  if (clock === 'accelerated') {
    const speed = parsePositiveNumber(process.env['TF_SPEED']) ?? 20;
    const built = createAcceleratedClock(speed);
    return { clock: built, kind: clock, desc: built.desc() };
  }
  const built = createLogicalClock();
  return { clock: built, kind: 'logical', desc: built.desc() };
}

function parseTieBreak(value: string | undefined): 'DEPTH' | 'TRADES' {
  const normalized = value?.trim().toUpperCase();
  if (normalized === 'TRADES') {
    return 'TRADES';
  }
  return 'DEPTH';
}

function parseMaxEvents(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 200;
  }
  return Math.floor(parsed);
}

function parseMilliseconds(value: string | undefined): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function buildLimits(): ReplayLimits {
  const limits: ReplayLimits = {
    maxEvents: parseMaxEvents(process.env['TF_MAX_EVENTS']),
  };
  const maxSim = parseMilliseconds(process.env['TF_MAX_SIM_MS']);
  if (maxSim !== undefined) {
    limits.maxSimTimeMs = maxSim;
  }
  const maxWall = parseMilliseconds(process.env['TF_MAX_WALL_MS']);
  if (maxWall !== undefined) {
    limits.maxWallTimeMs = maxWall;
  }
  return limits;
}

function formatList(label: string, items: string[]): string {
  return `${label}=${items.join(', ')}`;
}

function formatLimits(limits: ReplayLimits): string {
  const parts: string[] = [];
  if (limits.maxEvents !== undefined) {
    parts.push(`events<=${limits.maxEvents}`);
  }
  if (limits.maxSimTimeMs !== undefined) {
    parts.push(`sim<=${limits.maxSimTimeMs}ms`);
  }
  if (limits.maxWallTimeMs !== undefined) {
    parts.push(`wall<=${limits.maxWallTimeMs}ms`);
  }
  return parts.length > 0 ? parts.join(', ') : 'no limits';
}

function defaultFileList(): { trades: string[]; depth: string[] } {
  const trades = parseList(process.env['TF_TRADES_FILES'], [
    'examples/_smoke/mini-trades.jsonl',
  ]);
  const depth = parseList(process.env['TF_DEPTH_FILES'], [
    'examples/_smoke/mini-depth.jsonl',
  ]);
  return { trades: ensureAbsolute(trades), depth: ensureAbsolute(depth) };
}

export async function run(): Promise<ReplayProgress> {
  const { trades, depth } = defaultFileList();
  logger.info(
    [formatList('trades', trades), formatList('depth', depth)].join(' | '),
  );

  const tradeReader = wrapTrades(
    createJsonlCursorReader({ kind: 'trades', files: trades }),
  );
  const depthReader = wrapDepth(
    createJsonlCursorReader({ kind: 'depth', files: depth }),
  );

  const tieBreak = parseTieBreak(process.env['TF_TIE_BREAK']);
  const mergeStart: MergeStartState = { nextSourceOnEqualTs: tieBreak };
  const preferDepth = tieBreak !== 'TRADES';
  const timeline: AsyncIterable<MergedEvent> = createMergedStream(
    tradeReader,
    depthReader,
    mergeStart,
    { preferDepthOnEqualTs: preferDepth },
  );

  const clock = buildClock(parseClock(process.env['TF_CLOCK']));
  const limits = buildLimits();
  logger.info(
    `clock=${clock.desc} (${clock.kind}) tieBreak=${tieBreak} limits=${formatLimits(limits)}`,
  );

  const progress = await runReplay({
    timeline,
    clock: clock.clock,
    limits,
    onProgress: (stats: ReplayProgress) => {
      logger.progress(stats);
    },
  });

  logger.info(`completed ${formatProgress(progress)}`);
  return progress;
}

async function main(): Promise<void> {
  try {
    const progress = await run();
    const wallMs = Math.max(0, progress.wallLastMs - progress.wallStartMs);
    const simMs =
      progress.simStartTs !== undefined && progress.simLastTs !== undefined
        ? Math.max(0, Number(progress.simLastTs) - Number(progress.simStartTs))
        : undefined;
    const marker: Record<string, number> & { simMs?: number } = {
      eventsOut: progress.eventsOut,
      wallMs,
    };
    if (simMs !== undefined) {
      marker.simMs = simMs;
    }
    console.log('BASIC_REPLAY_OK', marker);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('BASIC_REPLAY_FAILED', message);
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

const invokedFromCli =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedFromCli) {
  void main();
}
