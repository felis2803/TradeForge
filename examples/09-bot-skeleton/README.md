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

## ENV (все строки)

- `TF_SYMBOL=BTCUSDT` (по умолчанию)
- `TF_TRADES_FILES` / `TF_DEPTH_FILES` — пути к JSONL-таймлайнам
- `TF_SEED=42`
- `TF_EMA_FAST=12`, `TF_EMA_SLOW=26`, `TF_SPREAD_BPS=5`
- `TF_QTY="0.001"`
- `TF_CLOCK=logical|accelerated|wall` (+ `TF_SPEED`), `TF_MAX_EVENTS`/`TF_MAX_SIM_MS`/`TF_MAX_WALL_MS`
- `TF_VERBOSE=1`, `TF_NDJSON_PATH=/tmp/tf.bot.ndjson`

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
jq -c '{ts, kind, action, fill}' /tmp/tf.bot.ndjson | head
```

Каждая строка — JSON с полями `ts`, `kind`, `action` (для действий бота) и `fill` (для исполнений).

## Fixed-point

Числовые значения передавайте строками; внутри используются `bigint` с масштабами `priceScale=5` и `qtyScale=6`.
