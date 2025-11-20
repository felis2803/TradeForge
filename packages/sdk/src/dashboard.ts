import { createServer, type Server as HttpServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Trade } from '@tradeforge/io-binance';
import type { OrderView, FillEvent } from '@tradeforge/sim';
import type { LiquidationEvent, BotContext } from './runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DashboardConfig {
  enabled: boolean;
  port?: number;
  autoOpenBrowser?: boolean;
}

export interface BotInfo {
  id: string;
  name: string;
  symbol: string;
  strategy?: string;
}

export interface DashboardState {
  symbol: string;
  balance: bigint;
  position: bigint;
  unrealizedPnL: bigint;
  orders: Map<string, OrderView>;
}

export interface BotHandle {
  readonly id: string;
  broadcast(type: string, data: unknown): void;
  updateState(state: Partial<DashboardState>): void;
  unregister(): void;
}

export interface DashboardServer {
  registerBot(id: string, info: Omit<BotInfo, 'id'>): BotHandle;
  close(): Promise<void>;
  readonly port: number;
  readonly url: string;
}

interface WebSocketMessage {
  type: string;
  botId?: string;
  data: unknown;
}

interface BotData {
  info: BotInfo;
  state: DashboardState;
}

export function createDashboardServer(
  config: DashboardConfig,
): DashboardServer {
  const port = config.port ?? 3000;
  const clients = new Set<WebSocket>();
  const bots = new Map<string, BotData>();

  // Load HTML dashboard
  const dashboardHtml = readFileSync(
    join(__dirname, 'dashboard.html'),
    'utf-8',
  );

  // Create HTTP server
  const httpServer: HttpServer = createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(dashboardHtml);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  // Create WebSocket server
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[Dashboard] Client connected');
    clients.add(ws);

    // Send bot list to new client
    const botList = Array.from(bots.values()).map((bot) => ({
      id: bot.info.id,
      name: bot.info.name,
      symbol: bot.info.symbol,
      strategy: bot.info.strategy,
      balance: bot.state.balance.toString(),
      position: bot.state.position.toString(),
      unrealizedPnL: bot.state.unrealizedPnL.toString(),
    }));

    const botListMessage: WebSocketMessage = {
      type: 'botList',
      data: botList,
    };
    ws.send(JSON.stringify(botListMessage));

    // Send initial state for each bot
    bots.forEach((bot) => {
      const initMessage: WebSocketMessage = {
        type: 'init',
        botId: bot.info.id,
        data: {
          symbol: bot.state.symbol,
          balance: bot.state.balance.toString(),
          position: bot.state.position.toString(),
          unrealizedPnL: bot.state.unrealizedPnL.toString(),
          orders: Array.from(bot.state.orders.values()).map((order) => ({
            ...order,
            qty: order.qty.toString(),
            price: order.price?.toString(),
            filledQty: order.filledQty?.toString(),
          })),
        },
      };
      ws.send(JSON.stringify(initMessage));
    });

    ws.on('close', () => {
      console.log('[Dashboard] Client disconnected');
      clients.delete(ws);
    });

    ws.on('error', (err: Error) => {
      console.error('[Dashboard] WebSocket error:', err);
      clients.delete(ws);
    });
  });

  // Start HTTP server
  httpServer.listen(port, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 TradeForge Dashboard running at http://localhost:${port}`);
    console.log(`${'='.repeat(60)}\n`);

    // Auto-open browser if configured
    if (config.autoOpenBrowser) {
      import('node:child_process').then(({ exec }) => {
        const url = `http://localhost:${port}`;
        const command =
          process.platform === 'win32'
            ? `start ${url}`
            : process.platform === 'darwin'
              ? `open ${url}`
              : `xdg-open ${url}`;

        exec(command, (error) => {
          if (error) {
            console.error('[Dashboard] Failed to open browser:', error);
          }
        });
      });
    }
  });

  function broadcastToAll(message: WebSocketMessage): void {
    const json = JSON.stringify(message);
    clients.forEach((client) => {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(json);
      }
    });
  }

  function registerBot(id: string, info: Omit<BotInfo, 'id'>): BotHandle {
    if (bots.has(id)) {
      throw new Error(`Bot with id "${id}" is already registered`);
    }

    const botInfo: BotInfo = { id, ...info };
    const botData: BotData = {
      info: botInfo,
      state: {
        symbol: info.symbol,
        balance: 0n,
        position: 0n,
        unrealizedPnL: 0n,
        orders: new Map(),
      },
    };

    bots.set(id, botData);
    console.log(`[Dashboard] Bot registered: ${id} (${info.name})`);

    // Notify all clients about new bot
    broadcastToAll({
      type: 'botRegistered',
      data: {
        id: botInfo.id,
        name: botInfo.name,
        symbol: botInfo.symbol,
        strategy: botInfo.strategy,
      },
    });

    // Return bot-specific handle
    return {
      id,
      broadcast(type: string, data: unknown): void {
        broadcastToAll({
          type,
          botId: id,
          data,
        });
      },
      updateState(updates: Partial<DashboardState>): void {
        const bot = bots.get(id);
        if (!bot) return;

        if (updates.symbol !== undefined) bot.state.symbol = updates.symbol;
        if (updates.balance !== undefined) bot.state.balance = updates.balance;
        if (updates.position !== undefined)
          bot.state.position = updates.position;
        if (updates.unrealizedPnL !== undefined)
          bot.state.unrealizedPnL = updates.unrealizedPnL;
        if (updates.orders !== undefined) bot.state.orders = updates.orders;
      },
      unregister(): void {
        if (bots.delete(id)) {
          console.log(`[Dashboard] Bot unregistered: ${id}`);
          broadcastToAll({
            type: 'botUnregistered',
            data: { id },
          });
        }
      },
    };
  }

  async function close(): Promise<void> {
    return new Promise((resolve) => {
      // Close all WebSocket connections
      clients.forEach((client) => {
        client.close();
      });
      clients.clear();

      // Close WebSocket server
      wss.close(() => {
        // Close HTTP server
        httpServer.close(() => {
          console.log('[Dashboard] Server closed');
          resolve();
        });
      });
    });
  }

  return {
    registerBot,
    close,
    port,
    url: `http://localhost:${port}`,
  };
}

// Helper functions to serialize data for WebSocket

export function serializeTrade(trade: Trade) {
  return {
    ts: Number(trade.ts),
    price: trade.price.toString(),
    qty: trade.qty.toString(),
    side: trade.side,
  };
}

export function serializeOrder(order: OrderView) {
  return {
    id: order.id,
    type: order.type,
    side: order.side,
    qty: order.qty.toString(),
    price: order.price?.toString(),
    filledQty: order.filledQty?.toString(),
    status: order.status,
    ts: order.ts,
  };
}

export function serializeFill(fill: FillEvent) {
  return {
    orderId: fill.orderId,
    side: fill.side,
    price: fill.price.toString(),
    qty: fill.qty.toString(),
    ts: fill.ts,
  };
}

export function serializeBalance(ctx: BotContext) {
  return {
    balance: ctx.balance.toString(),
    position: ctx.position.toString(),
    unrealizedPnL: ctx.unrealizedPnL.toString(),
  };
}

export function serializeLiquidation(event: LiquidationEvent) {
  return {
    reason: event.reason,
    position: event.position.toString(),
    balance: event.balance.toString(),
    unrealizedPnL: event.unrealizedPnL.toString(),
    equity: event.equity.toString(),
    minEquity: event.minEquity.toString(),
    ts: event.ts,
  };
}
