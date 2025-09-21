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
    ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now(), payload: {} }));
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
