import type { Side } from '../types/index.js';

export function assertNonNegative<T extends bigint>(
  x: T,
  name = 'value',
): void {
  if (x < 0n) {
    throw new Error(`${name} must be non-negative`);
  }
}

export const isBid = (side: Side): boolean => side === 'BUY';
export const isAsk = (side: Side): boolean => side === 'SELL';
