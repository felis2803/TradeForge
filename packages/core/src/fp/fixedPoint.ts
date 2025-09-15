import { PriceInt, QtyInt } from '../types/index.js';
import { assertNonNegative } from '../utils/guards.js';

function toFixedInt(
  value: string | number,
  scale: number,
  name: string,
): bigint {
  const str = typeof value === 'number' ? value.toString() : value;
  if (str.startsWith('-')) {
    throw new Error(`${name} cannot be negative`);
  }
  const [intPart, fracPart = ''] = str.split('.');
  const frac = fracPart.padEnd(scale, '0').slice(0, scale);
  return BigInt(intPart + frac);
}

function fromFixedInt(value: bigint, scale: number): string {
  assertNonNegative(value);
  const negative = value < 0n;
  if (negative) {
    throw new Error('value cannot be negative');
  }
  if (scale === 0) {
    return value.toString();
  }
  const s = value.toString().padStart(scale + 1, '0');
  const intPart = s.slice(0, -scale) || '0';
  const fracPart = s.slice(-scale);
  const trimmed = fracPart.replace(/0+$/, '');
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

export function toPriceInt(value: string | number, scale: number): PriceInt {
  return toFixedInt(value, scale, 'price') as PriceInt;
}

export function toQtyInt(value: string | number, scale: number): QtyInt {
  return toFixedInt(value, scale, 'qty') as QtyInt;
}

export function fromPriceInt(p: PriceInt, scale: number): string {
  return fromFixedInt(p, scale);
}

export function fromQtyInt(q: QtyInt, scale: number): string {
  return fromFixedInt(q, scale);
}

function cmp(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const cmpPrice = (a: PriceInt, b: PriceInt): number => cmp(a, b);
export const cmpQty = (a: QtyInt, b: QtyInt): number => cmp(a, b);

export function addPrice(a: PriceInt, b: PriceInt): PriceInt {
  return (a + b) as PriceInt;
}

export function subPrice(a: PriceInt, b: PriceInt): PriceInt {
  const r = a - b;
  assertNonNegative(r, 'subPrice result');
  return r as PriceInt;
}

export function addQty(a: QtyInt, b: QtyInt): QtyInt {
  return (a + b) as QtyInt;
}

export function subQty(a: QtyInt, b: QtyInt): QtyInt {
  const r = a - b;
  assertNonNegative(r, 'subQty result');
  return r as QtyInt;
}

export function mulDivQty(a: QtyInt, b: bigint, denom: bigint): QtyInt {
  if (denom === 0n) {
    throw new Error('denom must be non-zero');
  }
  return ((a * b) / denom) as QtyInt;
}

export function mulDivPrice(a: PriceInt, b: bigint, denom: bigint): PriceInt {
  if (denom === 0n) {
    throw new Error('denom must be non-zero');
  }
  return ((a * b) / denom) as PriceInt;
}

export const serializePrice = fromPriceInt;
export const serializeQty = fromQtyInt;
