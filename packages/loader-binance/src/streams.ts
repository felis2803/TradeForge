import { resolveDatasetFile } from './paths.js';
import type {
  DepthStream,
  DepthStreamOptions,
  TradeStream,
  TradeStreamOptions,
} from './types.js';
import { parseTradesFile } from './parse/trades.js';
import { parseDepthFile } from './parse/depth.js';

export function createTradeStream(options: TradeStreamOptions): TradeStream {
  const file = resolveDatasetFile(
    'trades',
    options.symbol,
    options.date,
    options.rootDir,
  );
  return parseTradesFile(file, options);
}

export function createDepthStream(options: DepthStreamOptions): DepthStream {
  const file = resolveDatasetFile(
    'depth',
    options.symbol,
    options.date,
    options.rootDir,
  );
  return parseDepthFile(file, options);
}
