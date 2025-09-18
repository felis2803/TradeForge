import { basename, resolve } from 'node:path';
import { statSync } from 'node:fs';
import process from 'node:process';
import {
  deserializeExchangeState,
  restoreEngineFromSnapshot,
  type CoreReaderCursor,
  type MergeStartState,
  type ReplayProgress,
} from '@tradeforge/core';
import { createLogger } from '../_shared/logging.js';
import { loadCp, formatCheckpointSummary } from '../_shared/checkpoint.js';
import { buildDepthReader, buildTradesReader } from '../_shared/readers.js';
import { buildMerged } from '../_shared/merge.js';
import { runScenario } from '../_shared/replay.js';

const logger = createLogger({
  prefix: '[examples/06-resume-from-checkpoint/resume]',
});

function resolveCheckpointPath(): string {
  const argvPath = process.argv[2];
  const envPath = process.env['TF_CP_PATH'];
  const raw = argvPath && argvPath.trim().length > 0 ? argvPath : envPath;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'checkpoint path is required (pass as CLI argument or set TF_CP_PATH)',
    );
  }
  const path = resolve(process.cwd(), raw.trim());
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) {
    throw new Error(`checkpoint file not found: ${path}`);
  }
  return path;
}

function resolveDataPath(file: string): string {
  return resolve(process.cwd(), 'examples', '_smoke', file);
}

const ZIP_SUFFIX = '.zip';
const GZ_SUFFIX = '.gz';

function normalizeBasename(value: string): string {
  const lower = value.toLowerCase();
  if (lower.endsWith(ZIP_SUFFIX)) {
    return value.slice(0, -ZIP_SUFFIX.length);
  }
  if (lower.endsWith(GZ_SUFFIX)) {
    return value.slice(0, -GZ_SUFFIX.length);
  }
  return value;
}

function ensureMatchingInputs(
  kind: 'trades' | 'depth',
  cursor: CoreReaderCursor | undefined,
  files: string[],
): void {
  if (!cursor) {
    return;
  }
  const expected = basename(cursor.file);
  const expectedVariants = new Set([expected, normalizeBasename(expected)]);
  const candidates = new Set<string>();
  for (const file of files) {
    const base = basename(file);
    candidates.add(base);
    candidates.add(normalizeBasename(base));
  }
  for (const variant of expectedVariants) {
    if (candidates.has(variant)) {
      return;
    }
  }
  logger.warn(
    `${kind} cursor references ${expected}, but provided files are ${
      files.map((file) => basename(file)).join(', ') || 'none'
    }`,
  );
}

function buildNote(progress: ReplayProgress): string {
  const parts = [`events=${progress.eventsOut}`];
  if (progress.simLastTs !== undefined) {
    parts.push(`lastTs=${String(progress.simLastTs)}`);
  }
  return parts.join(' ');
}

async function main(): Promise<void> {
  const cpPath = resolveCheckpointPath();
  const checkpoint = await loadCp(cpPath, logger);
  logger.info(`loaded checkpoint: ${formatCheckpointSummary(checkpoint)}`);

  const restoredState = deserializeExchangeState(checkpoint.state);
  restoreEngineFromSnapshot(checkpoint.engine, restoredState);
  const checkpointSymbol = checkpoint.meta?.symbol;
  if (checkpointSymbol) {
    const config = restoredState.getSymbolConfig(checkpointSymbol);
    if (!config) {
      logger.warn(
        `symbol ${String(checkpointSymbol)} referenced in checkpoint is missing in restored state`,
      );
    }
  }

  const tradesPath = resolveDataPath('mini-trades.jsonl');
  const depthPath = resolveDataPath('mini-depth.jsonl');
  const tradeFiles = [tradesPath];
  const depthFiles = [depthPath];

  ensureMatchingInputs('trades', checkpoint.cursors.trades, tradeFiles);
  ensureMatchingInputs('depth', checkpoint.cursors.depth, depthFiles);

  const trades = buildTradesReader(tradeFiles, checkpoint.cursors.trades);
  const depth = buildDepthReader(depthFiles, checkpoint.cursors.depth);

  const mergeStart: MergeStartState = {
    nextSourceOnEqualTs: checkpoint.merge?.nextSourceOnEqualTs ?? 'DEPTH',
  };
  const timeline = buildMerged(trades, depth, mergeStart);

  const maxEvents = Number(process.env['TF_EX06_RESUME_EVENTS'] ?? '24');
  logger.info(`continuing replay for up to ${maxEvents} events`);
  const progress = await runScenario({
    timeline,
    clock: 'logical',
    limits: { maxEvents },
    logger,
  });

  logger.info(`resume finished: ${buildNote(progress)}`);
  const payload = {
    cpPath,
    loaded: true,
    eventsOutDelta: progress.eventsOut,
    simLastTs: progress.simLastTs ?? null,
  } satisfies Record<string, unknown>;
  console.log('RESUME_OK', JSON.stringify(payload));
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    logger.debug(err.stack);
  }
  process.exit(1);
});
