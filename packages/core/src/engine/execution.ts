import type { MergedEvent } from '../merge/timeline.js';
import type { ExchangeState } from '../sim/state.js';
import { AccountsService } from '../sim/accounts.js';
import { OrdersService } from '../sim/orders.js';
import type { Order } from '../sim/types.js';
import type { PriceInt, QtyInt, TimestampMs } from '../types/index.js';
import {
  cloneFees,
  compareOrdersForMatch,
  createFill,
  crossesLimitPrice,
  determineLiquidity,
  applyParticipationFactor,
  getOrderRemainingQty,
} from './utils.js';
import type { ExecutionOptions, ExecutionReport } from './types.js';

function minQty(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function toQtyInt(value: bigint): QtyInt {
  return value as QtyInt;
}

function shouldTriggerStop(order: Order, tradePrice: PriceInt): boolean {
  if (order.activated) {
    return false;
  }
  if (order.type !== 'STOP_LIMIT' && order.type !== 'STOP_MARKET') {
    return false;
  }
  if (!order.triggerPrice || !order.triggerDirection) {
    return false;
  }
  const triggerPriceRaw = order.triggerPrice as unknown as bigint;
  const tradePriceRaw = tradePrice as unknown as bigint;
  if (order.triggerDirection === 'UP') {
    return tradePriceRaw >= triggerPriceRaw;
  }
  return tradePriceRaw <= triggerPriceRaw;
}

function buildOrderPatch(order: Order): Partial<Order> {
  return {
    status: order.status,
    executedQty: order.executedQty,
    cumulativeQuote: order.cumulativeQuote,
    fees: cloneFees(order.fees),
    tsUpdated: order.tsUpdated,
  } satisfies Partial<Order>;
}

export async function* executeTimeline(
  timeline: AsyncIterable<MergedEvent>,
  state: ExchangeState,
  options: ExecutionOptions = {},
): AsyncIterable<ExecutionReport> {
  const accounts = new AccountsService(state);
  const orders = new OrdersService(state, accounts);
  const treatLimitAsMaker = options.treatLimitAsMaker ?? true;
  const participationFactor = BigInt(options.participationFactor ?? 1);
  const useAggressorForLiquidity = options.useAggressorForLiquidity ?? false;
  let lastTs: TimestampMs | undefined;

  for await (const event of timeline) {
    lastTs = event.ts;
    if (event.kind !== 'trade') {
      continue;
    }
    const trade = event.payload;
    const stopOrders = Array.from(orders.getStopOrders(trade.symbol));
    if (stopOrders.length > 0) {
      const triggeredStops = stopOrders.filter((order) =>
        shouldTriggerStop(order, trade.price),
      );
      if (triggeredStops.length > 0) {
        triggeredStops.sort(compareOrdersForMatch);
        for (const stopOrder of triggeredStops) {
          orders.activateStopOrder(stopOrder, {
            ts: event.ts,
            tradePrice: trade.price,
          });
        }
      }
    }
    const openOrders = Array.from(orders.getOpenOrders(trade.symbol));
    if (openOrders.length === 0) {
      continue;
    }
    openOrders.sort(compareOrdersForMatch);
    let remainingTradeQty = applyParticipationFactor(
      trade.qty,
      participationFactor,
    );
    if (remainingTradeQty <= 0n) {
      continue;
    }
    for (const order of openOrders) {
      const crosses = crossesLimitPrice(order, trade.price);
      const remainingOrderQty = getOrderRemainingQty(
        order,
      ) as unknown as bigint;
      if (remainingOrderQty <= 0n) {
        continue;
      }
      if (order.tif === 'FOK') {
        if (!crosses || remainingTradeQty < remainingOrderQty) {
          const canceled = orders.cancelOrder(order.id);
          if (canceled.status === 'CANCELED') {
            yield {
              ts: event.ts,
              kind: 'ORDER_UPDATED',
              orderId: order.id,
              patch: buildOrderPatch(canceled),
            } satisfies ExecutionReport;
          }
          continue;
        }
      }
      if (!crosses) {
        if (order.tif === 'IOC') {
          const canceled = orders.cancelOrder(order.id);
          if (canceled.status === 'CANCELED') {
            yield {
              ts: event.ts,
              kind: 'ORDER_UPDATED',
              orderId: order.id,
              patch: buildOrderPatch(canceled),
            } satisfies ExecutionReport;
          }
        }
        continue;
      }
      if (remainingTradeQty <= 0n) {
        if (order.tif === 'IOC') {
          const canceled = orders.cancelOrder(order.id);
          if (canceled.status === 'CANCELED') {
            yield {
              ts: event.ts,
              kind: 'ORDER_UPDATED',
              orderId: order.id,
              patch: buildOrderPatch(canceled),
            } satisfies ExecutionReport;
          }
        }
        continue;
      }
      const fillQtyRaw = minQty(remainingOrderQty, remainingTradeQty);
      if (fillQtyRaw <= 0n) {
        continue;
      }
      const fillQty = toQtyInt(fillQtyRaw);
      const aggressorSide = trade.aggressor ?? trade.side;
      const liquidity = determineLiquidity(order, {
        treatLimitAsMaker,
        useAggressorForLiquidity,
        ...(aggressorSide ? { aggressorSide } : {}),
      });
      const fill = createFill({
        ts: event.ts,
        order,
        price: trade.price,
        qty: fillQty,
        liquidity,
        ...(trade.id ? { tradeRef: trade.id } : {}),
        ...(aggressorSide ? { sourceAggressor: aggressorSide } : {}),
      });
      const updated = orders.applyFill(order.id, fill);
      remainingTradeQty -= fillQtyRaw;
      yield {
        ts: event.ts,
        kind: 'FILL',
        orderId: order.id,
        fill,
        patch: buildOrderPatch(updated),
      } satisfies ExecutionReport;
      if (updated.status === 'FILLED') {
        orders.closeOrder(order.id, 'FILLED');
      }
    }
    for (const order of openOrders) {
      if (
        order.tif === 'IOC' &&
        (order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED') &&
        order.tsCreated <= event.ts
      ) {
        const canceled = orders.cancelOrder(order.id);
        if (canceled.status === 'CANCELED') {
          yield {
            ts: event.ts,
            kind: 'ORDER_UPDATED',
            orderId: order.id,
            patch: buildOrderPatch(canceled),
          } satisfies ExecutionReport;
        }
      }
    }
  }

  const endTs = lastTs ?? (0 as TimestampMs);
  yield { ts: endTs, kind: 'END' } satisfies ExecutionReport;
}
