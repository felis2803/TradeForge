import type { Balances, PriceInt, QtyInt, Side } from '@tradeforge/core';

import { isIntString, mulDivInt, toBigIntOr } from '../lib/fixed.js';

export interface RiskContext {
  balances: {
    base: Balances;
    quote: Balances;
  };
  qtyScale: number;
  makerFeeBps: number;
}

function toRawQty(value: QtyInt): bigint {
  const raw = value as unknown as bigint;
  const str = raw.toString(10);
  if (!isIntString(str)) {
    throw new Error('qty must be an integer string');
  }
  return toBigIntOr(str, 0n);
}

function toRawPrice(value: PriceInt): bigint {
  const raw = value as unknown as bigint;
  const str = raw.toString(10);
  if (!isIntString(str)) {
    throw new Error('price must be an integer string');
  }
  return toBigIntOr(str, 0n);
}

function toBalanceFree(value: Balances): bigint {
  const str = value.free.toString(10);
  if (!isIntString(str)) {
    return 0n;
  }
  return toBigIntOr(str, 0n);
}

function pow10(exp: number): bigint {
  if (!Number.isFinite(exp) || exp < 0) {
    return 1n;
  }
  return 10n ** BigInt(exp);
}

function clampQty(value: bigint): QtyInt {
  return (value < 0n ? 0n : value) as unknown as QtyInt;
}

function calcTotalCost(
  priceRaw: bigint,
  qtyRaw: bigint,
  qtyScale: number,
  makerFeeBps: number,
): bigint {
  if (priceRaw <= 0n || qtyRaw <= 0n) {
    return 0n;
  }
  const denom = pow10(qtyScale);
  const denomStr = denom.toString(10);
  if (!isIntString(denomStr)) {
    return 0n;
  }
  const priceStr = priceRaw.toString(10);
  const qtyStr = qtyRaw.toString(10);
  const notionalStr = mulDivInt(priceStr, qtyStr, denomStr);
  const notional = toBigIntOr(notionalStr, 0n);
  if (notional <= 0n) {
    return 0n;
  }
  const feeBps = Math.max(0, makerFeeBps);
  if (feeBps === 0) {
    return notional;
  }
  const feeStr = mulDivInt(notionalStr, feeBps.toString(10), '10000');
  const fee = toBigIntOr(feeStr, 0n);
  return notional + fee;
}

export function capQtyByBalance(
  qty: QtyInt,
  price: PriceInt,
  side: Side,
  ctx: RiskContext,
): QtyInt {
  const qtyRaw = toRawQty(qty);
  if (qtyRaw <= 0n) {
    return clampQty(qtyRaw);
  }
  if (side === 'SELL') {
    const available = toBalanceFree(ctx.balances.base);
    if (available <= 0n) {
      return clampQty(0n);
    }
    const capped = qtyRaw > available ? available : qtyRaw;
    return clampQty(capped);
  }
  const priceRaw = toRawPrice(price);
  if (priceRaw <= 0n) {
    return clampQty(0n);
  }
  const availableQuote = toBalanceFree(ctx.balances.quote);
  if (availableQuote <= 0n) {
    return clampQty(0n);
  }
  const denom = pow10(ctx.qtyScale);
  const feeMultiplier = BigInt(10000 + Math.max(0, ctx.makerFeeBps));
  if (feeMultiplier <= 0n) {
    return clampQty(0n);
  }
  const numerator = availableQuote * 10000n * denom;
  const denominator = priceRaw * feeMultiplier;
  if (denominator <= 0n) {
    return clampQty(0n);
  }
  const maxQty = numerator / denominator;
  if (maxQty <= 0n) {
    return clampQty(0n);
  }
  const capped = qtyRaw > maxQty ? maxQty : qtyRaw;
  return clampQty(capped);
}

export function canPlace(
  side: Side,
  ctx: RiskContext,
  qty: QtyInt,
  price?: PriceInt,
): boolean {
  const qtyRaw = toRawQty(qty);
  if (qtyRaw <= 0n) {
    return false;
  }
  if (side === 'SELL') {
    return toBalanceFree(ctx.balances.base) >= qtyRaw;
  }
  if (!price) {
    return false;
  }
  const priceRaw = toRawPrice(price);
  const required = calcTotalCost(
    priceRaw,
    qtyRaw,
    ctx.qtyScale,
    ctx.makerFeeBps,
  );
  return required > 0n && toBalanceFree(ctx.balances.quote) >= required;
}
