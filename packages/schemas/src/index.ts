import { createRequire } from 'node:module';

const schemaRequire = createRequire(import.meta.url);

const tradesV1Schema = schemaRequire(
  './v1/trades.schema.json',
) as typeof import('./v1/trades.schema.json');
const depthL2DiffV1Schema = schemaRequire(
  './v1/depth-l2diff.schema.json',
) as typeof import('./v1/depth-l2diff.schema.json');
const checkpointV1Schema = schemaRequire(
  './v1/checkpoint.schema.json',
) as typeof import('./v1/checkpoint.schema.json');
const logsV1Schema = schemaRequire(
  './v1/logs.schema.json',
) as typeof import('./v1/logs.schema.json');
const metricsV1Schema = schemaRequire(
  './v1/metrics.schema.json',
) as typeof import('./v1/metrics.schema.json');

export const tradesV1 = tradesV1Schema;
export const depthL2DiffV1 = depthL2DiffV1Schema;
export const checkpointV1 = checkpointV1Schema;
export const logsV1 = logsV1Schema;
export const metricsV1 = metricsV1Schema;

export type NumericLike = string | number;
export type SideLike = 'BUY' | 'SELL' | 'buy' | 'sell';
export type LiquidityLike = 'MAKER' | 'TAKER' | 'maker' | 'taker';

export type TradeV1 = {
  ts: number | string;
  symbol: string;
  price: NumericLike;
  qty: NumericLike;
  side?: SideLike;
  aggressor?: SideLike;
  id?: string | number;
  source?: string;
  seq?: number;
  entry?: string;
  kind?: 'trade';
};

export type DepthLevelV1 =
  | [NumericLike, NumericLike]
  | { price: NumericLike; qty: NumericLike };

export type DepthL2DiffV1 = {
  ts: number | string;
  symbol: string;
  bids: DepthLevelV1[];
  asks: DepthLevelV1[];
  source?: string;
  seq?: number;
  entry?: string;
  kind?: 'depth';
};

export type CheckpointCursorV1 = {
  file: string;
  entry?: string;
  recordIndex: number | string;
};

export type CheckpointV1 = {
  version: 1 | '1';
  createdAtMs: number | string;
  meta: { symbol: string; note?: string | null } & Record<string, unknown>;
  cursors: Record<string, CheckpointCursorV1>;
  merge: { nextSourceOnEqualTs?: 'DEPTH' | 'TRADES' };
  engine: Record<string, unknown>;
  state: Record<string, unknown>;
};

export type FeesPatchV1 = { maker?: NumericLike; taker?: NumericLike } & Record<
  string,
  unknown
>;

export type ExecutionFillV1 = {
  ts?: number | string;
  orderId?: string | number;
  price: NumericLike;
  qty: NumericLike;
  side?: SideLike;
  liquidity?: LiquidityLike;
  tradeRef?: string;
  sourceAggressor?: SideLike;
} & Record<string, unknown>;

export type LogEntryV1 = {
  ts: number | string;
  kind: string;
  type?: string;
  orderId?: string | number;
  side?: SideLike;
  price?: NumericLike;
  qty?: NumericLike;
  fee?: NumericLike;
  reason?: string;
  session?: string;
  runId?: string;
  fill?: ExecutionFillV1;
  patch?: {
    status?: string;
    executedQty?: NumericLike;
    cumulativeQuote?: NumericLike;
    fees?: FeesPatchV1;
    tsUpdated?: number | string;
  } & Record<string, unknown>;
} & Record<string, unknown>;

export type MetricV1 = {
  ts: number | string;
  name: string;
  value?: NumericLike | null;
  labels?: Record<string, string | number | boolean>;
};
