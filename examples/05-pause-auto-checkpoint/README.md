# 05 — Пауза старта и автосохранение чекпоинтов

Пример демонстрирует управление симуляцией TradeForge: запуск с паузой, продолжение по команде и автосохранение чекпоинтов v1 как по количеству событий, так и по реальному времени. Используются мини-данные из каталога [`examples/_smoke`](../_smoke/).

> Числовые значения — строки (fixed-point).
> На Windows при `--pause-on-start` CLI включает raw-mode автоматически.

## Требования

- Установленные зависимости (`pnpm install`).
- Сборка рабочих пакетов (`pnpm -w build`).
- Сборка примеров (`pnpm -w examples:build`) — создаёт `dist-examples/**`.
- Для быстрого старта достаточно мини-файлов сделок и стакана из `examples/_smoke`.

## CLI — старт на паузе + автосейв чекпоинтов

1. Укажем файлы сделок и стакана (можно перечислять несколько путём разделения запятой или переносом строки):

   ```bash
   export TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl"
   export TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl"
   ```

2. Запустим симуляцию через CLI с паузой на старте и автосохранением чекпоинта в `/tmp/tf.cp.json`:

   ```bash
   pnpm --filter @tradeforge/cli dev -- simulate \
     --trades "$TF_TRADES_FILES" \
     --depth "$TF_DEPTH_FILES" \
     --clock logical \
     --max-events 100 \
     --pause-on-start \
     --checkpoint-save /tmp/tf.cp.json \
     --cp-interval-events 20 \
     --cp-interval-wall-ms 500
   ```

   Команда стартует симуляцию в режиме паузы (`--pause-on-start`). После появления подсказки нажмите Enter, чтобы продолжить исполнение. Флаги `--checkpoint-save`, `--cp-interval-events` и `--cp-interval-wall-ms` включают автосохранение чекпоинтов: файл обновляется каждые 20 событий и/или каждые 500 мс реального времени.

3. После завершения можно проверить содержимое чекпоинта:

   ```bash
   ls -lh /tmp/tf.cp.json
   cat /tmp/tf.cp.json | head
   ```

## SDK (TypeScript) — автоматическое возобновление и логирование

Сценарий [`run.ts`](./run.ts) показывает аналогичную логику на SDK: старт с паузой, программное `resume()` и автосейвы чекпоинтов на диск.

1. Убедитесь, что примеры собраны (`pnpm -w examples:build`).
2. Запустите подготовленный скрипт:

   ```bash
   node dist-examples/05-pause-auto-checkpoint/run.js
   ```

   Скрипт очистит предыдущий `/tmp/tf.cp.json`, сформирует таймлайн из мини-фикстур, запустит симуляцию с `pauseOnStart=true` и автоматически возобновит её через ~300 мс. На каждом автосохранении выводится краткое описание чекпоинта, а по завершении — маркер `PAUSE_CP_OK { cpExists: true }`.

## Smoke-проверка

Для быстрой проверки поведения можно воспользоваться скриптом `smoke.ts`:

```bash
node examples/05-pause-auto-checkpoint/smoke.ts
```

Смоук запускает собранный сценарий, проверяет наличие файла `/tmp/tf.cp.json` и убеждается, что в stdout присутствует маркер `PAUSE_CP_OK`.
