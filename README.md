# TradeForge

Биржевая песочница для тренировки торговых ботов на основе исторических данных Binance.

## Development

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm --filter @tradeforge/cli dev
pnpm --filter @tradeforge/cli dev -- --version
```

## Mini fixtures & jq scripts (for CI)

- **Датасеты:** `datasets/mini-fixtures/{flat,trend,vol}` — используются в CI для быстрых, детерминированных прогонов.
- **Анализ логов:** см. `scripts/jq/*` (схема v1). Пример:
  ```bash
  jq -f scripts/jq/summary-v1.jq logs/v1/orders.ndjson
  ```

## REST service

HTTP адаптер доступен в пакете `@tradeforge/svc`:

```bash
pnpm --filter @tradeforge/svc dev
```

Сервис поднимает Fastify-сервер (по умолчанию порт `3000`) с эндпойнтами `/v1/accounts` и `/v1/orders` для работы с in-memory симулятором.
