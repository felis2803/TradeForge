# 04 — Стоп-ордера (STOP_LIMIT и STOP_MARKET)

Пример показывает работу стоп-ордеров в TradeForge: постановку `STOP_LIMIT` и `STOP_MARKET`, активацию по цене сделки, частичное исполнение и ручную отмену остатка. Сценарий использует мини-датасет сделок/стакана и выводит итоговый маркер `STOP_ORDERS_OK`.

> Все числовые поля (`qty`, `price`, `triggerPrice`, суммы депозитов) передавайте строками в фиксированной точности (fixed-point).

## Требования

- Установленные зависимости (`pnpm install`).
- Сборка пакетов (`pnpm -w build`).
- Сборка примеров (`pnpm -w examples:build`) — создаёт `dist-examples/**` для запуска CLI/SDK.
- Источник данных: JSONL-файлы сделок и стакана. Для демонстрации используем мини-набор из [`examples/_smoke`](../_smoke/).

## CLI — демонстрация активации и отмены

1. Укажем файлы сделок/стакана (скрипт автоматически подставит эти значения, если переменные окружения не заданы):

```bash
export TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl"
export TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl"
```

> При необходимости задайте `TF_TRIGGER_BELOW`/`TF_TRIGGER_ABOVE` — строки с фиксированной точностью для `triggerPrice`.

2. Собираем и запускаем сценарий:

   ```bash
   pnpm -w examples:build
   pnpm examples:run 04-stop-orders
   ```

   В stdout появятся журнальные сообщения об активации и исполнении ордеров. Финальная строка содержит маркер для автоматизаций:

   ```text
   STOP_ORDERS_OK { placed: 2, triggered: 2, canceled: 1 }
   ```

   Значения `triggered` и `canceled` подсчитываются по фактическому статусу `STOP_MARKET` (полностью исполнен) и `STOP_LIMIT` (частично исполнен и отменён вручную).

## SDK (TypeScript) — ключевые шаги

Скрипт [`run.ts`](./run.ts) реализует полный сценарий на SDK:

1. Загружает сделки и стакан через `buildTradesReader`/`buildDepthReader`, объединяет их в `buildMerged`.
2. Создаёт `ExchangeState` с символом `BTCUSDT`, подключает `AccountsService` и `OrdersService`.
3. Открывает счёт и зачисляет 0.100 BTC + 2000 USDT (строки автоматически конвертируются в `QtyInt`/`PriceInt`).
4. Размещает два стоп-ордера. `triggerPrice` берётся из переменных окружения `TF_TRIGGER_BELOW`/`TF_TRIGGER_ABOVE`, а при их отсутствии вычисляется по первой сделке (≈±1 % с ограничением до ±0.02/0.40 USDT) с запасным значением `9000`/`11000`:
   - `STOP_MARKET SELL 0.020 BTC` с `triggerDirection=DOWN` — сработает, когда цена сделки опустится ниже порога.
   - `STOP_LIMIT BUY 0.040 BTC @ 27000.45` с `triggerDirection=UP` — активируется при росте цены, дальше работает как лимитный ордер.
5. Итерация `executeTimeline` отслеживает активацию, логи `fill` и отменяет `STOP_LIMIT`, как только он частично исполнен (остаток остаётся `CANCELED`).
6. Скрипт печатает финальные статусы для обоих ордеров и маркер `STOP_ORDERS_OK { placed: 2, triggered: 2, canceled: 1 }`.

Запуск собранного скрипта напрямую (переменные окружения аналогичны CLI-варианту):

```bash
TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl" \
TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl" \
node dist-examples/04-stop-orders/run.js
```

## REST (curl)

Для работы HTTP API поднимаем сервис:

```bash
pnpm --filter @tradeforge/svc dev
```

По умолчанию сервер слушает `http://localhost:3000`. Все числовые поля (`qty`, `price`, `triggerPrice`, суммы депозитов) передаются строками.

### Подготовка счёта

```bash
ACCOUNT_ID=$(curl -s -X POST http://localhost:3000/v1/accounts | jq -r '.accountId')

# Депозит базовой и котируемой валюты (строки в fixed-point)
curl -s -X POST "http://localhost:3000/v1/accounts/$ACCOUNT_ID/deposit" \
  -H "content-type: application/json" \
  -d '{"currency":"BTC","amount":"0.100"}'

curl -s -X POST "http://localhost:3000/v1/accounts/$ACCOUNT_ID/deposit" \
  -H "content-type: application/json" \
  -d '{"currency":"USDT","amount":"2000"}'
```

### STOP_MARKET (SELL) с триггером вниз

```bash
STOP_MARKET_ID=$(curl -s -X POST http://localhost:3000/v1/orders \
  -H "content-type: application/json" \
  -d '{
        "accountId": "'"$ACCOUNT_ID"'",
        "symbol": "BTCUSDT",
        "type": "STOP_MARKET",
        "side": "SELL",
        "qty": "0.020",
        "triggerPrice": "27000.12",
        "triggerDirection": "DOWN"
      }' | jq -r '.id')
```

### STOP_LIMIT (BUY) с триггером вверх

```bash
STOP_LIMIT_ID=$(curl -s -X POST http://localhost:3000/v1/orders \
  -H "content-type: application/json" \
  -d '{
        "accountId": "'"$ACCOUNT_ID"'",
        "symbol": "BTCUSDT",
        "type": "STOP_LIMIT",
        "side": "BUY",
        "qty": "0.040",
        "price": "27000.45",
        "triggerPrice": "27000.50",
        "triggerDirection": "UP"
      }' | jq -r '.id')
```

Проверяем текущее состояние и открытые ордера:

```bash
curl -s "http://localhost:3000/v1/orders/$STOP_LIMIT_ID" | jq
curl -s "http://localhost:3000/v1/orders/open?accountId=$ACCOUNT_ID&symbol=BTCUSDT" | jq
```

После частичного исполнения `STOP_LIMIT` можно отменить остаток:

```bash
curl -s -X DELETE "http://localhost:3000/v1/orders/$STOP_LIMIT_ID" | jq
```

### Типичные ошибки валидации (400 Bad Request)

```bash
# price обязателен для STOP_LIMIT
curl -i -X POST http://localhost:3000/v1/orders \
  -H "content-type: application/json" \
  -d '{
        "accountId": "'"$ACCOUNT_ID"'",
        "symbol": "BTCUSDT",
        "type": "STOP_LIMIT",
        "side": "BUY",
        "qty": "0.010",
        "triggerPrice": "27000",
        "triggerDirection": "UP"
      }'
# HTTP/1.1 400 Bad Request
# {"message":"price is required for STOP_LIMIT"}

# triggerPrice обязателен для всех стоп-ордеров
curl -i -X POST http://localhost:3000/v1/orders \
  -H "content-type: application/json" \
  -d '{
        "accountId": "'"$ACCOUNT_ID"'",
        "symbol": "BTCUSDT",
        "type": "STOP_MARKET",
        "side": "SELL",
        "qty": "0.010"
      }'
# HTTP/1.1 400 Bad Request
# {"message":"triggerPrice is required for stop orders"}
```

`triggerDirection` тоже обязателен для `STOP_LIMIT`/`STOP_MARKET` и должен быть `UP` или `DOWN`. Ответы сервиса сериализуют `bigint` в строки, поэтому поля `price`, `qty`, `triggerPrice`, а также балансы возвращаются строковыми значениями.
