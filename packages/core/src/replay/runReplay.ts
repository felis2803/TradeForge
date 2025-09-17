import { saveCheckpoint } from './checkpoint.js';
import type { CheckpointV1 } from './checkpoint.js';
import type {
  AutoCheckpointOpts,
  ReplayController,
  ReplayProgress,
  RunReplayOptions,
} from './types.js';

function normalizeEventInterval(value?: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  const floored = Math.floor(value);
  if (floored <= 0) return undefined;
  return Math.max(1, floored);
}

function normalizeWallInterval(value?: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value > 0 ? value : undefined;
}

function hasAutoCheckpoint(opts?: AutoCheckpointOpts):
  | (AutoCheckpointOpts & {
      savePath: string;
      buildCheckpoint: () => Promise<CheckpointV1>;
    })
  | undefined {
  if (!opts || !opts.savePath || !opts.buildCheckpoint) {
    return undefined;
  }
  return opts as AutoCheckpointOpts & {
    savePath: string;
    buildCheckpoint: () => Promise<CheckpointV1>;
  };
}

async function waitForResume(controller: ReplayController): Promise<void> {
  if (!controller.isPaused()) {
    return;
  }
  await controller.waitUntilResumed();
}

export async function runReplay({
  timeline,
  clock,
  limits,
  controller,
  onEvent,
  onProgress,
  autoCp,
}: RunReplayOptions): Promise<ReplayProgress> {
  const maxEvents = limits?.maxEvents ?? Number.POSITIVE_INFINITY;
  const maxSimTimeMs = limits?.maxSimTimeMs ?? Number.POSITIVE_INFINITY;
  const maxWallTimeMs = limits?.maxWallTimeMs ?? Number.POSITIVE_INFINITY;
  const stats: ReplayProgress = {
    eventsOut: 0,
    wallStartMs: clock.now(),
    wallLastMs: clock.now(),
  };

  const normalizedAuto = hasAutoCheckpoint(autoCp);
  const eventInterval = normalizeEventInterval(autoCp?.cpIntervalEvents);
  const wallInterval = normalizeWallInterval(autoCp?.cpIntervalWallMs);
  let nextCheckpointByEvents =
    normalizedAuto && eventInterval !== undefined ? eventInterval : undefined;
  let nextCheckpointByWall =
    normalizedAuto && wallInterval !== undefined
      ? stats.wallStartMs + wallInterval
      : undefined;

  for await (const event of timeline) {
    if (stats.eventsOut >= maxEvents) {
      break;
    }

    const now = clock.now();
    stats.wallLastMs = now;
    if (now - stats.wallStartMs >= maxWallTimeMs) {
      break;
    }

    if (
      stats.simStartTs !== undefined &&
      stats.simLastTs !== undefined &&
      Number(stats.simLastTs) - Number(stats.simStartTs) >= maxSimTimeMs
    ) {
      break;
    }

    const simStartValue = stats.simStartTs ?? event.ts;
    const simElapsed = Math.max(0, Number(event.ts) - Number(simStartValue));
    const wallTarget = stats.wallStartMs + simElapsed;

    if (wallTarget - stats.wallStartMs > maxWallTimeMs) {
      break;
    }

    await clock.tickUntil(wallTarget);
    stats.wallLastMs = clock.now();

    if (stats.wallLastMs - stats.wallStartMs > maxWallTimeMs) {
      break;
    }

    if (controller && controller.isPaused()) {
      await waitForResume(controller);
      stats.wallLastMs = clock.now();
      if (stats.wallLastMs - stats.wallStartMs > maxWallTimeMs) {
        break;
      }
    }

    if (stats.simStartTs === undefined) {
      stats.simStartTs = simStartValue;
    }
    stats.simLastTs = event.ts;

    if (onEvent) {
      await onEvent(event, stats);
    }

    stats.eventsOut += 1;

    if (onProgress) {
      onProgress(stats);
    }

    if (normalizedAuto) {
      let savesPlanned = 0;
      if (
        nextCheckpointByEvents !== undefined &&
        eventInterval !== undefined &&
        stats.eventsOut >= nextCheckpointByEvents
      ) {
        savesPlanned = 1;
        nextCheckpointByEvents += eventInterval;
      }

      if (nextCheckpointByWall !== undefined && wallInterval !== undefined) {
        let wallTriggers = 0;
        while (stats.wallLastMs >= nextCheckpointByWall) {
          wallTriggers += 1;
          nextCheckpointByWall += wallInterval;
        }
        if (wallTriggers > savesPlanned) {
          savesPlanned = wallTriggers;
        }
      }

      if (savesPlanned > 0) {
        for (let i = 0; i < savesPlanned; i += 1) {
          try {
            const checkpoint = await normalizedAuto.buildCheckpoint();
            await saveCheckpoint(normalizedAuto.savePath, checkpoint);
            if (onProgress) {
              onProgress(stats);
            }
          } catch (err) {
            console.warn(
              `runReplay: failed to auto-save checkpoint to ${normalizedAuto.savePath}`,
              err,
            );
            break;
          }
        }
        const nowAfterCp = clock.now();
        if (nowAfterCp > stats.wallLastMs) {
          stats.wallLastMs = nowAfterCp;
        }
      }
    }
  }

  stats.wallLastMs = clock.now();
  return stats;
}
