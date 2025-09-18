const INT_RE = /^\d+$/;

export const isIntString = (value?: string | null): value is string => {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && INT_RE.test(trimmed);
};

export function toBigIntOr(
  source: string | undefined | null,
  fallback: bigint,
): bigint {
  if (!isIntString(source)) {
    return fallback;
  }
  return BigInt(source.trim());
}

/**
 * Integer multiply-divide helper: returns `floor((A * B) / C)` as a decimal string.
 *
 * Все аргументы должны быть строками целых неотрицательных чисел (fixed-point представление).
 * Бросает ошибку при нецелых входах или если знаменатель `C` равен нулю.
 */
export function mulDivInt(a: string, b: string, c: string): string {
  if (!isIntString(a) || !isIntString(b) || !isIntString(c)) {
    throw new Error('mulDivInt expects int strings');
  }
  const A = BigInt(a.trim());
  const B = BigInt(b.trim());
  const C = BigInt(c.trim());
  if (C === 0n) {
    throw new Error('mulDivInt expects non-zero denominator');
  }
  return ((A * B) / C).toString(10);
}
