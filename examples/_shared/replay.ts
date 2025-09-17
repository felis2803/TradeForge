import {
  createAcceleratedClock,
  createLogicalClock,
  createWallClock,
  runReplay,
  type CheckpointV1,
  type MergedEvent,
  type ReplayController,
  type ReplayLimits,
  type ReplayProgress,
  type SimClock,
} from '@tradeforge/core';
import { createLogger, type Logger } from './logging.js';

export type ClockKind = 'logical' | 'wall' | 'accelerated';

export interface RunScenarioOptions {
  timeline: AsyncIterable<MergedEvent>;
  clock: ClockKind;
  limits?: ReplayLimits;
  autoCp?: {
    savePath?: string;
    cpIntervalEvents?: number;
    cpIntervalWallMs?: number;
    buildCheckpoint?: () => Promise<CheckpointV1>;
  };
  pauseOnStart?: boolean;
  controller?: ReplayController;
  logger?: Logger;
  onEvent?: (
    event: MergedEvent,
    progress: ReplayProgress,
  ) => Promise<void> | void;
  onProgress?: (progress: ReplayProgress) => void;
  acceleratedSpeed?: number;
}

function parseSpeed(value?: string): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return undefined;
  }
  return num;
}

function buildClock(
  kind: ClockKind,
  requestedSpeed?: number,
): { clock: SimClock; desc: string } {
  if (kind === 'logical') {
    const clock = createLogicalClock();
    return { clock, desc: clock.desc() };
  }
  if (kind === 'wall') {
    const clock = createWallClock();
    return { clock, desc: clock.desc() };
  }
  const envSpeed = parseSpeed(process.env['TF_ACCELERATED_SPEED']);
  const speed = requestedSpeed ?? envSpeed ?? 10;
  const clock = createAcceleratedClock(speed);
  return { clock, desc: clock.desc() };
}

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

export async function runScenario(
  options: RunScenarioOptions,
): Promise<ReplayProgress> {
  const logger = options.logger ?? createLogger();
  const { clock, desc } = buildClock(options.clock, options.acceleratedSpeed);
  logger.info(`replay start (clock=${desc})${formatLimits(options.limits)}`);

  const controller = options.controller;
  if (options.pauseOnStart) {
    if (controller) {
      controller.pause();
      logger.info(
        'replay controller paused on start — call controller.resume() to continue',
      );
    } else {
      logger.warn(
        'pauseOnStart requested but no controller provided; continuing without pause',
      );
    }
  }

  let lastEvents = -1;
  const autoCp = options.autoCp ? { ...options.autoCp } : undefined;
  const hasAutoSave = Boolean(autoCp?.savePath);

  const replayOptions: Parameters<typeof runReplay>[0] = {
    timeline: options.timeline,
    clock,
    onProgress: (stats: ReplayProgress) => {
      options.onProgress?.(stats);
      if (stats.eventsOut !== lastEvents) {
        lastEvents = stats.eventsOut;
        logger.progress(stats);
      } else if (hasAutoSave && autoCp?.savePath) {
        logger.autoCheckpoint(autoCp.savePath, stats);
      }
    },
  };
  if (options.limits) {
    replayOptions.limits = options.limits;
  }
  if (controller) {
    replayOptions.controller = controller;
  }
  if (options.onEvent) {
    replayOptions.onEvent = options.onEvent;
  }
  if (autoCp) {
    replayOptions.autoCp = autoCp;
  }

  const progress = await runReplay(replayOptions);

  logger.progress(progress, 'completed');
  return progress;
}
