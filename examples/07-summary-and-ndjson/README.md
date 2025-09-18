# 07 — Сводка и экспорт NDJSON

Пример показывает два способа собрать агрегированную статистику по прогону:
через CLI (`--summary`) и через SDK-скрипт, который одновременно пишет поток
`ExecutionReport` в NDJSON для последующей аналитики.

Мини-фикстуры (десятки событий) лежат в [`examples/_smoke`](../_smoke/).

> Числовые поля в NDJSON — строки (fixed-point). Для примеров post-processing требуется установленный `jq`.

## Требования

- Установленные зависимости (`pnpm install`).
- Сборка пакетов (`pnpm -w build`).
- Сборка примеров перед запуском SDK (`pnpm -w examples:build`).

## Вариант A — CLI: summary и NDJSON

1. Подготовьте переменные окружения с путями к мини-фикстурам:

   ```bash
   export TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl"
   export TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl"
   ```

2. Запустите симуляцию с флагом `--summary`. CLI распечатает два JSON-объекта:
   метаданные прогона и агрегированную сводку (итоги по ордерам, балансам и
   комиссиям). Все `bigint` сериализуются в строки.

   ```bash
   pnpm --filter @tradeforge/cli dev -- simulate \
     --trades "$TF_TRADES_FILES" \
     --depth "$TF_DEPTH_FILES" \
     --clock logical \
     --max-events 32 \
     --summary
   ```

3. Для потоковой выгрузки отчётов воспользуйтесь флагом `--ndjson` и
   перенаправьте stdout в файл. Агрегированная сводка по ордерам продолжит
   печататься после завершения прогона.

   ```bash
   pnpm --filter @tradeforge/cli dev -- simulate \
     --trades "$TF_TRADES_FILES" \
     --depth "$TF_DEPTH_FILES" \
     --clock logical \
     --max-events 32 \
     --ndjson > /tmp/tf.reports.ndjson
   ```

### Post-processing NDJSON

После завершения CLI можно быстро проверить структуру потока.

- Подсчёт типов отчётов (`eventType`) через `jq`:

  ```bash
  jq -r '.["eventType"]' /tmp/tf.reports.ndjson | sort | uniq -c
  ```

- Подсчёт числа сделок (fill) через `awk`:

  ```bash
  awk -F'"' '/"eventType":"FILL"/ { fills += 1 } END { print "fills=" fills }' \
    /tmp/tf.reports.ndjson
  ```

## Вариант B — SDK (TypeScript)

1. Соберите примеры, чтобы получить `dist-examples/**`:

   ```bash
   pnpm -w examples:build
   ```

2. Запустите скрипт. Он формирует merged timeline на мини-фикстурах, запускает
   симуляцию с логическими часами и пишет поток `ExecutionReport` в
   `/tmp/tf.reports.ndjson` по мере поступления событий. После завершения
   скрипт печатает агрегированную сводку и строку `SUMMARY_NDJSON_OK` с числом
   записей и длительностью прогона.

   ```bash
   node dist-examples/07-summary-and-ndjson/run.js
   ```

3. Для проверки NDJSON можно воспользоваться smoke-скриптом:

   ```bash
   node examples/07-summary-and-ndjson/smoke.ts
   ```

   Он запускает собранный SDK-пример, убеждается в наличии `/tmp/tf.reports.ndjson`
   и проверяет, что в файле есть хотя бы одна строка.
