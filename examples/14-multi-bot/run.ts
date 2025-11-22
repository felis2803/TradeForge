/**
 * Multi-Bot Trading Dashboard Example
 *
 * This example demonstrates how to run multiple trading bots simultaneously
 * with a shared dashboard to monitor all bots in real-time.
 *
 * Features 3 bots with different strategies:
 * 1. Mean Reversion Bot (BTCUSDT) - Buys when price drops, sells when it rises
 * 2. Momentum Bot (ETHUSDT) - Follows the trend
 * 3. Market Maker Bot (SOLUSDT) - Places orders on both sides
 */

import { runBot, createDashboardServer } from '@tradeforge/sdk';
import { createLiveTradeStream } from '@tradeforge/feed-binance';
import type { SymbolId } from '@tradeforge/core';
import type { BotContext } from '@tradeforge/sdk';

// Helper formatting functions
function formatPrice(price: bigint): string {
  // Price scale 5, display 2 decimal places
  const divisor = 100000n; // 1e5
  const val = price / divisor;
  const integer = val / 100n;
  const fraction = val % 100n;
  return `${integer}.${fraction.toString().padStart(2, '0')}`;
}

function formatBase(amount: bigint): string {
  // Base is scale 5, display 5 decimal places
  const divisor = 100000n; // 1e5
  const val = amount / divisor;
  const integer = val / 100000n;
  const fraction = val % 100000n;
  const absFraction = fraction < 0n ? -fraction : fraction;
  const sign = amount < 0n ? '-' : '';
  return `${sign}${integer}.${absFraction.toString().padStart(5, '0')}`;
}

function formatQuote(amount: bigint): string {
  // Quote is scale 10 (5 + 5), display 2 decimal places
  const divisor = 100000000n; // 1e8
  const val = amount / divisor;
  const integer = val / 100n;
  const fraction = val % 100n;
  const absFraction = fraction < 0n ? -fraction : fraction;
  return `${integer}.${absFraction.toString().padStart(2, '0')}`;
}

// Shared dashboard server for all bots
const dashboard = createDashboardServer({
  enabled: true,
  port: 3000,
  autoOpenBrowser: true,
});

console.log('\n🚀 Starting Multi-Bot Trading System...\n');

// =============================================================================
// BOT 1: Mean Reversion Strategy (BTCUSDT)
// =============================================================================
// This bot tries to profit from price oscillations around a moving average
// Buy when price drops below average, sell when it rises above

let btcPriceHistory: bigint[] = [];
const BTC_MA_PERIOD = 20;

const meanReversionBot = runBot({
  symbol: 'BTCUSDT' as SymbolId,
  trades: createLiveTradeStream({ symbol: 'BTCUSDT' as SymbolId }),
  initialQuoteBalance: 100000_00000000n, // $100,000

  dashboard: {
    server: dashboard,
    botId: 'bot-btc-mean-reversion',
    botName: 'BTC Mean Reversion',
    strategy: 'Mean Reversion',
  },

  liquidationMarginRatio: 0.001, // 0.1% - allow small orders

  onTrade: (trade, ctx: BotContext) => {
    // Update price history
    btcPriceHistory.push(trade.price);
    if (btcPriceHistory.length > BTC_MA_PERIOD) {
      btcPriceHistory.shift();
    }

    // Calculate moving average
    if (btcPriceHistory.length < BTC_MA_PERIOD) return;

    const sum = btcPriceHistory.reduce((a, b) => a + b, 0n);
    const ma = sum / BigInt(BTC_MA_PERIOD);

    const currentPrice = trade.price;
    const deviation = currentPrice - ma;
    const deviationPercent = Number((deviation * 10000n) / ma) / 100;

    // Mean reversion logic
    if (ctx.position === 0n) {
      // No position: enter when price deviates significantly
      if (deviationPercent < -0.5) {
        // Price is 0.5% below MA - BUY signal
        const buyAmount = 100000n; // 0.001 BTC
        console.log(
          `[BTC Mean Reversion] 📈 BUY signal: Price ${deviationPercent.toFixed(2)}% below MA`,
        );
        ctx.placeOrder({
          type: 'MARKET',
          side: 'BUY',
          qty: buyAmount,
        });
      } else if (deviationPercent > 0.5) {
        // Price is 0.5% above MA - SELL signal
        const sellAmount = 100000n; // 0.001 BTC
        console.log(
          `[BTC Mean Reversion] 📉 SELL signal: Price ${deviationPercent.toFixed(2)}% above MA`,
        );
        ctx.placeOrder({
          type: 'MARKET',
          side: 'SELL',
          qty: sellAmount,
        });
      }
    } else {
      // Has position: close when price reverts to mean
      if (ctx.position > 0n && currentPrice >= ma) {
        console.log(
          `[BTC Mean Reversion] ✅ Closing LONG: Price reverted to MA`,
        );
        ctx.placeOrder({
          type: 'MARKET',
          side: 'SELL',
          qty: ctx.position,
        });
      } else if (ctx.position < 0n && currentPrice <= ma) {
        console.log(
          `[BTC Mean Reversion] ✅ Closing SHORT: Price reverted to MA`,
        );
        ctx.placeOrder({
          type: 'MARKET',
          side: 'BUY',
          qty: -ctx.position,
        });
      }
    }
  },

  onOrderFill: (fill, ctx) => {
    console.log(
      `[BTC Mean Reversion] 📊 Fill: ${fill.side} ${formatBase(fill.qty)} BTC @ $${formatPrice(fill.price)} | ` +
        `Balance: $${formatQuote(ctx.balance)} | Position: ${formatBase(ctx.position)} BTC | ` +
        `P/L: $${formatQuote(ctx.unrealizedPnL)}`,
    );
  },
});

// =============================================================================
// BOT 2: Momentum Strategy (ETHUSDT)
// =============================================================================
// This bot follows the trend - buys when price is rising, sells when falling

let ethPrevPrice: bigint | null = null;
let ethTrendUpCount = 0;
let ethTrendDownCount = 0;
const ETH_TREND_THRESHOLD = 3;

const momentumBot = runBot({
  symbol: 'ETHUSDT' as SymbolId,
  trades: createLiveTradeStream({ symbol: 'ETHUSDT' as SymbolId }),
  initialQuoteBalance: 100000_00000000n, // $100,000

  dashboard: {
    server: dashboard,
    botId: 'bot-eth-momentum',
    botName: 'ETH Momentum',
    strategy: 'Momentum Following',
  },

  liquidationMarginRatio: 0.001, // 0.1% - allow small orders

  onTrade: (trade, ctx: BotContext) => {
    if (!ethPrevPrice) {
      ethPrevPrice = trade.price;
      return;
    }

    // Track trend direction
    if (trade.price > ethPrevPrice) {
      ethTrendUpCount++;
      ethTrendDownCount = 0;
    } else if (trade.price < ethPrevPrice) {
      ethTrendDownCount++;
      ethTrendUpCount = 0;
    }

    ethPrevPrice = trade.price;

    // Momentum trading logic
    if (ctx.position === 0n) {
      // Enter on strong uptrend
      if (ethTrendUpCount >= ETH_TREND_THRESHOLD) {
        const buyAmount = 10000000n; // 0.1 ETH
        console.log(
          `[ETH Momentum] 🚀 Uptrend detected (${ethTrendUpCount} consecutive rises) - BUYING`,
        );
        ctx.placeOrder({
          type: 'MARKET',
          side: 'BUY',
          qty: buyAmount,
        });
        ethTrendUpCount = 0;
      }
      // Enter on strong downtrend
      else if (ethTrendDownCount >= ETH_TREND_THRESHOLD) {
        const sellAmount = 10000000n; // 0.1 ETH
        console.log(
          `[ETH Momentum] 📉 Downtrend detected (${ethTrendDownCount} consecutive drops) - SELLING`,
        );
        ctx.placeOrder({
          type: 'MARKET',
          side: 'SELL',
          qty: sellAmount,
        });
        ethTrendDownCount = 0;
      }
    } else {
      // Exit on trend reversal
      if (ctx.position > 0n && ethTrendDownCount >= 2) {
        console.log(`[ETH Momentum] 🔄 Trend reversal - Closing LONG`);
        ctx.placeOrder({
          type: 'MARKET',
          side: 'SELL',
          qty: ctx.position,
        });
      } else if (ctx.position < 0n && ethTrendUpCount >= 2) {
        console.log(`[ETH Momentum] 🔄 Trend reversal - Closing SHORT`);
        ctx.placeOrder({
          type: 'MARKET',
          side: 'BUY',
          qty: -ctx.position,
        });
      }
    }
  },

  onOrderFill: (fill, ctx) => {
    console.log(
      `[ETH Momentum] 📊 Fill: ${fill.side} ${formatBase(fill.qty)} ETH @ $${formatPrice(fill.price)} | ` +
        `Balance: $${formatQuote(ctx.balance)} | Position: ${formatBase(ctx.position)} ETH | ` +
        `P/L: $${formatQuote(ctx.unrealizedPnL)}`,
    );
  },
});

// =============================================================================
// BOT 3: Market Maker Strategy (SOLUSDT)
// =============================================================================
// This bot places limit orders on both sides of the market to capture spread

let solActiveBuyOrder: string | null = null;
let solActiveSellOrder: string | null = null;

const marketMakerBot = runBot({
  symbol: 'SOLUSDT' as SymbolId,
  trades: createLiveTradeStream({ symbol: 'SOLUSDT' as SymbolId }),
  initialQuoteBalance: 100000_00000000n, // $100,000

  dashboard: {
    server: dashboard,
    botId: 'bot-sol-market-maker',
    botName: 'SOL Market Maker',
    strategy: 'Market Making',
  },

  liquidationMarginRatio: 0.001, // 0.1% - allow small orders

  onTrade: (trade, ctx: BotContext) => {
    // Only maintain orders when we have no position
    if (ctx.position !== 0n) {
      // Close position at market
      console.log(`[SOL Market Maker] ⚖️ Closing position`);
      ctx.placeOrder({
        type: 'MARKET',
        side: ctx.position > 0n ? 'SELL' : 'BUY',
        qty: ctx.position > 0n ? ctx.position : -ctx.position,
      });
      return;
    }

    // Place limit orders on both sides
    const spread = trade.price / 200n; // 0.5% spread
    const orderSize = 1000000n; // 0.01 SOL

    // Cancel old orders if they exist
    if (solActiveBuyOrder) {
      ctx.cancelOrder(solActiveBuyOrder);
      solActiveBuyOrder = null;
    }
    if (solActiveSellOrder) {
      ctx.cancelOrder(solActiveSellOrder);
      solActiveSellOrder = null;
    }

    // Place new buy order below market
    const buyPrice = trade.price - spread;
    console.log(
      `[SOL Market Maker] 📋 Placing BUY limit @ $${formatPrice(buyPrice)}`,
    );
    solActiveBuyOrder = ctx.placeOrder({
      type: 'LIMIT',
      side: 'BUY',
      qty: orderSize,
      price: buyPrice,
    });

    // Place new sell order above market
    const sellPrice = trade.price + spread;
    console.log(
      `[SOL Market Maker] 📋 Placing SELL limit @ $${formatPrice(sellPrice)}`,
    );
    solActiveSellOrder = ctx.placeOrder({
      type: 'LIMIT',
      side: 'SELL',
      qty: orderSize,
      price: sellPrice,
    });
  },

  onOrderFill: (fill, ctx) => {
    console.log(
      `[SOL Market Maker] 💰 Fill: ${fill.side} ${formatBase(fill.qty)} SOL @ $${formatPrice(fill.price)} | ` +
        `Balance: $${formatQuote(ctx.balance)} | Position: ${formatBase(ctx.position)} SOL | ` +
        `P/L: $${formatQuote(ctx.unrealizedPnL)}`,
    );

    // Clear active order IDs on fill
    if (fill.side === 'BUY') solActiveBuyOrder = null;
    if (fill.side === 'SELL') solActiveSellOrder = null;
  },

  onOrderUpdate: (order) => {
    if (order.status === 'CANCELED') {
      // Clear canceled order IDs
      if (order.id === solActiveBuyOrder) solActiveBuyOrder = null;
      if (order.id === solActiveSellOrder) solActiveSellOrder = null;
    }
  },
});

// =============================================================================
// Run all bots concurrently
// =============================================================================

console.log('\n📊 All bots started! Opening dashboard...\n');

try {
  await Promise.allSettled([meanReversionBot, momentumBot, marketMakerBot]);
} catch (error) {
  console.error('Error running bots:', error);
} finally {
  console.log('\n🔚 All bots finished. Closing dashboard...\n');
  await dashboard.close();
}
