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
