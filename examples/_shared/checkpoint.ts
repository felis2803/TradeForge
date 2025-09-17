import type {
  CheckpointV1,
  CoreReaderCursor,
  ExchangeState,
  MergeStartState,
  SymbolId,
} from '@tradeforge/core';
import {
  loadCheckpoint,
  makeCheckpointV1,
  saveCheckpoint,
} from '@tradeforge/core';
import type { Logger } from './logging.js';

export interface CheckpointInput {
  symbol: string;
  state: ExchangeState;
  cursors: { trades?: CoreReaderCursor; depth?: CoreReaderCursor };
  merge?: MergeStartState;
  note?: string;
}

function describeCursor(name: string, cursor?: CoreReaderCursor): string {
  if (!cursor) {
    return `${name}:none`;
  }
  const entry = cursor.entry ? `${cursor.file}::${cursor.entry}` : cursor.file;
  return `${name}:${entry}#${cursor.recordIndex}`;
}

export function formatCheckpointSummary(cp: CheckpointV1): string {
  const cursors = [
    describeCursor('trades', cp.cursors.trades),
    describeCursor('depth', cp.cursors.depth),
  ].join(', ');
  const tieBreak = cp.merge?.nextSourceOnEqualTs ?? 'DEPTH';
  const parts = [
    `v${cp.version}`,
    `symbol=${cp.meta.symbol}`,
    `tieBreak=${tieBreak}`,
    `created=${new Date(cp.createdAtMs).toISOString()}`,
    `cursors=[${cursors}]`,
  ];
  if (cp.meta.note) {
    parts.push(`note=${cp.meta.note}`);
  }
  return parts.join(' ');
}

export function makeCp(input: CheckpointInput): CheckpointV1 {
  const payload: Parameters<typeof makeCheckpointV1>[0] = {
    symbol: input.symbol as SymbolId,
    state: input.state,
    cursors: input.cursors,
  };
  if (input.merge) {
    payload.merge = input.merge;
  }
  if (input.note) {
    payload.note = input.note;
  }
  return makeCheckpointV1(payload);
}

export async function saveCp(
  path: string,
  cp: CheckpointV1,
  logger?: Logger,
): Promise<void> {
  await saveCheckpoint(path, cp);
  if (logger) {
    logger.info(`checkpoint saved -> ${path}`);
    logger.info(formatCheckpointSummary(cp));
  }
}

export async function loadCp(
  path: string,
  logger?: Logger,
): Promise<CheckpointV1> {
  const cp = await loadCheckpoint(path);
  if (logger) {
    logger.info(`checkpoint loaded <- ${path}`);
    logger.info(formatCheckpointSummary(cp));
  }
  return cp;
}
