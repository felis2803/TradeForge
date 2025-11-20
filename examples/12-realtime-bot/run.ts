import { runBot } from '@tradeforge/sdk';
import {
  fromPriceInt,
  fromQtyInt,
  type PriceInt,
  type QtyInt,
  type SymbolId,
} from '@tradeforge/core';

// Realtime streams
import {
  createLiveTradeStream,
  createLiveDepthStream,
} from '@tradeforge/feed-binance';

const SCALE = 5;

console.log('Starting Realtime Bot...');

const SYMBOL = 'BTCUSDT' as SymbolId;
const QUOTE_SCALE = 10000000000n; // 1e10
const INITIAL_BALANCE = 10000000n * QUOTE_SCALE; // 10,000,000 USDT

function formatQuote(amount: bigint): string {
  // Quote is scale 5 + 5 = 10
  // We want to show 2 decimal places
  const divisor = 100000000n; // 1e8
  const val = amount / divisor;
  const integer = val / 100n;
  const fraction = val % 100n;
  const absFraction = fraction < 0n ? -fraction : fraction;
  return `${integer}.${absFraction.toString().padStart(2, '0')}`;
}

await runBot({
  symbol: SYMBOL,
  initialQuoteBalance: INITIAL_BALANCE,
  trades: createLiveTradeStream({ symbol: SYMBOL }),
  depth: createLiveDepthStream({ symbol: SYMBOL }),
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
  onOrderFill: (fill, ctx) => {
    const priceStr = fromPriceInt(fill.price as PriceInt, SCALE);
    const qtyStr = fromQtyInt(fill.qty as QtyInt, SCALE);

    const posStr = fromQtyInt(ctx.position as QtyInt, SCALE);
    const balStr = formatQuote(ctx.balance);
    const pnlStr = formatQuote(ctx.unrealizedPnL);

    console.log(
      `[Realtime] Order filled! Price: ${priceStr} USDT, Qty: ${qtyStr} BTC, Pos: ${posStr} BTC, Bal: ${balStr} USDT, P/L: ${pnlStr} USDT`,
    );
  },
});

console.log('Bot finished.');
