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

export interface DashboardState {
  symbol: string;
  balance: bigint;
  position: bigint;
  unrealizedPnL: bigint;
  orders: Map<string, OrderView>;
}

export interface DashboardServer {
  broadcast(type: string, data: unknown): void;
  updateState(state: Partial<DashboardState>): void;
  close(): Promise<void>;
  readonly port: number;
  readonly url: string;
}

interface WebSocketMessage {
  type: string;
  data: unknown;
}

export function createDashboardServer(
  config: DashboardConfig,
): DashboardServer {
  const port = config.port ?? 3000;
  const clients = new Set<WebSocket>();

  const state: DashboardState = {
    symbol: '',
    balance: 0n,
    position: 0n,
    unrealizedPnL: 0n,
    orders: new Map(),
  };

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

    // Send initial state
    const initMessage: WebSocketMessage = {
      type: 'init',
      data: {
        symbol: state.symbol,
        balance: state.balance.toString(),
        position: state.position.toString(),
        unrealizedPnL: state.unrealizedPnL.toString(),
        orders: Array.from(state.orders.values()).map((order) => ({
          ...order,
          qty: order.qty.toString(),
          price: order.price?.toString(),
          filledQty: order.filledQty?.toString(),
        })),
      },
    };
    ws.send(JSON.stringify(initMessage));
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

  function broadcast(type: string, data: unknown): void {
    const message: WebSocketMessage = { type, data };
    const json = JSON.stringify(message);

    clients.forEach((client) => {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(json);
      }
    });
  }

  function updateState(updates: Partial<DashboardState>): void {
    if (updates.symbol !== undefined) state.symbol = updates.symbol;
    if (updates.balance !== undefined) state.balance = updates.balance;
    if (updates.position !== undefined) state.position = updates.position;
    if (updates.unrealizedPnL !== undefined)
      state.unrealizedPnL = updates.unrealizedPnL;
    if (updates.orders !== undefined) state.orders = updates.orders;
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
    broadcast,
    updateState,
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
