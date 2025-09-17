import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  createReplayController,
  ExchangeState,
  StaticMockOrderbook,
  type CoreReaderCursor,
  type ReplayProgress,
} from '@tradeforge/core';
import { buildDepthReader, buildTradesReader } from '../_shared/readers.js';
import { buildMerged } from '../_shared/merge.js';
import { runScenario } from '../_shared/replay.js';
import { createLogger, formatProgress } from '../_shared/logging.js';
import { makeCp } from '../_shared/checkpoint.js';

const logger = createLogger({ prefix: '[examples/05-pause-auto-checkpoint]' });

const DEFAULT_TRADES = resolve('examples', '_smoke', 'mini-trades.jsonl');
const DEFAULT_DEPTH = resolve('examples', '_smoke', 'mini-depth.jsonl');
const DEFAULT_CP_PATH = '/tmp/tf.cp.json';

function resolveCheckpointPath(): string {
  const raw = process.env['TF_CP_PATH'];
  if (raw && raw.trim()) {
    return raw.trim();
  }
  return DEFAULT_CP_PATH;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseNonNegativeInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function preferredFiles(
  envKey: 'TF_TRADES_FILES' | 'TF_DEPTH_FILES',
  fallback: string,
): string[] {
  const envValue = process.env[envKey];
  if (envValue && envValue.trim()) {
    return [];
  }
  return [fallback];
}

function resolveTieBreak(): 'DEPTH' | 'TRADES' {
  const raw = process.env['TF_TIE_BREAK']?.trim().toUpperCase();
  if (raw === 'TRADES') {
    return 'TRADES';
  }
  return 'DEPTH';
}

function currentCursorOf(source: unknown): CoreReaderCursor | undefined {
  if (!source || typeof source !== 'object') {
    return undefined;
  }
  const maybe = source as { currentCursor?: () => CoreReaderCursor };
  if (typeof maybe.currentCursor !== 'function') {
    return undefined;
  }
  try {
    return maybe.currentCursor();
  } catch {
    return undefined;
  }
}

export async function run(): Promise<{
  progress: ReplayProgress;
  checkpointPath: string;
}> {
  const tradesReader = buildTradesReader(
    preferredFiles('TF_TRADES_FILES', DEFAULT_TRADES),
  );
  const depthReader = buildDepthReader(
    preferredFiles('TF_DEPTH_FILES', DEFAULT_DEPTH),
  );
  const timeline = buildMerged(tradesReader, depthReader);

  const controller = createReplayController();
  const checkpointPath = resolveCheckpointPath();
  if (existsSync(checkpointPath)) {
    rmSync(checkpointPath, { force: true });
    logger.debug(`removed existing checkpoint at ${checkpointPath}`);
  }

  const symbol = (process.env['TF_SYMBOL'] ?? 'BTCUSDT').toUpperCase();
  const state = new ExchangeState({
    symbols: {
      [symbol]: {
        base: 'BTC',
        quote: 'USDT',
        priceScale: 2,
        qtyScale: 4,
      },
    },
    fee: { makerBps: 10, takerBps: 20 },
    orderbook: new StaticMockOrderbook({ best: {} }),
  });

  const mergeState = { nextSourceOnEqualTs: resolveTieBreak() };
  const cpIntervalEvents = parsePositiveInt(
    process.env['TF_CP_INTERVAL_EVENTS'],
    20,
  );
  const cpIntervalWallMs = parsePositiveInt(
    process.env['TF_CP_INTERVAL_WALL_MS'],
    500,
  );
  const maxEvents = parsePositiveInt(process.env['TF_MAX_EVENTS'], 100);
  const resumeDelayMs = parseNonNegativeInt(
    process.env['TF_RESUME_DELAY_MS'],
    600,
  );

  logger.info(
    `preparing replay (maxEvents=${maxEvents}) checkpointPath=${checkpointPath}`,
  );
  logger.info(
    `auto-checkpoint every ${cpIntervalEvents} events or ${cpIntervalWallMs}ms`,
  );

  setTimeout(() => {
    logger.info(`resuming replay after pause (${resumeDelayMs}ms)`);
    controller.resume();
  }, resumeDelayMs);

  const progress = await runScenario({
    timeline,
    clock: 'logical',
    limits: { maxEvents },
    controller,
    pauseOnStart: true,
    autoCp: {
      savePath: checkpointPath,
      cpIntervalEvents,
      cpIntervalWallMs,
      buildCheckpoint: async () => {
        const cursors: { trades?: CoreReaderCursor; depth?: CoreReaderCursor } =
          {};
        const tradesCursor = currentCursorOf(tradesReader);
        if (tradesCursor) {
          cursors.trades = tradesCursor;
        }
        const depthCursor = currentCursorOf(depthReader);
        if (depthCursor) {
          cursors.depth = depthCursor;
        }
        return makeCp({
          symbol,
          state,
          merge: mergeState,
          cursors,
          note: 'auto-checkpoint (examples/05)',
        });
      },
    },
    logger,
  });

  logger.info(`replay complete ${formatProgress(progress)}`);
  return { progress, checkpointPath };
}

async function main(): Promise<void> {
  try {
    const { progress, checkpointPath } = await run();
    const cpExists = existsSync(checkpointPath);
    const wallElapsed = Math.max(0, progress.wallLastMs - progress.wallStartMs);
    const marker = {
      eventsOut: progress.eventsOut,
      wallMs: wallElapsed,
      cpExists,
    };
    console.log('PAUSE_CP_OK', marker);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(message);
    if (err instanceof Error && err.stack) {
      logger.debug(err.stack);
    }
    console.error('PAUSE_CP_FAILED', message);
    process.exit(1);
  }
}

const invokedFromCli =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1]!)).href === import.meta.url;

if (invokedFromCli) {
  void main();
}
