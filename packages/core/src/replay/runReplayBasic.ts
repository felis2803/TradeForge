import type { ReplayStats, RunReplayBasicOptions } from './types.js';

export async function runReplayBasic({
  timeline,
  clock,
  limits,
  onEvent,
}: RunReplayBasicOptions): Promise<ReplayStats> {
  const maxEvents = limits?.maxEvents ?? Number.POSITIVE_INFINITY;
  const maxSimTimeMs = limits?.maxSimTimeMs ?? Number.POSITIVE_INFINITY;
  const maxWallTimeMs = limits?.maxWallTimeMs ?? Number.POSITIVE_INFINITY;
  const stats: ReplayStats = {
    eventsOut: 0,
    wallStartMs: clock.now(),
    wallLastMs: clock.now(),
  };

  for await (const event of timeline) {
    if (stats.eventsOut >= maxEvents) {
      break;
    }

    if (
      stats.simStartTs !== undefined &&
      stats.simLastTs !== undefined &&
      Number(stats.simLastTs) - Number(stats.simStartTs) >= maxSimTimeMs
    ) {
      break;
    }

    const now = clock.now();
    stats.wallLastMs = now;
    if (now - stats.wallStartMs >= maxWallTimeMs) {
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

    if (stats.simStartTs === undefined) {
      stats.simStartTs = simStartValue;
    }
    stats.simLastTs = event.ts;

    onEvent?.(event, stats);
    stats.eventsOut += 1;
  }

  stats.wallLastMs = clock.now();
  return stats;
}
