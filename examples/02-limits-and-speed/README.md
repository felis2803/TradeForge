# 02 — Лимиты длительности и скорость часов

Продолжаем работать с историческим прогоном, но теперь управляем длительностью
и скоростью симуляции. Пример показывает, как ограничить работу движка по
количеству событий, симулируемому времени и реальному wall-времени, а также как
использовать ускоренные часы.

## Требования

- Установленные зависимости репозитория (`pnpm install`).
- Сборка рабочих пакетов (`pnpm -w build`).
- Мини-файлы с данными из [`examples/_smoke`](../_smoke/).

## Вариант A — CLI

1. Подготовим пути к данным (можно перечислять несколько файлов через запятую):

   ```bash
   export TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl"
   export TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl"
   ```

2. Запускаем разные варианты симуляции через CLI:

   **Логические часы + ограничение по событиям**

   ```bash
   pnpm --filter @tradeforge/cli dev -- simulate \
     --trades "$TF_TRADES_FILES" \
     --depth "$TF_DEPTH_FILES" \
     --clock logical \
     --max-events 10 \
     --summary
   ```

   **Ускоренные часы (speed=20) + лимит по сим-времени**

   ```bash
   pnpm --filter @tradeforge/cli dev -- simulate \
     --trades "$TF_TRADES_FILES" \
     --depth "$TF_DEPTH_FILES" \
     --clock accelerated \
     --speed 20 \
     --max-sim-ms 2000 \
     --summary
   ```

   **Wall-часы + ограничение по реальному времени исполнения**

   ```bash
   pnpm --filter @tradeforge/cli dev -- simulate \
     --trades "$TF_TRADES_FILES" \
     --depth "$TF_DEPTH_FILES" \
     --clock wall \
     --max-wall-ms 1200 \
     --summary
   ```

> Сим-время (simulation time) — это диапазон временных меток событий в данных,
> например `1700000000000…1700000002000` для первых двух сделок. Wall-время
> измеряется по реальному `Date.now()`. Логические часы обрабатывают события без
> задержек, ускоренные — масштабируют wall-время (speed ×), а wall-часы
> синхронизируются с реальным временем один к одному.

## Вариант B — SDK (TypeScript)

1. Собираем примеры (создаст `dist-examples/**`):

   ```bash
   pnpm -w examples:build
   ```

2. Запускаем подготовленный скрипт:

   ```bash
   node dist-examples/02-limits-and-speed/run.js
   ```

   В stdout появятся три блока `LIMITS_SPEED_RESULT { ... }` — для логических,
   ускоренных и wall-часов. Итоговый маркер `LIMITS_SPEED_OK` сигнализирует об
   успешном завершении примера.

## Smoke-проверка

Для локальной проверки можно использовать скрипт:

```bash
pnpm -w examples:build
node examples/02-limits-and-speed/smoke.ts
```

Он запускает скомпилированный SDK-пример и проверяет наличие маркера
`LIMITS_SPEED_OK`.
