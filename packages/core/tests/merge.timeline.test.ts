import {
  createMergedStream,
  TradeEvent,
  DepthEvent,
  MergedEvent,
  TimestampMs,
  SymbolId,
  PriceInt,
  QtyInt,
} from '../src/index';

const SYMBOL = 'BTCUSDT' as SymbolId;

function toAsync<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      for (const item of items) {
        yield item;
      }
    },
  };
}

function collect(iter: AsyncIterable<MergedEvent>): Promise<MergedEvent[]> {
  const out: MergedEvent[] = [];
  return (async () => {
    for await (const item of iter) {
      out.push(item);
    }
    return out;
  })();
}

function makeTradeEvent(
  ts: number,
  seq: number,
  entry = 'trades.jsonl',
): TradeEvent {
  const payload = {
    ts: ts as TimestampMs,
    symbol: SYMBOL,
    price: BigInt(10000 + seq) as PriceInt,
    qty: BigInt(1 + seq) as QtyInt,
  };
  const event: TradeEvent = {
    kind: 'trade',
    ts: payload.ts,
    payload,
    source: 'TRADES',
    seq,
    entry,
  };
  return event;
}

function makeDepthEvent(
  ts: number,
  seq: number,
  entry = 'depth.jsonl',
): DepthEvent {
  const payload = {
    ts: ts as TimestampMs,
    symbol: SYMBOL,
    bids: [
      {
        price: BigInt(10000 + seq) as PriceInt,
        qty: BigInt(10 + seq) as QtyInt,
      },
    ],
    asks: [],
  };
  const event: DepthEvent = {
    kind: 'depth',
    ts: payload.ts,
    payload,
    source: 'DEPTH',
    seq,
    entry,
  };
  return event;
}

test('merges events by timestamp with depth precedence', async () => {
  const trades = [makeTradeEvent(1, 0), makeTradeEvent(3, 1)];
  const depth = [makeDepthEvent(2, 0), makeDepthEvent(3, 1)];
  const merged = createMergedStream(toAsync(trades), toAsync(depth));
  const result = await collect(merged);
  expect(result.map((e) => [e.kind, Number(e.ts), e.source])).toEqual([
    ['trade', 1, 'TRADES'],
    ['depth', 2, 'DEPTH'],
    ['depth', 3, 'DEPTH'],
    ['trade', 3, 'TRADES'],
  ]);
});

test('respects preferDepthOnEqualTs=false', async () => {
  const trades = [makeTradeEvent(3, 0)];
  const depth = [makeDepthEvent(3, 0)];
  const merged = createMergedStream(toAsync(trades), toAsync(depth), {
    preferDepthOnEqualTs: false,
  });
  const result = await collect(merged);
  expect(result.map((e) => e.kind)).toEqual(['trade', 'depth']);
});

test('maintains stable order within the same source using seq', async () => {
  const trades = [makeTradeEvent(5, 0)];
  const depth = [
    makeDepthEvent(4, 0),
    makeDepthEvent(4, 1),
    makeDepthEvent(4, 2),
  ];
  const merged = createMergedStream(toAsync(trades), toAsync(depth));
  const result = await collect(merged);
  const depthSeq = result.filter((e) => e.source === 'DEPTH').map((e) => e.seq);
  expect(depthSeq).toEqual([0, 1, 2]);
});

test('falls back to entry ordering when seq matches', async () => {
  const tradePayload = {
    ts: 6 as TimestampMs,
    symbol: SYMBOL,
    price: 1n as PriceInt,
    qty: 1n as QtyInt,
  };
  const depthPayload = {
    ts: 6 as TimestampMs,
    symbol: SYMBOL,
    bids: [],
    asks: [],
  };
  const tradeEvent: TradeEvent = {
    kind: 'trade',
    ts: tradePayload.ts,
    payload: tradePayload,
    source: 'DEPTH',
    seq: 0,
    entry: 'z-entry.jsonl',
  };
  const depthEvent: DepthEvent = {
    kind: 'depth',
    ts: depthPayload.ts,
    payload: depthPayload,
    source: 'DEPTH',
    seq: 0,
    entry: 'a-entry.jsonl',
  };
  const merged = createMergedStream(
    toAsync([tradeEvent]),
    toAsync([depthEvent]),
  );
  const result = await collect(merged);
  expect(result[0]?.entry).toBe('a-entry.jsonl');
  expect(result[1]?.entry).toBe('z-entry.jsonl');
});
