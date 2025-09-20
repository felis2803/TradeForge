# @tradeforge/schemas

Набор JSON-схем и TypeScript-типов для основных артефактов TradeForge. Версия `v1` покрывает трейды, L2-дифф стакана, чекпоинты движка, NDJSON-логи исполнения и поток метрик.

## Установка

```bash
pnpm add @tradeforge/schemas
```

## Использование

```ts
import { tradesV1 } from '@tradeforge/schemas';

// например, можно скомпилировать схему в AJV
import Ajv from 'ajv';

const ajv = new Ajv({ allowUnionTypes: true });
const validate = ajv.compile(tradesV1);
```

Также пакет экспортирует интерфейсы `TradeV1`, `DepthL2DiffV1`, `CheckpointV1`, `LogEntryV1` и `MetricV1` для статической типизации.
