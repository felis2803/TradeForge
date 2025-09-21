import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  BalanceSnapshotFile,
  MetadataFile,
  OrderRecord,
  OrdersFile,
  RunConfig,
  RunFile,
  RunStateSnapshot,
  TradeRecord,
  TradesFile,
  IntString,
} from './types.js';
import {
  getRunId,
  getSnapshot,
  getTimestamps,
  listBots,
  listOrders,
  listTrades,
} from './state.js';

const DEFAULT_RUNS_ROOT = path.resolve(
  fileURLToPath(new URL('../../..', import.meta.url)),
  'runs',
);

export const RUNS_ROOT = process.env.RUNS_DIR
  ? path.resolve(process.env.RUNS_DIR)
  : DEFAULT_RUNS_ROOT;

async function writeFileAtomic(filePath: string, data: string): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.tmp-${randomUUID()}.json`);
  await writeFile(tmpPath, data, 'utf-8');
  await rename(tmpPath, filePath);
}

export async function persistJSON(
  filePath: string,
  data: unknown,
): Promise<void> {
  const payload = JSON.stringify(data, null, 2);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeFileAtomic(filePath, payload);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }
  throw lastError ?? new Error('Failed to persist JSON');
}

function getRunDir(runId: string): string {
  return path.join(RUNS_ROOT, runId);
}

export async function prepareRunArtifacts(
  config: RunConfig,
  timestamps: { createdAt: number | null },
): Promise<void> {
  const dir = getRunDir(config.id);
  await mkdir(dir, { recursive: true });

  const metadata: MetadataFile = {
    exchange: config.exchange,
    dataOperator: config.dataOperator,
    instruments: config.instruments,
    heartbeatTimeoutSec: config.heartbeatTimeoutSec,
    version: 1,
  };

  await persistJSON(path.join(dir, 'metadata.json'), metadata);

  const createdAt = timestamps.createdAt ?? Date.now();
  const runFile: RunFile = {
    config,
    status: 'configured',
    createdAt,
    startedAt: null,
    pausedAt: null,
    stoppedAt: null,
    updatedAt: createdAt,
  };

  await persistJSON(path.join(dir, 'run.json'), runFile);
  await persistJSON(path.join(dir, 'balances.json'), <BalanceSnapshotFile>{
    updatedAt: createdAt,
    balances: [],
  });
  await persistJSON(path.join(dir, 'orders.json'), <OrdersFile>{
    updatedAt: createdAt,
    orders: [],
  });
  await persistJSON(path.join(dir, 'trades.json'), <TradesFile>{
    updatedAt: createdAt,
    trades: [],
  });
}

export async function persistRunStatus(
  runId: string,
  snapshot: RunStateSnapshot,
  timestamps: {
    createdAt: number | null;
    startedAt: number | null;
    pausedAt: number | null;
    stoppedAt: number | null;
  },
): Promise<void> {
  const dir = getRunDir(runId);
  const now = Date.now();
  const runFile: RunFile = {
    config: snapshot.config,
    status: snapshot.status,
    createdAt: timestamps.createdAt ?? now,
    startedAt: timestamps.startedAt,
    pausedAt: timestamps.pausedAt,
    stoppedAt: timestamps.stoppedAt,
    updatedAt: now,
  };
  await persistJSON(path.join(dir, 'run.json'), runFile);
}

export async function persistBalances(
  runId: string,
  bots: Array<{
    botName: string;
    initialBalanceInt: IntString;
    currentBalanceInt: IntString;
  }>,
): Promise<void> {
  const dir = getRunDir(runId);
  const now = Date.now();
  const payload: BalanceSnapshotFile = {
    updatedAt: now,
    balances: bots.map((bot) => ({
      botName: bot.botName,
      initialBalanceInt: bot.initialBalanceInt,
      currentBalanceInt: bot.currentBalanceInt,
    })),
  };
  await persistJSON(path.join(dir, 'balances.json'), payload);
}

export async function persistOrders(
  runId: string,
  orders: OrderRecord[],
): Promise<void> {
  const dir = getRunDir(runId);
  const payload: OrdersFile = {
    updatedAt: Date.now(),
    orders,
  };
  await persistJSON(path.join(dir, 'orders.json'), payload);
}

export async function persistTrades(
  runId: string,
  trades: TradeRecord[],
): Promise<void> {
  const dir = getRunDir(runId);
  const payload: TradesFile = {
    updatedAt: Date.now(),
    trades,
  };
  await persistJSON(path.join(dir, 'trades.json'), payload);
}

export async function persistFullState(): Promise<void> {
  const runId = getRunId();
  if (!runId) {
    return;
  }
  await persistRunStatus(runId, getSnapshot(), getTimestamps());
  await persistOrders(runId, listOrders());
  await persistTrades(runId, listTrades());
  await persistBalances(
    runId,
    listBots().map((bot) => ({
      botName: bot.botName,
      initialBalanceInt: bot.initialBalanceInt,
      currentBalanceInt: bot.currentBalanceInt,
    })),
  );
}
