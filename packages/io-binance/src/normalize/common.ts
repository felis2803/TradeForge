import type {
  DepthDiff,
  DepthEvent,
  SourceTag,
  Trade,
  TradeEvent,
} from '@tradeforge/core';

interface DecoratorOptions {
  source: SourceTag;
  entry?: string;
}

export function createTradeEventDecorator(
  opts: DecoratorOptions,
): (payload: Trade) => TradeEvent {
  let seq = 0;
  return (payload: Trade): TradeEvent => {
    const base: TradeEvent = {
      kind: 'trade',
      ts: payload.ts,
      payload,
      source: opts.source,
      seq: seq++,
    };
    if (opts.entry !== undefined) {
      base.entry = opts.entry;
    }
    return base;
  };
}

export function createDepthEventDecorator(
  opts: DecoratorOptions,
): (payload: DepthDiff) => DepthEvent {
  let seq = 0;
  return (payload: DepthDiff): DepthEvent => {
    const base: DepthEvent = {
      kind: 'depth',
      ts: payload.ts,
      payload,
      source: opts.source,
      seq: seq++,
    };
    if (opts.entry !== undefined) {
      base.entry = opts.entry;
    }
    return base;
  };
}
