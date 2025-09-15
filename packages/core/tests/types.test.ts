import {
  isBid,
  isAsk,
  assertNonNegative,
  getScaleFor,
  SymbolId,
} from '../src/index';

test('isBid/isAsk guards', () => {
  expect(isBid('BUY')).toBe(true);
  expect(isBid('SELL')).toBe(false);
  expect(isAsk('SELL')).toBe(true);
  expect(isAsk('BUY')).toBe(false);
});

test('assertNonNegative throws on negative', () => {
  expect(() => assertNonNegative(-1n)).toThrow();
});

test('getScaleFor returns defaults', () => {
  const scale = getScaleFor('BTCUSDT' as SymbolId);
  expect(scale).toEqual({ priceScale: 5, qtyScale: 6 });
});
