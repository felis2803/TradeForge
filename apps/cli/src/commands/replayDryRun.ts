/* eslint-disable */
import { createReader } from '@tradeforge/io-binance';
import {
  createMergedStream,
  TradeEvent,
  DepthEvent,
  MergedEvent,
} from '@tradeforge/core';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { materializeFixturePath } from '../utils/materializeFixtures.js';

function stringify(obj: unknown, space?: number) {
  return JSON.stringify(
    obj,
    (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    space,
  );
}

function parseArgs(argv: string[]): Record<string, string> {
  const res: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        const key = a.slice(2, eq);
        const val = a.slice(eq + 1);
        res[key] = val;
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      const val = next && !next.startsWith('--') ? argv[++i]! : 'true';
      res[key] = val;
    }
  }
  return res;
}

function resolveInputList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((f) => {
      const candidates = [
        resolve(process.cwd(), f),
        resolve(process.cwd(), '..', f),
        resolve(process.cwd(), '..', '..', f),
      ];
      for (const candidate of candidates) {
        const ensured = materializeFixturePath(candidate);
        if (existsSync(ensured)) return ensured;
      }
      const fallback = materializeFixturePath(
        candidates[0] ?? resolve(process.cwd(), f),
      );
      return fallback;
    });
}

function parseTime(value?: string): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isNaN(num) ? undefined : num;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const lower = value.toLowerCase();
  if (lower === 'false' || lower === '0' || lower === 'no') return false;
  if (lower === 'true' || lower === '1' || lower === 'yes') return true;
  return defaultValue;
}

function toSummary(event: MergedEvent) {
  if (event.kind === 'trade') {
    return {
      ts: event.ts,
      kind: event.kind,
      source: event.source,
      seq: event.seq,
      entry: event.entry,
      symbol: event.payload.symbol,
      price: event.payload.price,
      qty: event.payload.qty,
      side: event.payload.side,
      id: event.payload.id,
    };
  }
  return {
    ts: event.ts,
    kind: event.kind,
    source: event.source,
    seq: event.seq,
    entry: event.entry,
    symbol: event.payload.symbol,
    bids: event.payload.bids.length,
    asks: event.payload.asks.length,
  };
}

export async function replayDryRun(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const tradeFiles = resolveInputList(args['trades']);
  const depthFiles = resolveInputList(args['depth']);
  if (tradeFiles.length === 0 || depthFiles.length === 0) {
    console.error(
      'usage: tf replay --dry-run --trades <files> --depth <files> [--symbol BTCUSDT] [--limit 10]',
    );
    process.exitCode = 1;
    return;
  }
  const symbol = (args['symbol'] ?? 'BTCUSDT') as string;
  const formatTrades = (args['format-trades'] as string) ?? 'auto';
  const formatDepth = (args['format-depth'] as string) ?? 'auto';
  const limit = args['limit'] ? Number(args['limit']) : undefined;
  const fromMs = parseTime(args['from']);
  const toMs = parseTime(args['to']);
  const ndjson = parseBool(args['ndjson'], false);
  const preferDepth = parseBool(args['prefer-depth-on-equal-ts'], true);
  const timeFilter: { fromMs?: number; toMs?: number } = {};
  if (fromMs !== undefined) timeFilter.fromMs = fromMs;
  if (toMs !== undefined) timeFilter.toMs = toMs;
  const tradeOpts: Record<string, unknown> = {
    kind: 'trades',
    files: tradeFiles,
    symbol,
    format: formatTrades,
    internalTag: 'TRADES',
  };
  const depthOpts: Record<string, unknown> = {
    kind: 'depth',
    files: depthFiles,
    symbol,
    format: formatDepth,
    internalTag: 'DEPTH',
  };
  if (Object.keys(timeFilter).length) {
    tradeOpts['timeFilter'] = timeFilter;
    depthOpts['timeFilter'] = timeFilter;
  }
  const tradeReader = createReader(
    tradeOpts as any,
  ) as AsyncIterable<TradeEvent>;
  const depthReader = createReader(
    depthOpts as any,
  ) as AsyncIterable<DepthEvent>;
  const merged = createMergedStream(tradeReader, depthReader, {
    preferDepthOnEqualTs: preferDepth,
  });
  let emitted = 0;
  for await (const event of merged) {
    if (limit !== undefined && emitted >= limit) break;
    if (ndjson) {
      console.log(stringify(event));
    } else {
      console.log(stringify(toSummary(event), 2));
    }
    emitted++;
  }
  if (emitted === 0) {
    console.log('no merged events emitted (check filters or inputs)');
  }
}
