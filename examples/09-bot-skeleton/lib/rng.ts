export type Prng = () => number;

function normalizeSeed(seed: number): number {
  const normalized = seed >>> 0;
  return normalized === 0 ? 0x9e3779b9 : normalized;
}

export function makeXorShift32(seed: number): Prng {
  let state = normalizeSeed(Number.isFinite(seed) ? seed : 0);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}
