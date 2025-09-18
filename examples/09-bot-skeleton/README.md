# 09 — Bot Skeleton (SDK)

Минимальный пример торгового бота на SDK TradeForge. Бот читает таймлайн торгов и стаканов, считает две EMA, строит намерение на единственный лимитный ордер и через reconcile приводит открытые заявки к желаемому состоянию. Исполнения учитываются в метриках; итог выводится строкой `BOT_OK { ... }`.

## Быстрый старт

```bash
pnpm -w examples:build
TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl" \
TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl" \
TF_CLOCK=logical TF_MAX_EVENTS=1000 TF_QTY="0.001" \
node dist-examples/09-bot-skeleton/run.js
```

Ожидаемый вывод: строка `BOT_OK { ... }` с полями `fills`, `fees`, `finalBalances`, `pnl`.

## ENV

| VAR                                                  | type       | default                             | meaning                             |
| ---------------------------------------------------- | ---------- | ----------------------------------- | ----------------------------------- |
| `TF_SYMBOL`                                          | string     | `BTCUSDT`                           | символ для торговли                 |
| `TF_TRADES_FILES`                                    | csv/string | `examples/_smoke/mini-trades.jsonl` | список trade-таймлайнов             |
| `TF_DEPTH_FILES`                                     | csv/string | `examples/_smoke/mini-depth.jsonl`  | список depth-таймлайнов             |
| `TF_SEED`                                            | int        | `42`                                | seed для детерминированного PRNG    |
| `TF_EMA_FAST` / `TF_EMA_SLOW`                        | int        | `12` / `26`                         | окна EMA                            |
| `TF_SPREAD_BPS`                                      | int        | `5`                                 | спред в б.п. относительно mid       |
| `TF_QTY`                                             | string     | `0.001`                             | желаемый объём заявки (fixed-point) |
| `TF_CLOCK`                                           | enum       | `logical`                           | `logical` / `accelerated` / `wall`  |
| `TF_SPEED`                                           | number     | –                                   | ускорение для `accelerated` clock   |
| `TF_MAX_EVENTS` / `TF_MAX_SIM_MS` / `TF_MAX_WALL_MS` | int        | –                                   | лимиты реплея                       |
| `TF_MIN_ACTION_MS`                                   | int        | `200`                               | анти-дребезг по сим-времени         |
| `TF_REPLACE_AS_CANCEL_PLACE`                         | flag `0/1` | `0`                                 | форсить replace как cancel+place    |
| `TF_VERBOSE`                                         | flag `0/1` | `0`                                 | расширенные логи решений и сделок   |
| `TF_NDJSON_PATH`                                     | path       | –                                   | писать действия/сводку в NDJSON     |
| `TF_KEEP_NDJSON`                                     | flag `0/1` | `0`                                 | сохранить NDJSON после завершения   |

## Scales (fixed-point)

| field        | default | description                                 |
| ------------ | ------- | ------------------------------------------- |
| `priceScale` | `5`     | масштаб цен (5 знаков после запятой)        |
| `qtyScale`   | `6`     | масштаб количества (6 знаков после запятой) |

> Все числовые значения (цены, объёмы, балансы) передавайте строками: внутри SDK они хранятся в `bigint` с фиксированным масштабом. Значения по умолчанию для примера заданы в [`SYMBOL_CONFIG`](./run.ts) и могут отличаться в зависимости от инструмента/конфигурации.

## Что делает бот

1. Читает торговые и стаканные события, объединяет их в таймлайн.
2. Поддерживает best bid/ask, mid и последнюю цену сделки.
3. Считает две EMA и определяет сигнал BUY/SELL/FLAT.
4. Строит намерение (`BUY` ниже mid или `SELL` выше mid), приводит его к открытому ордеру через `reconcile`.
5. Проверяет доступные средства, учитывает комиссию и исполненные сделки.
6. Пишет действия и исполнения в NDJSON (если задан `TF_NDJSON_PATH`).
7. Завершает работу строкой `BOT_OK { ... }` с финальными метриками.

## NDJSON постобработка

```bash
TF_NDJSON_PATH="/tmp/tf.bot.ndjson" node dist-examples/09-bot-skeleton/run.js
jq -r '.kind' /tmp/tf.bot.ndjson | sort | uniq -c
```

Каждая строка NDJSON содержит `ts`, `kind`, `action` и `fill`; удобно быстро посмотреть статистику по событиям через `jq`.
