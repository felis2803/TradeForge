import {
  createTradeStream,
  createDepthStream,
  syncBinanceDataset,
} from '@tradeforge/loader-binance';
import type { SymbolId } from '@tradeforge/core';

const SYMBOL = 'BTCUSDT' as SymbolId;
const DATE = '2021-05-01';

async function main(): Promise<void> {
  await syncBinanceDataset({ symbol: SYMBOL, date: DATE });

  const tradeStream = createTradeStream({ symbol: SYMBOL, date: DATE });
  const depthStream = createDepthStream({ symbol: SYMBOL, date: DATE });

  let tradesShown = 0;
  console.log('First trades:');
  for await (const trade of tradeStream) {
    console.log(trade);
    if (++tradesShown >= 5) break;
  }

  let depthShown = 0;
  console.log('First depth diffs:');
  for await (const diff of depthStream) {
    console.log(diff);
    if (++depthShown >= 5) break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
