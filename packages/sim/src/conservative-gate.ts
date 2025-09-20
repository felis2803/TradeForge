import type { ConservativePolicyConfig } from './types.js';
import type { InternalOrder } from './order-store.js';
import type { Trade } from './types.js';

type TradeRecord = {
  price: bigint;
  ts: number;
};

interface GateConfig {
  enable: boolean;
  stalenessMs: number;
}

const DEFAULT_POLICY: GateConfig = {
  enable: true,
  stalenessMs: 2000,
};

function resolvePolicy(config?: ConservativePolicyConfig): GateConfig {
  const enable = config?.enableConservativeForLimit ?? true;
  const stalenessMs = config?.tradeStalenessMs ?? DEFAULT_POLICY.stalenessMs;
  return {
    enable,
    stalenessMs,
  };
}

export class ConservativeGate {
  private readonly policy: GateConfig;
  private readonly lastTradeBySide: Partial<
    Record<'BUY' | 'SELL', TradeRecord>
  > = {};

  constructor(config?: ConservativePolicyConfig) {
    this.policy = resolvePolicy(config);
  }

  updateTrade(trade: Trade): void {
    this.lastTradeBySide[trade.side] = {
      price: trade.price,
      ts: trade.ts,
    };
  }

  isLimitAllowed(order: InternalOrder, now: number): boolean {
    if (!this.policy.enable) {
      return true;
    }
    if (order.type !== 'LIMIT') {
      return true;
    }
    if (order.price === undefined) {
      return false;
    }
    const candidateSides: ('BUY' | 'SELL')[] =
      order.side === 'BUY' ? ['SELL', 'BUY'] : ['BUY', 'SELL'];
    for (const side of candidateSides) {
      const record = this.lastTradeBySide[side];
      if (!record) {
        continue;
      }
      if (!this.isFresh(record, now)) {
        continue;
      }
      if (this.isPricePermitted(order.side, order.price, record.price)) {
        return true;
      }
    }
    return false;
  }

  private isFresh(record: TradeRecord, now: number): boolean {
    return now - record.ts <= this.policy.stalenessMs;
  }

  private isPricePermitted(
    side: InternalOrder['side'],
    limit: bigint,
    tradePrice: bigint,
  ): boolean {
    if (side === 'BUY') {
      return tradePrice <= limit;
    }
    return tradePrice >= limit;
  }
}
