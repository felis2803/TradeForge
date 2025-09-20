import type { LiquidityConfig, OrderBookSnapshot, Side } from './types.js';
import type { InternalOrder } from './order-store.js';

export interface PlannedLevel {
  price: bigint;
  qty: bigint;
}

export interface PlanResult {
  levels: PlannedLevel[];
  exhausted: boolean;
}

const DEFAULT_LIQUIDITY: Required<LiquidityConfig> = {
  maxSlippageLevels: 10,
  rejectOnExhaustedLiquidity: false,
};

function resolveLiquidity(config?: LiquidityConfig): Required<LiquidityConfig> {
  return {
    maxSlippageLevels:
      config?.maxSlippageLevels ?? DEFAULT_LIQUIDITY.maxSlippageLevels,
    rejectOnExhaustedLiquidity:
      config?.rejectOnExhaustedLiquidity ??
      DEFAULT_LIQUIDITY.rejectOnExhaustedLiquidity,
  };
}

function pickSource(side: Side, snapshot: OrderBookSnapshot): PlannedLevel[] {
  if (side === 'BUY') {
    return snapshot.asks;
  }
  return snapshot.bids;
}

export class LiquidityPlanner {
  private readonly liquidity: Required<LiquidityConfig>;

  constructor(config?: LiquidityConfig) {
    this.liquidity = resolveLiquidity(config);
  }

  planLimit(order: InternalOrder, snapshot: OrderBookSnapshot): PlanResult {
    if (order.price === undefined) {
      return { levels: [], exhausted: true };
    }
    const levels = pickSource(order.side, snapshot);
    const planned: PlannedLevel[] = [];
    let remaining = order.remainingQty;
    for (const level of levels) {
      if (!this.isLevelUsable(order, level.price)) {
        continue;
      }
      if (level.qty <= 0n) {
        continue;
      }
      const fillQty = remaining < level.qty ? remaining : level.qty;
      if (fillQty <= 0n) {
        continue;
      }
      planned.push({ price: level.price, qty: fillQty });
      remaining -= fillQty;
      if (remaining === 0n) {
        break;
      }
    }
    return {
      levels: planned,
      exhausted: remaining > 0n,
    };
  }

  planMarket(order: InternalOrder, snapshot: OrderBookSnapshot): PlanResult {
    const levels = pickSource(order.side, snapshot);
    const planned: PlannedLevel[] = [];
    const maxLevels = this.liquidity.maxSlippageLevels;
    let remaining = order.remainingQty;
    let usedLevels = 0;
    for (const level of levels) {
      if (level.qty <= 0n) {
        continue;
      }
      usedLevels += 1;
      const fillQty = remaining < level.qty ? remaining : level.qty;
      planned.push({ price: level.price, qty: fillQty });
      remaining -= fillQty;
      if (remaining === 0n) {
        break;
      }
      if (usedLevels >= maxLevels) {
        break;
      }
    }
    return {
      levels: planned,
      exhausted: remaining > 0n,
    };
  }

  shouldRejectOnExhaustion(): boolean {
    return this.liquidity.rejectOnExhaustedLiquidity;
  }

  getMaxSlippageLevels(): number {
    return this.liquidity.maxSlippageLevels;
  }

  private isLevelUsable(order: InternalOrder, price: bigint): boolean {
    if (order.price === undefined) {
      return false;
    }
    if (order.side === 'BUY') {
      return price <= order.price;
    }
    return price >= order.price;
  }
}
