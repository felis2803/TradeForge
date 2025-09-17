# 01 — Базовый исторический прогон

Минимальный пример исторического прогона симулятора TradeForge. Сценарий использует готовые JSONL-файлы сделок и стакана, объединяет их в единую временную шкалу и воспроизводит события через CLI или SDK.

## Требования

- Установленные зависимости репозитория (`pnpm install`).
- Сборка рабочих пакетов (`pnpm -w build`).
- Наличие файлов с данными:
  - сделки — `*.jsonl`, `*.jsonl.gz` или `*.jsonl.zip`;
  - обновления стакана — `*.jsonl`, `*.jsonl.gz` или `*.jsonl.zip`.
- Для быстрого старта можно использовать мини-фикстуры из [`examples/_smoke`](../_smoke/).

## Вариант A — CLI

1. Указываем файлы через переменные окружения (можно перечислять несколько путём разделения запятой или переносом строки):

   ```bash
   export TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl"
   export TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl"
   ```

2. Запускаем симуляцию через CLI (логические часы, 200 событий, краткий summary):

   ```bash
   pnpm --filter @tradeforge/cli dev -- simulate \
     --trades "$TF_TRADES_FILES" \
     --depth "$TF_DEPTH_FILES" \
     --clock logical \
     --max-events 200 \
     --summary
   ```

### Accelerated / Wall примеры

Примеры альтернативных часов:

```bash
pnpm --filter @tradeforge/cli dev -- simulate \
  --trades "$TF_TRADES_FILES" --depth "$TF_DEPTH_FILES" \
  --clock accelerated --speed 20 --max-sim-ms 300000 --summary

pnpm --filter @tradeforge/cli dev -- simulate \
  --trades "$TF_TRADES_FILES" --depth "$TF_DEPTH_FILES" \
  --clock wall --max-wall-ms 10000 --summary
```

### NDJSON (опционально)

Для потоковой выгрузки отчёта в формате NDJSON можно включить соответствующий флаг и перенаправить вывод в файл:

```bash
pnpm --filter @tradeforge/cli dev -- simulate \
  --trades "$TF_TRADES_FILES" --depth "$TF_DEPTH_FILES" \
  --clock logical --max-events 200 --ndjson > /tmp/tf.reports.ndjson
```

## Вариант B — SDK (TypeScript)

1. Собираем примеры (создаст `dist-examples/**`):

   ```bash
   pnpm -w examples:build
   ```

2. Запускаем подготовленный скрипт. Файлы и параметры задаём через переменные окружения (в скобках — значения по умолчанию):

   ```bash
   TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl" \
   TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl" \
   TF_CLOCK=logical \
   TF_MAX_EVENTS=200 \
   node dist-examples/01-basic-replay/run.js
   ```

   Дополнительные параметры:
   - `TF_TIE_BREAK` — стратегия при совпадении временных меток (`DEPTH` | `TRADES`, по умолчанию `DEPTH`).
   - `TF_SPEED` — множитель ускорения для `TF_CLOCK=accelerated`.
   - `TF_MAX_SIM_MS` — лимит по симулируемому времени (миллисекунды).
   - `TF_MAX_WALL_MS` — лимит по реальному времени исполнения (миллисекунды).

   В stdout появится строка `BASIC_REPLAY_OK { ... }` с числом обработанных событий и длительностью прогона.

## Smoke-проверка

Для локальной проверки можно воспользоваться готовым скриптом:

```bash
pnpm -w examples:ex01:smoke
```

Он соберёт переменные окружения для мини-фикстур и проверит наличие маркера `BASIC_REPLAY_OK` в выводе SDK-скрипта.
