# 07 — Summary & NDJSON

Пример демонстрирует два канала аналитики симулятора TradeForge: финальный агрегированный summary и поток `ExecutionReport` в
формате NDJSON, пригодный для дальнейшей обработки (`jq`, `awk`, Logstash и т.п.).

## Требования

- Зависимости репозитория (`pnpm install`).
- Сборка пакетов рабочего пространства (`pnpm -w build`).
- Готовые данные сделок и стакана. Для примеров ниже используются мини-фикстуры из [`examples/_smoke`](../_smoke/).

## Вариант A — CLI

### Summary (`--summary`)

```bash
pnpm --filter @tradeforge/cli exec -- \
  tf simulate \
  --trades examples/_smoke/mini-trades.jsonl \
  --depth examples/_smoke/mini-depth.jsonl \
  --clock logical \
  --max-events 200 \
  --summary
```

В stdout появятся два JSON-объекта: краткий отчёт по прогону (количество событий, длительность, параметры часов) и агрегированное
summary (итоги по ордерам, балансы счетов, конфигурация симуляции). Все числовые значения `bigint` сериализованы строками.

### NDJSON (`--ndjson`)

Для записи потока `ExecutionReport` перенаправьте NDJSON-вывод в файл:

```bash
pnpm --filter @tradeforge/cli exec -- \
  tf simulate \
  --trades examples/_smoke/mini-trades.jsonl \
  --depth examples/_smoke/mini-depth.jsonl \
  --clock logical \
  --max-events 200 \
  --ndjson > /tmp/tf.reports.ndjson
```

CLI продолжит печатать финальный summary, поэтому вы можете одновременно анализировать агрегированную статистику и поток событий.

#### Пост-обработка NDJSON

- Подсчёт количества отчётов каждого типа:

  ```bash
  jq -r '.kind' /tmp/tf.reports.ndjson | sort | uniq -c
  ```

- Суммарный объём исполнений (`fill.qty`) по ордеру:

  ```bash
  jq -r 'select(.kind == "FILL") | [.orderId, .fill.qty] | @tsv' /tmp/tf.reports.ndjson \
    | awk '{ qty[$1] += $2 } END { for (id in qty) printf("%s\t%s\n", id, qty[id]); }'
  ```

## Вариант B — SDK (TypeScript)

1. Соберите примеры (создаст `dist-examples/**`):

   ```bash
   pnpm -w examples:build
   ```

2. Запустите сценарий, чтобы сформировать summary и NDJSON. Параметры можно переопределять через переменные окружения
   (`TF_TRADES_FILES`, `TF_DEPTH_FILES`, `TF_MAX_EVENTS`):

   ```bash
   TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl" \
   TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl" \
   TF_MAX_EVENTS=200 \
   node dist-examples/07-summary-and-ndjson/run.js
   ```

   Скрипт выведет блок `SUMMARY_JSON` с агрегированной статистикой и создаст `/tmp/tf.reports.ndjson`. Завершается маркером
   `SUMMARY_NDJSON_OK { rows, eventsOut, wallMs, simMs }`.

## Smoke-проверка

```bash
node examples/07-summary-and-ndjson/smoke.ts
```

Скрипт убедится, что `/tmp/tf.reports.ndjson` существует и содержит как минимум одну непустую строку.
