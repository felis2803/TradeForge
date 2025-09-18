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

function toRawQty(value: QtyInt | bigint | undefined): bigint | undefined {
  const normalized = normalizeInt(value);
  if (normalized === undefined) {
    return undefined;
  }
  return normalized < 0n ? 0n : normalized;
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
    const price = normalizeInt(priceSelector(level));
    const qty = toRawQty(qtySelector(level));
    if (price === undefined || qty === undefined) {
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
