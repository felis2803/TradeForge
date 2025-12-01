import type { Position, PlaybackSpeed, DataMode } from '@/types/ManualTrading';
import { playbackSpeedMultiplier } from './constants';

/**
 * Calculate liquidation price for a position
 */
export function computeLiqPrice(
  avgPrice: number,
  size: number,
  markPrice?: number,
): number {
  const reference = Math.min(avgPrice, markPrice ?? avgPrice);
  const riskClamp = Math.max(0.35, 0.6 - Math.min(0.2, Math.abs(size) * 0.01));
  return Number((reference * riskClamp).toFixed(2));
}

/**
 * Calculate profit and loss for a position
 */
export function computePnl(
  position: Position,
  markPrice: number,
): { diff: number; pct: number } {
  const diff = Number(
    ((markPrice - position.avgPrice) * position.size).toFixed(2),
  );
  const notional = Math.max(1, Math.abs(position.avgPrice * position.size));
  const pct = Number(((diff / notional) * 100).toFixed(2));
  return { diff, pct };
}

/**
 * Calculate hours between two date strings
 */
export function getPeriodHours(start: string, end: string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diff = endDate.getTime() - startDate.getTime();
  return Number.isFinite(diff) ? Math.max(1, diff / 3_600_000) : 24;
}

/**
 * Compute update interval based on data mode and playback speed
 */
export function computeUpdateInterval(
  dataMode: DataMode,
  playbackSpeed: PlaybackSpeed,
  periodStart: string,
  periodEnd: string,
): number {
  const speed = playbackSpeedMultiplier[playbackSpeed] ?? 1;
  const base = dataMode === 'realtime' ? 1200 : 1800;

  if (dataMode === 'history') {
    const periodHours = getPeriodHours(periodStart, periodEnd);
    const periodFactor = Math.min(4, Math.max(0.5, periodHours / 24));
    return Math.max(350, Math.round((base * periodFactor) / speed));
  }

  return Math.max(450, Math.round(base / speed));
}
