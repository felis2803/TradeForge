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

const NORMALIZE_SUFFIX_RE = /\.jsonl(\.(gz|zip))?$/i;

function normalizeName(value: string): string {
  return basename(value).toLowerCase().replace(NORMALIZE_SUFFIX_RE, '');
}

function gatherNormalizedNames(values: Iterable<string>): Set<string> {
  const normalized = new Set<string>();
  for (const value of values) {
    normalized.add(normalizeName(value));
  }
  return normalized;
}

function cursorFiles(cursor: CoreReaderCursor | undefined): string[] {
  if (!cursor || !cursor.file) {
    return [];
  }
  return [cursor.file];
}

function describeSet(values: Set<string>): string {
  if (values.size === 0) {
    return 'none';
  }
  return [...values].sort().join(', ');
}

function ensureMatchingInputs(
  kind: 'trades' | 'depth',
  cursor: CoreReaderCursor | undefined,
  files: string[],
): void {
  if (!cursor) {
    return;
  }
  const expectedBase = basename(cursor.file);
  const expectedNormalized = normalizeName(cursor.file);
  const candidates = new Set<string>();
  for (const file of files) {
    candidates.add(normalizeName(file));
  }
  if (candidates.has(expectedNormalized)) {
    return;
  }
  logger.warn(
    `${kind} cursor references ${expectedBase}, but provided files are ${
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

  const checkpointInputs = [
    ...cursorFiles(checkpoint.cursors.trades),
    ...cursorFiles(checkpoint.cursors.depth),
  ];
  const providedInputs = [...tradeFiles, ...depthFiles];
  const checkpointNormalized = gatherNormalizedNames(checkpointInputs);
  const providedNormalized = gatherNormalizedNames(providedInputs);
  const inputsMatch =
    checkpointNormalized.size === providedNormalized.size &&
    [...checkpointNormalized].every((value) => providedNormalized.has(value));
  if (!inputsMatch) {
    console.warn(
      `[resume] WARNING: inputs differ (normalized basename). checkpoint=${describeSet(
        checkpointNormalized,
      )} provided=${describeSet(providedNormalized)}`,
    );
  }

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
