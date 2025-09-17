import { type SimClock } from './types.js';

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createLogicalClock(): SimClock {
  return {
    desc(): string {
      return 'logical';
    },
    now(): number {
      return Date.now();
    },
    async tickUntil(): Promise<void> {
      return;
    },
  };
}

export function createWallClock(): SimClock {
  return {
    desc(): string {
      return 'wall';
    },
    now(): number {
      return Date.now();
    },
    async tickUntil(targetWallMs: number): Promise<void> {
      const delay = targetWallMs - Date.now();
      if (delay <= 0) {
        return;
      }
      await sleep(delay);
    },
  };
}

export function createAcceleratedClock(speed: number): SimClock {
  const finiteSpeed = Number.isFinite(speed) ? speed : 1;
  const normalizedSpeed = finiteSpeed <= 0 ? 1 : finiteSpeed;
  const divisor = Math.max(normalizedSpeed, 1e-9);
  return {
    desc(): string {
      return `accel(x${normalizedSpeed})`;
    },
    now(): number {
      return Date.now();
    },
    async tickUntil(targetWallMs: number): Promise<void> {
      const delay = targetWallMs - Date.now();
      if (delay <= 0) {
        return;
      }
      await sleep(delay / divisor);
    },
  };
}
