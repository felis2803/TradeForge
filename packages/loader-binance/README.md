# @tradeforge/loader-binance

Загрузчик архивов Binance Data Portal с локальным кэшем.

## Возможности

- CLI-команда `pnpm loader:binance sync`.
- Кэширование в `datasets/binance/<symbol>/<date>/`.
- Потоки сделок и диффов глубины через `createTradeStream` и `createDepthStream`.

## Использование

```bash
pnpm loader:binance sync --symbol BTCUSDT --date 2021-05-01
```

```ts
import {
  createTradeStream,
  createDepthStream,
  syncBinanceDataset,
} from '@tradeforge/loader-binance';

await syncBinanceDataset({ symbol: 'BTCUSDT', date: '2021-05-01' });

const trades = createTradeStream({ symbol: 'BTCUSDT', date: '2021-05-01' });
const depth = createDepthStream({ symbol: 'BTCUSDT', date: '2021-05-01' });
```

## Тесты

```bash
pnpm --filter @tradeforge/loader-binance run test
```
