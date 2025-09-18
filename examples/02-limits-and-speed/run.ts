import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  createAcceleratedClock,
  createLogicalClock,
  createWallClock,
  runReplay,
  type MergedEvent,
  type ReplayLimits,
  type ReplayProgress,
  type SimClock,
} from '@tradeforge/core';
import { createLogger } from '../_shared/logging.js';
import { buildDepthReader, buildTradesReader } from '../_shared/readers.js';
import { buildMerged } from '../_shared/merge.js';

const logger = createLogger({ prefix: '[examples/02-limits-and-speed]' });

const DATA_ROOT = resolve(process.cwd(), 'examples', '_smoke');
const TRADES_FILE = resolve(DATA_ROOT, 'mini-trades.jsonl');
const DEPTH_FILE = resolve(DATA_ROOT, 'mini-depth.jsonl');

type ClockKind = 'logical' | 'accelerated' | 'wall';
type ClockWithDesc = { clock: SimClock; desc: string };

type StopReason = 'maxEvents' | 'maxSimTimeMs' | 'maxWallTimeMs' | 'completed';

type RunConfig = {
  kind: ClockKind;
  limits: ReplayLimits;
  acceleratedSpeed?: number;
  expectedStop?: Exclude<StopReason, 'completed'>;
};

function formatLimits(limits?: ReplayLimits): string {
  if (!limits) return '';
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
  return parts.length > 0 ? ` limits(${parts.join(', ')})` : '';
}

function computeWallMs(progress: ReplayProgress): number {
  return Math.max(0, progress.wallLastMs - progress.wallStartMs);
}

function computeSimMs(progress: ReplayProgress): number {
  if (progress.simStartTs === undefined || progress.simLastTs === undefined) {
    return 0;
  }
  const start = Number(progress.simStartTs);
  const end = Number(progress.simLastTs);
  return Math.max(0, end - start);
}

type StopFlags = Partial<
  Record<'maxEvents' | 'maxSimTimeMs' | 'maxWallTimeMs', boolean>
>;

function detectStoppedBy(
  progress: ReplayProgress,
  limits: ReplayLimits | undefined,
  wallMs: number,
  simMs: number,
): StopFlags {
  if (!limits) {
    return {};
  }
  const flags: StopFlags = {};
  if (
    limits.maxEvents !== undefined &&
    progress.eventsOut >= limits.maxEvents
  ) {
    flags.maxEvents = true;
  }
  if (limits.maxSimTimeMs !== undefined && simMs >= limits.maxSimTimeMs) {
    flags.maxSimTimeMs = true;
  }
  if (limits.maxWallTimeMs !== undefined && wallMs >= limits.maxWallTimeMs) {
    flags.maxWallTimeMs = true;
  }
  return flags;
}

function buildClock(kind: ClockKind, speed?: number): ClockWithDesc {
  if (kind === 'logical') {
    const clock = createLogicalClock();
    return { clock, desc: clock.desc() };
  }
  if (kind === 'wall') {
    const clock = createWallClock();
    return { clock, desc: clock.desc() };
  }
  const accelSpeed = speed ?? 20;
  const clock = createAcceleratedClock(accelSpeed);
  return { clock, desc: clock.desc() };
}

function createTimeline(): AsyncIterable<MergedEvent> {
  const trades = buildTradesReader([TRADES_FILE]);
  const depth = buildDepthReader([DEPTH_FILE]);
  return buildMerged(trades, depth);
}

async function runOnce(config: RunConfig): Promise<void> {
  const { clock, desc } = buildClock(config.kind, config.acceleratedSpeed);
  logger.info(
    `run start kind=${config.kind} clock=${desc}${formatLimits(
      config.limits,
    )}${config.expectedStop ? ` expectedStop=${config.expectedStop}` : ''}`,
  );

  const progress = await runReplay({
    timeline: createTimeline(),
    clock,
    limits: config.limits,
    onProgress: (stats: ReplayProgress) => {
      logger.progress(stats, config.kind);
    },
  });

  const wallMs = computeWallMs(progress);
  const simMs = computeSimMs(progress);
  const stoppedBy = detectStoppedBy(progress, config.limits, wallMs, simMs);
  const result = {
    kind: config.kind,
    eventsOut: progress.eventsOut,
    wallMs,
    simMs,
    stoppedBy,
  };

  logger.info(`run completed kind=${config.kind} events=${progress.eventsOut}`);
  const reason: StopReason = result.stoppedBy?.maxEvents
    ? 'maxEvents'
    : result.stoppedBy?.maxSimTimeMs
      ? 'maxSimTimeMs'
      : result.stoppedBy?.maxWallTimeMs
        ? 'maxWallTimeMs'
        : 'completed';
  console.log('LIMITS', { reason, eventsOut: result.eventsOut, wallMs, simMs });
  console.log('LIMITS_SPEED_RESULT', { ...result, reason });
}

async function runAll(): Promise<void> {
  const runs: RunConfig[] = [
    {
      kind: 'logical',
      limits: { maxEvents: 10 },
      expectedStop: 'maxEvents',
    },
    {
      kind: 'accelerated',
      limits: { maxSimTimeMs: 2000 },
      acceleratedSpeed: 20,
      expectedStop: 'maxSimTimeMs',
    },
    {
      kind: 'wall',
      limits: { maxWallTimeMs: 1200 },
      expectedStop: 'maxWallTimeMs',
    },
  ];

  logger.info(`using trades=${TRADES_FILE}`);
  logger.info(`using depth=${DEPTH_FILE}`);

  for (const config of runs) {
    await runOnce(config);
  }

  console.log('LIMITS_SPEED_OK');
}

async function main(): Promise<void> {
  try {
    await runAll();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('LIMITS_SPEED_FAILED', message);
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

export { runAll };
