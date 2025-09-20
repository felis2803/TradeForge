import type { SymbolId } from '@tradeforge/core';
import { SUPPORTED_SYMBOLS } from '../constants.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(input: string): string {
  if (!DATE_RE.test(input)) {
    throw new Error(`date must be in format YYYY-MM-DD; received: ${input}`);
  }
  return input;
}

export function assertSymbol(symbol: SymbolId): SymbolId {
  const normalized = symbol.toUpperCase() as SymbolId;
  if (!SUPPORTED_SYMBOLS.has(normalized)) {
    throw new Error(`symbol ${symbol} is not supported`);
  }
  return normalized;
}
