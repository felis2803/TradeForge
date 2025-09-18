import { mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import {
  ExchangeState,
  StaticMockOrderbook,
  type CoreReaderCursor,
  type MergeStartState,
  type ReplayProgress,
  type SymbolId,
} from '@tradeforge/core';
import { buildDepthReader, buildTradesReader } from '../_shared/readers.js';
import { buildMerged } from '../_shared/merge.js';
import { runScenario } from '../_shared/replay.js';
import { createLogger } from '../_shared/logging.js';
import {
  makeCp,
  saveCp,
  formatCheckpointSummary,
} from '../_shared/checkpoint.js';

const logger = createLogger({
  prefix: '[examples/06-resume-from-checkpoint/save]',
});

const SYMBOL = 'BTCUSDT' as SymbolId;

const SYMBOL_CONFIG = {
  base: 'BTC',
  quote: 'USDT',
  priceScale: 2,
  qtyScale: 3,
};

function resolveDataPath(file: string): string {
  return resolve(process.cwd(), 'examples', '_smoke', file);
}

function resolveCheckpointPath(): { path: string; dir?: string } {
  const override = process.env['TF_CP_PATH'];
  if (override && override.trim().length > 0) {
    const explicit = resolve(process.cwd(), override.trim());
    logger.info(`TF_CP_PATH set — checkpoint will be written to ${explicit}`);
    return { path: explicit };
  }
  const dir = mkdtempSync(join(tmpdir(), 'tf-ex06-'));
  const path = resolve(dir, 'checkpoint.v1.json');
  logger.info(`generated checkpoint path ${path}`);
  return { path, dir };
}

function safeCursor(
  readCursor: () => CoreReaderCursor,
): CoreReaderCursor | undefined {
  try {
    return readCursor();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(`unable to read cursor: ${reason}`);
    return undefined;
  }
}

function buildNote(progress: ReplayProgress): string {
  const parts = [`events=${progress.eventsOut}`];
  if (progress.simLastTs !== undefined) {
    parts.push(`lastTs=${String(progress.simLastTs)}`);
  }
  return parts.join(' ');
}

async function main(): Promise<void> {
  const tradesPath = resolveDataPath('mini-trades.jsonl');
  const depthPath = resolveDataPath('mini-depth.jsonl');

  const trades = buildTradesReader([tradesPath]);
  const depth = buildDepthReader([depthPath]);

  const mergeStart: MergeStartState = { nextSourceOnEqualTs: 'DEPTH' };
  const timeline = buildMerged(trades, depth, mergeStart);

  const state = new ExchangeState({
    symbols: { [SYMBOL as unknown as string]: SYMBOL_CONFIG },
    fee: { makerBps: 0, takerBps: 0 },
    orderbook: new StaticMockOrderbook({ best: {} }),
  });

  const maxEvents = Number(process.env['TF_EX06_SAVE_EVENTS'] ?? '6');

  logger.info(`starting replay for ${maxEvents} events to prepare checkpoint`);
  const progress = await runScenario({
    timeline,
    clock: 'logical',
    limits: { maxEvents },
    logger,
  });

  logger.info(
    `replay finished after ${progress.eventsOut} events (simLastTs=${String(progress.simLastTs ?? 'n/a')})`,
  );

  const { path: cpPath } = resolveCheckpointPath();
  const cursors: { trades?: CoreReaderCursor; depth?: CoreReaderCursor } = {};

  const tradesCursor = safeCursor(trades.currentCursor.bind(trades));
  if (tradesCursor) {
    cursors.trades = tradesCursor;
  }
  const depthCursor = safeCursor(depth.currentCursor.bind(depth));
  if (depthCursor) {
    cursors.depth = depthCursor;
  }

  const checkpoint = makeCp({
    symbol: SYMBOL,
    state,
    cursors,
    merge: mergeStart,
    note: buildNote(progress),
  });

  logger.info(`checkpoint summary: ${formatCheckpointSummary(checkpoint)}`);
  await saveCp(cpPath, checkpoint, logger);

  const summary = { cpPath, eventsOut: progress.eventsOut };
  console.log('SAVE_OK', JSON.stringify(summary));
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    logger.debug(err.stack);
  }
  process.exit(1);
});
