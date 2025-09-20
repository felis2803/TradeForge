import { resolve } from 'node:path';

export const DEFAULT_BASE_URL = 'https://data.binance.vision';
export const DEFAULT_ROOT_DIR = resolve('datasets', 'binance');
export const SUPPORTED_SYMBOLS = new Set(['BTCUSDT']);

export const TRADE_ARCHIVE_PATH =
  'data/futures/um/daily/trades/{symbol}/{symbol}-trades-{date}.json.gz';
export const DEPTH_ARCHIVE_PATH =
  'data/futures/um/daily/diffBookDepth/{symbol}/{symbol}-diffBookDepth-{date}.json.gz';

export type ArchiveKind = 'trades' | 'depth';

export const ARCHIVE_DEFINITIONS: Record<
  ArchiveKind,
  { template: string; filename: string }
> = {
  trades: { template: TRADE_ARCHIVE_PATH, filename: 'trades.json.gz' },
  depth: { template: DEPTH_ARCHIVE_PATH, filename: 'depth.json.gz' },
};
