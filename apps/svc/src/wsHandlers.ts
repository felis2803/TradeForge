import type { FastifyInstance } from 'fastify';
import type { IncomingMessage } from 'node:http';
import type { SocketStream } from '@fastify/websocket';
import type { RawData, WebSocket } from 'ws';

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
import { OrderFlag, OrderRecord, RunConfig, WsEnvelope } from './types.js';
import { persistFullState } from './persistence.js';

interface BotConnection {
  botName: string;
  socket: WebSocket;
  heartbeatTimer?: NodeJS.Timeout;
  serverHeartbeat?: NodeJS.Timeout;
}

const botConnections = new Map<string, BotConnection>();
const uiClients = new Set<WebSocket>();

interface NormalizedOrderPlacePayload {
  clientOrderId: string;
  symbol: string;
  side: OrderRecord['side'];
  type: OrderRecord['type'];
  qtyInt: number;
  priceInt?: number;
  stopPriceInt?: number;
  limitPriceInt?: number;
  timeInForce: OrderRecord['timeInForce'];
  flags: OrderFlag[];
}

interface OrderCancelPayload {
  serverOrderId: string;
}

interface HelloPayload {
  botName: string;
  initialBalanceInt: number;
}

function parseQuery(req: IncomingMessage): { role?: string } {
  const url = new URL(req.url ?? '', 'http://localhost');
  const role = url.searchParams.get('role') ?? undefined;
  return { role };
}

function send(socket: WebSocket, message: WsEnvelope): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  socket.send(JSON.stringify({ ...message, ts: Date.now() }));
}

function broadcastToUi(message: WsEnvelope): void {
  for (const socket of uiClients) {
    if (socket.readyState !== socket.OPEN) continue;
    socket.send(JSON.stringify({ ...message, ts: Date.now() }));
  }
}

function scheduleHeartbeatTimeout(connection: BotConnection): void {
  clearTimeout(connection.heartbeatTimer);
  const timeoutMs = getHeartbeatTimeoutSec() * 1000;
  connection.heartbeatTimer = setTimeout(() => {
    connection.socket.close(4000, 'heartbeat timeout');
    setBotConnectionStatus(connection.botName, false);
    botConnections.delete(connection.botName);
  }, timeoutMs);
}

function startServerHeartbeat(connection: BotConnection): void {
  clearInterval(connection.serverHeartbeat);
  const timeoutMs = Math.max(
    2000,
    Math.floor((getHeartbeatTimeoutSec() * 1000) / 2),
  );
  connection.serverHeartbeat = setInterval(() => {
    send(connection.socket, {
      type: 'heartbeat',
      ts: Date.now(),
      payload: { ts: Date.now() },
    });
  }, timeoutMs) as NodeJS.Timeout;
}

function stopConnectionTimers(connection: BotConnection): void {
  clearTimeout(connection.heartbeatTimer);
  clearInterval(connection.serverHeartbeat);
}

function sendHello(connection: BotConnection, config: RunConfig | null): void {
  const payload = {
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
  send(connection.socket, {
    type: 'hello',
    ts: Date.now(),
    payload,
  });
}

function sendDepthSnapshot(connection: BotConnection, symbol: string): void {
  const mid = getLastPrice(symbol);
  const bids = [
    [String(mid - 1000), '2'],
    [String(mid - 500), '1'],
  ];
  const asks = [
    [String(mid + 500), '1'],
    [String(mid + 1000), '2'],
  ];
  send(connection.socket, {
    type: 'depth.snapshot',
    ts: Date.now(),
    payload: { symbol, bids, asks },
  });
}

function sendBalanceUpdate(botName: string, balanceInt: number): void {
  const message: WsEnvelope = {
    type: 'balance.update',
    ts: Date.now(),
    payload: { botName, balanceInt },
  };
  const connection = botConnections.get(botName);
  if (connection) {
    send(connection.socket, message);
  }
  broadcastToUi(message);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  return null;
}

function toOptionalFiniteNumber(value: unknown): number | undefined {
  const result = toFiniteNumber(value);
  return result === null ? undefined : result;
}

function extractClientOrderId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const raw = record['clientOrderId'];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw;
  }
  return undefined;
}

function normalizeOrderPlacePayload(
  payload: unknown,
): NormalizedOrderPlacePayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const clientOrderId =
    typeof record['clientOrderId'] === 'string'
      ? record['clientOrderId'].trim()
      : '';
  const symbol =
    typeof record['symbol'] === 'string' ? record['symbol'].trim() : '';
  if (!clientOrderId || !symbol) {
    return null;
  }

  const side = record['side'];
  if (side !== 'buy' && side !== 'sell') {
    return null;
  }

  const type = record['type'];
  const validTypes: Array<OrderRecord['type']> = [
    'MARKET',
    'LIMIT',
    'STOP_MARKET',
    'STOP_LIMIT',
  ];
  if (
    typeof type !== 'string' ||
    !validTypes.includes(type as OrderRecord['type'])
  ) {
    return null;
  }

  const qty = toFiniteNumber(record['qtyInt']);
  if (qty === null) {
    return null;
  }

  const timeInForce: OrderRecord['timeInForce'] =
    record['timeInForce'] === 'GTC' || record['timeInForce'] === undefined
      ? 'GTC'
      : 'GTC';
  const flagsRaw = record['flags'];
  const flags: OrderFlag[] = Array.isArray(flagsRaw)
    ? (flagsRaw.filter((flag) => flag === 'postOnly') as OrderFlag[])
    : [];

  const priceInt = toOptionalFiniteNumber(record['priceInt']);
  const stopPriceInt = toOptionalFiniteNumber(record['stopPriceInt']);
  const limitPriceInt = toOptionalFiniteNumber(record['limitPriceInt']);

  return {
    clientOrderId,
    symbol,
    side,
    type: type as OrderRecord['type'],
    qtyInt: qty,
    priceInt,
    stopPriceInt,
    limitPriceInt,
    timeInForce,
    flags,
  };
}

function normalizeOrderCancelPayload(
  payload: unknown,
): OrderCancelPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const raw = record['serverOrderId'];
  const serverOrderId =
    typeof raw === 'string'
      ? raw.trim()
      : raw !== undefined && raw !== null
        ? String(raw).trim()
        : '';
  if (!serverOrderId) {
    return null;
  }
  return { serverOrderId };
}

function normalizeHelloPayload(payload: unknown): HelloPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const rawBotName = record['botName'];
  const botName =
    typeof rawBotName === 'string'
      ? rawBotName.trim()
      : rawBotName !== undefined && rawBotName !== null
        ? String(rawBotName).trim()
        : '';
  if (!botName) {
    return null;
  }
  const initialBalance = toFiniteNumber(record['initialBalanceInt']);
  return { botName, initialBalanceInt: initialBalance ?? 0 };
}

async function handleOrderPlace(
  connection: BotConnection,
  envelope: WsEnvelope,
  payload: unknown,
): Promise<void> {
  const config = getRunConfig();
  if (!config) {
    send(connection.socket, {
      type: 'order.reject',
      ts: Date.now(),
      payload: {
        clientOrderId: extractClientOrderId(payload),
        reason: 'RUN_NOT_CONFIGURED',
      },
      reqId: envelope.reqId,
    });
    return;
  }

  const orderPayload = normalizeOrderPlacePayload(payload);
  const clientOrderId =
    orderPayload?.clientOrderId ?? extractClientOrderId(payload);
  if (!orderPayload) {
    send(connection.socket, {
      type: 'order.reject',
      ts: Date.now(),
      payload: { clientOrderId, reason: 'INVALID_ORDER' },
      reqId: envelope.reqId,
    });
    return;
  }

  const symbolConfig = config.instruments.find(
    (instrument) => instrument.symbol === orderPayload.symbol,
  );
  if (!symbolConfig) {
    send(connection.socket, {
      type: 'order.reject',
      ts: Date.now(),
      payload: {
        clientOrderId: orderPayload.clientOrderId,
        reason: 'UNKNOWN_SYMBOL',
      },
      reqId: envelope.reqId,
    });
    return;
  }

  const active = countActiveOrders(connection.botName);
  if (active >= config.maxActiveOrders) {
    send(connection.socket, {
      type: 'order.reject',
      ts: Date.now(),
      payload: {
        clientOrderId: orderPayload.clientOrderId,
        reason: 'RATE_LIMIT',
      },
      reqId: envelope.reqId,
    });
    return;
  }

  const serverOrderId = nextOrderId();
  const order: OrderRecord = buildOrderRecord({
    serverOrderId,
    clientOrderId: orderPayload.clientOrderId,
    botName: connection.botName,
    symbol: orderPayload.symbol,
    side: orderPayload.side,
    type: orderPayload.type,
    qtyInt: orderPayload.qtyInt,
    priceInt: orderPayload.priceInt,
    stopPriceInt: orderPayload.stopPriceInt,
    limitPriceInt: orderPayload.limitPriceInt,
    timeInForce: orderPayload.timeInForce,
    flags: orderPayload.flags,
    status: 'accepted',
  });

  addOrder(order);

  send(connection.socket, {
    type: 'order.ack',
    ts: Date.now(),
    payload: {
      clientOrderId: orderPayload.clientOrderId,
      serverOrderId,
      status: 'accepted',
    },
    reqId: envelope.reqId,
  });

  if (orderPayload.type !== 'MARKET') {
    updateOrderStatus(serverOrderId, 'open');
    send(connection.socket, {
      type: 'order.update',
      ts: Date.now(),
      payload: { serverOrderId, status: 'open' },
    });
    await persistFullState();
    return;
  }

  const priceInt = orderPayload.priceInt ?? getLastPrice(orderPayload.symbol);
  const qtyInt = orderPayload.qtyInt;
  const takerFeeBp = symbolConfig.fees.takerBp;
  const feeInt = Math.floor((priceInt * qtyInt * takerFeeBp) / 10_000);

  updateOrderStatus(serverOrderId, 'filled');

  const liquidity: 'maker' | 'taker' = orderPayload.flags.includes('postOnly')
    ? 'maker'
    : 'taker';

  send(connection.socket, {
    type: 'order.fill',
    ts: Date.now(),
    payload: { serverOrderId, priceInt, qtyInt, liquidity, feeInt },
  });

  send(connection.socket, {
    type: 'order.update',
    ts: Date.now(),
    payload: { serverOrderId, status: 'filled' },
  });

  send(connection.socket, {
    type: 'trade',
    ts: Date.now(),
    payload: {
      symbol: orderPayload.symbol,
      priceInt,
      qtyInt,
      side: orderPayload.side,
    },
  });

  const bot = getBot(connection.botName);
  if (bot) {
    const delta = priceInt * qtyInt;
    const newBalance =
      orderPayload.side === 'buy'
        ? bot.currentBalanceInt - delta - feeInt
        : bot.currentBalanceInt + delta - feeInt;
    updateBotBalance(connection.botName, newBalance);
    sendBalanceUpdate(connection.botName, newBalance);
  }

  addTrade({
    serverOrderId,
    botName: connection.botName,
    symbol: orderPayload.symbol,
    priceInt,
    qtyInt,
    side: orderPayload.side,
    liquidity,
    feeInt,
    ts: Date.now(),
  });

  await persistFullState();
}

async function handleOrderCancel(
  connection: BotConnection,
  payload: unknown,
): Promise<void> {
  const normalized = normalizeOrderCancelPayload(payload);
  if (!normalized) {
    send(connection.socket, {
      type: 'order.reject',
      ts: Date.now(),
      payload: { reason: 'INVALID_CANCEL' },
    });
    return;
  }

  const order = updateOrderStatus(normalized.serverOrderId, 'canceled');
  if (!order) {
    send(connection.socket, {
      type: 'order.reject',
      ts: Date.now(),
      payload: {
        serverOrderId: normalized.serverOrderId,
        reason: 'UNKNOWN_ORDER',
      },
    });
    return;
  }
  send(connection.socket, {
    type: 'order.cancel',
    ts: Date.now(),
    payload: { serverOrderId: normalized.serverOrderId, status: 'canceled' },
  });
  await persistFullState();
}

function handleBotDisconnect(connection: BotConnection): void {
  stopConnectionTimers(connection);
  setBotConnectionStatus(connection.botName, false);
  botConnections.delete(connection.botName);
}

function registerUi(connection: SocketStream): void {
  const { socket } = connection;
  uiClients.add(socket as WebSocket);
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
    uiClients.delete(socket as WebSocket);
  });
}

export function registerWsHandlers(server: FastifyInstance): void {
  server.get('/ws', { websocket: true }, (connection, req) => {
    const { role } = parseQuery(req.raw as IncomingMessage);
    if (role === 'ui') {
      registerUi(connection);
      return;
    }

    const socket = connection.socket as WebSocket;
    const botConnection: BotConnection = {
      botName: '',
      socket,
    };

    socket.on('message', (buffer: RawData) => {
      let envelope: WsEnvelope<unknown>;
      try {
        envelope = JSON.parse(buffer.toString()) as WsEnvelope<unknown>;
      } catch (error) {
        return;
      }

      if (envelope.type !== 'heartbeat') {
        touchBot(botConnection.botName);
      }

      switch (envelope.type) {
        case 'hello': {
          const helloPayload = normalizeHelloPayload(envelope.payload);
          if (!helloPayload) {
            send(socket, {
              type: 'order.reject',
              ts: Date.now(),
              payload: { reason: 'INVALID_HELLO' },
              reqId: envelope.reqId,
            });
            return;
          }
          const { botName, initialBalanceInt } = helloPayload;
          botConnection.botName = botName;
          botConnections.set(botName, botConnection);
          upsertBot(botName, initialBalanceInt);
          scheduleHeartbeatTimeout(botConnection);
          startServerHeartbeat(botConnection);
          sendHello(botConnection, getRunConfig());
          const config = getRunConfig();
          if (config) {
            for (const instrument of config.instruments) {
              sendDepthSnapshot(botConnection, instrument.symbol);
            }
          }
          sendBalanceUpdate(
            botName,
            getBot(botName)?.currentBalanceInt ?? initialBalanceInt,
          );
          void persistFullState();
          break;
        }
        case 'heartbeat': {
          if (!botConnection.botName) {
            return;
          }
          scheduleHeartbeatTimeout(botConnection);
          break;
        }
        case 'order.place': {
          if (!botConnection.botName) {
            return;
          }
          scheduleHeartbeatTimeout(botConnection);
          void handleOrderPlace(
            botConnection,
            envelope,
            envelope.payload,
          ).catch((error) => {
            console.error('order.place failed', error);
          });
          break;
        }
        case 'order.cancel': {
          if (!botConnection.botName) {
            return;
          }
          scheduleHeartbeatTimeout(botConnection);
          void handleOrderCancel(botConnection, envelope.payload).catch(
            (error) => {
              console.error('order.cancel failed', error);
            },
          );
          break;
        }
        default:
          break;
      }
    });

    socket.on('close', () => {
      handleBotDisconnect(botConnection);
      void persistFullState();
    });
  });
}
