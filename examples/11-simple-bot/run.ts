import { runBot } from '@tradeforge/sdk';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TRADES_FILE = resolve(__dirname, '../_smoke/mini-trades.jsonl');

console.log('Starting Simple Bot...');

await runBot({
  symbol: 'BTCUSDT',
  trades: TRADES_FILE,
  onTrade: (trade, ctx) => {
    // Simple logic: buy if price < 30000 (assuming scale)
    // For demonstration, we place an order if price is below a threshold.
    // Based on mini-trades.jsonl, prices are around 27000.
    // If scale is 5 (based on previous logs 2700010000), then 30000 * 10^5 = 3000000000
    if (trade.price < 3000000000n) {
      console.log(`Price is low (${trade.price}), buying!`);
      ctx.placeOrder({
        type: 'LIMIT',
        side: 'BUY',
        qty: 100000n,
        price: trade.price - 100n,
      });
    }
  },
  onOrderFill: (fill) => {
    console.log('Order filled!', fill);
  },
});

console.log('Bot finished.');
