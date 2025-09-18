import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  ExchangeState,
  StaticMockOrderbook,
  createReplayController,
  type MergedEvent,
  type ReplayProgress,
  type SymbolId,
} from '@tradeforge/core';
import { buildDepthReader, buildTradesReader } from '../_shared/readers.js';
import { buildMerged } from '../_shared/merge.js';
import { runScenario } from '../_shared/replay.js';
import { createLogger } from '../_shared/logging.js';
import { formatCheckpointSummary, makeCp } from '../_shared/checkpoint.js';

const logger = createLogger({ prefix: '[examples/05-pause-auto-checkpoint]' });

const CHECKPOINT_PATH = '/tmp/tf.cp.json';
const SYMBOL = 'BTCUSDT' as SymbolId;

const SYMBOL_CONFIG = {
  base: 'BTC',
  quote: 'USDT',
  priceScale: 2,
  qtyScale: 4,
};

const state = new ExchangeState({
  symbols: { [SYMBOL as unknown as string]: SYMBOL_CONFIG },
  fee: { makerBps: 0, takerBps: 0 },
  orderbook: new StaticMockOrderbook({ best: {} }),
});

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function safeCursor<T>(readCursor: () => T): T | undefined {
  try {
    return readCursor();
  } catch (err) {
    logger.warn(
      `failed to read cursor for checkpoint: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }
}

async function main(): Promise<void> {
  if (existsSync(CHECKPOINT_PATH)) {
    rmSync(CHECKPOINT_PATH);
    logger.info(`removed previous checkpoint at ${CHECKPOINT_PATH}`);
  }

  const dataRoot = resolve(process.cwd(), 'examples', '_smoke');
  const tradesPath = resolve(dataRoot, 'mini-trades.jsonl');
  const depthPath = resolve(dataRoot, 'mini-depth.jsonl');

  const trades = buildTradesReader([tradesPath]);
  const depth = buildDepthReader([depthPath]);
  const timeline = buildMerged(trades, depth);

  const controller = createReplayController();

  const resumeDelayMs = Number(process.env['TF_EXAMPLE_RESUME_DELAY'] ?? '300');
  const slowdownMs = Number(process.env['TF_EXAMPLE_EVENT_DELAY'] ?? '120');

  let lastProgress: ReplayProgress | undefined;
  let lastEvent: MergedEvent | undefined;

  const runPromise = runScenario({
    timeline,
    clock: 'logical',
    limits: { maxEvents: 100 },
    controller,
    pauseOnStart: true,
    logger,
    autoCp: {
      savePath: CHECKPOINT_PATH,
      cpIntervalEvents: 20,
      cpIntervalWallMs: 500,
      buildCheckpoint: async () => {
        const tradesCursor = safeCursor(() => trades.currentCursor());
        const depthCursor = safeCursor(() => depth.currentCursor());
        const noteParts: string[] = [];
        if (lastProgress) {
          noteParts.push(`events=${lastProgress.eventsOut}`);
          if (lastProgress.simLastTs !== undefined) {
            noteParts.push(`simLast=${String(lastProgress.simLastTs)}`);
          }
        }
        if (lastEvent) {
          noteParts.push(`last=${lastEvent.source}:${String(lastEvent.ts)}`);
        }
        const checkpoint = makeCp({
          symbol: SYMBOL,
          state,
          cursors: {
            ...(tradesCursor ? { trades: tradesCursor } : {}),
            ...(depthCursor ? { depth: depthCursor } : {}),
          },
          merge: { nextSourceOnEqualTs: 'DEPTH' },
          note: noteParts.length > 0 ? noteParts.join(' ') : 'auto-checkpoint',
        });
        logger.info(
          `auto-checkpoint snapshot -> ${formatCheckpointSummary(checkpoint)}`,
        );
        return checkpoint;
      },
    },
    onEvent: async (event) => {
      lastEvent = event;
      if (slowdownMs > 0) {
        await delay(slowdownMs);
      }
    },
    onProgress: (progress) => {
      lastProgress = progress;
    },
  });

  logger.info(
    `controller paused on start — will resume automatically in ${resumeDelayMs}ms`,
  );
  const resumeTimer = setTimeout(
    () => {
      logger.info('resuming replay now');
      controller.resume();
    },
    Math.max(0, resumeDelayMs),
  );

  const progress = await runPromise;
  clearTimeout(resumeTimer);

  logger.info(`replay finished: processed ${progress.eventsOut} events`);

  const checkpointExists = existsSync(CHECKPOINT_PATH);
  if (checkpointExists) {
    logger.info(`checkpoint file saved at ${CHECKPOINT_PATH}`);
  } else {
    logger.warn(`checkpoint file not found at ${CHECKPOINT_PATH}`);
  }

  console.log('PAUSE_CP_OK', { cpExists: checkpointExists });
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    logger.debug(err.stack);
  }
  process.exit(1);
});
