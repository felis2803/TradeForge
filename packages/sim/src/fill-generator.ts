import type { InternalOrder } from './order-store.js';
import type { FillEvent } from './types.js';
import type { PlannedLevel } from './liquidity-planner.js';

export interface FillComputation {
  fills: FillEvent[];
  totalFilled: bigint;
  remaining: bigint;
}

export class FillGenerator {
  generate(
    order: InternalOrder,
    plan: PlannedLevel[],
    ts: number,
  ): FillComputation {
    const fills: FillEvent[] = [];
    let remaining = order.remainingQty;
    let totalFilled = 0n;
    let levelIndex = 0;
    for (const level of plan) {
      if (remaining === 0n) {
        break;
      }
      const fillQty = remaining < level.qty ? remaining : level.qty;
      if (fillQty <= 0n) {
        levelIndex += 1;
        continue;
      }
      fills.push({
        orderId: order.id,
        side: order.side,
        price: level.price,
        qty: fillQty,
        ts,
        levelIndex,
      });
      remaining -= fillQty;
      totalFilled += fillQty;
      levelIndex += 1;
    }
    return {
      fills,
      totalFilled,
      remaining,
    };
  }
}
