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

export interface LiquidationEvent {
  reason: string;
  position: bigint;
  balance: bigint;
  unrealizedPnL: bigint;
  equity: bigint;
  minEquity: bigint;
  ts: number;
}

export interface BotContext {
  placeOrder(order: Omit<SubmitOrder, 'ts'>): string;
  cancelOrder(orderId: string): boolean;
  readonly position: bigint;
  readonly balance: bigint;
  readonly unrealizedPnL: bigint;
  readonly equity: bigint;
}

export interface BotConfig {
  symbol: string;
  trades: string | string[] | AsyncIterable<Trade>;
  depth?: string | string[] | AsyncIterable<DepthDiff>;
  onTrade?: (trade: Trade, ctx: BotContext) => void;
  onDepth?: (diff: DepthDiff, ctx: BotContext) => void;
  onOrderUpdate?: (order: OrderView) => void;
  onOrderFill?: (fill: FillEvent, ctx: BotContext) => void;
  onOrderReject?: (event: RejectEvent) => void;
  onLiquidation?: (event: LiquidationEvent) => void;
  onError?: (err: Error) => void;
  initialBasePosition?: bigint;
  initialQuoteBalance?: bigint;
  liquidationMarginRatio?: number; // Default: 0.1 (10%)
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

function isAsyncIterable<T>(input: unknown): input is AsyncIterable<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!input && typeof (input as any)[Symbol.asyncIterator] === 'function';
}

export async function runBot(config: BotConfig): Promise<void> {
  let tradesSource: AsyncIterable<Trade>;

  if (isAsyncIterable(config.trades)) {
    tradesSource = config.trades;
  } else {
    const tradesFiles = Array.isArray(config.trades)
      ? config.trades
      : [config.trades];
    tradesSource = createJsonlCursorReader({
      kind: 'trades',
      files: tradesFiles.map((f) => resolve(f)),
    }) as AsyncIterable<Trade>;
  }

  let depthSource: AsyncIterable<DepthDiff>;

  if (config.depth && isAsyncIterable(config.depth)) {
    depthSource = config.depth;
  } else {
    const depthFiles = config.depth
      ? Array.isArray(config.depth)
        ? config.depth
        : [config.depth]
      : [];

    depthSource =
      depthFiles.length > 0
        ? (createJsonlCursorReader({
            kind: 'depth',
            files: depthFiles.map((f) => resolve(f)),
          }) as AsyncIterable<DepthDiff>)
        : (async function* () {})();
  }

  const tradesSourceIter = tradesSource;
  const depthSourceIter = depthSource;

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
  // Check if depth source is effectively empty (the empty generator we created)
  // This check is a bit loose but sufficient for now.
  // If it's an array of files and empty, we know it's empty.
  // If it's an iterable, we assume it might have data.
  const hasDepth =
    config.depth &&
    (isAsyncIterable(config.depth) ||
      (Array.isArray(config.depth) && config.depth.length > 0) ||
      typeof config.depth === 'string');

  if (hasDepth) {
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

  let position = config.initialBasePosition ?? 0n;
  let balance = config.initialQuoteBalance ?? 0n;
  const initialBalance = balance;
  let totalCost = 0n; // Cost basis for P/L calculation
  let lastPrice = 0n; // Last seen price from trades
  const MARGIN_RATIO = config.liquidationMarginRatio ?? 0.1;
  const minEquity = BigInt(Math.floor(Number(initialBalance) * MARGIN_RATIO));
  let isLiquidating = false;

  // Helper: Calculate unrealized PnL
  const calculateUnrealizedPnL = (): bigint => {
    if (lastPrice === 0n) return 0n;
    return position * lastPrice - totalCost;
  };

  // Helper: Calculate equity
  const calculateEquity = (): bigint => {
    return balance + calculateUnrealizedPnL();
  };

  // Helper: Check if liquidation needed
  const shouldLiquidate = (): boolean => {
    if (isLiquidating) return false; // Already liquidating
    if (position === 0n) return false; // No position to liquidate
    const equity = calculateEquity();
    return equity < minEquity;
  };

  // Helper: Check if order would violate margin
  const checkSufficientBalance = (order: Omit<SubmitOrder, 'ts'>): boolean => {
    // Estimate worst-case cost for this order
    let estimatedCost = 0n;
    if (order.side === 'BUY') {
      // For buy, we need to pay price * qty
      const price = order.type === 'LIMIT' ? (order.price ?? 0n) : lastPrice;
      estimatedCost = price * order.qty;
    } else {
      // For sell, we receive funds, so cost is negative (adds to balance)
      const price = order.type === 'LIMIT' ? (order.price ?? 0n) : lastPrice;
      estimatedCost = -(price * order.qty);
    }

    // Calculate equity after this order
    const newBalance = balance - estimatedCost;
    const equity = newBalance + calculateUnrealizedPnL();
    return equity >= minEquity;
  };

  // Helper: Trigger liquidation
  const triggerLiquidation = () => {
    if (isLiquidating) return;
    if (position === 0n) return;

    isLiquidating = true;
    const equity = calculateEquity();
    const unrealizedPnL = calculateUnrealizedPnL();

    // Log liquidation event
    const liquidationEvent: LiquidationEvent = {
      reason: `Equity (${equity}) fell below minimum (${minEquity})`,
      position,
      balance,
      unrealizedPnL,
      equity,
      minEquity,
      ts: Number(currentTs),
    };

    config.onLiquidation?.(liquidationEvent);

    // Close position with market order
    const closeSide = position > 0n ? 'SELL' : 'BUY';
    const closeQty = position > 0n ? position : -position;

    if (engineRef && closeQty > 0n) {
      try {
        engineRef.submitOrder({
          type: 'MARKET',
          side: closeSide,
          qty: closeQty,
          ts: Number(currentTs),
        });
      } catch (err) {
        console.error('[Liquidation] Failed to submit liquidation order:', err);
      }
    }
  };

  const ctx: BotContext = {
    placeOrder: (order) => {
      if (!engineRef) throw new Error('Engine not initialized');

      // Pre-execution validation
      if (!checkSufficientBalance(order)) {
        const equity = calculateEquity();
        console.error(
          `[Order Rejected] Insufficient balance. Order would violate margin requirement. ` +
            `Equity: ${equity}, Min required: ${minEquity}, Order: ${order.side} ${order.qty}`,
        );
        return ''; // Return empty string to indicate rejection
      }

      // Use tracked timestamp or 0 if not available yet
      return engineRef.submitOrder({ ...order, ts: Number(currentTs) });
    },
    cancelOrder: (orderId) => {
      if (!engineRef) throw new Error('Engine not initialized');
      return engineRef.cancelOrder(orderId);
    },
    get position() {
      return position;
    },
    get balance() {
      return balance;
    },
    get unrealizedPnL() {
      return calculateUnrealizedPnL();
    },
    get equity() {
      return calculateEquity();
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
    // Update last price for P/L calculation
    lastPrice = trade.price;
    // Inject symbol to match Trade interface from io-binance
    const fullTrade = { ...trade, symbol: config.symbol } as unknown as Trade;
    config.onTrade?.(fullTrade, ctx);

    // Check for liquidation after price update
    if (shouldLiquidate()) {
      triggerLiquidation();
    }
  });

  engine.on('orderUpdated', (order: OrderView) => {
    config.onOrderUpdate?.(order);
  });

  engine.on('orderFilled', (fill: FillEvent) => {
    if (fill.side === 'BUY') {
      position += fill.qty;
      balance -= fill.price * fill.qty;
      totalCost += fill.price * fill.qty;
    } else {
      position -= fill.qty;
      balance += fill.price * fill.qty;
      totalCost -= fill.price * fill.qty;
    }

    // Reset liquidation flag if position is closed
    if (position === 0n) {
      isLiquidating = false;
    }

    config.onOrderFill?.(fill, ctx);
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
