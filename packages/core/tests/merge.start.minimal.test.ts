import {
  createMergedStream,
  MergeStartState,
  TradeEvent,
  DepthEvent,
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

async function collect(iter: AsyncIterable<TradeEvent | DepthEvent>) {
  const out: (TradeEvent | DepthEvent)[] = [];
  for await (const value of iter) {
    out.push(value);
  }
  return out;
}

function makeTradeEvent(ts: number, seq: number): TradeEvent {
  const payload = {
    ts: ts as TimestampMs,
    symbol: SYMBOL,
    price: BigInt(10000 + seq) as PriceInt,
    qty: BigInt(1 + seq) as QtyInt,
  };
  return {
    kind: 'trade',
    ts: payload.ts,
    payload,
    source: 'TRADES',
    seq,
    entry: 'trades.jsonl',
  };
}

function makeDepthEvent(ts: number, seq: number): DepthEvent {
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
  return {
    kind: 'depth',
    ts: payload.ts,
    payload,
    source: 'DEPTH',
    seq,
    entry: 'depth.jsonl',
  };
}

test('start.nextSourceOnEqualTs overrides only the first tie', async () => {
  const trades = [makeTradeEvent(1, 0), makeTradeEvent(2, 1)];
  const depth = [makeDepthEvent(1, 0), makeDepthEvent(2, 1)];
  const start: MergeStartState = { nextSourceOnEqualTs: 'TRADES' };

  const merged = createMergedStream(toAsync(trades), toAsync(depth), start, {
    preferDepthOnEqualTs: true,
  });
  const result = await collect(merged);
  expect(result.map((e) => [e.source, Number(e.ts)])).toEqual([
    ['TRADES', 1],
    ['DEPTH', 1],
    ['DEPTH', 2],
    ['TRADES', 2],
  ]);

  const mergedRepeat = createMergedStream(
    toAsync(trades),
    toAsync(depth),
    start,
    { preferDepthOnEqualTs: true },
  );
  const repeat = await collect(mergedRepeat);
  expect(repeat.map((e) => [e.source, Number(e.ts)])).toEqual([
    ['TRADES', 1],
    ['DEPTH', 1],
    ['DEPTH', 2],
    ['TRADES', 2],
  ]);
});
