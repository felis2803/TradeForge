import type {
  Liquidity,
  PriceInt,
  QtyInt,
  Side,
  TimestampMs,
} from '../types/index.js';
import type { Order } from '../sim/types.js';
import type { Fill } from './types.js';

interface LiquidityOptions {
  treatLimitAsMaker?: boolean;
  aggressorSide?: Side;
  useAggressorForLiquidity?: boolean;
}

export function determineLiquidity(
  order: Order,
  options: LiquidityOptions = {},
): Liquidity {
  if (options.useAggressorForLiquidity && options.aggressorSide) {
    return options.aggressorSide === order.side ? 'TAKER' : 'MAKER';
  }
  if (order.type === 'MARKET') {
    return 'TAKER';
  }
  if (options.treatLimitAsMaker ?? true) {
    return 'MAKER';
  }
  return 'TAKER';
}

export function createFill(params: {
  ts: TimestampMs;
  order: Order;
  price: PriceInt;
  qty: QtyInt;
  liquidity: Liquidity;
  tradeRef?: string;
  sourceAggressor?: Side;
}): Fill {
  const fill: Fill = {
    ts: params.ts,
    orderId: params.order.id,
    price: params.price,
    qty: params.qty,
    side: params.order.side,
    liquidity: params.liquidity,
  };
  if (params.sourceAggressor !== undefined) {
    fill.sourceAggressor = params.sourceAggressor;
  }
  if (params.tradeRef !== undefined) {
    fill.tradeRef = params.tradeRef;
  }
  return fill;
}

export function applyParticipationFactor(qty: QtyInt, factor: bigint): bigint {
  if (factor <= 0n) {
    return 0n;
  }
  return (qty as unknown as bigint) * factor;
}

export function compareOrdersForMatch(a: Order, b: Order): number {
  if (a.tsCreated !== b.tsCreated) {
    return (
      (a.tsCreated as unknown as number) - (b.tsCreated as unknown as number)
    );
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

export function getOrderRemainingQty(order: Order): QtyInt {
  const total = order.qty as unknown as bigint;
  const executed = order.executedQty as unknown as bigint;
  const remaining = total - executed;
  return (remaining > 0n ? remaining : 0n) as QtyInt;
}

export function crossesLimitPrice(order: Order, tradePrice: PriceInt): boolean {
  if (order.type === 'MARKET') {
    return true;
  }
  if (!order.price) {
    return false;
  }
  if (order.side === 'BUY') {
    return tradePrice <= order.price;
  }
  return tradePrice >= order.price;
}

export function cloneFees(fees: Order['fees']): Order['fees'] {
  const next: Order['fees'] = {};
  if (fees.maker !== undefined) {
    next.maker = fees.maker;
  }
  if (fees.taker !== undefined) {
    next.taker = fees.taker;
  }
  return next;
}
