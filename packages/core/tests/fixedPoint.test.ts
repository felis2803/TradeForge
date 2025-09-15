import {
  toPriceInt,
  fromPriceInt,
  toQtyInt,
  fromQtyInt,
  PriceInt,
  cmpPrice,
  cmpQty,
  addPrice,
  subPrice,
  addQty,
  subQty,
  mulDivQty,
  mulDivPrice,
  QtyInt,
} from '../src/index';

test('price conversion to/from bigint', () => {
  const scale = 5;
  const int = toPriceInt('27123.45', scale);
  expect(int).toBe(2712345000n);
  expect(fromPriceInt(int, scale)).toBe('27123.45');
});

test('qty conversion to/from bigint', () => {
  const scale = 6;
  const int = toQtyInt('0.123456', scale);
  expect(int).toBe(123456n);
  expect(fromQtyInt(int, scale)).toBe('0.123456');
});

test('trailing zeros normalization', () => {
  const scale = 5;
  const int = toPriceInt('1.2', scale);
  expect(int).toBe(120000n);
  expect(fromPriceInt(int, scale)).toBe('1.2');
  const back = fromPriceInt(toPriceInt('1.200000', scale), scale);
  expect(back).toBe('1.2');
  const roundtrip = fromPriceInt(toPriceInt(back, scale), scale);
  expect(roundtrip).toBe('1.2');
});

test('comparison helpers', () => {
  expect(cmpPrice(100n as PriceInt, 100n as PriceInt)).toBe(0);
  expect(cmpPrice(99n as PriceInt, 100n as PriceInt)).toBe(-1);
  expect(cmpPrice(101n as PriceInt, 100n as PriceInt)).toBe(1);
  expect(cmpQty(1n as QtyInt, 2n as QtyInt)).toBe(-1);
});

test('add/sub helpers', () => {
  expect(addQty(1n as QtyInt, 2n as QtyInt)).toBe(3n);
  expect(subQty(3n as QtyInt, 1n as QtyInt)).toBe(2n);
  expect(addPrice(1n as PriceInt, 2n as PriceInt)).toBe(3n);
  expect(subPrice(3n as PriceInt, 1n as PriceInt)).toBe(2n);
  expect(() => subQty(1n as QtyInt, 2n as QtyInt)).toThrow();
});

test('mulDiv helpers', () => {
  expect(mulDivQty(1000n as QtyInt, 3n, 2n)).toBe(1500n);
  expect(mulDivQty(1n as QtyInt, 1n, 2n)).toBe(0n);
  expect(mulDivPrice(1000n as PriceInt, 3n, 2n)).toBe(1500n);
});

test('reject scientific notation', () => {
  expect(() => toPriceInt('1e-6', 8)).toThrow();
  // number -> toString() может дать scientific; явно просим строку
  expect(() => toPriceInt(1e-7, 8)).toThrow();
});

test('reject invalid chars', () => {
  expect(() => toPriceInt('12.3.4', 5)).toThrow();
  expect(() => toQtyInt('abc', 6)).toThrow();
});

test('reject negatives at input', () => {
  expect(() => toPriceInt('-1.0', 5)).toThrow();
  expect(() => toQtyInt('-0.001', 6)).toThrow();
});
