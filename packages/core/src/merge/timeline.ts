import type { DepthDiff, TimestampMs, Trade } from '../types/index.js';

export type SourceTag = 'DEPTH' | 'TRADES';

interface BaseEvent<TKind extends 'trade' | 'depth', TPayload> {
  kind: TKind;
  ts: TimestampMs;
  payload: TPayload;
  source: SourceTag;
  seq: number;
  entry?: string;
}

export type TradeEvent = BaseEvent<'trade', Trade>;

export type DepthEvent = BaseEvent<'depth', DepthDiff>;

export type MergedEvent = TradeEvent | DepthEvent;

export interface MergeOptions {
  preferDepthOnEqualTs?: boolean;
}

type StreamState<TEvent extends MergedEvent> = {
  iterator: AsyncIterator<TEvent>;
  current: TEvent | undefined;
  done: boolean;
  fallbackCounter: number;
  expectedSource: SourceTag;
};

type EntryOrderMap = Record<SourceTag, Map<string, number>>;

function compareBySource(
  a: SourceTag,
  b: SourceTag,
  preferDepth: boolean,
): number {
  if (a === b) return 0;
  if (preferDepth) {
    return a === 'DEPTH' ? -1 : 1;
  }
  return a === 'TRADES' ? -1 : 1;
}

function getEntryIndex(event: MergedEvent, entryOrder: EntryOrderMap): number {
  const entry = event.entry;
  if (!entry) return -1;
  const map = entryOrder[event.source];
  let idx = map.get(entry);
  if (idx === undefined) {
    idx = map.size;
    map.set(entry, idx);
  }
  return idx;
}

function compareEvents(
  a: MergedEvent,
  b: MergedEvent,
  preferDepth: boolean,
  entryOrder: EntryOrderMap,
  fallbackOrder: WeakMap<MergedEvent, number>,
): number {
  if (a === b) return 0;
  if (a.ts !== b.ts) {
    return a.ts < b.ts ? -1 : 1;
  }
  if (a.source !== b.source) {
    return compareBySource(a.source, b.source, preferDepth);
  }
  if (a.seq !== b.seq) {
    return a.seq < b.seq ? -1 : 1;
  }
  const entryIdxA = getEntryIndex(a, entryOrder);
  const entryIdxB = getEntryIndex(b, entryOrder);
  if (entryIdxA !== entryIdxB) {
    return entryIdxA < entryIdxB ? -1 : 1;
  }
  const entryA = a.entry ?? '';
  const entryB = b.entry ?? '';
  if (entryA !== entryB) {
    return entryA < entryB ? -1 : 1;
  }
  const fallbackA = fallbackOrder.get(a) ?? 0;
  const fallbackB = fallbackOrder.get(b) ?? 0;
  if (fallbackA !== fallbackB) {
    return fallbackA < fallbackB ? -1 : 1;
  }
  return 0;
}

async function pullNext<TEvent extends MergedEvent>(
  state: StreamState<TEvent>,
  fallbackOrder: WeakMap<MergedEvent, number>,
): Promise<void> {
  if (state.done || state.current) return;
  const next = await state.iterator.next();
  if (next.done) {
    state.done = true;
    state.current = undefined;
    return;
  }
  const value = next.value;
  if (!value) {
    state.current = undefined;
    return;
  }
  if (value.source !== state.expectedSource) {
    state.expectedSource = value.source;
  }
  if (!fallbackOrder.has(value)) {
    fallbackOrder.set(value, state.fallbackCounter++);
  }
  state.current = value;
}

export function createMergedStream(
  trades: AsyncIterable<TradeEvent>,
  depth: AsyncIterable<DepthEvent>,
  opts: MergeOptions = {},
): AsyncIterable<MergedEvent> {
  const preferDepth = opts.preferDepthOnEqualTs ?? true;
  const entryOrder: EntryOrderMap = {
    DEPTH: new Map(),
    TRADES: new Map(),
  };
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<MergedEvent> {
      const fallbackOrder = new WeakMap<MergedEvent, number>();
      const tradeState: StreamState<TradeEvent> = {
        iterator: trades[Symbol.asyncIterator](),
        done: false,
        current: undefined,
        fallbackCounter: 0,
        expectedSource: 'TRADES',
      };
      const depthState: StreamState<DepthEvent> = {
        iterator: depth[Symbol.asyncIterator](),
        done: false,
        current: undefined,
        fallbackCounter: 0,
        expectedSource: 'DEPTH',
      };
      const states: StreamState<MergedEvent>[] = [
        tradeState as unknown as StreamState<MergedEvent>,
        depthState as unknown as StreamState<MergedEvent>,
      ];
      while (true) {
        await pullNext(tradeState, fallbackOrder);
        await pullNext(depthState, fallbackOrder);
        let bestState: StreamState<MergedEvent> | undefined;
        for (const state of states) {
          const current = state.current;
          if (!current) continue;
          if (!bestState) {
            bestState = state;
            continue;
          }
          const cmp = compareEvents(
            current,
            bestState.current!,
            preferDepth,
            entryOrder,
            fallbackOrder,
          );
          if (cmp < 0) {
            bestState = state;
          }
        }
        if (!bestState) break;
        const value = bestState.current!;
        bestState.current = undefined;
        yield value;
      }
    },
  };
}
