# @tradeforge/cli

Командная строка TradeForge предназначена для локальных прогонов симулятора на исторических данных Binance. После сборки пакет предоставляет бинарь `tf`.

```bash
pnpm install
pnpm --filter @tradeforge/cli build
pnpm --filter @tradeforge/cli exec -- tf --version
```

## Quickstart

1. **Запуск с автосохранением** — стартуем прогон и складываем Checkpoint v1 каждые 10 000 событий:

   ```bash
   pnpm --filter @tradeforge/cli exec -- \
     tf simulate \
     --trades data/trades.jsonl \
     --checkpoint-save checkpoints/btcusdt.json \
     --cp-interval-events 10000
   ```

   Файл чекпоинта содержит снимок движка и курсоры для входных JSONL-стримов.

2. **Возобновление** — продолжаем с сохранённого состояния и печатаем агрегированную сводку:

   ```bash
   pnpm --filter @tradeforge/cli exec -- \
     tf simulate \
     --trades data/trades.jsonl \
     --depth data/depth.jsonl \
     --checkpoint-load checkpoints/btcusdt.json \
     --summary
   ```

   Для корректного реплея нужно передать те же файлы, что использовались при сохранении (JSONL обеспечивает гарантированные курсоры, см. ниже).

   Пример фрагмента `--summary` (значения сериализованы строками фиксированной точки, scale указан в блоке `config`):

   ```json
   {
     "totals": {
       "orders": {
         "total": 1,
         "filled": 1,
         "partiallyFilled": 0,
         "canceled": 0
       },
       "fills": 1,
       "executedQty": "400000",
       "notional": "400000400",
       "fees": { "maker": "400000", "taker": "0" }
     },
     "orders": [
       {
         "id": "O1",
         "side": "BUY",
         "status": "FILLED",
         "qty": "400000",
         "executedQty": "400000",
         "cumulativeQuote": "400000400",
         "fees": { "maker": "400000" },
         "fills": 1
       }
     ],
     "balances": {
       "A1": {
         "USDT": { "free": "9599599600", "locked": "0" },
         "BTC": { "free": "400000", "locked": "0" }
       }
     },
     "config": {
       "symbol": "BTCUSDT",
       "priceScale": 5,
       "qtyScale": 6,
       "ordersSeeded": []
     }
   }
   ```

## Supported formats

- Симулятор читает CSV, JSON и JSONL (`*.jsonl`, `*.jsonl.gz`, `*.jsonl.zip`).
- Курсоры и возобновляемые чекпоинты гарантированы **только** для JSONL-файлов и архивов (`.jsonl`, `.jsonl.gz`, `.jsonl.zip` с одним вложенным `*.jsonl`).
- Архивы с несколькими файлами или JSON/CSV без формата строк не поддерживают курсоры — при возобновлении поток данных будет переигран с начала.

## Numeric values

Все денежные величины (`price`, `qty`, `notional`, комиссии) внутри движка — `bigint`. CLI сериализует их в строки как при выводе отчётов, так и внутри чекпоинтов. Входные аргументы (`--qty`, `--price`, значения в JSON) также ожидаются строковыми, чтобы избежать потери точности.

## Команда `tf simulate`

`tf simulate` запускает консервативный матчинг ордеров поверх потока сделок и (опционально) стакана. В стандартном режиме команда печатает два JSON-объекта: метаданные прогона (`clock`, число обработанных событий и длительности) и агрегированную сводку по счетам/ордерам. Все числовые поля сериализуются в строки, чтобы сохранить точность `bigint`.

### Источники данных

- `--trades <path>[,<path>...]` — список файлов со сделками. Поддерживаются `*.jsonl`, `*.jsonl.gz`, `*.jsonl.zip`, `*.json`, `*.ndjson`, `*.csv`. Для гарантий восстановления воспользуйтесь форматами из раздела [Supported formats](#supported-formats).
- `--depth <path>[,<path>...]` — список файлов с изменениями стакана. Необязательны; в MVP-1 данные стакана не влияют на исполнение, но участвуют в тай-брейке при совпадении меток времени.
- `--symbol <SYMBOL>` — идентификатор инструмента (по умолчанию `BTCUSDT`). При возобновлении из чекпоинта символ берётся из снимка.
- `--format-trades/--format-depth <auto|csv|json|jsonl>` — явное указание формата, если расширение файла вводит в заблуждение.
- `--from` / `--to` — ограничение диапазона по времени. Принимают Unix-миллисекунды или строки, которые понимает `Date.parse`.
- `--limit <N>` — ограничивает число распечатанных отчётов при `--ndjson`.

### Управление исполнением

- `--clock <logical|wall|accel>` — тип часов. Логические часы не зависят от wall-clock. Wall-clock синхронизирован с реальным временем. `accel` включает ускоренные часы; множитель задаётся через `--speed` (>=1).
- `--speed <FACTOR>` — ускорение для `--clock accel`. По умолчанию `10`.
- `--max-events <N>` — жёсткий лимит на количество событий, после которого симуляция останавливается.
- `--max-sim-ms <MS>` — ограничение виртуального времени (разница меток сделок) в миллисекундах.
- `--max-wall-ms <MS>` — ограничение по реальному времени выполнения.
- `--pause-on-start` — старт в паузе. CLI ожидает нажатия Enter перед продолжением, что удобно при запуске из терминала с долгим прогревом.

  > Windows: при `--pause-on-start` CLI включает «raw mode», чтобы Enter обрабатывался корректно даже в PowerShell/консолях Windows Terminal — ручной настройки не требуется.

- `--prefer-depth-on-equal-ts` — управляет tie-break при одинаковых метках времени (по умолчанию стакан приоритетнее).
- `--treat-limit-as-maker` — опция консервативного режима (по умолчанию `true`), позволяющая симулятору считать лимитные заявки поставщиком ликвидности.
- `--strict-conservative` — отключает участие в сделках, где нет уверенности в ликвидности со стороны агрессора (`participationFactor = 0`).
- `--use-aggressor-liquidity` — разрешает использовать объём агрессора для частичного матчинга (по умолчанию выключено).

### Вывод

- `--ndjson` — печатать каждый отчёт исполнения (execution report) отдельной строкой в формате NDJSON.
- `--summary` / `--no-summary` — включает/выключает финальный агрегированный отчёт (по умолчанию печатается).

#### Summary/NDJSON вывод

`--summary` формирует агрегированный JSON: блок `totals` содержит счётчики событий и суммарные величины (сериализованы строками, чтобы сохранить точность `bigint`), `orders` — итоговое состояние ордеров, `balances` — снапшот балансов счётов. В `config` возвращаются параметры шкалы (`priceScale`, `qtyScale`), которые помогут преобразовать строки обратно в десятичные значения.

`--ndjson` выводит поток `ExecutionReport` в формате NDJSON и не мешает финальному summary. Каждая строка — отдельный отчёт, готовый для стриминга или дальнейшей обработки через `jq`/Logstash. Пример строки с событием fill:

```json
{
  "ts": 1577836800000,
  "kind": "FILL",
  "orderId": "O1",
  "fill": {
    "ts": 1577836800000,
    "orderId": "O1",
    "price": "1000001000",
    "qty": "400000",
    "side": "BUY",
    "liquidity": "MAKER",
    "sourceAggressor": "BUY",
    "tradeRef": "1"
  },
  "patch": {
    "status": "FILLED",
    "executedQty": "400000",
    "cumulativeQuote": "400000400",
    "fees": { "maker": "400000" },
    "tsUpdated": 3
  }
}
```

### Работа с чекпоинтами

- `--checkpoint-save <FILE>` — путь для автосохранения Checkpoint v1 во время реплея.
- `--cp-interval-events <N>` — интервал автосейва по числу событий (`0` отключает).
- `--cp-interval-wall-ms <MS>` — интервал автосейва по wall-clock времени (`0` отключает).
- `--checkpoint-load <FILE>` — загрузить Checkpoint v1 и продолжить реплей. Требуются те же входные файлы (JSONL для курсоров).

Чекпоинт содержит сериализованное состояние движка, курсоры по потокам сделок/стакана и флаг tie-break. Файл сохраняется в JSON с `bigint`, сериализованными в строки.

### Типовые сценарии

1. **Базовый прогон**

   ```bash
   pnpm --filter @tradeforge/cli exec -- \
     tf simulate \
     --trades data/trades.jsonl \
     --depth data/depth.jsonl
   ```

2. **Автосохранение чекпоинтов** — сохраняем снимок каждые 10 000 событий или каждые 60 с реального времени:

   ```bash
   pnpm --filter @tradeforge/cli exec -- \
     tf simulate \
     --trades data/trades.jsonl \
     --checkpoint-save checkpoints/btcusdt.json \
     --cp-interval-events 10000 \
     --cp-interval-wall-ms 60000
   ```

3. **Возобновление из чекпоинта** — продолжаем с того же места, где остановились:

   ```bash
   pnpm --filter @tradeforge/cli exec -- \
     tf simulate \
     --checkpoint-load checkpoints/btcusdt.json \
     --trades data/trades.jsonl \
     --depth data/depth.jsonl
   ```

   Если чекпоинт содержит курсоры `trades`/`depth`, необходимо снова указать исходные JSONL-файлы.

4. **Пауза перед стартом** — запускаем с интерактивной паузой и ускоренными часами:
   ```bash
   pnpm --filter @tradeforge/cli exec -- \
     tf simulate \
     --trades data/trades.jsonl \
     --clock accel \
     --speed 50 \
     --pause-on-start
   ```

## Возобновление через CLI

Типовой user-flow: запускаем симуляцию с `--checkpoint-save`, дожидаемся автосохранения (`checkpoint saved to …`), прекращаем процесс и затем продолжаем с помощью `--checkpoint-load`. Для устойчивого возобновления используйте JSONL источники: только они гарантируют корректное восстановление курсора по файлам.
