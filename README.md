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

### Node/SCHEMA matrix

- Матрица GitHub Actions проверяет проект на Node.js `18.x` и `20.x` с базовой конфигурацией `SCHEMA=v1`.
- Конфигурация `SCHEMA=v2` запускается только для pull request'ов с меткой `schema:v2` и выполняется на Node.js `20.x`.
- На push-событиях `SCHEMA=v2` не запускается.
- Джоба `SCHEMA=v2` помечена как **неблокирующая** — падение допускается через `continue-on-error`, но помогает увидеть потенциальные проблемы заранее.

## REST service

HTTP адаптер доступен в пакете `@tradeforge/svc`:

```bash
pnpm --filter @tradeforge/svc dev
```

Сервис поднимает Fastify-сервер (по умолчанию порт `3000`) с эндпойнтами `/v1/accounts` и `/v1/orders` для работы с in-memory симулятором.
