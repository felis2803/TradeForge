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

## REST service

HTTP адаптер доступен в пакете `@tradeforge/svc`:

```bash
pnpm --filter @tradeforge/svc dev
```

Сервис поднимает Fastify-сервер (по умолчанию порт `3000`) с эндпойнтами `/v1/accounts` и `/v1/orders` для работы с in-memory симулятором.
