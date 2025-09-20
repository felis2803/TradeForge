import { readFile, writeFile } from 'node:fs/promises';
import { ajv as schemaAjv, validateCheckpointV1 } from '@tradeforge/validation';
import { StaticMockOrderbook } from '../sim/orderbook.mock.js';
import { ExchangeState } from '../sim/state.js';
import type {
  Account,
  AccountId,
  Balances,
  FeeConfig,
  Order,
  OrderSide,
  OrderStatus,
  OrderType,
  SymbolConfig,
  TimeInForce,
  TriggerDirection,
} from '../sim/types.js';
import type {
  Liquidity,
  NotionalInt,
  OrderId,
  PriceInt,
  QtyInt,
  Side,
  SymbolId,
  TimestampMs,
} from '../types/index.js';
import type { Fill } from '../engine/types.js';
import type { CursorIterable, MergeStartState } from '../merge/start.js';

export interface CoreReaderCursor {
  file: string;
  entry?: string;
  recordIndex: number;
}

export interface EngineSnapshot {
  openOrderIds: string[];
  stopOrderIds: string[];
}

interface SerializedBalanceEntry {
  free: string;
  locked: string;
}

interface SerializedAccountEntry {
  id: string;
  apiKey: string;
  balances: Record<string, SerializedBalanceEntry>;
}

interface SerializedFill {
  ts: number;
  orderId: string;
  price: string;
  qty: string;
  side: Side;
  liquidity: Liquidity;
  tradeRef?: string;
  sourceAggressor?: Side;
}

interface SerializedReservation {
  currency: string;
  total: string;
  remaining: string;
}

interface SerializedOrderEntry {
  id: string;
  symbol: string;
  type: OrderType;
  side: OrderSide;
  tif: TimeInForce;
  status: OrderStatus;
  accountId: string;
  qty: string;
  executedQty: string;
  cumulativeQuote: string;
  fees: { maker?: string; taker?: string };
  tsCreated: number;
  tsUpdated: number;
  price?: string;
  triggerPrice?: string;
  triggerDirection?: TriggerDirection;
  activated?: boolean;
  rejectReason?: Order['rejectReason'];
  fills?: SerializedFill[];
  reserved?: SerializedReservation;
}

interface SerializedSymbolConfig extends SymbolConfig {}

interface SerializedStateConfig {
  symbols: Record<string, SerializedSymbolConfig>;
  fee: FeeConfig;
  counters: {
    accountSeq: number;
    orderSeq: number;
    tsCounter: number;
  };
}

interface SerializedAccountsState {
  [accountId: string]: SerializedAccountEntry;
}

interface SerializedOrdersState {
  [orderId: string]: SerializedOrderEntry;
}

interface SerializedState {
  config: SerializedStateConfig;
  accounts: SerializedAccountsState;
  orders: SerializedOrdersState;
}

export type SerializedExchangeState = SerializedState;

export interface CheckpointV1 {
  version: 1;
  createdAtMs: number;
  meta: { symbol: SymbolId; note?: string };
  cursors: { trades?: CoreReaderCursor; depth?: CoreReaderCursor };
  merge: { nextSourceOnEqualTs?: 'DEPTH' | 'TRADES' };
  engine: EngineSnapshot;
  state: SerializedExchangeState;
}

function parseBigInt(
  value: string | undefined,
  label: string,
): bigint | undefined {
  if (value === undefined) return undefined;
  try {
    return BigInt(value);
  } catch (err) {
    throw new Error(`invalid bigint string for ${label}`);
  }
}

function cloneBalances(
  balances: Map<string, Balances>,
): Record<string, SerializedBalanceEntry> {
  const entries = Array.from(balances.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const out: Record<string, SerializedBalanceEntry> = {};
  for (const [currency, balance] of entries) {
    out[currency] = {
      free: balance.free.toString(10),
      locked: balance.locked.toString(10),
    };
  }
  return out;
}

function serializeAccounts(state: ExchangeState): SerializedAccountsState {
  const entries = Array.from(state.accounts.values()).sort((a, b) =>
    (a.id as unknown as string).localeCompare(b.id as unknown as string),
  );
  const out: SerializedAccountsState = {};
  for (const account of entries) {
    const id = account.id as unknown as string;
    out[id] = {
      id,
      apiKey: account.apiKey,
      balances: cloneBalances(account.balances),
    };
  }
  return out;
}

function serializeFees(order: Order): { maker?: string; taker?: string } {
  const fees: { maker?: string; taker?: string } = {};
  if (order.fees.maker !== undefined) {
    fees.maker = order.fees.maker.toString(10);
  }
  if (order.fees.taker !== undefined) {
    fees.taker = order.fees.taker.toString(10);
  }
  return fees;
}

function serializeFills(order: Order): SerializedFill[] | undefined {
  if (!order.fills || order.fills.length === 0) {
    return undefined;
  }
  return order.fills.map((fill) => ({
    ts: fill.ts as unknown as number,
    orderId: fill.orderId as unknown as string,
    price: (fill.price as unknown as bigint).toString(10),
    qty: (fill.qty as unknown as bigint).toString(10),
    side: fill.side,
    liquidity: fill.liquidity,
    ...(fill.tradeRef !== undefined ? { tradeRef: fill.tradeRef } : {}),
    ...(fill.sourceAggressor !== undefined
      ? { sourceAggressor: fill.sourceAggressor }
      : {}),
  }));
}

function serializeReservation(order: Order): SerializedReservation | undefined {
  if (!order.reserved) return undefined;
  return {
    currency: order.reserved.currency,
    total: order.reserved.total.toString(10),
    remaining: order.reserved.remaining.toString(10),
  };
}

function serializeOrders(state: ExchangeState): SerializedOrdersState {
  const entries = Array.from(state.orders.values()).sort((a, b) =>
    (a.id as unknown as string).localeCompare(b.id as unknown as string),
  );
  const out: SerializedOrdersState = {};
  for (const order of entries) {
    const id = order.id as unknown as string;
    const entry: SerializedOrderEntry = {
      id,
      symbol: order.symbol as unknown as string,
      type: order.type,
      side: order.side,
      tif: order.tif,
      status: order.status,
      accountId: order.accountId as unknown as string,
      qty: (order.qty as unknown as bigint).toString(10),
      executedQty: (order.executedQty as unknown as bigint).toString(10),
      cumulativeQuote: (order.cumulativeQuote as unknown as bigint).toString(
        10,
      ),
      fees: serializeFees(order),
      tsCreated: order.tsCreated as unknown as number,
      tsUpdated: order.tsUpdated as unknown as number,
    };
    if (order.price !== undefined) {
      entry.price = (order.price as unknown as bigint).toString(10);
    }
    if (order.triggerPrice !== undefined) {
      entry.triggerPrice = (order.triggerPrice as unknown as bigint).toString(
        10,
      );
    }
    if (order.triggerDirection !== undefined) {
      entry.triggerDirection = order.triggerDirection;
    }
    if (order.activated !== undefined) {
      entry.activated = order.activated;
    }
    if (order.rejectReason !== undefined) {
      entry.rejectReason = order.rejectReason;
    }
    const fills = serializeFills(order);
    if (fills) {
      entry.fills = fills;
    }
    const reservation = serializeReservation(order);
    if (reservation) {
      entry.reserved = reservation;
    }
    out[id] = entry;
  }
  return out;
}

function serializeSymbols(
  state: ExchangeState,
): Record<string, SerializedSymbolConfig> {
  const entries = Object.keys(state.symbols).sort();
  const out: Record<string, SerializedSymbolConfig> = {};
  for (const key of entries) {
    const cfg = state.symbols[key]!;
    out[key] = {
      base: cfg.base,
      quote: cfg.quote,
      priceScale: cfg.priceScale,
      qtyScale: cfg.qtyScale,
    } satisfies SerializedSymbolConfig;
  }
  return out;
}

export function serializeExchangeState(
  state: ExchangeState,
): SerializedExchangeState {
  const internal = state as unknown as {
    accountSeq: number;
    orderSeq: number;
    tsCounter: number;
  };
  return {
    config: {
      symbols: serializeSymbols(state),
      fee: { ...state.fee },
      counters: {
        accountSeq: internal.accountSeq ?? 0,
        orderSeq: internal.orderSeq ?? 0,
        tsCounter: internal.tsCounter ?? 0,
      },
    },
    accounts: serializeAccounts(state),
    orders: serializeOrders(state),
  } satisfies SerializedExchangeState;
}

function ensureSymbolConfig(
  serialized: SerializedExchangeState,
): Record<string, SymbolConfig> {
  const symbols: Record<string, SymbolConfig> = {};
  for (const [symbol, cfg] of Object.entries(serialized.config.symbols)) {
    symbols[symbol] = {
      base: cfg.base,
      quote: cfg.quote,
      priceScale: cfg.priceScale,
      qtyScale: cfg.qtyScale,
    } satisfies SymbolConfig;
  }
  return symbols;
}

function restoreAccount(
  state: ExchangeState,
  serialized: SerializedAccountEntry,
  knownCurrencies: Set<string>,
): void {
  const accountId = serialized.id as unknown as AccountId;
  const account: Account = {
    id: accountId,
    apiKey: serialized.apiKey,
    balances: new Map(),
  };
  for (const [currency, balance] of Object.entries(serialized.balances)) {
    if (!knownCurrencies.has(currency)) {
      throw new Error(`unknown currency in serialized state: ${currency}`);
    }
    account.balances.set(currency, {
      free: parseBigInt(
        balance.free,
        `accounts[${serialized.id}].balances.${currency}.free`,
      )!,
      locked: parseBigInt(
        balance.locked,
        `accounts[${serialized.id}].balances.${currency}.locked`,
      )!,
    });
  }
  state.accounts.set(accountId, account);
}

function restoreFill(serialized: SerializedFill): Fill {
  return {
    ts: serialized.ts as TimestampMs,
    orderId: serialized.orderId as unknown as OrderId,
    price: BigInt(serialized.price) as PriceInt,
    qty: BigInt(serialized.qty) as QtyInt,
    side: serialized.side,
    liquidity: serialized.liquidity,
    ...(serialized.tradeRef !== undefined
      ? { tradeRef: serialized.tradeRef }
      : {}),
    ...(serialized.sourceAggressor !== undefined
      ? { sourceAggressor: serialized.sourceAggressor }
      : {}),
  } satisfies Fill;
}

function restoreOrder(
  state: ExchangeState,
  serialized: SerializedOrderEntry,
  knownSymbols: Set<string>,
): void {
  if (!knownSymbols.has(serialized.symbol)) {
    throw new Error(`unknown symbol in serialized order: ${serialized.symbol}`);
  }
  const orderId = serialized.id as unknown as OrderId;
  const order: Order = {
    id: orderId,
    tsCreated: serialized.tsCreated as TimestampMs,
    tsUpdated: serialized.tsUpdated as TimestampMs,
    symbol: serialized.symbol as unknown as SymbolId,
    type: serialized.type,
    side: serialized.side,
    tif: serialized.tif,
    status: serialized.status,
    accountId: serialized.accountId as unknown as AccountId,
    qty: BigInt(serialized.qty) as QtyInt,
    executedQty: BigInt(serialized.executedQty) as QtyInt,
    cumulativeQuote: BigInt(serialized.cumulativeQuote) as NotionalInt,
    fees: {},
    fills: [],
  };
  if (serialized.price !== undefined) {
    order.price = BigInt(serialized.price) as PriceInt;
  }
  if (serialized.triggerPrice !== undefined) {
    order.triggerPrice = BigInt(serialized.triggerPrice) as PriceInt;
  }
  if (serialized.triggerDirection !== undefined) {
    order.triggerDirection = serialized.triggerDirection;
  }
  if (serialized.activated !== undefined) {
    order.activated = serialized.activated;
  }
  if (serialized.rejectReason !== undefined) {
    order.rejectReason = serialized.rejectReason;
  }
  const maker = parseBigInt(
    serialized.fees.maker,
    `orders[${serialized.id}].fees.maker`,
  );
  if (maker !== undefined) {
    order.fees.maker = maker;
  }
  const taker = parseBigInt(
    serialized.fees.taker,
    `orders[${serialized.id}].fees.taker`,
  );
  if (taker !== undefined) {
    order.fees.taker = taker;
  }
  if (serialized.fills && serialized.fills.length > 0) {
    order.fills = serialized.fills.map(restoreFill);
  }
  if (serialized.reserved) {
    order.reserved = {
      currency: serialized.reserved.currency,
      total: BigInt(serialized.reserved.total),
      remaining: BigInt(serialized.reserved.remaining),
    };
  }
  state.orders.set(orderId, order);
}

function collectKnownCurrencies(
  symbols: Record<string, SymbolConfig>,
): Set<string> {
  const set = new Set<string>();
  for (const cfg of Object.values(symbols)) {
    set.add(cfg.base);
    set.add(cfg.quote);
  }
  return set;
}

export function deserializeExchangeState(
  data: SerializedExchangeState,
): ExchangeState {
  const symbols = ensureSymbolConfig(data);
  const orderbook = new StaticMockOrderbook({ best: {} });
  const state = new ExchangeState({
    symbols,
    fee: { ...data.config.fee },
    orderbook,
  });
  state.accounts.clear();
  state.orders.clear();
  state.openOrders.clear();
  state.stopOrders.clear();

  const knownCurrencies = collectKnownCurrencies(symbols);
  for (const accountEntry of Object.values(data.accounts)) {
    restoreAccount(state, accountEntry, knownCurrencies);
  }
  const knownSymbols = new Set(Object.keys(symbols));
  for (const orderEntry of Object.values(data.orders)) {
    restoreOrder(state, orderEntry, knownSymbols);
  }

  const counters = data.config.counters;
  const internal = state as unknown as {
    accountSeq: number;
    orderSeq: number;
    tsCounter: number;
  };
  if (typeof counters.accountSeq === 'number') {
    internal.accountSeq = counters.accountSeq;
  }
  if (typeof counters.orderSeq === 'number') {
    internal.orderSeq = counters.orderSeq;
  }
  if (typeof counters.tsCounter === 'number') {
    internal.tsCounter = counters.tsCounter;
  }
  return state;
}

export function snapshotEngine(state: ExchangeState): EngineSnapshot {
  const openOrderIds = Array.from(state.openOrders.keys()).map(
    (id) => id as unknown as string,
  );
  const stopOrderIds = Array.from(state.stopOrders.keys()).map(
    (id) => id as unknown as string,
  );
  return { openOrderIds, stopOrderIds } satisfies EngineSnapshot;
}

export function restoreEngineFromSnapshot(
  snap: EngineSnapshot,
  state: ExchangeState,
): void {
  state.openOrders.clear();
  for (const id of snap.openOrderIds) {
    const order = state.orders.get(id as unknown as OrderId);
    if (!order) {
      throw new Error(`open order from snapshot missing in state: ${id}`);
    }
    state.openOrders.set(order.id, order);
  }
  state.stopOrders.clear();
  for (const id of snap.stopOrderIds) {
    const order = state.orders.get(id as unknown as OrderId);
    if (!order) {
      throw new Error(`stop order from snapshot missing in state: ${id}`);
    }
    state.stopOrders.set(order.id, order);
  }
}

function cloneCursor(cursor?: CoreReaderCursor): CoreReaderCursor | undefined {
  if (!cursor) return undefined;
  const cloned: CoreReaderCursor = {
    file: cursor.file,
    recordIndex: cursor.recordIndex,
  };
  if (cursor.entry !== undefined) {
    cloned.entry = cursor.entry;
  }
  return cloned;
}

export function makeCheckpointV1(args: {
  symbol: SymbolId;
  cursors: { trades?: CoreReaderCursor; depth?: CoreReaderCursor };
  merge?: MergeStartState;
  state: ExchangeState;
  note?: string;
}): CheckpointV1 {
  const engine = snapshotEngine(args.state);
  const serialized = serializeExchangeState(args.state);
  const cursors: { trades?: CoreReaderCursor; depth?: CoreReaderCursor } = {};
  const cursorEntries = Object.entries(args.cursors)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [key, value] of cursorEntries) {
    (cursors as Record<string, CoreReaderCursor>)[key] = cloneCursor(value)!;
  }
  const merge = args.merge?.nextSourceOnEqualTs
    ? { nextSourceOnEqualTs: args.merge.nextSourceOnEqualTs }
    : {};
  const meta: CheckpointV1['meta'] = { symbol: args.symbol };
  if (args.note) {
    meta.note = args.note;
  }
  return {
    version: 1,
    createdAtMs: Date.now(),
    meta,
    cursors,
    merge,
    engine,
    state: serialized,
  } satisfies CheckpointV1;
}

const KEY_PRIORITY: Record<string, number> = { cursors: -1 };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value).sort((a, b) => {
      const priority = (KEY_PRIORITY[a] ?? 0) - (KEY_PRIORITY[b] ?? 0);
      if (priority !== 0) {
        return priority;
      }
      return a.localeCompare(b);
    });
    for (const key of keys) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted as unknown as T;
  }
  return value;
}

export async function saveCheckpoint(
  path: string,
  cp: CheckpointV1,
): Promise<void> {
  const sorted = sortKeysDeep(cp);
  if (!validateCheckpointV1(sorted)) {
    const message = schemaAjv.errorsText(validateCheckpointV1.errors ?? [], {
      separator: '; ',
    });
    console.warn(`[checkpoint] schema validation failed: ${message}`);
  }
  let json = JSON.stringify(sorted, null, 2);
  json = json.replace(/^{\n\s*"/, '{"');
  await writeFile(path, json, 'utf8');
}

function ensureObject(value: unknown, path: string): Record<string, unknown> {
  if (value === undefined || value === null) {
    throw new Error(`checkpoint is missing required field: ${path}`);
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`checkpoint ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function ensureString(value: unknown, path: string): string {
  if (value === undefined || value === null) {
    throw new Error(`checkpoint is missing required field: ${path}`);
  }
  if (typeof value !== 'string') {
    throw new Error(`checkpoint ${path} must be a string`);
  }
  return value;
}

function ensureNonEmptyString(value: unknown, path: string): string {
  const str = ensureString(value, path);
  if (str.trim().length === 0) {
    throw new Error(`checkpoint ${path} must be a non-empty string`);
  }
  return str;
}

function ensureNumber(value: unknown, path: string): number {
  if (value === undefined || value === null) {
    throw new Error(`checkpoint is missing required field: ${path}`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`checkpoint ${path} must be a finite number`);
  }
  return value;
}

function ensureArray(value: unknown, path: string): unknown[] {
  if (value === undefined || value === null) {
    throw new Error(`checkpoint is missing required field: ${path}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`checkpoint ${path} must be an array`);
  }
  return value;
}

function ensureStringArray(value: unknown, path: string): string[] {
  const arr = ensureArray(value, path);
  return arr.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new Error(`checkpoint ${path}[${index}] must be a string`);
    }
    return entry;
  });
}

function validateCursor(name: string, value: unknown): void {
  const cursor = ensureObject(value, `cursors.${name}`);
  ensureNonEmptyString(cursor['file'], `cursors.${name}.file`);
  const entry = cursor['entry'];
  if (entry !== undefined && typeof entry !== 'string') {
    throw new Error(`checkpoint cursors.${name}.entry must be a string`);
  }
  const recordIndex = ensureNumber(
    cursor['recordIndex'],
    `cursors.${name}.recordIndex`,
  );
  if (!Number.isInteger(recordIndex)) {
    throw new Error(`cursors.${name}.recordIndex must be an integer`);
  }
  if (recordIndex < 0) {
    throw new Error(`cursors.${name}.recordIndex must be >= 0`);
  }
}

function validateCheckpointPayload(data: unknown): CheckpointV1 {
  const parsed = ensureObject(data, 'checkpoint');
  if (parsed['version'] !== 1) {
    throw new Error('unsupported checkpoint version');
  }
  const meta = ensureObject(parsed['meta'], 'meta');
  ensureNonEmptyString(meta['symbol'], 'meta.symbol');
  const createdAtMs = ensureNumber(parsed['createdAtMs'], 'createdAtMs');
  if (!Number.isInteger(createdAtMs) || createdAtMs < 0) {
    throw new Error('checkpoint createdAtMs must be a non-negative integer');
  }
  const note = meta['note'];
  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw new Error('checkpoint meta.note must be a string');
  }
  const cursors = ensureObject(parsed['cursors'], 'cursors');
  for (const [name, cursor] of Object.entries(cursors)) {
    if (cursor === undefined || cursor === null) {
      continue;
    }
    validateCursor(name, cursor);
  }
  const engine = ensureObject(parsed['engine'], 'engine');
  ensureStringArray(engine['openOrderIds'], 'engine.openOrderIds');
  ensureStringArray(engine['stopOrderIds'], 'engine.stopOrderIds');
  ensureObject(parsed['merge'], 'merge');
  ensureObject(parsed['state'], 'state');
  return parsed as unknown as CheckpointV1;
}

export async function loadCheckpoint(path: string): Promise<CheckpointV1> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  return validateCheckpointPayload(parsed);
}

function createEmptyDepthStream<T>(): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<T> {
      return;
    },
  } satisfies AsyncIterable<T>;
}

export async function resumeFromCheckpoint(
  cp: CheckpointV1,
  deps: {
    buildTrades: (
      cursor?: CoreReaderCursor,
    ) => AsyncIterable<unknown> | CursorIterable<unknown>;
    buildDepth?: (
      cursor?: CoreReaderCursor,
    ) => AsyncIterable<unknown> | CursorIterable<unknown>;
    createMerged: (
      trades: AsyncIterable<unknown> | CursorIterable<unknown>,
      depth: AsyncIterable<unknown> | CursorIterable<unknown>,
      start: MergeStartState,
    ) => AsyncIterable<unknown>;
    continueRun: (
      timeline: AsyncIterable<unknown>,
      state: ExchangeState,
    ) => Promise<unknown>;
  },
): Promise<{ state: ExchangeState }> {
  const state = deserializeExchangeState(cp.state);
  restoreEngineFromSnapshot(cp.engine, state);
  const tradesSource = deps.buildTrades(cp.cursors.trades);
  const depthSource = deps.buildDepth
    ? deps.buildDepth(cp.cursors.depth)
    : undefined;
  const start: MergeStartState = {};
  if (cp.merge?.nextSourceOnEqualTs) {
    start.nextSourceOnEqualTs = cp.merge.nextSourceOnEqualTs;
  }
  const depthIterable = depthSource
    ? depthSource
    : (createEmptyDepthStream() as AsyncIterable<unknown>);
  const merged = deps.createMerged(tradesSource, depthIterable, start);
  await deps.continueRun(merged, state);
  return { state };
}
