import type { brand } from '../types/brands.js';
import type {
  NotionalInt,
  OrderId,
  PriceInt,
  QtyInt,
  SymbolId,
  TimestampMs,
} from '../types/index.js';
import type { Fill } from '../engine/types.js';
import type { OrderbookProvider } from './orderbook.mock.js';

export type AccountId = brand<string, 'AccountId'>;
export type Currency = string;

export interface Balances {
  free: bigint;
  locked: bigint;
}

export interface Account {
  id: AccountId;
  apiKey: string;
  balances: Map<Currency, Balances>;
}

export interface SymbolConfig {
  base: Currency;
  quote: Currency;
  priceScale: number;
  qtyScale: number;
}

export type OrderType = 'LIMIT' | 'MARKET' | 'STOP_LIMIT' | 'STOP_MARKET';
export type OrderSide = 'BUY' | 'SELL';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';
export type OrderStatus =
  | 'NEW'
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELED'
  | 'REJECTED';

export type RejectReason =
  | 'UNSUPPORTED_EXECUTION'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_PARAMS'
  | 'UNKNOWN_SYMBOL';

export interface Order {
  id: OrderId;
  tsCreated: TimestampMs;
  tsUpdated: TimestampMs;
  symbol: SymbolId;
  type: OrderType;
  side: OrderSide;
  tif: TimeInForce;
  price?: PriceInt;
  qty: QtyInt;
  status: OrderStatus;
  rejectReason?: RejectReason;
  accountId: AccountId;
  executedQty: QtyInt;
  cumulativeQuote: NotionalInt;
  fees: {
    maker?: bigint;
    taker?: bigint;
  };
  fills: Fill[];
  reserved?: {
    currency: Currency;
    total: bigint;
    remaining: bigint;
  };
}

export interface FeeConfig {
  makerBps: number;
  takerBps: number;
}

export interface ExchangeStateConfig {
  symbols: Record<string, SymbolConfig>;
  fee: FeeConfig;
  orderbook: OrderbookProvider;
}

export interface PlaceOrderInput {
  accountId: AccountId;
  symbol: SymbolId;
  type: OrderType;
  side: OrderSide;
  qty: QtyInt;
  price?: PriceInt;
  tif?: TimeInForce;
}

export interface CancelOrderResult extends Order {}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function calcFee(notional: bigint, bps: number): bigint {
  if (!Number.isFinite(bps)) {
    throw new Error('bps must be finite');
  }
  if (!Number.isInteger(bps)) {
    throw new Error('bps must be an integer');
  }
  if (bps < 0) {
    throw new Error('bps must be non-negative');
  }
  const multiplier = BigInt(bps);
  if (multiplier === 0n || notional === 0n) {
    return 0n;
  }
  return (notional * multiplier) / 10000n;
}
