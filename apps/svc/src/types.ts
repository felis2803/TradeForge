export type RunMode = 'history' | 'realtime';
export type RunSpeed = 'realtime' | '1x' | '2x' | 'as_fast_as_possible';

export interface InstrumentConfig {
  symbol: string;
  fees: {
    makerBp: number;
    takerBp: number;
  };
}

export interface RunConfig {
  id: string;
  mode: RunMode;
  speed: RunSpeed;
  exchange: string;
  dataOperator: string;
  instruments: InstrumentConfig[];
  maxActiveOrders: number;
  heartbeatTimeoutSec: number;
  dataReady: boolean;
}

export type RunLifecycleStatus =
  | 'idle'
  | 'configured'
  | 'running'
  | 'paused'
  | 'stopped';

export interface RunStateSnapshot {
  status: RunLifecycleStatus;
  config: RunConfig | null;
  runId: string | null;
  startedAt: number | null;
  pausedAt: number | null;
  stoppedAt: number | null;
}

export interface BotState {
  botName: string;
  initialBalanceInt: number;
  currentBalanceInt: number;
  connected: boolean;
  lastSeenTs: number;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_MARKET' | 'STOP_LIMIT';
export type OrderTimeInForce = 'GTC';
export type OrderFlag = 'postOnly';

export type InternalOrderStatus =
  | 'accepted'
  | 'open'
  | 'partiallyFilled'
  | 'filled'
  | 'canceled'
  | 'rejected';

export interface OrderRecord {
  serverOrderId: string;
  clientOrderId: string;
  botName: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qtyInt: number;
  priceInt?: number;
  stopPriceInt?: number;
  limitPriceInt?: number;
  status: InternalOrderStatus;
  timeInForce: OrderTimeInForce;
  flags: OrderFlag[];
  createdAt: number;
  updatedAt: number;
  notes?: string;
}

export interface TradeRecord {
  serverOrderId: string;
  botName: string;
  symbol: string;
  priceInt: number;
  qtyInt: number;
  side: OrderSide;
  liquidity: 'maker' | 'taker';
  feeInt: number;
  ts: number;
}

export interface BalanceSnapshotFile {
  updatedAt: number;
  balances: Array<
    Pick<BotState, 'botName' | 'initialBalanceInt' | 'currentBalanceInt'>
  >;
}

export interface RunFile {
  config: RunConfig | null;
  status: RunLifecycleStatus;
  createdAt: number;
  startedAt: number | null;
  pausedAt: number | null;
  stoppedAt: number | null;
  updatedAt: number;
}

export interface MetadataFile {
  exchange: string;
  dataOperator: string;
  instruments: InstrumentConfig[];
  heartbeatTimeoutSec: number;
  version: number;
}

export interface OrdersFile {
  updatedAt: number;
  orders: OrderRecord[];
}

export interface TradesFile {
  updatedAt: number;
  trades: TradeRecord[];
}

export interface WsEnvelope<TPayload = unknown> {
  type: string;
  ts: number;
  payload: TPayload;
  reqId?: string;
}
