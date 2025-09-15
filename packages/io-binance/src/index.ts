/* eslint-disable */
import fg from 'fast-glob';
import type {
  SymbolId,
  Trade,
  DepthDiff,
  SymbolScaleMap,
} from '@tradeforge/core';
import { readFileLines } from './fs/readers.js';
import { parseCsv, CsvOptions } from './parse/csv.js';
import { parseJsonl } from './parse/jsonl.js';
import { parseJson, JsonOptions } from './parse/json.js';
import { normalizeTrade } from './normalize/trades.js';
import { normalizeDepth } from './normalize/depth.js';

export interface ReaderOpts {
  kind: 'trades' | 'depth';
  files: string[];
  symbol?: SymbolId;
  format?: 'auto' | 'csv' | 'json' | 'jsonl';
  csv?: CsvOptions & { mapping?: Record<string, string> };
  json?: { mapping?: Record<string, string> } & JsonOptions;
  scaleOverride?: SymbolScaleMap;
  timeFilter?: { fromMs?: number; toMs?: number };
  limit?: number;
  assertMonotonicTimestamps?: boolean;
  logger?: { debug?: (msg: string) => void; warn?: (msg: string) => void };
}

function detectFormat(name: string): 'csv' | 'json' | 'jsonl' {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl';
  return 'json';
}

async function expand(files: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    if (/[\*\?]/.test(f)) {
      const found = await fg(f, { dot: false });
      out.push(...found);
    } else {
      out.push(f);
    }
  }
  return out;
}

export async function* createReader(
  opts: ReaderOpts,
): AsyncIterable<Trade | DepthDiff> {
  const symbol = (opts.symbol ?? ('BTCUSDT' as SymbolId)) as SymbolId;
  const files = await expand(opts.files);
  let count = 0;
  let prevTs: number | undefined;
  for await (const entry of readFileLines(files)) {
    const fmt =
      opts.format === 'auto' || !opts.format
        ? detectFormat(entry.name)
        : opts.format;
    let rawIter: AsyncIterable<any>;
    if (fmt === 'csv') {
      rawIter = parseCsv(entry.lines, opts.csv);
    } else if (fmt === 'jsonl') {
      rawIter = parseJsonl(entry.lines);
    } else {
      rawIter = parseJson(entry.lines, opts.json);
    }
    for await (const raw of rawIter) {
      const common: Record<string, unknown> = { symbol };
      if (opts.scaleOverride) {
        common['scaleOverride'] = opts.scaleOverride;
      }
      let item: Trade | DepthDiff;
      if (opts.kind === 'trades') {
        const nOpts: Record<string, unknown> = { ...common };
        const map = opts.csv?.mapping ?? opts.json?.mapping;
        if (map) nOpts['mapping'] = map;
        item = normalizeTrade(raw, nOpts as any);
      } else {
        const nOpts: Record<string, unknown> = { ...common };
        const map = opts.json?.mapping;
        if (map) nOpts['mapping'] = map;
        item = normalizeDepth(raw, nOpts as any);
      }
      const ts = item.ts;
      if (opts.timeFilter) {
        if (opts.timeFilter.fromMs && ts < opts.timeFilter.fromMs) {
          continue;
        }
        if (opts.timeFilter.toMs && ts > opts.timeFilter.toMs) {
          continue;
        }
      }
      if (
        opts.assertMonotonicTimestamps &&
        prevTs !== undefined &&
        ts < prevTs
      ) {
        throw new Error(
          `timestamp decreased: prev=${prevTs} current=${ts} file=${entry.name}`,
        );
      }
      prevTs = ts;
      yield item;
      count++;
      if (opts.limit && count >= opts.limit) {
        return;
      }
    }
  }
}

export type { Trade, DepthDiff } from '@tradeforge/core';
export type { CsvOptions } from './parse/csv.js';
