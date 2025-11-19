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

HTTP адаптер доступен в пакете `@tradeforge/svc`:

```bash
pnpm --filter @tradeforge/svc dev
```

Сервис поднимает Fastify-сервер (по умолчанию порт `3000`) с эндпойнтами `/v1/accounts` и `/v1/orders` для работы с in-memory симулятором.

## CLI realtime run (`tf realtime`)

Команда `tf realtime` из пакета `@tradeforge/cli` подключает движок к live WebSocket биржи и использует исторические данные только как резерв.

```bash
pnpm --filter @tradeforge/cli exec -- \
  tf realtime \
  --exchange binance \
  --symbols BTCUSDT ETHUSDT \
  --api-key "$BINANCE_API_KEY" \
  --api-secret "$BINANCE_SECRET" \
  --listen-key "$BINANCE_LISTEN_KEY" \
  --heartbeat-timeout 5 \
  --checkpoint-save ./checkpoints/realtime.json
```

- `--symbols` принимает список инструментов для подписки; CLI проверяет лимиты подписок и комиссии из конфигурации.
- При обрыве соединения команда автоматически выполняет `reconnect` с экспоненциальной задержкой и применяет последний чекпоинт, если указаны `--checkpoint-save/--checkpoint-load`.
- Флаг `--on-disconnect restart` (значение по умолчанию) перезапускает run, как только WebSocket снова доступен; используйте `--on-disconnect exit`, чтобы остановить процесс и проанализировать логи вручную.
- Статус feed и лаг отображаются в CLI (`Feed lag: 120ms | reconnect attempts: 1`).

Для запуска live-симуляции требуется исходящий доступ к WebSocket хостам биржи и валидные API-ключи с правами «read-only» или «trade» (в зависимости от сценария). Убедитесь, что сетевой firewall пропускает TCP 443 и что системное время синхронизировано (NTP), иначе биржи могут отклонять соединения по подписи.

## CI

### Node/SCHEMA matrix

- Матрица GitHub Actions проверяет проект на Node.js `18.x` и `20.x` с базовой конфигурацией `SCHEMA=v1`.
- Конфигурация `SCHEMA=v2` запускается только для pull request'ов с меткой `schema:v2` и выполняется на Node.js `20.x`.
- На push-событиях `SCHEMA=v2` не запускается.
- Джоба `SCHEMA=v2` помечена как **неблокирующая** — падение допускается через `continue-on-error`, но помогает увидеть потенциальные проблемы заранее.
