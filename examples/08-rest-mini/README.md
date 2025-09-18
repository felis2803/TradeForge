# 08 — Минимальный REST-сценарий

Пример показывает, как с помощью `curl` выполнять базовые операции через сервис [`@tradeforge/svc`](../../apps/svc/README.md): создать аккаунт, пополнить счёт, разместить и отменить ордера. Сценарий рассчитан на локальный запуск без SDK.

> REST-сервис должен быть доступен по `BASE_URL` (по умолчанию `http://localhost:3000`).
> Все числовые значения (`amount`, `qty`, `price`, `triggerPrice`, суммы в балансах) передаются **строками**. Сервис принимает строки, масштабирует их по конфигурации символа и возвращает строки с тем же масштабом.
> Не забывайте указывать заголовок `content-type: application/json` для запросов с телом.
> Для разбора ответов и проверки идентификаторов примеры используют `jq`.

## Требования

- `pnpm install` — общие зависимости (если ещё не ставили).
- Запущенный REST-сервис: `pnpm --filter @tradeforge/svc dev` (по умолчанию слушает `http://localhost:3000`).
- Утилиты `curl` и `jq` — используются для отправки запросов и форматирования ответов.

Создайте пару переменных окружения для сокращений:

```bash
export BASE_URL="http://localhost:3000"
export SYMBOL="BTCUSDT"
```

## Шаги сценария

### 1. Создать аккаунт

```bash
ACCOUNT_ID=$(curl -sS -X POST "$BASE_URL/v1/accounts" | jq -r '.accountId')
echo "ACCOUNT_ID=$ACCOUNT_ID"
```

Пример ответа:

```json
{ "accountId": "A1" }
```

### 2. Пополнить счёт в котируемой валюте

Пополняем баланс на 1000 USDT:

```bash
curl -sS -X POST "$BASE_URL/v1/accounts/$ACCOUNT_ID/deposit" \
  -H 'content-type: application/json' \
  -d '{"currency":"USDT","amount":"1000"}' | jq
```

Ответ отражает текущее состояние баланса USDT. Значение `free` (`"100000000"`) — это 1000 × 10⁵ (учитывается `priceScale=5` для `BTCUSDT`).

```json
{
  "free": "100000000",
  "locked": "0"
}
```

Снимок всех балансов счёта:

```bash
curl -sS "$BASE_URL/v1/accounts/$ACCOUNT_ID/balances" | jq
```

```json
{
  "USDT": {
    "free": "100000000",
    "locked": "0"
  }
}
```

### 3. Разместить LIMIT BUY ордер

Ордер на покупку 0.010 BTC по цене 27 000.40 USDT:

```bash
LIMIT_JSON=$(curl -sS -X POST "$BASE_URL/v1/orders" \
  -H 'content-type: application/json' \
  -d '{
        "accountId": "'"$ACCOUNT_ID"'",
        "symbol": "'"$SYMBOL"'",
        "type": "LIMIT",
        "side": "BUY",
        "qty": "0.010",
        "price": "27000.40"
      }')
LIMIT_ID=$(echo "$LIMIT_JSON" | jq -r '.id')
echo "$LIMIT_JSON" | jq '{id, type, side, qty, price, status, reserved}'
```

Ожидаемый фрагмент ответа:

```json
{
  "id": "O1",
  "type": "LIMIT",
  "side": "BUY",
  "qty": "10000",
  "price": "2700040000",
  "status": "OPEN",
  "reserved": {
    "currency": "USDT",
    "total": "27013900",
    "remaining": "27013900"
  }
}
```

Проверяем статус ордера и список открытых заявок:

```bash
curl -sS "$BASE_URL/v1/orders/$LIMIT_ID" | jq '{id, status, qty, price}'
curl -sS "$BASE_URL/v1/orders/open?accountId=$ACCOUNT_ID&symbol=$SYMBOL" | jq 'map({id, type, status})'
```

### 4. Разместить STOP_MARKET ордер

BUY-стоп без цены (исполнится маркетом после триггера 27 500 USDT):

```bash
STOP_JSON=$(curl -sS -X POST "$BASE_URL/v1/orders" \
  -H 'content-type: application/json' \
  -d '{
        "accountId": "'"$ACCOUNT_ID"'",
        "symbol": "'"$SYMBOL"'",
        "type": "STOP_MARKET",
        "side": "BUY",
        "qty": "0.005",
        "triggerPrice": "27500",
        "triggerDirection": "UP"
      }')
echo "$STOP_JSON" | jq '{id, type, triggerPrice, triggerDirection, status}'
```

### 5. Отменить LIMIT ордер и проверить балансы

```bash
curl -sS -X DELETE "$BASE_URL/v1/orders/$LIMIT_ID" | jq '{id, status}'
curl -sS "$BASE_URL/v1/accounts/$ACCOUNT_ID/balances" | jq '.USDT'
curl -sS "$BASE_URL/v1/orders/open?accountId=$ACCOUNT_ID&symbol=$SYMBOL" | jq 'map({id, status})'
```

После отмены поле `locked` по USDT снова становится `"0"`.

## Типичные ошибки валидации (`400 Bad Request`)

### LIMIT без `price`

```bash
curl -i -sS -X POST "$BASE_URL/v1/orders" \
  -H 'content-type: application/json' \
  -d '{
        "accountId": "'"$ACCOUNT_ID"'",
        "symbol": "'"$SYMBOL"'",
        "type": "LIMIT",
        "side": "BUY",
        "qty": "0.010"
      }'
```

Фрагмент ответа:

```
HTTP/1.1 400 Bad Request
{"message":"price is required for LIMIT"}
```

### STOP\_\* без `triggerPrice`

```bash
curl -i -sS -X POST "$BASE_URL/v1/orders" \
  -H 'content-type: application/json' \
  -d '{
        "accountId": "'"$ACCOUNT_ID"'",
        "symbol": "'"$SYMBOL"'",
        "type": "STOP_MARKET",
        "side": "SELL",
        "qty": "0.001"
      }'
```

```
HTTP/1.1 400 Bad Request
{"message":"triggerPrice is required for stop orders"}
```

## Скрипт `rest.sh`

Для удобства можно использовать оболочку над `curl`:

```bash
bash examples/08-rest-mini/rest.sh help
```

Основные команды:

- `create_account` — POST `/v1/accounts`.
- `deposit_quote <accountId> <amount> [currency]` — POST `/v1/accounts/:id/deposit`.
- `place_limit <accountId> <side> <qty> <price> [symbol]` — POST `/v1/orders` с типом `LIMIT`.
- `place_stop_market <accountId> <side> <qty> <triggerPrice> <triggerDirection> [symbol]` — POST `/v1/orders` с типом `STOP_MARKET`.
- `list_open <accountId> [symbol]` — GET `/v1/orders/open`.
- `cancel_by_id <orderId>` — DELETE `/v1/orders/:id`.

Скрипт выводит JSON-ответы сервиса (если установлен `jq`, то в отформатированном виде). Переменные `BASE_URL` и `SYMBOL` берутся из окружения, как и в примерах выше.

## Смоук-тест

`smoke.ts` проверяет доступность сервиса и создание аккаунта. Если `BASE_URL` недостижим (сервис не запущен), скрипт выводит подсказку и завершает работу с кодом `0`, чтобы не падать в CI. При доступном сервисе выводится маркер `REST_MINI_SMOKE_OK <accountId>`.

```bash
node examples/08-rest-mini/smoke.ts
```
