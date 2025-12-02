import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import tradesV1 from '@tradeforge/schemas/v1/trades';
import depthL2DiffV1 from '@tradeforge/schemas/v1/depth-l2diff';
import checkpointV1 from '@tradeforge/schemas/v1/checkpoint';
import logsV1 from '@tradeforge/schemas/v1/logs';
import metricsV1 from '@tradeforge/schemas/v1/metrics';
import type {
  TradeV1,
  DepthL2DiffV1,
  CheckpointV1,
  LogEntryV1,
  MetricV1,
} from '@tradeforge/schemas';

type AjvInstance = import('ajv').default;
const AjvFactory = Ajv as unknown as new (...args: unknown[]) => AjvInstance;
const addFormatsPlugin = addFormats as unknown as (ajv: AjvInstance) => void;

export const ajv: AjvInstance = new AjvFactory({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
addFormatsPlugin(ajv);

export const validateTradeV1 = ajv.compile<TradeV1>(tradesV1);
export const validateDepthL2DiffV1 = ajv.compile<DepthL2DiffV1>(depthL2DiffV1);
export const validateCheckpointV1 = ajv.compile<CheckpointV1>(checkpointV1);
export const validateLogV1 = ajv.compile<LogEntryV1>(logsV1);
export const validateMetricV1 = ajv.compile<MetricV1>(metricsV1);

export type ValidateMode = 'strict' | 'warn' | 'off';

const validatorMap = {
  tradeV1: validateTradeV1,
  depthV1: validateDepthL2DiffV1,
  checkpointV1: validateCheckpointV1,
  logV1: validateLogV1,
  metricV1: validateMetricV1,
} as const;

type ValidatorKind = keyof typeof validatorMap;

function resolveMode(explicit?: ValidateMode): ValidateMode {
  const envValue = process.env['VALIDATE_WRITE'] as ValidateMode | undefined;
  const value = explicit ?? envValue;
  if (value === 'strict' || value === 'warn' || value === 'off') {
    return value;
  }
  return 'warn';
}

export function validateWithMode(
  kind: ValidatorKind,
  data: unknown,
  mode?: ValidateMode,
): boolean {
  const validate = validatorMap[kind];
  const ok = validate(data);
  if (!ok) {
    const normalized = resolveMode(mode);
    const message = ajv.errorsText(validate.errors ?? [], { dataVar: kind });
    if (normalized === 'strict') {
      throw new Error(`[${kind}] validation failed: ${message}`);
    }
    if (normalized === 'warn') {
      console.warn(`[${kind}] validation failed: ${message}`);
    }
  }
  return ok;
}

export type { TradeV1, DepthL2DiffV1, CheckpointV1, LogEntryV1, MetricV1 };
