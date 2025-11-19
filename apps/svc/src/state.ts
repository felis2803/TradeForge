import {
  BotState,
  IntString,
  InternalOrderStatus,
  OrderFlag,
  OrderRecord,
  OrderTimeInForce,
  OrderType,
  RunConfig,
  RunLifecycleStatus,
  RunSpeed,
  RunStateSnapshot,
  FeedHealthState,
  StreamTradeEntry,
  TopOfBookEntry,
  TradeRecord,
} from './types.js';

interface StateData {
  config: RunConfig | null;
  status: RunLifecycleStatus;
  runId: string | null;
  createdAt: number | null;
  startedAt: number | null;
  pausedAt: number | null;
  stoppedAt: number | null;
  bots: Map<string, BotState>;
  orders: Map<string, OrderRecord>;
  trades: TradeRecord[];
  orderSeq: number;
  lastPrices: Map<string, bigint>;
  market: MarketState;
}

interface DepthSnapshotState {
  bids: Array<[IntString, IntString]>;
  asks: Array<[IntString, IntString]>;
  ts: number | null;
  seq?: number | null;
}

interface MarketState {
  depth: Map<string, DepthSnapshotState>;
  topOfBook: Map<string, TopOfBookEntry>;
  lastTrades: Map<string, StreamTradeEntry>;
  feed: FeedHealthState;
}

const DEFAULT_PRICE_INT = 100_000n;

function toIntStringStrict(value: IntString | number | bigint): IntString {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  throw new Error('Invalid integer value');
}

function toIntStringOptional(
  value?: IntString | number | bigint,
): IntString | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return toIntStringStrict(value);
}

const initialState: StateData = {
  config: null,
  status: 'idle',
  runId: null,
  createdAt: null,
  startedAt: null,
  pausedAt: null,
  stoppedAt: null,
  bots: new Map(),
  orders: new Map(),
  trades: [],
  orderSeq: 0,
  lastPrices: new Map(),
  market: {
    depth: new Map(),
    topOfBook: new Map(),
    lastTrades: new Map(),
    feed: { healthy: false, lastUpdateTs: null },
  },
};

let state: StateData = { ...initialState };

export function resetState(): void {
  state = {
    ...initialState,
    bots: new Map(),
    orders: new Map(),
    trades: [],
    lastPrices: new Map(),
    market: {
      depth: new Map(),
      topOfBook: new Map(),
      lastTrades: new Map(),
      feed: { healthy: false, lastUpdateTs: null },
    },
  };
}

export function configureRun(config: RunConfig): void {
  resetState();
  state.config = config;
  state.status = 'configured';
  state.runId = config.id;
  const now = Date.now();
  state.createdAt = now;
  state.startedAt = null;
  state.pausedAt = null;
  state.stoppedAt = null;
  state.lastPrices = new Map(
    config.instruments.map((instrument) => [
      instrument.symbol,
      DEFAULT_PRICE_INT,
    ]),
  );
  state.market.depth = new Map(
    config.instruments.map((instrument) => [
      instrument.symbol,
      { bids: [], asks: [], ts: null } satisfies DepthSnapshotState,
    ]),
  );
  state.market.topOfBook = new Map(
    config.instruments.map((instrument) => [
      instrument.symbol,
      { bestBidInt: null, bestAskInt: null, ts: null },
    ]),
  );
  state.market.lastTrades = new Map();
  state.market.feed = { healthy: false, lastUpdateTs: null };
}

export function setStatus(status: RunLifecycleStatus): void {
  const now = Date.now();
  state.status = status;
  switch (status) {
    case 'running':
      state.startedAt = state.startedAt ?? now;
      state.pausedAt = null;
      break;
    case 'paused':
      state.pausedAt = now;
      break;
    case 'stopped':
      state.stoppedAt = now;
      state.lastPrices = new Map();
      state.market.depth = new Map();
      state.market.topOfBook = new Map();
      state.market.lastTrades = new Map();
      state.market.feed = { healthy: false, lastUpdateTs: null };
      break;
    default:
      break;
  }
}

export function setRunSpeed(speed: RunSpeed): void {
  if (!state.config) {
    return;
  }
  state.config = { ...state.config, speed };
}

function cloneTopOfBookEntry(entry: TopOfBookEntry): TopOfBookEntry {
  return {
    bestBidInt: entry.bestBidInt,
    bestAskInt: entry.bestAskInt,
    ts: entry.ts,
  };
}

function touchFeedUpdate(ts?: number): void {
  state.market.feed.lastUpdateTs = ts ?? Date.now();
}

export function updateDepthFromFeed(
  symbol: string,
  snapshot: {
    bids: Array<[IntString, IntString]>;
    asks: Array<[IntString, IntString]>;
    ts?: number | null;
    seq?: number | null;
  },
): void {
  const bids = snapshot.bids.map(
    ([price, qty]) =>
      [toIntStringStrict(price), toIntStringStrict(qty)] as [
        IntString,
        IntString,
      ],
  );
  const asks = snapshot.asks.map(
    ([price, qty]) =>
      [toIntStringStrict(price), toIntStringStrict(qty)] as [
        IntString,
        IntString,
      ],
  );
  const record: DepthSnapshotState = {
    bids,
    asks,
    ts: snapshot.ts ?? null,
    ...(snapshot.seq !== undefined ? { seq: snapshot.seq } : {}),
  };
  state.market.depth.set(symbol, record);

  const topEntry: TopOfBookEntry = {
    bestBidInt: bids.length ? bids[0][0] : null,
    bestAskInt: asks.length ? asks[0][0] : null,
    ts: record.ts,
  };
  state.market.topOfBook.set(symbol, topEntry);
  touchFeedUpdate(record.ts ?? undefined);
}

export function getDepthSnapshot(
  symbol: string,
): DepthSnapshotState | undefined {
  const snapshot = state.market.depth.get(symbol);
  if (!snapshot) {
    return undefined;
  }
  return {
    bids: snapshot.bids.map(([price, qty]) => [price, qty]),
    asks: snapshot.asks.map(([price, qty]) => [price, qty]),
    ts: snapshot.ts,
    seq: snapshot.seq,
  };
}

export function recordStreamTrade(
  symbol: string,
  trade: StreamTradeEntry,
): void {
  const payload: StreamTradeEntry = {
    priceInt: toIntStringStrict(trade.priceInt),
    qtyInt: toIntStringStrict(trade.qtyInt),
    side: trade.side,
    ts: trade.ts,
  };
  state.market.lastTrades.set(symbol, payload);
  try {
    state.lastPrices.set(symbol, BigInt(payload.priceInt));
  } catch {
    // ignore bigint coercion errors
  }
  touchFeedUpdate(trade.ts);
}

export function getLastStreamTrade(
  symbol: string,
): StreamTradeEntry | undefined {
  const trade = state.market.lastTrades.get(symbol);
  if (!trade) {
    return undefined;
  }
  return { ...trade };
}

export function setFeedHealthy(healthy: boolean): void {
  state.market.feed.healthy = healthy;
}

export function getFeedHealth(): FeedHealthState {
  return { ...state.market.feed };
}

export function getSnapshot(): RunStateSnapshot {
  const topOfBook: Record<string, TopOfBookEntry> = {};
  if (state.config) {
    for (const instrument of state.config.instruments) {
      const entry =
        state.market.topOfBook.get(instrument.symbol) ??
        ({ bestBidInt: null, bestAskInt: null, ts: null } as TopOfBookEntry);
      topOfBook[instrument.symbol] = cloneTopOfBookEntry(entry);
    }
  } else {
    for (const [symbol, entry] of state.market.topOfBook.entries()) {
      topOfBook[symbol] = cloneTopOfBookEntry(entry);
    }
  }

  const lastTrades: Record<string, StreamTradeEntry> = {};
  for (const [symbol, trade] of state.market.lastTrades.entries()) {
    lastTrades[symbol] = { ...trade };
  }

  return {
    status: state.status,
    config: state.config,
    runId: state.runId,
    startedAt: state.startedAt,
    pausedAt: state.pausedAt,
    stoppedAt: state.stoppedAt,
    marketData: {
      topOfBook,
      lastTrades,
      feed: { ...state.market.feed },
    },
  };
}

export function getTimestamps(): {
  createdAt: number | null;
  startedAt: number | null;
  pausedAt: number | null;
  stoppedAt: number | null;
} {
  return {
    createdAt: state.createdAt,
    startedAt: state.startedAt,
    pausedAt: state.pausedAt,
    stoppedAt: state.stoppedAt,
  };
}

export function getRunId(): string | null {
  return state.runId;
}

export function getRunConfig(): RunConfig | null {
  return state.config;
}

export function getHeartbeatTimeoutSec(): number {
  return state.config?.heartbeatTimeoutSec ?? 6;
}

export function touchBot(botName: string): void {
  const existing = state.bots.get(botName);
  if (existing) {
    existing.lastSeenTs = Date.now();
    state.bots.set(botName, existing);
  }
}

export function upsertBot(
  botName: string,
  initialBalanceInt: IntString,
): BotState {
  const now = Date.now();
  const existing = state.bots.get(botName);
  if (existing) {
    existing.lastSeenTs = now;
    existing.connected = true;
    if (initialBalanceInt !== existing.initialBalanceInt) {
      existing.initialBalanceInt = toIntStringStrict(initialBalanceInt);
    }
    state.bots.set(botName, existing);
    return existing;
  }

  const bot: BotState = {
    botName,
    initialBalanceInt: toIntStringStrict(initialBalanceInt),
    currentBalanceInt: toIntStringStrict(initialBalanceInt),
    connected: true,
    lastSeenTs: now,
  };
  state.bots.set(botName, bot);
  return bot;
}

export function setBotConnectionStatus(
  botName: string,
  connected: boolean,
): void {
  const existing = state.bots.get(botName);
  if (!existing) {
    return;
  }
  existing.connected = connected;
  existing.lastSeenTs = Date.now();
  state.bots.set(botName, existing);
}

export function listBots(): BotState[] {
  return Array.from(state.bots.values()).map((bot) => ({ ...bot }));
}

export function getBot(botName: string): BotState | undefined {
  const bot = state.bots.get(botName);
  return bot ? { ...bot } : undefined;
}

export function updateBotBalance(
  botName: string,
  balanceInt: IntString,
): BotState | undefined {
  const bot = state.bots.get(botName);
  if (!bot) {
    return undefined;
  }
  bot.currentBalanceInt = toIntStringStrict(balanceInt);
  bot.lastSeenTs = Date.now();
  state.bots.set(botName, bot);
  return { ...bot };
}

export function nextOrderId(): string {
  state.orderSeq += 1;
  return `${state.runId ?? 'run'}-order-${state.orderSeq}`;
}

export function addOrder(order: OrderRecord): void {
  state.orders.set(order.serverOrderId, order);
}

export function updateOrderStatus(
  serverOrderId: string,
  status: InternalOrderStatus,
  notes?: string,
): OrderRecord | undefined {
  const order = state.orders.get(serverOrderId);
  if (!order) {
    return undefined;
  }
  order.status = status;
  order.updatedAt = Date.now();
  if (notes) {
    order.notes = notes;
  }
  state.orders.set(serverOrderId, order);
  return { ...order };
}

export function getOrder(serverOrderId: string): OrderRecord | undefined {
  const order = state.orders.get(serverOrderId);
  return order ? { ...order } : undefined;
}

export function listOrders(): OrderRecord[] {
  return Array.from(state.orders.values()).map((order) => ({ ...order }));
}

export function addTrade(record: TradeRecord): void {
  state.trades.push(record);
  try {
    state.lastPrices.set(record.symbol, BigInt(record.priceInt));
  } catch {
    // ignore conversion errors; retain previous price
  }
}

export function listTrades(): TradeRecord[] {
  return state.trades.map((trade) => ({ ...trade }));
}

export function getLastPrice(symbol: string): bigint {
  return state.lastPrices.get(symbol) ?? DEFAULT_PRICE_INT;
}

export function countActiveOrders(botName: string): number {
  let count = 0;
  for (const order of state.orders.values()) {
    if (order.botName !== botName) continue;
    if (order.status === 'open' || order.status === 'partiallyFilled') {
      count += 1;
    }
  }
  return count;
}

export function buildOrderRecord(params: {
  serverOrderId: string;
  clientOrderId: string;
  botName: string;
  symbol: string;
  side: OrderRecord['side'];
  type: OrderType;
  qtyInt: IntString;
  priceInt?: IntString;
  stopPriceInt?: IntString;
  limitPriceInt?: IntString;
  timeInForce: OrderTimeInForce;
  flags: OrderFlag[];
  status: InternalOrderStatus;
}): OrderRecord {
  const now = Date.now();
  return {
    serverOrderId: params.serverOrderId,
    clientOrderId: params.clientOrderId,
    botName: params.botName,
    symbol: params.symbol,
    side: params.side,
    type: params.type,
    qtyInt: toIntStringStrict(params.qtyInt),
    priceInt: toIntStringOptional(params.priceInt),
    stopPriceInt: toIntStringOptional(params.stopPriceInt),
    limitPriceInt: toIntStringOptional(params.limitPriceInt),
    timeInForce: params.timeInForce,
    flags: params.flags,
    status: params.status,
    createdAt: now,
    updatedAt: now,
  };
}
