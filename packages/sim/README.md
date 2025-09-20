# @tradeforge/sim

A deterministic simulation engine that replays historical order book activity and allows
submitting synthetic orders. The engine consumes normalized depth and trade streams
(A1 feeds), applies L2 order book updates (A2), and produces a deterministic stream of
order lifecycle events.

## Quick start

```ts
import { createEngine, type DepthDiff, type Trade } from '@tradeforge/sim';
import { InMemoryBook } from './your-orderbook-impl';

const depthStream: AsyncIterable<DepthDiff> = getDepth();
const tradeStream: AsyncIterable<Trade> = getTrades();
const engine = createEngine({
  streams: { depth: depthStream, trades: tradeStream },
  book: new InMemoryBook(),
});

const unsubscribe = engine.on('orderFilled', (fill) => {
  console.log('fill', fill.orderId, fill.qty.toString(), fill.price.toString());
});

const orderId = engine.submitOrder({
  type: 'LIMIT',
  side: 'BUY',
  qty: 3n,
  price: 1000n,
});

// remember to stop consumers when done
await engine.close();
unsubscribe();
```

## Conservative matching

`@tradeforge/sim` uses a conservative policy for limit orders. A limit order is only
eligible for matching after a real trade has crossed its price on the relevant side.
By default, the engine remembers the last trade per aggressor side and requires it to be
no older than `tradeStalenessMs` (2 seconds by default). Market orders bypass the
conservative gate and consume the best available liquidity immediately.

The policy is configurable via `createEngine({ policy: { ... } })`:

- `enableConservativeForLimit` – disable to match limits against the book immediately.
- `tradeStalenessMs` – adjust the freshness window that unlocks resting limits.

## Invariants

The engine enforces several invariants that are covered by unit and integration tests:

| Id  | Description                                                                           |
| --- | ------------------------------------------------------------------------------------- |
| I1  | No limit fill is emitted without a qualifying trade first unlocking the price.        |
| I2  | Executed prices honour the limit (buy ≤ limit price, sell ≥ limit price).             |
| I3  | Event processing is deterministic – identical inputs yield identical streams.         |
| I4  | Market orders respect `maxSlippageLevels` and optionally reject exhausted remainders. |
| I5  | Cancels are idempotent and never produce fills after acknowledgement.                 |

## Liquidity and market behaviour

Market orders consume the current book, respecting the configured slippage policy:

- `maxSlippageLevels` – the number of price levels that can be consumed per attempt.
- `rejectOnExhaustedLiquidity` – when `true`, any unfilled remainder produces an
  immediate rejection event; otherwise the order stays open and will retry when fresh
  liquidity arrives.

Limit orders stay in the internal store until a trade unlocks their price. Partial fills
requeue the order and wait for the next qualifying trade.

## FAQ

**Why did my limit order remain open?**

Most likely there was no qualifying trade within the configured freshness window. Check
`tradeSeen` events or widen `tradeStalenessMs` while testing.

**How do I log the event stream?**

Attach listeners using `engine.on(...)` and write the payloads to NDJSON or any other
format that suits your tooling. All lifecycle events share the same deterministic order
across runs, which makes diffing straightforward.

## Development

- `pnpm --filter @tradeforge/sim test` – run the simulation unit and integration tests.
- `pnpm --filter @tradeforge/sim build` – build the ESM bundle with type declarations.

The repository CI also executes determinism and soft performance checks to guarantee a
stable replay environment.
