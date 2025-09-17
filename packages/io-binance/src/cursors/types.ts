import type { SymbolId } from '@tradeforge/core';

export interface ReaderCursor {
  file: string;
  entry?: string;
  recordIndex: number;
}

export interface CursorIterable<T> extends AsyncIterable<T> {
  currentCursor(): ReaderCursor;
}

interface JsonlCursorReaderBaseOptions {
  files: string[];
  symbol?: SymbolId;
  timeFilter?: { fromMs?: number; toMs?: number };
  limit?: number;
  assertMonotonicTimestamps?: boolean;
  startCursor?: ReaderCursor;
}

export interface JsonlCursorTradesOptions extends JsonlCursorReaderBaseOptions {
  kind: 'trades';
}

export interface JsonlCursorDepthOptions extends JsonlCursorReaderBaseOptions {
  kind: 'depth';
  depthShape?: 'binance-spot-diff' | 'custom';
}

export type JsonlCursorReaderOptions =
  | JsonlCursorTradesOptions
  | JsonlCursorDepthOptions;
