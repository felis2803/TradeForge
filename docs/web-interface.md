# TradeForge Web Interface

## Overview

- The TradeForge web interface wraps the sandbox backend so you can configure simulated exchange runs, start/pause/stop execution, plug in proprietary bots, and watch balances in real time.
- The current MVP supports a single local operator with one active run at a time. Balances are tracked per bot; positions, PnL attribution, and multi-user workflows are out of scope for this release.

## Prerequisites

- Node.js 20 or newer (check with `node -v`).
- The pnpm workspace tooling configured on your machine.
- Clone this repository and install dependencies once from the root:

  ```bash
  pnpm -w i
  ```

## Launching the services

> **Run start note**: Speed is configured during preflight via `POST /v1/runs` and applies only to history mode. The `POST /v1/runs/start` endpoint starts the run using the previously configured parameters and does not accept a `speed` body.

1. **Start the backend (Fastify service).**

   ```bash
   cd apps/svc
   pnpm dev
   ```

   - Listens on `http://localhost:3001` by default. Override `PORT`/`HOST` if you need different bindings.
   - Set `RUNS_DIR` to customize where run artifacts (configs, orders, trades, balances) are persisted. By default they land in `<repo>/runs/`.
   - If you serve the UI from a different origin, define `CORS_ORIGIN` (comma-separated allowlist such as `http://localhost:5173`). When unset the dev server automatically allows the default UI origin.

2. **Start the frontend (React/Vite UI).**

   ```bash
   cd apps/web
   pnpm dev
   ```

   - The Vite dev server runs on `http://localhost:5173`.
   - Configure API routing by adding a `.env` (or `.env.local`) file next to `apps/web` with:

     ```bash
     VITE_API_BASE=http://localhost:3001
     ```

     > **Fees and integer fields**:
     >
     > - Commissions are in **basis points** (integers): `makerBp: 1`, `takerBp: 5`.
     > - Monetary/quantity fields ending with `Int` are **strings** in minimal units (JSON-safe).

     Use this when the backend is exposed on a non-default URL, container, or tunnel.

## Using the web UI

1. Open `http://localhost:5173` in your browser.
2. The landing page is split into three panels:

   <!-- TODO: add UI screenshot -->

   ### Preflight configuration
   - Choose **Биржа** (exchange) and **Оператор данных** (data operator) to describe the sandbox source.
   - Select the run **Режим** (`Realtime` or `History`). Historical mode unlocks a date range picker and playback speed control.
     Speed is set during run configuration (`POST /v1/runs`) and applies only to history mode.
   - Manage instrument rows to define symbols and their maker/taker commission basis points. Add extra rows for multi-asset simulations.
   - Set operational limits such as **Максимум активных ордеров** and **Таймаут heartbeat (сек)**.
   - Toggle **Статус данных** when your historical dataset is ready to run.
   - Press **Применить** to POST the configuration to `/v1/runs`.

     ```bash
     curl -X POST http://localhost:3001/v1/runs \
       -H "Content-Type: application/json" \
       -d '{
         "id": "run-20240101",
         "mode": "history",
         "speed": "1x",
         "exchange": "Binance",
         "dataOperator": "Internal",
         "instruments": [
           {
             "symbol": "BTCUSDT",
             "fees": { "makerBp": 1, "takerBp": 1 }
           }
         ],
         "maxActiveOrders": 100,
         "heartbeatTimeoutSec": 10,
         "dataReady": true
       }'
     ```

   ### Run control
   - The status strip mirrors `GET /v1/runs/status` and updates every five seconds.
   - **Старт** triggers `POST /v1/runs/start` to resume execution with the previously configured parameters.
   - **Пауза** (`POST /v1/runs/pause`) and **Стоп** (`POST /v1/runs/stop`) gracefully snapshot the state so you can resume or replay later.

   ### Bots panel
   - Lists connected bots with their declared initial balance and the latest balance snapshot.
   - Balances stream via WebSocket `balance.update` messages; reconnecting bots keep their previous balances and history.

## Connecting bots

> **Identity & Auth (MVP)**: No tokens/auth. A bot identifies by `botName`. On disconnect, state persists; reconnect with the **same `botName`** resumes the session. Avoid name collisions if multiple people test simultaneously.
>
> **Envelope timestamp (`ts`)**: we include `ts` (epoch ms) in examples for tracing; the server may ignore it.

### Session lifecycle

Bots connect to `ws://localhost:3001/ws`. Use secure WebSocket (`wss://`) if you proxy through TLS. Immediately after the socket opens, send a `hello` envelope. Integer quantities, prices, and balances should be encoded as strings to preserve precision.

```json
{
  "type": "hello",
  "ts": 1700000000000,
  "payload": {
    "botName": "alpha-maker",
    "initialBalanceInt": "100000000"
  }
}
```

The service replies with `hello` describing configured symbols, fees, and run limits:

```json
{
  "type": "hello",
  "ts": 1700000000000,
  "payload": {
    "symbols": ["BTCUSDT"],
    "fees": {
      "BTCUSDT": { "maker": 1, "taker": 1 }
    },
    "limits": { "maxActiveOrders": 100 }
  }
}
```

### Heartbeat

> **Timestamp note**: Examples may include `ts` (epoch ms). Both with and without `ts` are accepted; `ts` is recommended for tracing.

Maintain liveness by sending heartbeats faster than the configured `heartbeatTimeoutSec`:

```json
{ "type": "heartbeat", "ts": 1700000000000, "payload": {} }
```

The server responds with its own `heartbeat` and logs a warning if bot heartbeats lapse.

### Orders

Place orders via WebSocket:

```json
{
  "type": "order.place",
  "ts": 1700000000000,
  "payload": {
    "clientOrderId": "c_170...",
    "symbol": "BTCUSDT",
    "side": "buy",
    "type": "MARKET|LIMIT|STOP_MARKET|STOP_LIMIT",
    "qtyInt": "1",
    "priceInt": "100",
    "stopPriceInt": "100",
    "limitPriceInt": "101",
    "timeInForce": "GTC",
    "flags": ["postOnly"]
  }
}
```

> **STOP trigger source**: STOP orders (stop-market/stop-limit) trigger on the **last trade** price (not best bid/ask).

Successful submissions generate:

- `order.ack` with the assigned `serverOrderId` and acceptance status.
- `order.update` when the order transitions to `open`, `filled`, or `canceled`.
- `order.fill` plus a `trade` record for executed volume, including computed taker/maker fees.

### Order cancel

```json
{
  "type": "order.cancel",
  "ts": 1700000000000,
  "payload": { "serverOrderId": "o_123" }
}
```

### Rejections (structured codes)

```json
{
  "type": "order.reject",
  "ts": 1700000000000,
  "payload": {
    "code": "VALIDATION",
    "message": "bad order payload",
    "clientOrderId": "c_170..."
  }
}
```

```json
{
  "type": "order.reject",
  "ts": 1700000000000,
  "payload": { "code": "RATE_LIMIT", "message": "too many active orders" }
}
```

A successful cancel returns `order.cancel` with the same `serverOrderId`; failures emit `order.reject` codes such as `NOT_FOUND`, `RATE_LIMIT`, or `VALIDATION`.

### Balance updates

Balance deltas arrive as `balance.update` messages. The backend preserves bot state, so reconnecting with the same `botName` restores balances and active orders.

### Depth streaming (L2)

- On subscribe/connect the server emits a full L2 **snapshot** for each configured symbol:

```json
{
  "type": "depth.snapshot",
  "ts": 1700000000000,
  "payload": {
    "symbol": "BTCUSDT",
    "bids": [["100000", "2"]],
    "asks": [["100100", "1"]]
  }
}
```

- Then it streams **diff updates** without aggregation:

```json
{
  "type": "depth.diff",
  "ts": 1700000000000,
  "payload": {
    "symbol": "BTCUSDT",
    "bids": [["100000", "0"]],
    "asks": [["100200", "3"]]
  }
}
```

`qtyInt == "0"` means remove the price level.

### WebSocket message summary

| Direction    | Message types                                                             | Purpose                                                    |
| ------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| bot → server | `hello`, `heartbeat`, `order.place`, `order.cancel`                       | Identify the bot, maintain the session, and manage orders. |
| server → bot | `hello`, `heartbeat`                                                      | Confirm run configuration and acknowledge liveness.        |
| server → bot | `order.ack`, `order.update`, `order.fill`, `order.cancel`, `order.reject` | Reflect order lifecycle events and errors.                 |
| server → bot | `balance.update`, `depth.snapshot`, `depth.diff`                          | Stream state changes for balances and L2 order books.      |

## Persistence and results

### Persistence

- Artifacts are stored under `runs/{runId}/` (configurable via `RUNS_DIR`).
- Writes are **atomic** (temp file then rename) to avoid truncated files on crashes.

### Artifact inventory

- `run.json` – configuration snapshot and lifecycle timestamps.
- `metadata.json` – exchange metadata and heartbeat settings.
- `orders.json` / `trades.json` – chronological order and fill history.
- `balances.json` – bot balances as of the last persistence cycle.
- Re-run historical simulations by reusing the saved configuration with `POST /v1/runs` and pointing bots at the stored dataset.

## Examples

- A minimal Node.js bot emulator lives at [`docs/snippets/bot.js`](snippets/bot.js):

  ```javascript
  // Minimal bot emulator reflecting protocol & codes
  const WS = require('ws');

  const url = process.env.WS_URL || 'ws://localhost:3001/ws';
  const ws = new WS(url);

  ws.on('open', () => {
    console.log('[bot] connected to', url);
    ws.send(
      JSON.stringify({
        type: 'hello',
        ts: Date.now(),
        payload: { botName: 'demo-bot', initialBalanceInt: '100000000' },
      }),
    );

    setInterval(() => {
      ws.send(
        JSON.stringify({ type: 'heartbeat', ts: Date.now(), payload: {} }),
      );
    }, 2000);

    setInterval(() => {
      ws.send(
        JSON.stringify({
          type: 'order.place',
          ts: Date.now(),
          payload: {
            clientOrderId: `c_${Date.now()}`,
            symbol: 'BTCUSDT',
            side: 'buy',
            type: 'MARKET',
            qtyInt: '1',
            priceInt: '100',
            timeInForce: 'GTC',
          },
        }),
      );
    }, 5000);
  });

  ws.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === 'order.reject') {
        console.log('REJECT', message.payload.code, message.payload.message);
      } else {
        console.log('<<', message.type, message.payload);
      }
    } catch (error) {
      console.error('[bot] failed to parse', error);
    }
  });

  ws.on('close', () => {
    console.log('[bot] disconnected');
  });

  ws.on('error', (error) => {
    console.error('[bot] error', error);
  });
  ```

  Run it from the repo root with:

  ```bash
  node docs/snippets/bot.js
  ```

  Expect console logs for the `hello` handshake, `order.ack`/`order.fill` events, and `balance.update` deltas. The web UI will display the `demo-bot` balance tick down with each simulated buy.

## Troubleshooting

- **CORS errors in the browser console** – ensure the backend `CORS_ORIGIN` includes the UI origin and that `VITE_API_BASE` points at the correct backend URL.
- **`RATE_LIMIT` rejections** – increase `maxActiveOrders` in the Preflight panel or wait for active orders to complete before submitting more.
- **`VALIDATION` rejections** – double-check payloads: integer fields (`*_Int`) must be stringified whole numbers, required identifiers must be present, and symbols must exist in the configured run.
- **No balances shown** – verify that bots send periodic heartbeats and that the backend log does not report heartbeat timeouts.
