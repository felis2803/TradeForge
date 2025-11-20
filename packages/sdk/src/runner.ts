import { resolve } from 'node:path';
import {
  createJsonlCursorReader,
  type Trade,
  type DepthDiff,
} from '@tradeforge/io-binance';
import {
  createEngine,
  RealtimeOrderBook,
  type SubmitOrder,
  type OrderView,
  type FillEvent,
  type RejectEvent,
  type Trade as SimTrade,
  type DepthDiff as SimDepthDiff,
} from '@tradeforge/sim';

export interface BotContext {
  placeOrder(order: Omit<SubmitOrder, 'ts'>): string;
  cancelOrder(orderId: string): boolean;
}

export interface BotConfig {
  symbol: string;
  trades: string | string[];
  depth?: string | string[];
  onTrade?: (trade: Trade, ctx: BotContext) => void;
  onDepth?: (diff: DepthDiff, ctx: BotContext) => void;
  onOrderUpdate?: (order: OrderView) => void;
  onOrderFill?: (fill: FillEvent) => void;
  onOrderReject?: (event: RejectEvent) => void;
  onError?: (err: Error) => void;
}

function wrapStream<T>(
  source: AsyncIterable<T>,
  onDone: () => void,
): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      try {
        for await (const item of source) {
          yield item;
        }
      } finally {
        onDone();
      }
    },
  };
}

// Adapter to convert io-binance DepthDiff to sim DepthDiff
function adaptDepthStream(
  source: AsyncIterable<DepthDiff>,
): AsyncIterable<SimDepthDiff> {
  return {
    async *[Symbol.asyncIterator]() {
      let seq = 0;
      for await (const item of source) {
        const simDiff: SimDepthDiff = {
          ts: Number(item.ts),
          seq: seq++,
          bids: item.bids.map((l) => [l.price, l.qty]),
          asks: item.asks.map((l) => [l.price, l.qty]),
        };
        yield simDiff;
      }
    },
  };
}

export async function runBot(config: BotConfig): Promise<void> {
  const tradesFiles = Array.isArray(config.trades)
    ? config.trades
    : [config.trades];
  const depthFiles = config.depth
    ? Array.isArray(config.depth)
      ? config.depth
      : [config.depth]
    : [];

  const tradesSource = createJsonlCursorReader({
    kind: 'trades',
    files: tradesFiles.map((f) => resolve(f)),
  });

  // Force cast to AsyncIterable to avoid TS mismatch with CursorIterable
  const tradesSourceIter = tradesSource as AsyncIterable<Trade>;

  const depthSource =
    depthFiles.length > 0
      ? createJsonlCursorReader({
          kind: 'depth',
          files: depthFiles.map((f) => resolve(f)),
        })
      : (async function* () {})();

  const depthSourceIter = depthSource as AsyncIterable<DepthDiff>;

  let activeStreams = 0;
  let resolveFinished: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const checkDone = () => {
    activeStreams--;
    if (activeStreams === 0) {
      resolveFinished();
    }
  };

  activeStreams++; // trades
  const tradesStream = wrapStream(tradesSourceIter, checkDone);

  let depthStream = depthSourceIter;
  if (depthFiles.length > 0) {
    activeStreams++; // depth
    depthStream = wrapStream(depthSourceIter, checkDone);
  }

  const book = new RealtimeOrderBook();

  // Placeholder for the engine
  let engineRef: {
    submitOrder: (o: SubmitOrder) => string;
    cancelOrder: (id: string) => boolean;
  } | null = null;
  let currentTs = 0n;

  const ctx: BotContext = {
    placeOrder: (order) => {
      if (!engineRef) throw new Error('Engine not initialized');
      // Use tracked timestamp or 0 if not available yet
      return engineRef.submitOrder({ ...order, ts: Number(currentTs) });
    },
    cancelOrder: (orderId) => {
      if (!engineRef) throw new Error('Engine not initialized');
      return engineRef.cancelOrder(orderId);
    },
  };

  const tappedDepthStream = {
    async *[Symbol.asyncIterator]() {
      for await (const item of depthStream) {
        currentTs = BigInt(item.ts);
        config.onDepth?.(item, ctx);
        yield item;
      }
    },
  };

  const finalDepthStream = config.onDepth ? tappedDepthStream : depthStream;

  // Convert to SimDepthDiff for the engine
  const engineDepthStream = adaptDepthStream(finalDepthStream);

  const engineTradesStream = {
    async *[Symbol.asyncIterator]() {
      for await (const item of tradesStream) {
        currentTs = BigInt(item.ts);
        // Side is optional in core Trade, but required in Sim Trade.
        if (!item.side) continue;

        const simTrade: SimTrade = {
          ts: Number(item.ts),
          price: item.price,
          qty: item.qty,
          side: item.side,
        };
        yield simTrade;
      }
    },
  };

  const engine = createEngine({
    streams: {
      trades: engineTradesStream,
      depth: engineDepthStream,
    },
    book,
  });

  engineRef = {
    submitOrder: (order) => engine.submitOrder(order),
    cancelOrder: (id) => engine.cancelOrder(id),
  };

  engine.on('tradeSeen', (trade: SimTrade) => {
    // Inject symbol to match Trade interface from io-binance
    const fullTrade = { ...trade, symbol: config.symbol } as unknown as Trade;
    config.onTrade?.(fullTrade, ctx);
  });

  engine.on('orderUpdated', (order: OrderView) => {
    config.onOrderUpdate?.(order);
  });

  engine.on('orderFilled', (fill: FillEvent) => {
    config.onOrderFill?.(fill);
  });

  engine.on('orderRejected', (event: RejectEvent) => {
    config.onOrderReject?.(event);
  });

  engine.on('error', (err: Error) => {
    if (config.onError) {
      config.onError(err);
    } else {
      console.error('Engine error:', err);
    }
  });

  await finished;
  await engine.close();
}
