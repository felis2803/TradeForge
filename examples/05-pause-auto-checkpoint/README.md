# 05 — Пауза старта и автосейв чекпоинтов

Пример демонстрирует управление симуляцией: стартуем прогон на паузе, вручную продолжаем выполнение и наблюдаем автоматическое сохранение чекпоинтов по событиям и по таймеру. Скрипт и CLI используют мини-фикстуры из `examples/_smoke`, логические часы и периодически сохраняют `checkpoint.v1`.

## Требования

- Установленные зависимости (`pnpm install`).
- Сборка рабочих пакетов (`pnpm -w build`).
- Наличие исторических данных по сделкам и стакану (для быстрого старта подойдут файлы из [`examples/_smoke`](../_smoke/)).

## Вариант A — CLI

1. Указываем данные через переменные окружения (можно перечислять несколько путём разделения запятыми или переносами строки):

   ```bash
   export TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl"
   export TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl"
   ```

2. Запускаем симуляцию с паузой старта и автосохранением чекпоинтов:

   ```bash
   pnpm --filter @tradeforge/cli dev -- simulate \
     --trades "$TF_TRADES_FILES" \
     --depth "$TF_DEPTH_FILES" \
     --clock logical \
     --max-events 120 \
     --pause-on-start \
     --checkpoint-save /tmp/tf.cp.json \
     --cp-interval-events 20 \
     --cp-interval-wall-ms 500 \
     --summary
   ```

   Что произойдёт:
   - CLI стартует сценарий, сразу поставит контроллер на паузу и покажет приглашение `Press Enter to resume…`.
   - После нажатия Enter симуляция продолжится, а каждые 20 событий либо каждые 500 мс будет записываться `checkpoint.v1` по указанному пути (`/tmp/tf.cp.json`).
   - В логах появятся сообщения `checkpoint saved -> …` и сжатый summary по окончании выполнения.

   Параметры можно адаптировать: например, поменять путь сохранения (`--checkpoint-save`), увеличить частоту автосейвов (`--cp-interval-events`, `--cp-interval-wall-ms`) или задать другой лимит событий (`--max-events`).

## Вариант B — SDK (TypeScript)

1. Собираем папку `dist-examples/**`:

   ```bash
   pnpm -w examples:build
   ```

2. Запускаем скрипт `run.ts`, который автоматически ставит симуляцию на паузу, затем возобновляет и сохраняет чекпоинты:

   ```bash
   TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl" \
   TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl" \
   TF_CP_PATH=/tmp/tf.cp.json \
   TF_MAX_EVENTS=100 \
   TF_CP_INTERVAL_EVENTS=20 \
   TF_CP_INTERVAL_WALL_MS=500 \
   node dist-examples/05-pause-auto-checkpoint/run.js
   ```

   Дополнительные переменные окружения:
   - `TF_RESUME_DELAY_MS` — задержка перед автоматическим `resume()` (по умолчанию 600 мс).
   - `TF_TIE_BREAK` — выбор источника при совпадении меток (`DEPTH` или `TRADES`).

   После завершения в stdout появится строка `PAUSE_CP_OK { cpExists: true, … }`. Это подтверждает, что файл чекпоинта создан, а скрипт успешно снял паузу и прошёл лимит событий.

## Smoke-проверка

Для быстрой проверки сценария предусмотрен мини-тест:

```bash
node examples/05-pause-auto-checkpoint/smoke.ts
```

Скрипт выполнит собранный пример, убедится в наличии чекпоинта и проверит маркер `PAUSE_CP_OK` в stdout.
