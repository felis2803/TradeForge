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
type LimitReason = 'maxEvents' | 'maxSimTimeMs' | 'maxWallTimeMs';

type ClockWithDesc = { clock: SimClock; desc: string };

type RunConfig = {
  kind: ClockKind;
  reason: LimitReason;
  limits: ReplayLimits;
  acceleratedSpeed?: number;
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
    `run start kind=${config.kind} reason=${config.reason} clock=${desc}${formatLimits(
      config.limits,
    )}`,
  );

  const progress = await runReplay({
    timeline: createTimeline(),
    clock,
    limits: config.limits,
    onProgress: (stats: ReplayProgress) => {
      logger.progress(stats, config.kind);
    },
  });

  const result = {
    kind: config.kind,
    reason: config.reason,
    eventsOut: progress.eventsOut,
    wallMs: computeWallMs(progress),
    simMs: computeSimMs(progress),
  };

  logger.info(`run completed kind=${config.kind} events=${progress.eventsOut}`);
  console.log('LIMITS_SPEED_RESULT', result);
}

async function runAll(): Promise<void> {
  const runs: RunConfig[] = [
    {
      kind: 'logical',
      reason: 'maxEvents',
      limits: { maxEvents: 10 },
    },
    {
      kind: 'accelerated',
      reason: 'maxSimTimeMs',
      limits: { maxSimTimeMs: 2000 },
      acceleratedSpeed: 20,
    },
    {
      kind: 'wall',
      reason: 'maxWallTimeMs',
      limits: { maxWallTimeMs: 1200 },
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
