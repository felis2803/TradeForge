import type {
  DepthEvent,
  MergedEvent,
  PriceInt,
  QtyInt,
  TradeEvent,
} from '@tradeforge/core';

import { isIntString, toBigIntOr } from './fixed.js';

export interface BookState {
  bestBid?: PriceInt;
  bestAsk?: PriceInt;
  lastTrade?: PriceInt;
  mid?: PriceInt;
  marketReady: boolean;
  bids: Map<bigint, bigint>;
  asks: Map<bigint, bigint>;
}

function parseVerboseFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(normalized);
}

const BOOK_VERBOSE = parseVerboseFlag(process.env['TF_VERBOSE']);

function describeLevelValue(value: unknown): string {
  if (typeof value === 'bigint') {
    return value.toString(10);
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  return String(value);
}

function logInvalidLevel(price: string, qty: string, reason: string): void {
  if (!BOOK_VERBOSE) {
    return;
  }
  console.warn('[book] skip invalid level', { price, qty, reason });
}

function setBookPrice(
  state: BookState,
  key: 'bestBid' | 'bestAsk' | 'mid',
  value: PriceInt | undefined,
): void {
  if (value === undefined) {
    delete state[key];
    return;
  }
  state[key] = value;
}

function normalizeInt(
  value: PriceInt | QtyInt | bigint | undefined,
): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = value as unknown as bigint;
  const str = raw.toString(10);
  if (!isIntString(str)) {
    return undefined;
  }
  return toBigIntOr(str, 0n);
}

function toRawPrice(value: PriceInt | undefined): bigint | undefined {
  return normalizeInt(value);
}

function toPrice(value: bigint): PriceInt;
function toPrice(value: bigint | undefined): PriceInt | undefined;
function toPrice(value: bigint | undefined): PriceInt | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as unknown as PriceInt;
}

function updateMid(state: BookState): void {
  const bid = toRawPrice(state.bestBid);
  const ask = toRawPrice(state.bestAsk);
  let mid: bigint | undefined;
  if (bid !== undefined && ask !== undefined) {
    mid = (bid + ask) / 2n;
  } else {
    const lastTrade = toRawPrice(state.lastTrade);
    if (lastTrade !== undefined) {
      mid = lastTrade;
    }
  }
  if (mid === undefined) {
    setBookPrice(state, 'mid', undefined);
    state.marketReady = false;
    return;
  }
  setBookPrice(state, 'mid', toPrice(mid));
  state.marketReady = true;
}

function applyDepthLevels(
  levels: Map<bigint, bigint>,
  updates: DepthEvent['payload']['bids'],
  priceSelector: (level: DepthEvent['payload']['bids'][number]) => PriceInt,
  qtySelector: (level: DepthEvent['payload']['bids'][number]) => QtyInt,
): void {
  for (const level of updates) {
    const rawPrice = priceSelector(level);
    const rawQty = qtySelector(level);
    const displayPrice = describeLevelValue(rawPrice);
    const displayQty = describeLevelValue(rawQty);
    const priceStr = displayPrice.trim();
    const qtyStr = displayQty.trim();
    const priceIsInt = isIntString(priceStr);
    const qtyIsInt = isIntString(qtyStr);

    if (!priceIsInt || !qtyIsInt) {
      const invalidParts: string[] = [];
      if (!priceIsInt) {
        invalidParts.push('price');
      }
      if (!qtyIsInt) {
        invalidParts.push('qty');
      }
      logInvalidLevel(
        displayPrice,
        displayQty,
        `invalid-${invalidParts.join('-')}`,
      );
      continue;
    }

    const price = BigInt(priceStr);
    const qty = BigInt(qtyStr);

    if (price < 0n || qty < 0n) {
      const negativeParts: string[] = [];
      if (price < 0n) {
        negativeParts.push('price');
      }
      if (qty < 0n) {
        negativeParts.push('qty');
      }
      logInvalidLevel(
        displayPrice,
        displayQty,
        `negative-${negativeParts.join('-')}`,
      );
      continue;
    }
    if (qty <= 0n) {
      levels.delete(price);
    } else {
      levels.set(price, qty);
    }
  }
}

function computeBest(
  levels: Map<bigint, bigint>,
  pick: (current: bigint | undefined, price: bigint) => bigint,
): bigint | undefined {
  let best: bigint | undefined;
  for (const [price, qty] of levels.entries()) {
    if (qty <= 0n) {
      levels.delete(price);
      continue;
    }
    best = pick(best, price);
  }
  return best;
}

function applyDepth(state: BookState, event: DepthEvent): void {
  applyDepthLevels(
    state.bids,
    event.payload.bids,
    (level) => level.price,
    (level) => level.qty,
  );
  applyDepthLevels(
    state.asks,
    event.payload.asks,
    (level) => level.price,
    (level) => level.qty,
  );
  const bestBid = computeBest(state.bids, (current, price) =>
    current === undefined || price > current ? price : current,
  );
  const bestAsk = computeBest(state.asks, (current, price) =>
    current === undefined || price < current ? price : current,
  );
  setBookPrice(state, 'bestBid', toPrice(bestBid));
  setBookPrice(state, 'bestAsk', toPrice(bestAsk));
  updateMid(state);
}

function applyTrade(state: BookState, event: TradeEvent): void {
  const price = toRawPrice(event.payload.price);
  if (price === undefined) {
    return;
  }
  state.lastTrade = toPrice(price);
}

export function createBookState(): BookState {
  return {
    marketReady: false,
    bids: new Map<bigint, bigint>(),
    asks: new Map<bigint, bigint>(),
  } satisfies BookState;
}

export function updateBook(state: BookState, event: MergedEvent): void {
  if (event.kind === 'depth') {
    applyDepth(state, event);
    return;
  }
  applyTrade(state, event);
  updateMid(state);
}
