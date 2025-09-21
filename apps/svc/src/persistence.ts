import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
} from './types.js';
import {
  getRunId,
  getSnapshot,
  getTimestamps,
  listBots,
  listOrders,
  listTrades,
} from './state.js';

const RUNS_ROOT = path.resolve(process.cwd(), 'runs');

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getRunDir(runId: string): string {
  return path.join(RUNS_ROOT, runId);
}

export async function prepareRunArtifacts(
  config: RunConfig,
  timestamps: { createdAt: number | null },
): Promise<void> {
  const dir = getRunDir(config.id);
  await ensureDir(dir);

  const metadata: MetadataFile = {
    exchange: config.exchange,
    dataOperator: config.dataOperator,
    instruments: config.instruments,
    heartbeatTimeoutSec: config.heartbeatTimeoutSec,
    version: 1,
  };

  await writeJson(path.join(dir, 'metadata.json'), metadata);

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

  await writeJson(path.join(dir, 'run.json'), runFile);
  await writeJson(path.join(dir, 'balances.json'), <BalanceSnapshotFile>{
    updatedAt: createdAt,
    balances: [],
  });
  await writeJson(path.join(dir, 'orders.json'), <OrdersFile>{
    updatedAt: createdAt,
    orders: [],
  });
  await writeJson(path.join(dir, 'trades.json'), <TradesFile>{
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
  await writeJson(path.join(dir, 'run.json'), runFile);
}

export async function persistBalances(
  runId: string,
  bots: Array<{
    botName: string;
    initialBalanceInt: number;
    currentBalanceInt: number;
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
  await writeJson(path.join(dir, 'balances.json'), payload);
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
  await writeJson(path.join(dir, 'orders.json'), payload);
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
  await writeJson(path.join(dir, 'trades.json'), payload);
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
