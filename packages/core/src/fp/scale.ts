import { Scale, SymbolId, SymbolScaleMap } from '../types/index.js';

export const DEFAULT_SCALES: SymbolScaleMap = {
  BTCUSDT: { priceScale: 5, qtyScale: 6 },
  ETHUSDT: { priceScale: 5, qtyScale: 6 },
  SOLUSDT: { priceScale: 5, qtyScale: 6 },
};

export function getScaleFor(
  symbol: SymbolId,
  overrides: SymbolScaleMap = {},
): Scale {
  const sym = symbol as unknown as string;
  return (
    overrides[sym] ?? DEFAULT_SCALES[sym] ?? { priceScale: 0, qtyScale: 0 }
  );
}
