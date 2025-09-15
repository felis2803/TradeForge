import { isBid } from '../utils/guards.js';
import type { OrderId, SymbolId } from '../types/index.js';
import { AccountsService } from './accounts.js';
import { ExchangeState } from './state.js';
import {
  type AccountId,
  type CancelOrderResult,
  type Currency,
  type Order,
  type PlaceOrderInput,
  type RejectReason,
  type SymbolConfig,
  NotFoundError,
  ValidationError,
} from './types.js';

interface Reservation {
  currency: Currency;
  amount: bigint;
}

function pow10(exp: number): bigint {
  if (!Number.isInteger(exp) || exp < 0) {
    throw new ValidationError('scale must be a non-negative integer');
  }
  return 10n ** BigInt(exp);
}

export class OrdersService {
  private readonly reservations = new Map<OrderId, Reservation>();

  constructor(
    private readonly state: ExchangeState,
    private readonly accounts: AccountsService,
  ) {}

  placeOrder(input: PlaceOrderInput): Order {
    const account = this.accounts.requireAccount(input.accountId);
    void account; // existence check only

    const tif = input.tif ?? 'GTC';
    if (!['GTC', 'IOC', 'FOK'].includes(tif)) {
      throw new ValidationError('unsupported time in force');
    }
    if (input.side !== 'BUY' && input.side !== 'SELL') {
      throw new ValidationError('invalid side');
    }
    if (input.qty <= 0n) {
      throw new ValidationError('qty must be positive');
    }

    const id = this.state.nextOrderId();
    const now = this.state.now();
    const order: Order = {
      id,
      tsCreated: now,
      tsUpdated: now,
      symbol: input.symbol,
      type: input.type,
      side: input.side,
      tif,
      qty: input.qty,
      status: 'NEW',
      accountId: input.accountId,
    };
    if (input.price !== undefined) {
      order.price = input.price;
    }

    const symbolCfg = this.state.getSymbolConfig(input.symbol);
    if (!symbolCfg) {
      order.status = 'REJECTED';
      order.rejectReason = 'UNKNOWN_SYMBOL';
      this.state.orders.set(order.id, order);
      return order;
    }

    if (
      input.type === 'MARKET' ||
      input.type === 'STOP_LIMIT' ||
      input.type === 'STOP_MARKET'
    ) {
      order.status = 'REJECTED';
      order.rejectReason = 'UNSUPPORTED_EXECUTION';
      this.state.orders.set(order.id, order);
      return order;
    }

    if (input.type === 'LIMIT') {
      if (input.price === undefined || input.price <= 0n) {
        throw new ValidationError('price must be positive for limit orders');
      }
    }

    const reservation = this.tryReserve(order, symbolCfg);
    if (!reservation.ok) {
      order.status = 'REJECTED';
      order.rejectReason = reservation.reason ?? 'UNKNOWN_SYMBOL';
      this.state.orders.set(order.id, order);
      return order;
    }

    const { currency, amount } = reservation;
    order.status = 'OPEN';
    delete order.rejectReason;
    this.reservations.set(order.id, { currency, amount });
    this.state.orders.set(order.id, order);
    return order;
  }

  cancelOrder(id: OrderId): CancelOrderResult {
    const order = this.state.orders.get(id);
    if (!order) {
      throw new NotFoundError(`Order ${String(id)} not found`);
    }
    if (order.status !== 'OPEN') {
      return order;
    }
    const reservation = this.reservations.get(id);
    if (reservation) {
      this.accounts.unlock(
        order.accountId,
        reservation.currency,
        reservation.amount,
      );
      this.reservations.delete(id);
    }
    order.status = 'CANCELED';
    order.tsUpdated = this.state.now();
    return order;
  }

  getOrder(id: OrderId): Order {
    const order = this.state.orders.get(id);
    if (!order) {
      throw new NotFoundError(`Order ${String(id)} not found`);
    }
    return order;
  }

  listOpenOrders(accountId: AccountId, symbol?: SymbolId): Order[] {
    this.accounts.requireAccount(accountId);
    const result: Order[] = [];
    for (const order of this.state.orders.values()) {
      if (order.accountId !== accountId) continue;
      if (order.status !== 'OPEN') continue;
      if (symbol && order.symbol !== symbol) continue;
      result.push(order);
    }
    return result;
  }

  private tryReserve(
    order: Order,
    symbol: SymbolConfig,
  ):
    | { ok: true; amount: bigint; currency: Currency }
    | { ok: false; reason: RejectReason } {
    if (order.type !== 'LIMIT') {
      return { ok: false, reason: 'UNSUPPORTED_EXECUTION' };
    }
    if (!order.price) {
      throw new ValidationError('price is required for limit orders');
    }

    if (isBid(order.side)) {
      const denom = pow10(symbol.qtyScale);
      const notional = (order.price * order.qty) / denom;
      if (notional === 0n) {
        throw new ValidationError('order notional is below minimum tick');
      }
      if (!this.accounts.lock(order.accountId, symbol.quote, notional)) {
        return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
      }
      return { ok: true, currency: symbol.quote, amount: notional };
    }

    if (!this.accounts.lock(order.accountId, symbol.base, order.qty)) {
      return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
    }
    return { ok: true, currency: symbol.base, amount: order.qty };
  }
}
