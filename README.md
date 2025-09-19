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

## CI

CI в GitHub Actions проверяет проект на Node.js 18.x и 20.x с конфигурацией `SCHEMA=v1`.
Дополнительно доступен необязательный прогон `SCHEMA=v2` (Node.js 20.x) для pull-request'ов с меткой `schema:v2`.
Его падение не блокирует мердж, но помогает заранее оценить совместимость.

## REST service

HTTP адаптер доступен в пакете `@tradeforge/svc`:

```bash
pnpm --filter @tradeforge/svc dev
```

Сервис поднимает Fastify-сервер (по умолчанию порт `3000`) с эндпойнтами `/v1/accounts` и `/v1/orders` для работы с in-memory симулятором.
