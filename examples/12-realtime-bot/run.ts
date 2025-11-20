import { runBot } from '@tradeforge/sdk';
import type { Trade } from '@tradeforge/io-binance';
import {
  fromPriceInt,
  fromQtyInt,
  type PriceInt,
  type QtyInt,
} from '@tradeforge/core';

const SCALE = 5;

// Synthetic trade generator
async function* syntheticTrades(): AsyncIterable<Trade> {
  let price = 30000n * 100000n; // 30k with 1e5 scale
  let ts = Date.now();

  console.log('Starting synthetic trade stream...');

  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate delay

    ts += 100;
    // Random walk
    const delta = BigInt(Math.floor((Math.random() - 0.5) * 1000));
    price += delta;

    const trade: Trade = {
      ts,
      price,
      qty: 10000n, // 0.1
      side: Math.random() > 0.5 ? 'BUY' : 'SELL',
      id: BigInt(i),
      symbol: 'BTCUSDT',
    };

    yield trade;
  }
  console.log('Synthetic stream finished.');
}

console.log('Starting Realtime Bot...');

await runBot({
  symbol: 'BTCUSDT',
  trades: syntheticTrades(),
  onTrade: (trade, ctx) => {
    const priceStr = fromPriceInt(trade.price as PriceInt, SCALE);
    console.log(`[Realtime] Trade: ${priceStr} ${trade.side}`);

    // Simple logic
    if (trade.side === 'SELL') {
      ctx.placeOrder({
        type: 'LIMIT',
        side: 'BUY',
        qty: 10000n,
        price: trade.price - 500n,
      });
    }
  },
  onOrderFill: (fill) => {
    const priceStr = fromPriceInt(fill.price as PriceInt, SCALE);
    const qtyStr = fromQtyInt(fill.qty as QtyInt, SCALE);
    console.log(`[Realtime] Order filled! Price: ${priceStr}, Qty: ${qtyStr}`);
  },
});

console.log('Bot finished.');
