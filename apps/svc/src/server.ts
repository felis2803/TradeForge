import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';

import {
  configureRun,
  getRunConfig,
  getSnapshot,
  getTimestamps,
  listBots,
  setRunSpeed,
  setStatus,
} from './state.js';
import {
  RUNS_ROOT,
  prepareRunArtifacts,
  persistFullState,
  persistRunStatus,
} from './persistence.js';
import { registerWsHandlers } from './wsHandlers.js';
import type {
  InstrumentConfig,
  RunConfig,
  RunMode,
  RunSpeed,
} from './types.js';

const server = Fastify({
  logger: true,
});

const allowedOriginsEnv = process.env.CORS_ORIGIN;
const defaultOrigin =
  process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:5173';
const allowedOrigins = (allowedOriginsEnv ?? defaultOrigin ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

await server.register(cors, {
  origin(origin, callback) {
    if (!allowedOrigins.length || !origin) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('origin not allowed'), false);
  },
  credentials: true,
});

server.log.info(
  { runsDir: process.env.RUNS_DIR ?? RUNS_ROOT },
  'persistence directory configured',
);

await server.register(websocket, {
  options: {
    clientTracking: true,
  },
});

registerWsHandlers(server);

server.get('/v1/health', async () => ({ status: 'ok' }));

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return fallback;
}

function normalizeInstrument(input: unknown): InstrumentConfig | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const record = input as Record<string, unknown>;
  const rawSymbol = record['symbol'];
  const symbol =
    typeof rawSymbol === 'string'
      ? rawSymbol.trim()
      : rawSymbol !== undefined && rawSymbol !== null
        ? String(rawSymbol).trim()
        : '';
  if (!symbol) {
    return null;
  }
  const feesRecord =
    typeof record['fees'] === 'object' && record['fees'] !== null
      ? (record['fees'] as Record<string, unknown>)
      : undefined;
  const makerSource =
    feesRecord && 'makerBp' in feesRecord
      ? feesRecord['makerBp']
      : record['makerBp'];
  const takerSource =
    feesRecord && 'takerBp' in feesRecord
      ? feesRecord['takerBp']
      : record['takerBp'];

  return {
    symbol,
    fees: {
      makerBp: toFiniteNumber(makerSource, 0),
      takerBp: toFiniteNumber(takerSource, 0),
    },
  };
}

function normalizeRunConfig(body: unknown): RunConfig {
  const record =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const mode: RunMode = record['mode'] === 'history' ? 'history' : 'realtime';
  const rawSpeed = record['speed'];
  const allowedSpeeds: RunSpeed[] = [
    'realtime',
    '1x',
    '2x',
    'as_fast_as_possible',
  ];
  const speed: RunSpeed =
    mode === 'history' &&
    typeof rawSpeed === 'string' &&
    allowedSpeeds.includes(rawSpeed as RunSpeed)
      ? (rawSpeed as RunSpeed)
      : mode === 'history'
        ? '1x'
        : 'realtime';

  const instrumentsRaw = Array.isArray(record['instruments'])
    ? record['instruments']
    : [];
  const instruments = instrumentsRaw
    .map((instrument) => normalizeInstrument(instrument))
    .filter(
      (instrument): instrument is InstrumentConfig => instrument !== null,
    );

  const idValue = record['id'];
  const id =
    typeof idValue === 'string' && idValue.trim().length > 0
      ? idValue
      : `run-${Date.now()}`;

  return {
    id,
    mode,
    speed,
    exchange:
      typeof record['exchange'] === 'string'
        ? (record['exchange'] as string)
        : 'simulated',
    dataOperator:
      typeof record['dataOperator'] === 'string'
        ? (record['dataOperator'] as string)
        : 'internal',
    instruments,
    maxActiveOrders: toFiniteNumber(record['maxActiveOrders'], 50),
    heartbeatTimeoutSec: toFiniteNumber(record['heartbeatTimeoutSec'], 6),
    dataReady:
      record['dataReady'] === undefined ? true : Boolean(record['dataReady']),
  };
}

server.post('/v1/runs', async (request, reply) => {
  const config = normalizeRunConfig(request.body ?? {});
  if (!config.instruments.length) {
    reply.code(400);
    return { error: 'INSTRUMENTS_REQUIRED' };
  }

  configureRun(config);
  await prepareRunArtifacts(config, getTimestamps());
  await persistRunStatus(config.id, getSnapshot(), getTimestamps());

  return { status: 'configured', run: getSnapshot() };
});

server.post('/v1/runs/start', async (request, reply) => {
  const config = getRunConfig();
  if (!config) {
    reply.code(400);
    return { error: 'RUN_NOT_CONFIGURED' };
  }
  const body = (request.body ?? {}) as { speed?: RunSpeed };
  if (body.speed) {
    setRunSpeed(body.speed);
  }
  setStatus('running');
  server.log.info({ status: 'running' }, 'run transition');
  await persistFullState();
  return { status: 'running', run: getSnapshot() };
});

server.post('/v1/runs/pause', async (request, reply) => {
  if (!getRunConfig()) {
    reply.code(400);
    return { error: 'RUN_NOT_CONFIGURED' };
  }
  setStatus('paused');
  server.log.info({ status: 'paused' }, 'run transition');
  await persistFullState();
  return { status: 'paused', run: getSnapshot() };
});

server.post('/v1/runs/stop', async (request, reply) => {
  if (!getRunConfig()) {
    reply.code(400);
    return { error: 'RUN_NOT_CONFIGURED' };
  }
  setStatus('stopped');
  server.log.info({ status: 'stopped' }, 'run transition');
  await persistFullState();
  return { status: 'stopped', run: getSnapshot() };
});

server.get('/v1/runs/status', async () => {
  return getSnapshot();
});

server.get('/v1/bots', async () => {
  return {
    bots: listBots().map((bot) => ({
      botName: bot.botName,
      initialBalanceInt: bot.initialBalanceInt,
      currentBalanceInt: bot.currentBalanceInt,
      connected: bot.connected,
    })),
  };
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await server.listen({ port, host });
  server.log.info(`TradeForge service listening on ${host}:${port}`);
} catch (error) {
  server.log.error(error, 'Failed to start service');
  process.exit(1);
}
