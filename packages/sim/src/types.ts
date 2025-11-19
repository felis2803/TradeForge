export type Side = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';

export interface SubmitOrder {
  clientId?: string;
  type: OrderType;
  side: Side;
  qty: bigint;
  price?: bigint;
  ts?: number;
}

export interface Trade {
  ts: number;
  price: bigint;
  qty: bigint;
  side: Side;
}

export interface DepthDiff {
  ts: number;
  seq: number;
  bids: [price: bigint, qty: bigint][];
  asks: [price: bigint, qty: bigint][];
}

export interface OrderBookLevel {
  price: bigint;
  qty: bigint;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  ts?: number;
  seq?: number;
}

export interface OrderBook {
  applyDiff(diff: DepthDiff): void;
  getSnapshot(depth?: number): OrderBookSnapshot;
}

export type OrderStatus =
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED';

export interface OrderView {
  id: string;
  clientId?: string;
  type: OrderType;
  side: Side;
  qty: bigint;
  price?: bigint;
  ts: number;
  status: OrderStatus;
  remainingQty: bigint;
  filledQty: bigint;
}

export interface FillEvent {
  orderId: string;
  side: Side;
  price: bigint;
  qty: bigint;
  ts: number;
  levelIndex: number;
}

export type RejectReason =
  | 'INVALID_ORDER'
  | 'REJECTED_BY_POLICY'
  | 'NO_LIQUIDITY';

export interface RejectEvent {
  orderId: string;
  clientId?: string;
  reason: RejectReason;
  order: SubmitOrder;
  ts: number;
  message?: string;
}

export interface EngineEvents {
  orderAccepted(order: OrderView): void;
  orderUpdated(order: OrderView): void;
  orderFilled(fill: FillEvent): void;
  orderCanceled(order: OrderView): void;
  orderRejected(event: RejectEvent): void;
  tradeSeen(trade: Trade): void;
  error(err: Error): void;
}

export interface Engine {
  submitOrder(order: SubmitOrder): string;
  cancelOrder(orderId: string): boolean;
  on<E extends keyof EngineEvents>(event: E, cb: EngineEvents[E]): () => void;
  close(): Promise<void>;
}

export interface Clock {
  now(): number;
}

export interface ConservativePolicyConfig {
  enableConservativeForLimit?: boolean;
  tradeStalenessMs?: number;
}

export interface LiquidityConfig {
  maxSlippageLevels?: number;
  rejectOnExhaustedLiquidity?: boolean;
}

export interface EngineOptions {
  streams: {
    trades: AsyncIterable<Trade>;
    depth: AsyncIterable<DepthDiff>;
  };
  book: OrderBook;
  clock?: Clock;
  policy?: ConservativePolicyConfig;
  liquidity?: LiquidityConfig;
}
