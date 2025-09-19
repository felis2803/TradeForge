import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {
  tradesV1,
  depthL2DiffV1,
  checkpointV1,
  logsV1,
  metricsV1,
  type TradeV1,
  type DepthL2DiffV1,
  type CheckpointV1,
  type LogEntryV1,
  type MetricV1,
} from '@tradeforge/schemas';

type AjvInstance = import('ajv').default;
const AjvFactory = Ajv as unknown as new (...args: unknown[]) => AjvInstance;
const addFormatsPlugin = addFormats as unknown as (ajv: AjvInstance) => void;

export const ajv: AjvInstance = new AjvFactory({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
});
addFormatsPlugin(ajv);

export const validateTradeV1 = ajv.compile<TradeV1>(tradesV1);
export const validateDepthL2DiffV1 = ajv.compile<DepthL2DiffV1>(depthL2DiffV1);
export const validateCheckpointV1 = ajv.compile<CheckpointV1>(checkpointV1);
export const validateLogV1 = ajv.compile<LogEntryV1>(logsV1);
export const validateMetricV1 = ajv.compile<MetricV1>(metricsV1);

export type { TradeV1, DepthL2DiffV1, CheckpointV1, LogEntryV1, MetricV1 };
