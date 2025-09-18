import type { Balances, PriceInt, QtyInt, Side } from '@tradeforge/core';

export interface RiskContext {
  balances: {
    base: Balances;
    quote: Balances;
  };
  qtyScale: number;
  makerFeeBps: number;
}

function toRawQty(value: QtyInt): bigint {
  return value as unknown as bigint;
}

function toRawPrice(value: PriceInt): bigint {
  return value as unknown as bigint;
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
  if (denom === 0n) {
    return 0n;
  }
  const notional = (priceRaw * qtyRaw) / denom;
  const feeMultiplier = makerFeeBps > 0 ? BigInt(makerFeeBps) : 0n;
  const fee = feeMultiplier === 0n ? 0n : (notional * feeMultiplier) / 10000n;
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
    const available = ctx.balances.base.free;
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
  const availableQuote = ctx.balances.quote.free;
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
    return ctx.balances.base.free >= qtyRaw;
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
  return required > 0n && ctx.balances.quote.free >= required;
}
