import type { OrderId, SymbolId, TimestampMs } from '../types/index.js';
import {
  type Account,
  type AccountId,
  type ExchangeStateConfig,
  type FeeConfig,
  type Order,
  type SymbolConfig,
} from './types.js';
import type { OrderbookProvider } from './orderbook.mock.js';

export class ExchangeState {
  readonly symbols: Record<string, SymbolConfig>;
  readonly fee: FeeConfig;
  readonly accounts: Map<AccountId, Account> = new Map();
  readonly orders: Map<OrderId, Order> = new Map();
  readonly orderbook: OrderbookProvider;
  private accountSeq = 0;
  private orderSeq = 0;
  private tsCounter = 0;

  constructor(config: ExchangeStateConfig) {
    this.symbols = { ...config.symbols };
    this.fee = config.fee;
    this.orderbook = config.orderbook;
  }

  nextAccountId(): AccountId {
    this.accountSeq += 1;
    return `A${this.accountSeq}` as AccountId;
  }

  nextOrderId(): OrderId {
    this.orderSeq += 1;
    return `O${this.orderSeq}` as OrderId;
  }

  now(): TimestampMs {
    this.tsCounter += 1;
    return this.tsCounter as TimestampMs;
  }

  getSymbolConfig(symbol: SymbolId): SymbolConfig | undefined {
    return this.symbols[symbol as unknown as string];
  }
}
