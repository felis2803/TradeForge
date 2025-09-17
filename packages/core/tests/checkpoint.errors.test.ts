import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deserializeExchangeState,
  loadCheckpoint,
  restoreEngineFromSnapshot,
  type CheckpointV1,
  type EngineSnapshot,
  type SerializedExchangeState,
  type SymbolId,
} from '../src/index';

const SYMBOL_STRING = 'BTCUSDT';
const SYMBOL = SYMBOL_STRING as SymbolId;

function createSerializedState(): SerializedExchangeState {
  return {
    config: {
      symbols: {
        [SYMBOL_STRING]: {
          base: 'BTC',
          quote: 'USDT',
          priceScale: 2,
          qtyScale: 3,
        },
      },
      fee: { makerBps: 10, takerBps: 20 },
      counters: { accountSeq: 0, orderSeq: 0, tsCounter: 0 },
    },
    accounts: {},
    orders: {},
  } satisfies SerializedExchangeState;
}

function createCheckpointPayload(): CheckpointV1 {
  return {
    version: 1,
    createdAtMs: 0,
    meta: { symbol: SYMBOL },
    cursors: {},
    merge: {},
    engine: { openOrderIds: [], stopOrderIds: [] },
    state: createSerializedState(),
  } satisfies CheckpointV1;
}

async function withCheckpointFile(
  payload: unknown,
  run: (filePath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'tf-core-checkpoint-errors-'));
  const filePath = join(dir, 'checkpoint.json');
  try {
    await writeFile(filePath, JSON.stringify(payload), 'utf8');
    await run(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadCheckpoint rejects unsupported version', async () => {
  await withCheckpointFile({ version: 2 }, async (filePath) => {
    await expect(loadCheckpoint(filePath)).rejects.toThrow(
      'unsupported checkpoint version',
    );
  });
});

test('loadCheckpoint requires state field to be present', async () => {
  const base = createCheckpointPayload();
  const invalid = { ...base } as Record<string, unknown>;
  delete invalid['state'];
  await withCheckpointFile(invalid, async (filePath) => {
    await expect(loadCheckpoint(filePath)).rejects.toThrow(
      'checkpoint is missing required field: state',
    );
  });
});

test('loadCheckpoint rejects negative cursor recordIndex', async () => {
  const base = createCheckpointPayload();
  base.cursors.trades = { file: 'trades.jsonl', recordIndex: -1 };
  await withCheckpointFile(base, async (filePath) => {
    await expect(loadCheckpoint(filePath)).rejects.toThrow(
      'cursors.trades.recordIndex must be >= 0',
    );
  });
});

test('loadCheckpoint rejects depth cursor when recordIndex is negative', async () => {
  const base = createCheckpointPayload();
  base.cursors.trades = { file: 'trades.jsonl', recordIndex: 0 };
  base.cursors.depth = { file: 'depth.jsonl', recordIndex: -1 };
  await withCheckpointFile(base, async (filePath) => {
    await expect(loadCheckpoint(filePath)).rejects.toThrow('recordIndex');
  });
});

test('loadCheckpoint rejects cursor when entry is not a string', async () => {
  const base = createCheckpointPayload();
  base.cursors.depth = {
    file: 'depth.jsonl',
    recordIndex: 0,
    entry: 42 as unknown as string,
  };
  await withCheckpointFile(base, async (filePath) => {
    await expect(loadCheckpoint(filePath)).rejects.toThrow('entry');
  });
});

test('deserializeExchangeState rejects unknown currencies', () => {
  const serialized: SerializedExchangeState = {
    ...createSerializedState(),
    accounts: {
      A1: {
        id: 'A1',
        apiKey: 'api-A1',
        balances: {
          ETH: { free: '1', locked: '0' },
        },
      },
    },
  };
  expect(() => deserializeExchangeState(serialized)).toThrow(
    'unknown currency in serialized state: ETH',
  );
});

test('deserializeExchangeState rejects unknown order symbols', () => {
  const serialized: SerializedExchangeState = {
    ...createSerializedState(),
    accounts: {
      A1: {
        id: 'A1',
        apiKey: 'api-A1',
        balances: {
          USDT: { free: '0', locked: '0' },
        },
      },
    },
    orders: {
      O1: {
        id: 'O1',
        symbol: 'ETHUSDT',
        type: 'LIMIT',
        side: 'BUY',
        tif: 'GTC',
        status: 'OPEN',
        accountId: 'A1',
        qty: '1',
        executedQty: '0',
        cumulativeQuote: '0',
        fees: {},
        tsCreated: 1,
        tsUpdated: 1,
      },
    },
  };
  expect(() => deserializeExchangeState(serialized)).toThrow(
    'unknown symbol in serialized order: ETHUSDT',
  );
});

test('restoreEngineFromSnapshot fails when orders are missing', () => {
  const state = deserializeExchangeState(createSerializedState());
  const snapshot: EngineSnapshot = {
    openOrderIds: ['O-missing'],
    stopOrderIds: [],
  };
  expect(() => restoreEngineFromSnapshot(snapshot, state)).toThrow(
    'open order from snapshot missing in state: O-missing',
  );
});
