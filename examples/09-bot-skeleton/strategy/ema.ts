import type { PriceInt } from '@tradeforge/core';

export type CrossSignal = 'BUY' | 'SELL' | 'FLAT';

export interface EmaTracker {
  window: number;
  current?: PriceInt;
}

function toRaw(value: PriceInt | undefined): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as unknown as bigint;
}

function toPriceInt(value: bigint): PriceInt {
  return value as unknown as PriceInt;
}

export function updateEma(tracker: EmaTracker, price: PriceInt): PriceInt {
  const priceRaw = price as unknown as bigint;
  const prev = toRaw(tracker.current);
  if (prev === undefined) {
    tracker.current = price;
    return price;
  }
  const window = tracker.window <= 0 ? 1 : tracker.window;
  const numerator = (priceRaw - prev) * 2n;
  const denominator = BigInt(window + 1);
  const delta = denominator === 0n ? 0n : numerator / denominator;
  const next = prev + delta;
  const nextInt = toPriceInt(next);
  tracker.current = nextInt;
  return nextInt;
}

export function resolveSignal(
  fast?: PriceInt,
  slow?: PriceInt,
  epsilon: bigint = 0n,
): CrossSignal {
  const fastRaw = toRaw(fast);
  const slowRaw = toRaw(slow);
  if (fastRaw === undefined || slowRaw === undefined) {
    return 'FLAT';
  }
  const threshold = epsilon < 0n ? 0n : epsilon;
  const diff = fastRaw - slowRaw;
  if (diff > threshold) {
    return 'BUY';
  }
  if (diff < -threshold) {
    return 'SELL';
  }
  return 'FLAT';
}
