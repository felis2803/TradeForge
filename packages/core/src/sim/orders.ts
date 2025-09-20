import { isBid } from '../utils/guards.js';
import type {
  NotionalInt,
  OrderId,
  PriceInt,
  QtyInt,
  SymbolId,
  TimestampMs,
} from '../types/index.js';
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
  type TriggerDirection,
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

function isStopOrderType(
  type: Order['type'] | PlaceOrderInput['type'],
): type is 'STOP_LIMIT' | 'STOP_MARKET' {
  return type === 'STOP_LIMIT' || type === 'STOP_MARKET';
}

function isTriggerDirection(value: unknown): value is TriggerDirection {
  return value === 'UP' || value === 'DOWN';
}

function toRawQty(value: QtyInt): bigint {
  return value as unknown as bigint;
}

export class OrdersService {
  constructor(
    private readonly state: ExchangeState,
    private readonly accounts: AccountsService,
  ) {}

  private ensureReservationCapacity(
    order: Order,
    currency: Currency,
    amount: bigint,
  ): void {
    if (amount < 0n) {
      throw new ValidationError('reservation amount must be non-negative');
    }
    let reservation = order.reserved;
    if (!reservation) {
      if (amount === 0n) {
        order.reserved = {
          currency,
          total: 0n,
          remaining: 0n,
        };
        return;
      }
      if (!this.accounts.lock(order.accountId, currency, amount)) {
        throw new ValidationError('insufficient balance to create reservation');
      }
      order.reserved = {
        currency,
        total: amount,
        remaining: amount,
      };
      return;
    }
    if (reservation.currency !== currency) {
      throw new ValidationError('reservation currency mismatch');
    }
    const diff = amount - reservation.remaining;
    if (diff <= 0n) {
      return;
    }
    if (!this.accounts.lock(order.accountId, currency, diff)) {
      throw new ValidationError('insufficient balance to extend reservation');
    }
    reservation.total += diff;
    reservation.remaining += diff;
  }

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
    if (input.triggerPrice !== undefined) {
      order.triggerPrice = input.triggerPrice;
    }
    if (input.triggerDirection !== undefined) {
      order.triggerDirection = input.triggerDirection;
    }

    const symbolCfg = this.state.getSymbolConfig(input.symbol);
    if (!symbolCfg) {
      order.status = 'REJECTED';
      order.rejectReason = 'UNKNOWN_SYMBOL';
      this.state.orders.set(order.id, order);
      return order;
    }

    if (order.type === 'MARKET' && order.tif === 'FOK') {
      order.status = 'REJECTED';
      order.rejectReason = 'UNSUPPORTED_EXECUTION';
      this.state.orders.set(order.id, order);
      return order;
    }

    if (order.type === 'LIMIT' || order.type === 'STOP_LIMIT') {
      if (order.price === undefined || order.price <= 0n) {
        throw new ValidationError('price must be positive for limit orders');
      }
    }

    const isStopOrder = isStopOrderType(order.type);
    if (isStopOrder) {
      const triggerPriceRaw = order.triggerPrice as unknown as
        | bigint
        | undefined;
      if (triggerPriceRaw === undefined || triggerPriceRaw <= 0n) {
        throw new ValidationError(
          'triggerPrice must be positive for stop orders',
        );
      }
      if (!isTriggerDirection(order.triggerDirection)) {
        throw new ValidationError(
          'triggerDirection must be UP or DOWN for stop orders',
        );
      }
      order.activated = false;
    } else {
      delete order.triggerPrice;
      delete order.triggerDirection;
    }

    if (order.type === 'MARKET' || order.type === 'STOP_MARKET') {
      delete order.price;
    }

    let rejected: { reason: RejectReason } | undefined;
    if (order.type === 'LIMIT' || order.type === 'STOP_LIMIT') {
      const reservation = this.tryReserve(order, symbolCfg);
      if (!reservation.ok) {
        rejected = { reason: reservation.reason ?? 'UNKNOWN_SYMBOL' };
      } else {
        const { currency, total } = reservation.reservation;
        order.reserved = {
          currency,
          total,
          remaining: total,
        };
      }
    } else if (order.type === 'MARKET' || order.type === 'STOP_MARKET') {
      if (order.side === 'SELL') {
        const qtyRaw = toRawQty(order.qty);
        if (!this.accounts.lock(order.accountId, symbolCfg.base, qtyRaw)) {
          rejected = { reason: 'INSUFFICIENT_FUNDS' };
        } else {
          order.reserved = {
            currency: symbolCfg.base,
            total: qtyRaw,
            remaining: qtyRaw,
          };
        }
      } else {
        order.reserved = {
          currency: symbolCfg.quote,
          total: 0n,
          remaining: 0n,
        };
      }
    }

    if (rejected) {
      order.status = 'REJECTED';
      order.rejectReason = rejected.reason;
      this.state.orders.set(order.id, order);
      return order;
    }

    order.status = 'OPEN';
    delete order.rejectReason;
    this.state.orders.set(order.id, order);
    if (isStopOrder) {
      this.state.stopOrders.set(order.id, order);
    } else {
      this.state.openOrders.set(order.id, order);
    }
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
    this.state.openOrders.delete(order.id);
    this.state.stopOrders.delete(order.id);
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
    for (const order of this.state.openOrders.values()) {
      if (!isWorkingStatus(order.status)) continue;
      if (symbol && order.symbol !== symbol) continue;
      yield order;
    }
  }

  *getStopOrders(symbol?: SymbolId): Iterable<Order> {
    for (const order of this.state.stopOrders.values()) {
      if (!isWorkingStatus(order.status)) continue;
      if (symbol && order.symbol !== symbol) continue;
      yield order;
    }
  }

  activateStopOrder(
    order: Order,
    params: { ts: TimestampMs; tradePrice: PriceInt },
  ): Order {
    if (!isStopOrderType(order.type)) {
      return order;
    }
    const symbolCfg = this.state.getSymbolConfig(order.symbol);
    if (!symbolCfg) {
      throw new ValidationError('unknown symbol config for stop activation');
    }
    this.state.stopOrders.delete(order.id);
    const activationTs = this.state.now();
    order.activated = true;
    order.tsCreated = activationTs;
    order.tsUpdated = activationTs;
    if (order.type === 'STOP_LIMIT') {
      order.type = 'LIMIT';
      this.state.openOrders.set(order.id, order);
      return order;
    }
    order.type = 'MARKET';
    delete order.price;
    const qtyRaw = toRawQty(order.qty);
    if (isBid(order.side)) {
      const tradePriceRaw = params.tradePrice as unknown as bigint;
      const activationNotional = calcNotional(
        tradePriceRaw,
        qtyRaw,
        symbolCfg.qtyScale,
      );
      const activationNotionalRaw = activationNotional as unknown as bigint;
      const feeReserve = calcFee(activationNotional, this.state.fee.takerBps);
      this.ensureReservationCapacity(
        order,
        symbolCfg.quote,
        activationNotionalRaw + feeReserve,
      );
    } else {
      this.ensureReservationCapacity(order, symbolCfg.base, qtyRaw);
    }
    this.state.openOrders.set(order.id, order);
    return order;
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

    if (isBid(order.side)) {
      const spend = notionalRaw + fee;
      this.ensureReservationCapacity(order, symbolCfg.quote, spend);
      const reservation = order.reserved;
      if (!reservation) {
        throw new ValidationError('order has no active reservation');
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
      this.ensureReservationCapacity(order, symbolCfg.base, fillQtyRaw);
      const reservation = order.reserved;
      if (!reservation) {
        throw new ValidationError('order has no active reservation');
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
    this.state.openOrders.delete(order.id);
    this.state.stopOrders.delete(order.id);
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
    if (order.type !== 'LIMIT' && order.type !== 'STOP_LIMIT') {
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
