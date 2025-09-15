/* eslint-disable */
import { createReader } from '@tradeforge/io-binance';
import { existsSync } from 'fs';
import { resolve } from 'path';

function parseArgs(argv: string[]): Record<string, string> {
  const res: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const val = next && !next.startsWith('--') ? argv[++i]! : 'true';
      res[key] = val;
    }
  }
  return res;
}

export async function dumpTrades(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const files = String(args['files'] ?? '')
    .split(',')
    .filter(Boolean)
    .map((f) => {
      const direct = resolve(process.cwd(), f);
      if (existsSync(direct)) return direct;
      const up1 = resolve(process.cwd(), '..', f);
      if (existsSync(up1)) return up1;
      const up2 = resolve(process.cwd(), '..', '..', f);
      return existsSync(up2) ? up2 : direct;
    });
  if (files.length === 0) {
    console.error('no files specified');
    return;
  }
  const symbol = (args['symbol'] ?? 'BTCUSDT') as string;
  const format = (args['format'] as string) ?? 'auto';
  const limit = args['limit'] ? Number(args['limit']) : undefined;
  const fromMs = args['from'] ? Date.parse(String(args['from'])) : undefined;
  const toMs = args['to'] ? Date.parse(String(args['to'])) : undefined;
  const ndjson = args['ndjson'] === 'true';
  const tf: { fromMs?: number; toMs?: number } = {};
  if (fromMs !== undefined) tf.fromMs = fromMs;
  if (toMs !== undefined) tf.toMs = toMs;
  const readerOpts: Record<string, unknown> = {
    kind: 'trades',
    files,
    symbol,
    format,
    limit,
  };
  if (Object.keys(tf).length) readerOpts['timeFilter'] = tf;
  const reader = createReader(readerOpts as any);
  const stringify = (obj: unknown, space?: number) =>
    JSON.stringify(
      obj,
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      space,
    );
  for await (const t of reader as AsyncIterable<unknown>) {
    if (ndjson) {
      console.log(stringify(t));
    } else {
      console.log(stringify(t, 2));
    }
  }
}
