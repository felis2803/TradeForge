import { Level, Side } from './types.js';

const EPSILON = 1e-12;

const isPositive = (value: number): boolean =>
  Number.isFinite(value) && value > 0;
const isNonNegative = (value: number): boolean =>
  Number.isFinite(value) && value >= 0;

export class PriceLevels {
  private readonly prices: number[] = [];
  private readonly sizeByPrice = new Map<number, number>();

  constructor(private readonly side: Side) {}

  set(price: number, size: number): Level | null {
    if (!isPositive(price)) {
      throw new Error(`Invalid price: ${price}`);
    }

    if (!isNonNegative(size)) {
      throw new Error(`Invalid size: ${size}`);
    }

    if (size <= EPSILON) {
      this.delete(price);
      return null;
    }

    const { index, found } = this.locate(price);
    this.sizeByPrice.set(price, size);

    if (!found) {
      this.prices.splice(index, 0, price);
    }

    return { price, size };
  }

  delete(price: number): boolean {
    if (!isPositive(price)) {
      throw new Error(`Invalid price: ${price}`);
    }

    if (!this.sizeByPrice.has(price)) {
      return false;
    }

    const { index, found } = this.locate(price);
    if (found) {
      this.prices.splice(index, 1);
    }

    return this.sizeByPrice.delete(price);
  }

  get(price: number): Level | null {
    const size = this.sizeByPrice.get(price);
    if (size === undefined) {
      return null;
    }

    return { price, size };
  }

  best(): Level | null {
    const bestPrice = this.prices[0];
    if (bestPrice === undefined) {
      return null;
    }

    const size = this.sizeByPrice.get(bestPrice);
    if (size === undefined) {
      return null;
    }

    return { price: bestPrice, size };
  }

  toArray(depth?: number): Level[] {
    const limit =
      depth === undefined
        ? this.prices.length
        : Math.max(0, Math.min(this.prices.length, depth));
    const selected = this.prices.slice(0, limit);

    return selected.map((price) => {
      const size = this.sizeByPrice.get(price);
      if (size === undefined) {
        throw new Error(`Inconsistent state for price ${price}`);
      }

      return { price, size };
    });
  }

  clear(): void {
    this.prices.length = 0;
    this.sizeByPrice.clear();
  }

  count(): number {
    return this.prices.length;
  }

  private locate(price: number): { index: number; found: boolean } {
    let low = 0;
    let high = this.prices.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      const midPrice = this.prices[mid];

      if (midPrice === price) {
        return { index: mid, found: true };
      }

      const goLeft = this.side === 'bid' ? price > midPrice : price < midPrice;

      if (goLeft) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    return { index: low, found: false };
  }
}
