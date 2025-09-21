import type { FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type WebSocket from 'ws';
import type { RawData } from 'ws';
import { z } from 'zod';

import {
  addOrder,
  addTrade,
  buildOrderRecord,
  countActiveOrders,
  getBot,
  getHeartbeatTimeoutSec,
  getLastPrice,
  getRunConfig,
  nextOrderId,
  setBotConnectionStatus,
  touchBot,
  updateBotBalance,
  updateOrderStatus,
  upsertBot,
} from './state.js';
import { persistFullState } from './persistence.js';
import type { RejectPayload, RunConfig, WsEnvelope } from './types.js';

type ParsedEnvelope = z.infer<typeof EnvelopeSchema>;
type FastifyWsConnection = { socket: WebSocket };

function isFastifyConnection(value: unknown): value is FastifyWsConnection {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'socket' in value && Boolean((value as FastifyWsConnection).socket);
}

function resolveSocket(raw: FastifyWsConnection | WebSocket): WebSocket {
  return isFastifyConnection(raw) ? raw.socket : (raw as WebSocket);
}

interface BotConnection {
  botName: string;
  socket: WebSocket;
  lastHeartbeat: number;
  serverHeartbeat?: NodeJS.Timeout;
}

const botConnections = new Map<string, BotConnection>();
const uiClients = new Set<WebSocket>();
let heartbeatSweep: NodeJS.Timeout | null = null;

const EnvelopeSchema = z.object({
  type: z.string(),
  ts: z.number().optional(),
  payload: z.unknown(),
  reqId: z.string().optional(),
});

const IntStringSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(/^-?\d+$/),
    z.number().int().refine(Number.isSafeInteger, 'unsafe integer'),
    z.bigint(),
  ])
  .transform((value) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number') {
      return Math.trunc(value).toString();
    }
    return value.toString();
  });

const HelloSchema = z.object({
  botName: z.string().min(1),
  initialBalanceInt: IntStringSchema,
});

const HeartbeatSchema = z.object({
  ts: z.number().optional(),
});

const PlaceSchema = z.object({
  clientOrderId: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['MARKET', 'LIMIT', 'STOP_MARKET', 'STOP_LIMIT']),
  qtyInt: IntStringSchema,
  priceInt: IntStringSchema.optional(),
  stopPriceInt: IntStringSchema.optional(),
  limitPriceInt: IntStringSchema.optional(),
  timeInForce: z.literal('GTC').optional().default('GTC'),
  flags: z.array(z.literal('postOnly')).optional().default([]),
});

const CancelSchema = z.object({
  serverOrderId: z.string().min(1),
});

function parseQuery(req: IncomingMessage): { role?: string } {
  try {
    const url = new URL(req.url ?? '', 'http://localhost');
    const role = url.searchParams.get('role') ?? undefined;
    return { role };
  } catch {
    return {};
  }
}

function send(
  socket: WebSocket,
  type: string,
  payload: unknown,
  reqId?: string,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const message: WsEnvelope = {
    type,
    ts: Date.now(),
    payload,
    ...(reqId ? { reqId } : {}),
  };
  socket.send(JSON.stringify(message));
}

function broadcastToUi(type: string, payload: unknown): void {
  const envelope = JSON.stringify({ type, ts: Date.now(), payload });
  for (const socket of uiClients) {
    if (socket.readyState !== socket.OPEN) continue;
    socket.send(envelope);
  }
}

function sendReject(
  socket: WebSocket,
  payload: RejectPayload,
  reqId?: string,
): void {
  send(socket, 'order.reject', payload, reqId);
}

function startServerHeartbeat(connection: BotConnection): void {
  clearInterval(connection.serverHeartbeat);
  const timeoutMs = Math.max(
    2000,
    Math.floor((getHeartbeatTimeoutSec() * 1000) / 2),
  );
  connection.serverHeartbeat = setInterval(() => {
    send(connection.socket, 'heartbeat', { ts: Date.now() });
  }, timeoutMs) as NodeJS.Timeout;
}

function stopConnectionTimers(connection: BotConnection): void {
  clearInterval(connection.serverHeartbeat);
}

function buildHelloPayload(config: RunConfig | null) {
  return {
    symbols: config?.instruments.map((instrument) => instrument.symbol) ?? [],
    fees:
      config?.instruments.reduce<
        Record<string, { maker: number; taker: number }>
      >((acc, instrument) => {
        acc[instrument.symbol] = {
          maker: instrument.fees.makerBp,
          taker: instrument.fees.takerBp,
        };
        return acc;
      }, {}) ?? {},
    limits: {
      maxActiveOrders: config?.maxActiveOrders ?? 0,
    },
  };
}

function sendHello(connection: BotConnection, config: RunConfig | null): void {
  send(connection.socket, 'hello', buildHelloPayload(config));
}

function sendDepthSnapshot(connection: BotConnection, symbol: string): void {
  const mid = getLastPrice(symbol);
  const bids: Array<[string, string]> = [
    [(mid - 1000n).toString(), '2'],
    [(mid - 500n).toString(), '1'],
  ];
  const asks: Array<[string, string]> = [
    [(mid + 500n).toString(), '1'],
    [(mid + 1000n).toString(), '2'],
  ];
  send(connection.socket, 'depth.snapshot', { symbol, bids, asks });
}

function sendBalanceUpdate(botName: string, balanceInt: string): void {
  const message = { botName, balanceInt };
  const connection = botConnections.get(botName);
  if (connection) {
    send(connection.socket, 'balance.update', message);
  }
  broadcastToUi('balance.update', message);
}

function extractClientOrderId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const raw = record['clientOrderId'];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  return undefined;
}

function computeFeeInt(
  priceInt: string,
  qtyInt: string,
  feeBp: number,
  log: FastifyInstance['log'],
): string {
  try {
    const notional = BigInt(priceInt) * BigInt(qtyInt);
    const scale = 100n;
    const scaledFee = BigInt(Math.round(feeBp * Number(scale)));
    return ((notional * scaledFee) / (10000n * scale)).toString();
  } catch (error) {
    const priceNum = Number(priceInt);
    const qtyNum = Number(qtyInt);
    if (Number.isFinite(priceNum) && Number.isFinite(qtyNum)) {
      const feeValue = Math.floor((priceNum * qtyNum * feeBp) / 10000);
      if (Number.isFinite(feeValue)) {
        return feeValue.toString();
      }
    }
    log.warn(
      { priceInt, qtyInt, feeBp, error },
      'failed to compute feeInt, defaulting to zero',
    );
    return '0';
  }
}

function registerUi(socket: WebSocket): void {
  uiClients.add(socket);
  const interval = setInterval(() => {
    if (socket.readyState !== socket.OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({
        type: 'heartbeat',
        ts: Date.now(),
        payload: { ts: Date.now() },
      }),
    );
  }, 5000);
  socket.on('close', () => {
    clearInterval(interval);
    uiClients.delete(socket);
  });
}

function handleBotDisconnect(
  server: FastifyInstance,
  connection: BotConnection,
): void {
  stopConnectionTimers(connection);
  if (!connection.botName) {
    return;
  }
  botConnections.delete(connection.botName);
  setBotConnectionStatus(connection.botName, false);
  server.log.info({ bot: connection.botName }, 'bot disconnected');
}

function attachBotConnection(
  server: FastifyInstance,
  botName: string,
  connection: BotConnection,
): void {
  const previous = botConnections.get(botName);
  if (previous && previous.socket !== connection.socket) {
    server.log.info(
      { bot: botName },
      'bot reconnecting, replacing previous socket',
    );
    stopConnectionTimers(previous);
    try {
      previous.socket.close(4001, 'replaced by reconnect');
    } catch (error) {
      server.log.warn(
        { bot: botName, error },
        'failed to close previous socket on reconnect',
      );
    }
  }
  connection.botName = botName;
  connection.lastHeartbeat = Date.now();
  botConnections.set(botName, connection);
  setBotConnectionStatus(botName, true);
  startServerHeartbeat(connection);
}

async function handleOrderPlace(
  server: FastifyInstance,
  connection: BotConnection,
  envelope: ParsedEnvelope,
  rawPayload: unknown,
): Promise<void> {
  const parsed = PlaceSchema.safeParse(rawPayload);
  if (!parsed.success) {
    const clientOrderId = extractClientOrderId(rawPayload);
    sendReject(
      connection.socket,
      {
        code: 'VALIDATION',
        message: 'invalid order payload',
        clientOrderId,
      },
      envelope.reqId,
    );
    server.log.warn(
      { bot: connection.botName, error: parsed.error.format() },
      'order.place validation failed',
    );
    return;
  }

  const payload = parsed.data;
  const config = getRunConfig();
  if (!config) {
    sendReject(
      connection.socket,
      {
        code: 'NOT_FOUND',
        message: 'run not configured',
        clientOrderId: payload.clientOrderId,
      },
      envelope.reqId,
    );
    return;
  }

  const symbolConfig = config.instruments.find(
    (instrument) => instrument.symbol === payload.symbol,
  );
  if (!symbolConfig) {
    sendReject(
      connection.socket,
      {
        code: 'VALIDATION',
        message: 'unknown symbol',
        clientOrderId: payload.clientOrderId,
      },
      envelope.reqId,
    );
    return;
  }

  const activeOrders = countActiveOrders(connection.botName);
  if (activeOrders >= config.maxActiveOrders) {
    sendReject(
      connection.socket,
      {
        code: 'RATE_LIMIT',
        message: 'too many active orders',
        clientOrderId: payload.clientOrderId,
      },
      envelope.reqId,
    );
    server.log.warn(
      { bot: connection.botName, clientOrderId: payload.clientOrderId },
      'order rejected by rate limit',
    );
    return;
  }

  const serverOrderId = nextOrderId();
  const order = buildOrderRecord({
    serverOrderId,
    clientOrderId: payload.clientOrderId,
    botName: connection.botName,
    symbol: payload.symbol,
    side: payload.side,
    type: payload.type,
    qtyInt: payload.qtyInt,
    priceInt: payload.priceInt,
    stopPriceInt: payload.stopPriceInt,
    limitPriceInt: payload.limitPriceInt,
    timeInForce: payload.timeInForce,
    flags: payload.flags,
    status: 'accepted',
  });

  addOrder(order);
  server.log.info(
    {
      bot: connection.botName,
      clientOrderId: payload.clientOrderId,
      serverOrderId,
      type: payload.type,
      symbol: payload.symbol,
    },
    'order accepted',
  );

  send(
    connection.socket,
    'order.ack',
    {
      clientOrderId: payload.clientOrderId,
      serverOrderId,
      status: 'accepted',
    },
    envelope.reqId,
  );

  if (payload.type !== 'MARKET') {
    updateOrderStatus(serverOrderId, 'open');
    send(connection.socket, 'order.update', { serverOrderId, status: 'open' });
    await persistFullState();
    return;
  }

  const priceInt = payload.priceInt ?? getLastPrice(payload.symbol).toString();
  const qtyInt = payload.qtyInt;
  const feeInt = computeFeeInt(
    priceInt,
    qtyInt,
    symbolConfig.fees.takerBp,
    server.log,
  );
  const liquidity = payload.flags.includes('postOnly') ? 'maker' : 'taker';

  updateOrderStatus(serverOrderId, 'filled');

  send(connection.socket, 'order.fill', {
    serverOrderId,
    priceInt,
    qtyInt,
    liquidity,
    feeInt,
  });
  send(connection.socket, 'order.update', { serverOrderId, status: 'filled' });
  send(connection.socket, 'trade', {
    symbol: payload.symbol,
    priceInt,
    qtyInt,
    side: payload.side,
  });

  const bot = getBot(connection.botName);
  if (bot) {
    try {
      const balance = BigInt(bot.currentBalanceInt);
      const notional = BigInt(priceInt) * BigInt(qtyInt);
      const fee = BigInt(feeInt);
      const nextBalance =
        payload.side === 'buy'
          ? balance - notional - fee
          : balance + notional - fee;
      const nextBalanceStr = nextBalance.toString();
      updateBotBalance(connection.botName, nextBalanceStr);
      sendBalanceUpdate(connection.botName, nextBalanceStr);
    } catch (error) {
      server.log.warn(
        { bot: connection.botName, error },
        'failed to compute balance delta',
      );
    }
  }

  addTrade({
    serverOrderId,
    botName: connection.botName,
    symbol: payload.symbol,
    priceInt,
    qtyInt,
    side: payload.side,
    liquidity,
    feeInt,
    ts: Date.now(),
  });

  await persistFullState();
}

async function handleOrderCancel(
  server: FastifyInstance,
  connection: BotConnection,
  envelope: ParsedEnvelope,
  rawPayload: unknown,
): Promise<void> {
  const parsed = CancelSchema.safeParse(rawPayload);
  if (!parsed.success) {
    sendReject(
      connection.socket,
      { code: 'VALIDATION', message: 'invalid cancel payload' },
      envelope.reqId,
    );
    server.log.warn(
      { bot: connection.botName, error: parsed.error.format() },
      'order.cancel validation failed',
    );
    return;
  }

  const { serverOrderId } = parsed.data;
  const order = updateOrderStatus(serverOrderId, 'canceled');
  if (!order) {
    sendReject(
      connection.socket,
      {
        code: 'NOT_FOUND',
        message: 'order not found',
        serverOrderId,
      },
      envelope.reqId,
    );
    return;
  }

  send(connection.socket, 'order.cancel', {
    serverOrderId,
    status: 'canceled',
  });

  await persistFullState();
}

function ensureHeartbeatSweep(server: FastifyInstance): void {
  if (heartbeatSweep) {
    return;
  }
  heartbeatSweep = setInterval(() => {
    const timeoutMs = getHeartbeatTimeoutSec() * 1000;
    const now = Date.now();
    for (const [botName, connection] of botConnections) {
      if (now - connection.lastHeartbeat > timeoutMs) {
        server.log.warn(
          { bot: botName, lastHeartbeat: connection.lastHeartbeat, timeoutMs },
          'bot heartbeat timed out (soft disconnect)',
        );
      }
    }
  }, 1000);
  server.addHook('onClose', async () => {
    if (heartbeatSweep) {
      clearInterval(heartbeatSweep);
      heartbeatSweep = null;
    }
  });
}

export function registerWsHandlers(server: FastifyInstance): void {
  ensureHeartbeatSweep(server);

  server.get('/ws', { websocket: true }, (rawConnection, req) => {
    const socket = resolveSocket(
      rawConnection as FastifyWsConnection | WebSocket,
    );
    const { role } = parseQuery(req.raw as IncomingMessage);
    if (role === 'ui') {
      registerUi(socket);
      return;
    }

    const botConnection: BotConnection = {
      botName: '',
      socket,
      lastHeartbeat: Date.now(),
    };

    socket.on('message', (buffer: RawData) => {
      let decoded: unknown;
      try {
        decoded = JSON.parse(buffer.toString());
      } catch (error) {
        server.log.warn({ error }, 'failed to parse websocket payload');
        return;
      }

      const envelopeResult = EnvelopeSchema.safeParse(decoded);
      if (!envelopeResult.success) {
        server.log.warn(
          { error: envelopeResult.error.format() },
          'invalid websocket envelope',
        );
        return;
      }
      const envelope = envelopeResult.data;

      switch (envelope.type) {
        case 'hello': {
          const parsed = HelloSchema.safeParse(envelope.payload);
          if (!parsed.success) {
            sendReject(
              socket,
              { code: 'VALIDATION', message: 'invalid hello payload' },
              envelope.reqId,
            );
            server.log.warn(
              { error: parsed.error.format() },
              'bot hello validation failed',
            );
            return;
          }
          const { botName, initialBalanceInt } = parsed.data;
          attachBotConnection(server, botName, botConnection);
          const botState = upsertBot(botName, initialBalanceInt);
          touchBot(botName);
          sendHello(botConnection, getRunConfig());
          const config = getRunConfig();
          if (config) {
            for (const instrument of config.instruments) {
              sendDepthSnapshot(botConnection, instrument.symbol);
            }
          }
          const balance =
            getBot(botName)?.currentBalanceInt ?? botState.currentBalanceInt;
          sendBalanceUpdate(botName, balance);
          void persistFullState();
          server.log.info({ bot: botName }, 'bot connected');
          break;
        }
        case 'heartbeat': {
          if (!botConnection.botName) {
            return;
          }
          botConnection.lastHeartbeat = Date.now();
          touchBot(botConnection.botName);
          const payload = HeartbeatSchema.safeParse(envelope.payload);
          if (!payload.success) {
            server.log.warn(
              { bot: botConnection.botName, error: payload.error.format() },
              'invalid heartbeat payload',
            );
          }
          send(socket, 'heartbeat', { ts: Date.now() }, envelope.reqId);
          break;
        }
        case 'order.place': {
          if (!botConnection.botName) {
            sendReject(
              socket,
              {
                code: 'VALIDATION',
                message: 'hello required before order.place',
              },
              envelope.reqId,
            );
            return;
          }
          botConnection.lastHeartbeat = Date.now();
          touchBot(botConnection.botName);
          void handleOrderPlace(
            server,
            botConnection,
            envelope,
            envelope.payload,
          ).catch((error) => {
            server.log.error(
              { bot: botConnection.botName, error },
              'order.place handler failed',
            );
            sendReject(
              socket,
              {
                code: 'INTERNAL',
                message: 'internal error',
                clientOrderId: extractClientOrderId(envelope.payload),
              },
              envelope.reqId,
            );
          });
          break;
        }
        case 'order.cancel': {
          if (!botConnection.botName) {
            sendReject(
              socket,
              {
                code: 'VALIDATION',
                message: 'hello required before order.cancel',
              },
              envelope.reqId,
            );
            return;
          }
          botConnection.lastHeartbeat = Date.now();
          touchBot(botConnection.botName);
          void handleOrderCancel(
            server,
            botConnection,
            envelope,
            envelope.payload,
          ).catch((error) => {
            server.log.error(
              { bot: botConnection.botName, error },
              'order.cancel handler failed',
            );
            sendReject(
              socket,
              { code: 'INTERNAL', message: 'internal error' },
              envelope.reqId,
            );
          });
          break;
        }
        default:
          break;
      }
    });

    socket.on('close', () => {
      handleBotDisconnect(server, botConnection);
      void persistFullState();
    });

    socket.on('error', (error: unknown) => {
      server.log.error({ error }, 'websocket error');
    });
  });
}
