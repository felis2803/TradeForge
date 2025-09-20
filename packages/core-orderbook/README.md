# @tradeforge/core-orderbook

In-memory order book primitives for TradeForge simulations.

## Features

- Level 2 order book with bid/ask sides stored in sorted memory structures.
- Apply incremental L2 diffs or load full snapshots.
- Append-only trade store with iterators for time-window scans.
- Simple event hooks for updates and trades.
- Optimised for frequent updates (100k updates < 500 ms on Node.js 20).

## Usage

```ts
import { OrderBook } from '@tradeforge/core-orderbook';

const book = new OrderBook();

book.applyDiff({
  sequence: 42,
  timestamp: Date.now(),
  bids: [
    { price: 42110.4, size: 0.2 },
    { price: 42110.3, size: 0.15 },
  ],
  asks: [{ price: 42111.2, size: 0.18 }],
});

book.onUpdate((update) => {
  console.log('level change', update);
});

book.recordTrade({
  price: 42111.2,
  size: 0.05,
  side: 'ask',
  timestamp: Date.now(),
});

const snapshot = book.getSnapshot();
console.log(snapshot.bestBid, snapshot.bestAsk);

for (const trade of book.iterateTrades({
  fromTimestamp: snapshot.timestamp! - 60_000,
})) {
  console.log('recent trade', trade);
}
```

See [`examples/_data/orderbook-demo.ts`](../../examples/_data/orderbook-demo.ts) for a runnable sample.

## Invariants

- Diff metadata (`sequence`, `timestamp`) must be non-decreasing. Older values
  are rejected to prevent replay regressions.
- Levels with non-positive sizes are treated as deletions and will not emit
  update events if the level does not exist.
- Bid/ask books remain individually sorted; crossed states may appear if the
  incoming feed itself is crossed.
