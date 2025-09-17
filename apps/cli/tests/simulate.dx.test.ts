import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const loadCheckpointMock = jest.fn();
const runReplayMock = jest.fn();
const deserializeExchangeStateMock = jest.fn();
const makeCheckpointV1Mock = jest.fn();
const restoreEngineFromSnapshotMock = jest.fn();

jest.mock('@tradeforge/io-binance', () => {
  type ReaderOpts = { files?: string[] };

  const toReaderOpts = (opts: unknown): ReaderOpts => {
    if (opts && typeof opts === 'object' && 'files' in opts) {
      const files = (opts as { files?: string[] }).files;
      if (Array.isArray(files)) {
        return { files };
      }
    }
    return {};
  };

  const createMockReader = (opts: ReaderOpts) => {
    const file =
      Array.isArray(opts?.files) && opts.files.length > 0
        ? opts.files[0]!
        : 'reader.jsonl';
    return {
      currentCursor: () => ({ file, recordIndex: 0 }),
      async *[Symbol.asyncIterator]() {
        return;
      },
    };
  };
  return {
    __esModule: true,
    createReader: jest.fn((opts: unknown) =>
      createMockReader(toReaderOpts(opts)),
    ),
    createJsonlCursorReader: jest.fn((opts: unknown) =>
      createMockReader(toReaderOpts(opts)),
    ),
  };
});

jest.mock('@tradeforge/core', () => {
  type MockAccountEntry = {
    id: string;
    balances: Map<string, { free: bigint; locked: bigint }>;
  };

  type MockOrderEntry = Record<string, unknown>;

  class ExchangeState {
    public orders = new Map<string, MockOrderEntry>();
    public accounts = new Map<string, MockAccountEntry>();
    private readonly symbolConfig: Record<
      string,
      { priceScale: number; qtyScale: number }
    >;

    constructor(config: {
      symbols?: Record<string, { priceScale?: number; qtyScale?: number }>;
    }) {
      const symbols = config.symbols ?? {};
      this.symbolConfig = {};
      for (const [symbol, entry] of Object.entries(symbols)) {
        this.symbolConfig[symbol] = {
          priceScale: entry.priceScale ?? 5,
          qtyScale: entry.qtyScale ?? 6,
        };
      }
    }

    getSymbolConfig(symbol: string) {
      return this.symbolConfig[symbol];
    }
  }

  class AccountsService {
    private readonly state: ExchangeState;
    private readonly accounts = new Map<
      string,
      {
        id: string;
        balances: Map<string, { free: bigint; locked: bigint }>;
      }
    >();

    constructor(state: ExchangeState) {
      this.state = state;
    }

    createAccount(id: string) {
      const account: MockAccountEntry = {
        id,
        balances: new Map<string, { free: bigint; locked: bigint }>(),
      };
      this.accounts.set(id, account);
      this.state.accounts.set(id, account);
      return { id };
    }

    deposit(accountId: string, currency: string, amount: bigint) {
      const account = this.accounts.get(accountId);
      if (!account) {
        throw new Error('account not found');
      }
      const existing = account.balances.get(currency) ?? {
        free: 0n,
        locked: 0n,
      };
      existing.free += amount;
      account.balances.set(currency, existing);
    }

    getBalancesSnapshot(id: string) {
      const account = this.accounts.get(id);
      if (!account) {
        return {};
      }
      const snapshot: Record<string, { free: bigint; locked: bigint }> = {};
      for (const [currency, bal] of account.balances.entries()) {
        snapshot[currency] = { free: bal.free, locked: bal.locked };
      }
      return snapshot;
    }
  }

  class OrdersService {
    private static seq = 1;

    constructor(
      private readonly state: ExchangeState,
      accounts: AccountsService,
    ) {
      void accounts;
    }

    placeOrder(params: {
      accountId: unknown;
      symbol: unknown;
      type: string;
      side: string;
      qty: unknown;
      price?: unknown;
    }) {
      const id = `order-${OrdersService.seq++}`;
      const order = {
        id,
        symbol: params.symbol,
        type: params.type,
        side: params.side,
        status: 'OPEN',
        qty: params.qty,
        price: params.price,
        executedQty: 0n,
        cumulativeQuote: 0n,
        fills: [] as unknown[],
        fees: {} as Record<string, bigint>,
      };
      this.state.orders.set(id, order);
      return order;
    }
  }

  class StaticMockOrderbook {
    constructor(opts: unknown) {
      void opts;
    }
  }

  const createClock = (label: string) => {
    let current = 0;
    return {
      now: () => current,
      desc: () => label,
      tickUntil: async (target: number) => {
        current = target;
      },
    };
  };

  const executeTimeline = () =>
    (async function* () {
      return;
    })();

  const createMergedStream = () =>
    (async function* () {
      return;
    })();

  const createReplayController = () => {
    let paused = false;
    return {
      pause() {
        paused = true;
      },
      resume() {
        paused = false;
      },
      isPaused() {
        return paused;
      },
      waitUntilResumed: async () => {
        paused = false;
      },
    };
  };

  return {
    __esModule: true,
    AccountsService,
    ExchangeState,
    OrdersService,
    StaticMockOrderbook,
    createAcceleratedClock: (speed?: number) => {
      void speed;
      return createClock('accelerated');
    },
    createLogicalClock: () => createClock('logical'),
    createMergedStream,
    createWallClock: () => createClock('wall'),
    executeTimeline,
    loadCheckpoint: loadCheckpointMock,
    deserializeExchangeState: deserializeExchangeStateMock,
    restoreEngineFromSnapshot: restoreEngineFromSnapshotMock,
    makeCheckpointV1: makeCheckpointV1Mock,
    runReplay: runReplayMock,
    createReplayController,
    toPriceInt: (value: string) => BigInt(Math.trunc(Number(value))),
    toQtyInt: (value: string) => BigInt(Math.trunc(Number(value))),
  };
});

import { ExchangeState, loadCheckpoint, runReplay } from '@tradeforge/core';
import { simulate } from '../src/commands/simulate.js';

type SerializedStateLike = {
  config?: {
    symbols?: Record<string, { priceScale?: number; qtyScale?: number }>;
  };
};

type CheckpointPayload = {
  symbol: string;
  cursors: unknown;
  merge?: unknown;
  state: unknown;
};

function createTempInputFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tf-cli-test-'));
  const file = join(dir, name);
  writeFileSync(file, '');
  return file;
}

describe('simulate DX improvements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = undefined;

    runReplayMock.mockImplementation(async ({ onProgress, autoCp }) => {
      const stats = {
        eventsOut: 1,
        simStartTs: 0 as unknown as number,
        simLastTs: 0 as unknown as number,
        wallStartMs: 0,
        wallLastMs: 0,
      };
      if (onProgress) {
        onProgress({ ...stats });
      }
      if (autoCp?.buildCheckpoint) {
        await autoCp.buildCheckpoint();
        if (onProgress) {
          onProgress({ ...stats });
        }
      }
      return stats;
    });

    deserializeExchangeStateMock.mockImplementation(
      (state: SerializedStateLike) => {
        const symbols = state?.config?.symbols ?? {
          BTCUSDT: { priceScale: 5, qtyScale: 6 },
        };
        const config = { symbols } as unknown as ConstructorParameters<
          typeof ExchangeState
        >[0];
        return new ExchangeState(config);
      },
    );

    makeCheckpointV1Mock.mockImplementation((payload: CheckpointPayload) => ({
      version: 1,
      createdAtMs: 1_700_000_000_000,
      meta: { symbol: payload.symbol },
      cursors: payload.cursors,
      merge: payload.merge ?? {},
      engine: { openOrderIds: [], stopOrderIds: [] },
      state: payload.state,
    }));

    restoreEngineFromSnapshotMock.mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('fails fast when checkpoint version is unsupported', async () => {
    loadCheckpointMock.mockResolvedValue({
      version: 2,
      createdAtMs: Date.now(),
      meta: { symbol: 'BTCUSDT' },
      cursors: {},
      merge: {},
      engine: { openOrderIds: [], stopOrderIds: [] },
      state: {},
    });

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await simulate(['--checkpoint-load', 'checkpoint.json']);

    expect(loadCheckpoint).toHaveBeenCalledWith(
      expect.stringContaining('checkpoint.json'),
    );
    expect(runReplay).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unsupported checkpoint version'),
    );

    errorSpy.mockRestore();
  });

  it('warns when checkpoint trade cursor does not match provided inputs', async () => {
    loadCheckpointMock.mockResolvedValue({
      version: 1,
      createdAtMs: Date.now(),
      meta: { symbol: 'BTCUSDT' },
      cursors: {
        trades: { file: '/data/original-trades.jsonl', recordIndex: 10 },
      },
      merge: {},
      engine: { openOrderIds: [], stopOrderIds: [] },
      state: {
        config: {
          symbols: { BTCUSDT: { priceScale: 5, qtyScale: 6 } },
        },
      },
    });

    const tradePath = createTempInputFile('other-trades.jsonl');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await simulate(['--checkpoint-load', 'resume.json', '--trades', tradePath]);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'checkpoint trades cursor references original-trades.jsonl',
      ),
    );
    expect(process.exitCode).toBeUndefined();

    warnSpy.mockRestore();
  });

  it('logs checkpoint save once after auto checkpoint completes', async () => {
    const tradePath = createTempInputFile('trades.jsonl');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await simulate([
      '--trades',
      tradePath,
      '--checkpoint-save',
      'output.json',
      '--cp-interval-events',
      '1',
    ]);

    const checkpointLogs = logSpy.mock.calls
      .map((call) => call[0])
      .filter((msg): msg is string => typeof msg === 'string')
      .filter((msg) => msg.includes('checkpoint saved to'));

    expect(checkpointLogs).toHaveLength(1);
    expect(process.exitCode).toBeUndefined();

    logSpy.mockRestore();
  });
});
