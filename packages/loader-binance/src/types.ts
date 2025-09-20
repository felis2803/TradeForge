import type {
  SymbolId,
  SymbolScaleMap,
  DepthDiff,
  Trade,
} from '@tradeforge/core';
import type { ArchiveKind } from './constants.js';

export interface SyncOptions {
  symbol: SymbolId;
  date: string;
  rootDir?: string;
  baseUrl?: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
}

export interface SyncReportItem {
  kind: ArchiveKind;
  status: 'downloaded' | 'skipped';
  bytes?: number;
  path: string;
}

export interface SyncReport {
  symbol: SymbolId;
  date: string;
  datasetDir: string;
  items: SyncReportItem[];
}

export interface BaseStreamOptions {
  symbol: SymbolId;
  date: string;
  rootDir?: string;
  scaleOverride?: SymbolScaleMap;
}

export interface TradeStreamOptions extends BaseStreamOptions {}

export interface DepthStreamOptions extends BaseStreamOptions {}

export type TradeStream = AsyncIterable<Trade>;
export type DepthStream = AsyncIterable<DepthDiff>;
