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

## Reusable CI workflow

Проект использует переиспользуемый workflow `.github/workflows/ci-reusable.yml`. Вы можете настраивать матрицу через inputs в `.github/workflows/ci.yml`:

```yaml
jobs:
  main:
    uses: ./.github/workflows/ci-reusable.yml
    with:
      node_versions: '["18.x","20.x"]'
      schemas: '["v1","v2"]'
      allow_v2_failure: true
      working_directory: '.'
```

> Проект использует **Corepack**: версия pnpm берётся из `package.json` (`packageManager`).
> Локально выполните `corepack enable`, чтобы гарантировать ту же версию, что и в CI.

## Mini fixtures & jq scripts (for CI)

- **Датасеты:** `datasets/mini-fixtures/{flat,trend,vol}` — используются в CI для быстрых, детерминированных прогонов.
- **Анализ логов:** см. `scripts/jq/*` (схема v1). Пример:
  ```bash
  jq -f scripts/jq/summary-v1.jq logs/v1/orders.ndjson
  ```

## REST service

## CI

### Node/SCHEMA matrix

- Матрица GitHub Actions проверяет проект на Node.js `18.x` и `20.x` с базовой конфигурацией `SCHEMA=v1`.
- Конфигурация `SCHEMA=v2` запускается только для pull request'ов с меткой `schema:v2` и выполняется на Node.js `20.x`.
- На push-событиях `SCHEMA=v2` не запускается.
- Джоба `SCHEMA=v2` помечена как **неблокирующая** — падение допускается через `continue-on-error`, но помогает увидеть потенциальные проблемы заранее.

HTTP адаптер доступен в пакете `@tradeforge/svc`:

```bash
pnpm --filter @tradeforge/svc dev
```

Сервис поднимает Fastify-сервер (по умолчанию порт `3000`) с эндпойнтами `/v1/accounts` и `/v1/orders` для работы с in-memory симулятором.
