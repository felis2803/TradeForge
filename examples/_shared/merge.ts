import {
  createMergedStream,
  type CursorIterable,
  type DepthEvent,
  type MergeStartState,
  type MergedEvent,
  type TradeEvent,
} from '@tradeforge/core';

function resolveTieBreak(): 'DEPTH' | 'TRADES' {
  const raw = process.env['TF_TIE_BREAK']?.toUpperCase();
  if (raw === 'TRADES') {
    return 'TRADES';
  }
  return 'DEPTH';
}

export function buildMerged(
  trades: CursorIterable<TradeEvent> | AsyncIterable<TradeEvent>,
  depth: CursorIterable<DepthEvent> | AsyncIterable<DepthEvent>,
  start?: MergeStartState,
): AsyncIterable<MergedEvent> {
  const tieBreak = resolveTieBreak();
  const preferDepth = tieBreak !== 'TRADES';
  const effectiveStart: MergeStartState = {
    ...(start ?? {}),
  };
  if (!effectiveStart.nextSourceOnEqualTs) {
    effectiveStart.nextSourceOnEqualTs = tieBreak;
  }
  return createMergedStream(trades, depth, effectiveStart, {
    preferDepthOnEqualTs: preferDepth,
  });
}
