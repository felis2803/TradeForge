#!/usr/bin/env node
import WebSocket from 'ws';

const BOT_NAME = process.argv[2] ?? 'sample-bot';
const INITIAL_BALANCE = Number(process.argv[3] ?? 1_000_000);
const WS_URL = process.argv[4] ?? 'ws://localhost:3001/ws';

const socket = new WebSocket(WS_URL);

socket.on('open', () => {
  console.log(`[bot] connected -> ${WS_URL}`);
  send('hello', { botName: BOT_NAME, initialBalanceInt: INITIAL_BALANCE });
  const heartbeat = setInterval(() => {
    send('heartbeat', { ts: Date.now() });
  }, 3000);
  socket.on('close', () => clearInterval(heartbeat));

  setTimeout(() => {
    console.log('[bot] placing market order');
    send('order.place', {
      clientOrderId: `demo-${Date.now()}`,
      symbol: 'BTCUSDT',
      side: 'buy',
      type: 'MARKET',
      qtyInt: 1,
      timeInForce: 'GTC',
      flags: [],
    });
  }, 2000);
});

socket.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    console.log('[bot] message', msg.type, msg.payload);
  } catch (error) {
    console.error('[bot] failed to parse', error);
  }
});

socket.on('close', () => {
  console.log('[bot] connection closed');
});

socket.on('error', (error) => {
  console.error('[bot] error', error);
});

function send(type, payload) {
  socket.send(JSON.stringify({ type, ts: Date.now(), payload }));
}
