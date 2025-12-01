import type { DepthRow, InstrumentProfile } from '@/types/ManualTrading';
import { ORDERBOOK_DEPTH, instrumentProfiles } from './constants';

/**
 * Get instrument profile by symbol
 */
export function getProfile(symbol: string): InstrumentProfile {
  return instrumentProfiles[symbol] ?? instrumentProfiles['BTC/USDT'];
}

/**
 * Format time for display
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('ru-RU', { hour12: false });
}

/**
 * Aggregate orderbook levels by price
 */
export function aggregateSide(
  levels: DepthRow[],
  side: 'bids' | 'asks',
  depthLimit = ORDERBOOK_DEPTH,
): { levels: DepthRow[]; uniqueLevels: number } {
  const buckets = new Map<string, number>();

  for (const { price, size } of levels) {
    if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0)
      continue;
    const priceKey = price.toFixed(3);
    const nextSize = (buckets.get(priceKey) ?? 0) + size;
    buckets.set(priceKey, nextSize);
  }

  const sorted = Array.from(buckets.entries())
    .map(([price, size]) => ({
      price: Number(price),
      size: Number(size.toFixed(3)),
    }))
    .sort((left, right) =>
      side === 'bids' ? right.price - left.price : left.price - right.price,
    );

  return { levels: sorted.slice(0, depthLimit), uniqueLevels: sorted.length };
}
