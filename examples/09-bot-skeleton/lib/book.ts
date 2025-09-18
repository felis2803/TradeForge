import type {
  DepthEvent,
  MergedEvent,
  PriceInt,
  TradeEvent,
} from '@tradeforge/core';

export interface BookState {
  bestBid?: PriceInt;
  bestAsk?: PriceInt;
  lastTrade?: PriceInt;
  mid?: PriceInt;
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

function toRawPrice(value: PriceInt | undefined): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as unknown as bigint;
}

function toRawQty(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

function toPrice(value: bigint | undefined): PriceInt | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as unknown as PriceInt;
}

function updateMid(state: BookState): void {
  const bid = toRawPrice(state.bestBid);
  const ask = toRawPrice(state.bestAsk);
  if (bid !== undefined && ask !== undefined) {
    setBookPrice(state, 'mid', toPrice((bid + ask) / 2n));
    return;
  }
  if (bid !== undefined) {
    setBookPrice(state, 'mid', toPrice(bid));
    return;
  }
  if (ask !== undefined) {
    setBookPrice(state, 'mid', toPrice(ask));
    return;
  }
  if (state.lastTrade !== undefined) {
    setBookPrice(state, 'mid', state.lastTrade);
    return;
  }
  setBookPrice(state, 'mid', undefined);
}

function applyDepthLevels(
  levels: Map<bigint, bigint>,
  updates: DepthEvent['payload']['bids'],
  priceSelector: (level: DepthEvent['payload']['bids'][number]) => PriceInt,
  qtySelector: (level: DepthEvent['payload']['bids'][number]) => bigint,
): void {
  for (const level of updates) {
    const price = priceSelector(level) as unknown as bigint;
    const qty = toRawQty(qtySelector(level));
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
    (level) => level.qty as unknown as bigint,
  );
  applyDepthLevels(
    state.asks,
    event.payload.asks,
    (level) => level.price,
    (level) => level.qty as unknown as bigint,
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
  state.lastTrade = event.payload.price;
  if (!state.mid) {
    state.mid = event.payload.price;
  } else if (state.bestBid === undefined && state.bestAsk === undefined) {
    state.mid = event.payload.price;
  }
}

export function createBookState(): BookState {
  return {
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
