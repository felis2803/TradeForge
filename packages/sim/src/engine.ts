import { AsyncQueue } from './async-queue.js';
import { EngineEventBus } from './event-bus.js';
import { OrderStore, type InternalOrder } from './order-store.js';
import { ConservativeGate } from './conservative-gate.js';
import { LiquidityPlanner, type PlannedLevel } from './liquidity-planner.js';
import { FillGenerator } from './fill-generator.js';
import { LocalLiquidityTracker } from './local-liquidity.js';
import type {
  DepthDiff,
  Engine,
  EngineEvents,
  EngineOptions,
  FillEvent,
  RejectEvent,
  RejectReason,
  Side,
  SubmitOrder,
  Trade,
} from './types.js';

interface SubmitEvent {
  type: 'submit';
  orderId: string;
  order: SubmitOrder;
}

interface CancelEvent {
  type: 'cancel';
  orderId: string;
}

interface DepthEvent {
  type: 'depth';
  diff: DepthDiff;
}

interface TradeEvent {
  type: 'trade';
  trade: Trade;
}

type LoopEvent = SubmitEvent | CancelEvent | DepthEvent | TradeEvent;

class EngineTime {
  private current = 0;
  constructor(private readonly clock?: EngineOptions['clock']) {}

  advanceTo(ts?: number): number {
    if (typeof ts === 'number' && Number.isFinite(ts)) {
      if (ts > this.current) {
        this.current = ts;
      }
    }
    return this.current;
  }

  now(ts?: number): number {
    if (typeof ts === 'number' && Number.isFinite(ts)) {
      return this.advanceTo(ts);
    }
    if (this.clock) {
      return this.advanceTo(this.clock.now());
    }
    return this.current;
  }

  getCurrent(): number {
    return this.current;
  }
}

export class EngineImpl implements Engine {
  private readonly queue = new AsyncQueue<LoopEvent>();
  private readonly eventBus = new EngineEventBus();
  private readonly orderStore = new OrderStore();
  private readonly conservativeGate: ConservativeGate;
  private readonly liquidityPlanner: LiquidityPlanner;
  private readonly fillGenerator = new FillGenerator();
  private readonly localLiquidity = new LocalLiquidityTracker();
  private readonly time: EngineTime;
  private readonly streams: EngineOptions['streams'];
  private readonly book: EngineOptions['book'];
  private readonly pendingSubmissions = new Set<string>();
  private readonly openMarketOrders = new Set<string>();
  private readonly streamIterators: AsyncIterator<unknown>[] = [];
  private readonly streamTasks: Promise<void>[] = [];
  private readonly processing: Promise<void>;
  private stopped = false;
  private closed?: Promise<void>;
  private nextOrderSeq = 0;

  constructor(options: EngineOptions) {
    this.streams = options.streams;
    this.book = options.book;
    this.conservativeGate = new ConservativeGate(options.policy);
    this.liquidityPlanner = new LiquidityPlanner(options.liquidity);
    this.time = new EngineTime(options.clock);
    this.processing = this.processEvents();
    this.consumeStream(this.streams.depth, (diff) => ({ type: 'depth', diff }));
    this.consumeStream(this.streams.trades, (trade) => ({
      type: 'trade',
      trade,
    }));
  }

  submitOrder(order: SubmitOrder): string {
    const orderId = this.generateOrderId();
    this.pendingSubmissions.add(orderId);
    const copy: SubmitOrder = { ...order };
    this.queue.push({ type: 'submit', orderId, order: copy });
    return orderId;
  }

  cancelOrder(orderId: string): boolean {
    const known =
      this.orderStore.has(orderId) || this.pendingSubmissions.has(orderId);
    if (!known) {
      return false;
    }
    this.queue.push({ type: 'cancel', orderId });
    return true;
  }

  on<E extends keyof EngineEvents>(event: E, cb: EngineEvents[E]): () => void {
    return this.eventBus.on(event, cb);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return this.closed;
    }
    this.stopped = true;
    const shutdown = async () => {
      for (const iterator of this.streamIterators) {
        if (typeof iterator.return === 'function') {
          try {
            await iterator.return();
          } catch {
            // ignore iterator errors on shutdown
          }
        }
      }
      this.queue.close();
      await Promise.allSettled(this.streamTasks);
      await this.processing;
    };
    this.closed = shutdown();
    return this.closed;
  }

  private generateOrderId(): string {
    this.nextOrderSeq += 1;
    return `ORD-${this.nextOrderSeq}`;
  }

  private consumeStream<T>(
    stream: AsyncIterable<T>,
    factory: (payload: T) => LoopEvent,
  ): void {
    const iterator = stream[Symbol.asyncIterator]();
    this.streamIterators.push(iterator);
    const task = (async () => {
      while (!this.stopped) {
        const { value, done } = await iterator.next();
        if (done) {
          break;
        }
        this.queue.push(factory(value));
      }
    })().catch((err) => {
      this.eventBus.emit(
        'error',
        err instanceof Error ? err : new Error(String(err)),
      );
    });
    this.streamTasks.push(task);
  }

  private async processEvents(): Promise<void> {
    for await (const event of this.queue) {
      switch (event.type) {
        case 'depth':
          this.handleDepth(event.diff);
          break;
        case 'trade':
          this.handleTrade(event.trade);
          break;
        case 'submit':
          this.handleSubmit(event.orderId, event.order);
          break;
        case 'cancel':
          this.handleCancel(event.orderId);
          break;
      }
    }
  }

  private handleDepth(diff: DepthDiff): void {
    this.time.advanceTo(diff.ts);
    this.book.applyDiff(diff);
    this.localLiquidity.reset();
    this.matchOpenMarkets(this.time.getCurrent());
  }

  private handleTrade(trade: Trade): void {
    this.time.advanceTo(trade.ts);
    this.conservativeGate.updateTrade(trade);
    this.eventBus.emit('tradeSeen', trade);
    this.matchPendingLimits('BUY');
    this.matchPendingLimits('SELL');
    this.matchOpenMarkets(this.time.getCurrent());
  }

  private handleSubmit(orderId: string, order: SubmitOrder): void {
    this.pendingSubmissions.delete(orderId);
    const now = this.time.now(order.ts);
    const validationError = this.validate(order);
    if (validationError) {
      this.emitRejection(orderId, order, 'INVALID_ORDER', now, validationError);
      return;
    }
    const internal = this.orderStore.create(orderId, order, now);
    const view = this.orderStore.toView(internal);
    this.eventBus.emit('orderAccepted', view);
    if (internal.type === 'MARKET') {
      this.openMarketOrders.add(internal.id);
      this.executeMarket(internal, now);
    } else {
      this.tryExecuteLimit(internal, now);
    }
  }

  private handleCancel(orderId: string): void {
    const order = this.orderStore.get(orderId);
    if (!order) {
      return;
    }
    if (
      order.status === 'FILLED' ||
      order.status === 'CANCELED' ||
      order.status === 'REJECTED'
    ) {
      return;
    }
    const now = this.time.now();
    const view = this.orderStore.cancel(order, now);
    this.openMarketOrders.delete(orderId);
    this.eventBus.emit('orderCanceled', view);
    this.orderStore.delete(orderId);
  }

  private validate(order: SubmitOrder): string | null {
    if (order.qty <= 0n) {
      return 'qty must be positive';
    }
    if (order.type === 'LIMIT') {
      if (order.price === undefined) {
        return 'limit price required';
      }
      if (order.price <= 0n) {
        return 'limit price must be positive';
      }
    }
    return null;
  }

  private emitRejection(
    orderId: string,
    order: SubmitOrder,
    reason: RejectReason,
    ts: number,
    message?: string,
  ): void {
    const event: RejectEvent = {
      orderId,
      reason,
      order,
      ts,
    };
    if (order.clientId !== undefined) {
      event.clientId = order.clientId;
    }
    if (message !== undefined) {
      event.message = message;
    }
    this.eventBus.emit('orderRejected', event);
  }

  private matchPendingLimits(side: Side): void {
    const now = this.time.getCurrent();
    const pending = this.orderStore.getPendingForSide(side);
    for (const order of pending) {
      this.tryExecuteLimit(order, now);
    }
  }

  private tryExecuteLimit(order: InternalOrder, now: number): void {
    if (!this.conservativeGate.isLimitAllowed(order, now)) {
      this.orderStore.markAwaiting(order, true);
      return;
    }
    this.orderStore.markAwaiting(order, false);
    const snapshot = this.localLiquidity.apply(this.book.getSnapshot());
    const plan = this.liquidityPlanner.planLimit(order, snapshot);
    this.applyPlan(order, plan.levels, plan.exhausted, now);
    if (order.remainingQty > 0n) {
      this.orderStore.markAwaiting(order, true);
    }
  }

  private executeMarket(order: InternalOrder, now: number): void {
    const depth = this.book.getSnapshot(
      this.liquidityPlanner.getMaxSlippageLevels(),
    );
    const snapshot = this.localLiquidity.apply(depth);
    const plan = this.liquidityPlanner.planMarket(order, snapshot);
    this.applyPlan(order, plan.levels, plan.exhausted, now, true);
    if (order.remainingQty > 0n) {
      if (plan.exhausted && this.liquidityPlanner.shouldRejectOnExhaustion()) {
        this.rejectExistingOrder(
          order,
          'NO_LIQUIDITY',
          now,
          'market liquidity exhausted',
        );
      } else {
        this.openMarketOrders.add(order.id);
      }
    } else {
      this.openMarketOrders.delete(order.id);
    }
  }

  private applyPlan(
    order: InternalOrder,
    levels: PlannedLevel[],
    exhausted: boolean,
    ts: number,
    isMarket = false,
  ): void {
    if (levels.length === 0) {
      if (
        isMarket &&
        exhausted &&
        this.liquidityPlanner.shouldRejectOnExhaustion()
      ) {
        this.rejectExistingOrder(
          order,
          'NO_LIQUIDITY',
          ts,
          'market liquidity exhausted',
        );
      }
      return;
    }
    const { fills, totalFilled } = this.fillGenerator.generate(
      order,
      levels,
      ts,
    );
    if (totalFilled === 0n) {
      if (
        isMarket &&
        exhausted &&
        this.liquidityPlanner.shouldRejectOnExhaustion()
      ) {
        this.rejectExistingOrder(
          order,
          'NO_LIQUIDITY',
          ts,
          'market liquidity exhausted',
        );
      }
      return;
    }
    this.localLiquidity.recordConsumption(order.side, fills);
    for (const fill of fills) {
      this.applyFill(order, fill);
    }
    const updated = this.orderStore.toView(order);
    this.eventBus.emit('orderUpdated', updated);
    if (order.remainingQty === 0n) {
      this.openMarketOrders.delete(order.id);
    } else if (
      isMarket &&
      exhausted &&
      this.liquidityPlanner.shouldRejectOnExhaustion()
    ) {
      this.rejectExistingOrder(
        order,
        'NO_LIQUIDITY',
        ts,
        'market liquidity exhausted',
      );
    }
  }

  private applyFill(order: InternalOrder, fill: FillEvent): void {
    this.orderStore.applyFill(order, { qty: fill.qty, ts: fill.ts });
    this.eventBus.emit('orderFilled', fill);
    if (order.status === 'FILLED') {
      this.orderStore.delete(order.id);
    }
  }

  private rejectExistingOrder(
    order: InternalOrder,
    reason: RejectReason,
    ts: number,
    message?: string,
  ): void {
    this.orderStore.reject(order.id);
    this.openMarketOrders.delete(order.id);
    const view = this.orderStore.toView(order);
    this.eventBus.emit('orderUpdated', view);
    const event: RejectEvent = {
      orderId: order.id,
      reason,
      order: order.request,
      ts,
    };
    if (order.clientId !== undefined) {
      event.clientId = order.clientId;
    }
    if (message !== undefined) {
      event.message = message;
    }
    this.eventBus.emit('orderRejected', event);
    this.orderStore.delete(order.id);
  }

  private matchOpenMarkets(now: number): void {
    if (this.openMarketOrders.size === 0) {
      return;
    }
    const ids = Array.from(this.openMarketOrders);
    for (const id of ids) {
      const order = this.orderStore.get(id);
      if (!order) {
        this.openMarketOrders.delete(id);
        continue;
      }
      if (
        order.status === 'FILLED' ||
        order.status === 'CANCELED' ||
        order.status === 'REJECTED'
      ) {
        this.openMarketOrders.delete(id);
        continue;
      }
      if (order.remainingQty <= 0n) {
        this.openMarketOrders.delete(id);
        continue;
      }
      this.executeMarket(order, now);
    }
  }
}
