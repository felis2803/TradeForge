import type { MergedEvent } from '../merge/timeline.js';
import type { ExchangeState } from '../sim/state.js';
import { AccountsService } from '../sim/accounts.js';
import { OrdersService } from '../sim/orders.js';
import type { Order } from '../sim/types.js';
import type { QtyInt, TimestampMs } from '../types/index.js';
import {
  cloneFees,
  compareOrdersForMatch,
  createFill,
  crossesLimitPrice,
  determineLiquidity,
  getOrderRemainingQty,
} from './utils.js';
import type { ExecutionOptions, ExecutionReport } from './types.js';

const PARTICIPATION_FACTOR = 1n; // TODO: expose via options for strict conservative mode

function minQty(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function toQtyInt(value: bigint): QtyInt {
  return value as QtyInt;
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
  let lastTs: TimestampMs | undefined;

  for await (const event of timeline) {
    lastTs = event.ts;
    if (event.kind !== 'trade') {
      continue;
    }
    const trade = event.payload;
    const openOrders = Array.from(orders.getOpenOrders(trade.symbol));
    if (openOrders.length === 0) {
      continue;
    }
    openOrders.sort(compareOrdersForMatch);
    let remainingTradeQty =
      (trade.qty as unknown as bigint) * PARTICIPATION_FACTOR;
    if (remainingTradeQty <= 0n) {
      continue;
    }
    for (const order of openOrders) {
      if (remainingTradeQty <= 0n) {
        break;
      }
      if (!crossesLimitPrice(order, trade.price)) {
        continue;
      }
      const remainingOrderQty = getOrderRemainingQty(
        order,
      ) as unknown as bigint;
      if (remainingOrderQty <= 0n) {
        continue;
      }
      const fillQtyRaw = minQty(remainingOrderQty, remainingTradeQty);
      if (fillQtyRaw <= 0n) {
        continue;
      }
      const fillQty = toQtyInt(fillQtyRaw);
      const liquidity = determineLiquidity(order, {
        treatLimitAsMaker,
        ...(trade.side ? { aggressorSide: trade.side } : {}),
      });
      const fill = createFill({
        ts: event.ts,
        order,
        price: trade.price,
        qty: fillQty,
        liquidity,
        ...(trade.id ? { tradeRef: trade.id } : {}),
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
  }

  const endTs = lastTs ?? (0 as TimestampMs);
  yield { ts: endTs, kind: 'END' } satisfies ExecutionReport;
}
