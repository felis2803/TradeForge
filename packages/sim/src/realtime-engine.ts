import type {
  AccountsService,
  ExchangeState,
  OrdersService,
  PlaceOrderInput,
} from '@tradeforge/core';
import {
  type Fill,
  type Liquidity,
  type Order,
  type OrderId,
  type PriceInt,
  type QtyInt,
  type SymbolId,
  type TimestampMs,
} from '@tradeforge/core';

import { EngineImpl } from './engine.js';
import { RealtimeOrderBook } from './realtime-orderbook.js';
import type {
  Clock,
  ConservativePolicyConfig,
  DepthDiff,
  Engine,
  EngineOptions,
  LiquidityConfig,
  RejectReason,
  SubmitOrder,
  Trade,
} from './types.js';

interface StreamSource<T> {
  stream: AsyncIterable<T>;
  close?: () => Promise<void> | void;
}

type StreamInput<T> = AsyncIterable<T> | StreamSource<T>;

function normalizeStream<T>(input: StreamInput<T>): StreamSource<T> {
  if (typeof (input as StreamSource<T>).stream === 'object') {
    const candidate = input as StreamSource<T>;
    if (
      candidate.stream &&
      typeof candidate.stream[Symbol.asyncIterator] === 'function'
    ) {
      return candidate;
    }
  }
  return { stream: input as AsyncIterable<T> };
}

type Listener<T> = (payload: T) => void;

type RealtimeEngineEventPayloads = {
  orderAccepted: Order;
  orderUpdated: Order;
  orderFilled: { order: Order; fill: Fill };
  orderCanceled: Order;
  orderRejected: Order;
  tradeSeen: Trade;
};

type EventName = keyof RealtimeEngineEventPayloads;

class RealtimeEventBus {
  private readonly listeners: {
    [K in EventName]: Set<Listener<RealtimeEngineEventPayloads[K]>>;
  } = {
    orderAccepted: new Set(),
    orderUpdated: new Set(),
    orderFilled: new Set(),
    orderCanceled: new Set(),
    orderRejected: new Set(),
    tradeSeen: new Set(),
  };

  on<E extends EventName>(
    event: E,
    listener: Listener<RealtimeEngineEventPayloads[E]>,
  ): () => void {
    const bucket = this.listeners[event];
    bucket.add(listener);
    return () => {
      bucket.delete(listener);
    };
  }

  emit<E extends EventName>(
    event: E,
    payload: RealtimeEngineEventPayloads[E],
  ): void {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }

  clear(): void {
    for (const bucket of Object.values(this.listeners)) {
      bucket.clear();
    }
  }
}

function toSubmitOrder(order: Order): SubmitOrder {
  if (order.type !== 'LIMIT' && order.type !== 'MARKET') {
    throw new Error(`Unsupported order type: ${order.type}`);
  }
  const qty = order.qty as unknown as bigint;
  const submit: SubmitOrder = {
    clientId: order.id as unknown as string,
    type: order.type,
    side: order.side,
    qty,
  };
  if (order.type === 'LIMIT') {
    if (order.price === undefined) {
      throw new Error('Limit order must have price');
    }
    submit.price = order.price as unknown as bigint;
  }
  return submit;
}

function mapRejectReason(
  reason: RejectReason,
): NonNullable<Order['rejectReason']> {
  switch (reason) {
    case 'INVALID_ORDER':
      return 'INVALID_PARAMS';
    case 'REJECTED_BY_POLICY':
    case 'NO_LIQUIDITY':
      return 'UNSUPPORTED_EXECUTION';
    default:
      return 'INVALID_PARAMS';
  }
}

function asTimestamp(value: number): TimestampMs {
  return value as unknown as TimestampMs;
}

function asPrice(value: bigint): PriceInt {
  return value as unknown as PriceInt;
}

function asQty(value: bigint): QtyInt {
  return value as unknown as QtyInt;
}

const TAKER: Liquidity = 'TAKER';

export interface RealtimeEngineOptions {
  symbol: SymbolId;
  state: ExchangeState;
  accounts: AccountsService;
  orders: OrdersService;
  streams: {
    depth: StreamInput<DepthDiff>;
    trades: StreamInput<Trade>;
  };
  clock?: Clock;
  policy?: ConservativePolicyConfig;
  liquidity?: LiquidityConfig;
}

export interface RealtimeEngineAdapter {
  readonly engine: Engine;
  placeOrder(input: PlaceOrderInput): Order;
  cancelOrder(orderId: OrderId): boolean;
  on<E extends EventName>(
    event: E,
    listener: Listener<RealtimeEngineEventPayloads[E]>,
  ): () => void;
  close(): Promise<void>;
}

export function createRealtimeEngine(
  options: RealtimeEngineOptions,
): RealtimeEngineAdapter {
  if (!options.state.getSymbolConfig(options.symbol)) {
    throw new Error(`Unknown symbol: ${String(options.symbol)}`);
  }
  const depthSource = normalizeStream(options.streams.depth);
  const tradeSource = normalizeStream(options.streams.trades);
  const book = new RealtimeOrderBook();
  const engineOptions: EngineOptions = {
    streams: { depth: depthSource.stream, trades: tradeSource.stream },
    book,
  };
  if (options.clock !== undefined) {
    engineOptions.clock = options.clock;
  }
  if (options.policy !== undefined) {
    engineOptions.policy = options.policy;
  }
  if (options.liquidity !== undefined) {
    engineOptions.liquidity = options.liquidity;
  }
  const engine = new EngineImpl(engineOptions);

  const eventBus = new RealtimeEventBus();
  const engineToCore = new Map<string, OrderId>();
  const coreToEngine = new Map<OrderId, string>();
  const disposers: Array<() => void> = [];
  let closed: Promise<void> | undefined;

  function link(engineId: string, orderId: OrderId): void {
    engineToCore.set(engineId, orderId);
    coreToEngine.set(orderId, engineId);
  }

  function unlink(engineId: string): void {
    const coreOrderId = engineToCore.get(engineId);
    if (coreOrderId) {
      coreToEngine.delete(coreOrderId);
    }
    engineToCore.delete(engineId);
  }

  function getCoreOrder(engineId: string): Order | undefined {
    const orderId = engineToCore.get(engineId);
    if (!orderId) {
      return undefined;
    }
    try {
      return options.orders.getOrder(orderId);
    } catch {
      return undefined;
    }
  }

  disposers.push(
    engine.on('orderAccepted', (view) => {
      const order = view.clientId
        ? options.orders.getOrder(view.clientId as unknown as OrderId)
        : getCoreOrder(view.id);
      if (!order) {
        return;
      }
      eventBus.emit('orderAccepted', order);
    }),
  );

  disposers.push(
    engine.on('orderFilled', (fill) => {
      const orderId = engineToCore.get(fill.orderId);
      if (!orderId) {
        return;
      }
      const fillPayload: Fill = {
        ts: asTimestamp(fill.ts),
        orderId,
        price: asPrice(fill.price),
        qty: asQty(fill.qty),
        side: fill.side,
        liquidity: TAKER,
      };
      const order = options.orders.applyFill(orderId, fillPayload);
      eventBus.emit('orderFilled', { order, fill: fillPayload });
    }),
  );

  disposers.push(
    engine.on('orderUpdated', (view) => {
      const orderId = engineToCore.get(view.id);
      if (!orderId && !view.clientId) {
        return;
      }
      const resolvedId = orderId ?? (view.clientId as unknown as OrderId);
      if (!resolvedId) {
        return;
      }
      if (view.status === 'FILLED') {
        const order = options.orders.closeOrder(resolvedId, 'FILLED');
        unlink(view.id);
        eventBus.emit('orderUpdated', order);
        return;
      }
      if (view.status === 'REJECTED') {
        const order = options.orders.closeOrder(resolvedId, 'CANCELED');
        order.status = 'REJECTED';
        unlink(view.id);
        eventBus.emit('orderUpdated', order);
        return;
      }
      const order = options.orders.getOrder(resolvedId);
      eventBus.emit('orderUpdated', order);
    }),
  );

  disposers.push(
    engine.on('orderCanceled', (view) => {
      const orderId = engineToCore.get(view.id);
      if (!orderId) {
        return;
      }
      const order = options.orders.closeOrder(orderId, 'CANCELED');
      unlink(view.id);
      eventBus.emit('orderCanceled', order);
      eventBus.emit('orderUpdated', order);
    }),
  );

  disposers.push(
    engine.on('orderRejected', (event) => {
      const orderId = event.clientId
        ? (event.clientId as unknown as OrderId)
        : engineToCore.get(event.orderId);
      if (!orderId) {
        return;
      }
      const order = options.orders.getOrder(orderId);
      if (event.reason === undefined) {
        order.rejectReason = mapRejectReason('INVALID_ORDER');
      } else {
        order.rejectReason = mapRejectReason(event.reason);
      }
      order.status = 'REJECTED';
      eventBus.emit('orderRejected', order);
      eventBus.emit('orderUpdated', order);
    }),
  );

  disposers.push(
    engine.on('tradeSeen', (trade) => {
      eventBus.emit('tradeSeen', trade);
    }),
  );

  function placeOrder(input: PlaceOrderInput): Order {
    if (input.symbol !== options.symbol) {
      throw new Error('Symbol mismatch for realtime engine');
    }
    const order = options.orders.placeOrder(input);
    if (order.status === 'REJECTED') {
      eventBus.emit('orderRejected', order);
      eventBus.emit('orderUpdated', order);
      return order;
    }
    const submit = toSubmitOrder(order);
    const engineId = engine.submitOrder(submit);
    link(engineId, order.id);
    return order;
  }

  function cancelOrder(orderId: OrderId): boolean {
    const engineId = coreToEngine.get(orderId);
    if (!engineId) {
      return false;
    }
    return engine.cancelOrder(engineId);
  }

  async function close(): Promise<void> {
    if (!closed) {
      closed = (async () => {
        for (const dispose of disposers.splice(0)) {
          dispose();
        }
        eventBus.clear();
        await Promise.allSettled([
          (async () => {
            if (depthSource.close) {
              await depthSource.close();
            }
          })(),
          (async () => {
            if (tradeSource.close) {
              await tradeSource.close();
            }
          })(),
        ]);
        await engine.close();
      })();
    }
    return closed;
  }

  return {
    engine,
    placeOrder,
    cancelOrder,
    on: (event, listener) => eventBus.on(event, listener),
    close,
  };
}
