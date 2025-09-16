import type {
  Liquidity,
  OrderId,
  PriceInt,
  QtyInt,
  Side,
  TimestampMs,
} from '../types/index.js';
import type { Order } from '../sim/types.js';

export interface Fill {
  ts: TimestampMs;
  orderId: OrderId;
  price: PriceInt;
  qty: QtyInt;
  side: Side;
  liquidity: Liquidity;
  tradeRef?: string;
  sourceAggressor?: Side;
}

export type ExecutionReportKind = 'FILL' | 'ORDER_UPDATED' | 'END';

export interface ExecutionReport {
  ts: TimestampMs;
  kind: ExecutionReportKind;
  orderId?: OrderId;
  patch?: Partial<Order>;
  fill?: Fill;
}

export interface ExecutionOptions {
  preferDepthOnEqualTs?: boolean;
  treatLimitAsMaker?: boolean;
  participationFactor?: 0 | 1;
  useAggressorForLiquidity?: boolean;
}
