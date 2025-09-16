import { isBid } from '../utils/guards.js';
import type { NotionalInt, OrderId, QtyInt, SymbolId } from '../types/index.js';
import type { Fill } from '../engine/types.js';
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
  calcFee,
} from './types.js';

function pow10(exp: number): bigint {
  if (!Number.isInteger(exp) || exp < 0) {
    throw new ValidationError('scale must be a non-negative integer');
  }
  return 10n ** BigInt(exp);
}

function calcNotional(
  price: bigint,
  qty: bigint,
  qtyScale: number,
): NotionalInt {
  const denom = pow10(qtyScale);
  if (denom === 0n) {
    throw new ValidationError('qty scale denominator cannot be zero');
  }
  return ((price * qty) / denom) as NotionalInt;
}

function isWorkingStatus(status: Order['status']): boolean {
  return status === 'OPEN' || status === 'PARTIALLY_FILLED';
}

export class OrdersService {
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
      executedQty: 0n as QtyInt,
      cumulativeQuote: 0n as NotionalInt,
      fees: {},
      fills: [],
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

    const { currency, total } = reservation.reservation;
    order.status = 'OPEN';
    delete order.rejectReason;
    order.reserved = {
      currency,
      total,
      remaining: total,
    };
    this.state.orders.set(order.id, order);
    return order;
  }

  cancelOrder(id: OrderId): CancelOrderResult {
    const order = this.state.orders.get(id);
    if (!order) {
      throw new NotFoundError(`Order ${String(id)} not found`);
    }
    if (order.status !== 'OPEN' && order.status !== 'PARTIALLY_FILLED') {
      return order;
    }
    const reservation = order.reserved;
    if (reservation && reservation.remaining > 0n) {
      this.accounts.unlock(
        order.accountId,
        reservation.currency,
        reservation.remaining,
      );
      reservation.remaining = 0n;
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
      if (!isWorkingStatus(order.status)) continue;
      if (symbol && order.symbol !== symbol) continue;
      result.push(order);
    }
    return result;
  }

  *getOpenOrders(symbol?: SymbolId): Iterable<Order> {
    for (const order of this.state.orders.values()) {
      if (!isWorkingStatus(order.status)) continue;
      if (symbol && order.symbol !== symbol) continue;
      yield order;
    }
  }

  applyFill(orderId: OrderId, fill: Fill): Order {
    const order = this.state.orders.get(orderId);
    if (!order) {
      throw new NotFoundError(`Order ${String(orderId)} not found`);
    }
    if (!isWorkingStatus(order.status)) {
      throw new ValidationError('order is not active for fills');
    }
    const symbolCfg = this.state.getSymbolConfig(order.symbol);
    if (!symbolCfg) {
      throw new ValidationError('unknown symbol config for order fill');
    }
    const notional = calcNotional(fill.price, fill.qty, symbolCfg.qtyScale);
    const notionalRaw = notional as unknown as bigint;
    const fillQtyRaw = fill.qty as unknown as bigint;
    const feeBps =
      fill.liquidity === 'TAKER'
        ? this.state.fee.takerBps
        : this.state.fee.makerBps;
    const fee = calcFee(notional, feeBps);
    const reservation = order.reserved;
    if (!reservation) {
      throw new ValidationError('order has no active reservation');
    }

    if (isBid(order.side)) {
      const spend = notionalRaw + fee;
      if (reservation.remaining < spend) {
        throw new ValidationError('insufficient reserved quote for fill');
      }
      this.accounts.consumeLocked(
        order.accountId,
        symbolCfg.quote,
        notionalRaw,
      );
      this.accounts.applyTradeFees(order.accountId, symbolCfg.quote, fee, {
        preferLocked: true,
      });
      reservation.remaining -= spend;
      this.accounts.deposit(order.accountId, symbolCfg.base, fillQtyRaw);
    } else {
      if (reservation.remaining < fillQtyRaw) {
        throw new ValidationError('insufficient reserved base for fill');
      }
      this.accounts.consumeLocked(order.accountId, symbolCfg.base, fillQtyRaw);
      reservation.remaining -= fillQtyRaw;
      this.accounts.deposit(order.accountId, symbolCfg.quote, notionalRaw);
      this.accounts.applyTradeFees(order.accountId, symbolCfg.quote, fee, {
        preferLocked: false,
      });
    }

    order.executedQty = (order.executedQty + fillQtyRaw) as QtyInt;
    order.cumulativeQuote = (order.cumulativeQuote +
      notionalRaw) as NotionalInt;
    const feeKey = fill.liquidity === 'TAKER' ? 'taker' : 'maker';
    if (fee > 0n) {
      const existing = order.fees[feeKey] ?? 0n;
      order.fees[feeKey] = existing + fee;
    }
    order.fills.push(fill);
    order.tsUpdated = this.state.now();
    order.status =
      order.executedQty >= order.qty ? 'FILLED' : 'PARTIALLY_FILLED';
    return order;
  }

  closeOrder(orderId: OrderId, finalStatus: Order['status']): Order {
    if (finalStatus === 'CANCELED') {
      return this.cancelOrder(orderId);
    }
    if (finalStatus !== 'FILLED') {
      throw new ValidationError('unsupported final status');
    }
    const order = this.state.orders.get(orderId);
    if (!order) {
      throw new NotFoundError(`Order ${String(orderId)} not found`);
    }
    if (order.status === 'FILLED') {
      if (order.side === 'BUY') {
        this.accounts.releaseUnusedQuoteOnClose(order);
      }
      return order;
    }
    order.status = finalStatus;
    order.tsUpdated = this.state.now();
    if (order.side === 'BUY') {
      this.accounts.releaseUnusedQuoteOnClose(order);
    } else if (order.reserved && order.reserved.remaining > 0n) {
      this.accounts.unlock(
        order.accountId,
        order.reserved.currency,
        order.reserved.remaining,
      );
      order.reserved.remaining = 0n;
    }
    return order;
  }

  private tryReserve(
    order: Order,
    symbol: SymbolConfig,
  ):
    | { ok: true; reservation: { currency: Currency; total: bigint } }
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
      const feeReserve = calcFee(notional, this.state.fee.makerBps);
      const total = notional + feeReserve;
      if (!this.accounts.lock(order.accountId, symbol.quote, total)) {
        return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
      }
      return {
        ok: true,
        reservation: { currency: symbol.quote, total },
      };
    }

    if (!this.accounts.lock(order.accountId, symbol.base, order.qty)) {
      return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
    }
    return {
      ok: true,
      reservation: { currency: symbol.base, total: order.qty },
    };
  }
}
