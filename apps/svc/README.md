# @tradeforge/svc

REST-обёртка над симулятором TradeForge. Сервис поднимает Fastify-приложение с минимальным набором эндпойнтов для управления счётами и ордерами в рамках одного in-memory движка.

```bash
pnpm install
pnpm --filter @tradeforge/svc build
pnpm --filter @tradeforge/svc exec -- tf-svc
# по умолчанию сервер слушает http://0.0.0.0:3000
```

## Формат данных

- Все числовые значения передаются и возвращаются в виде строк. Это сохраняет точность `bigint` и избавляет от накопления ошибок фиксированной точности.
- Масштабирование завязано на символ: `qtyScale` применяется к базовой валюте (объёмы, `qty`), `priceScale` — к котируемой (цены, `price`, `triggerPrice`, `notional`).
- При работе с REST передавайте строки «как есть» — сервис сам нормализует значения в соответствии со scale.

## Эндпойнты

### POST `/v1/accounts`

Создание счёта. Возвращает идентификатор счёта.

```bash
curl -X POST http://localhost:3000/v1/accounts
# { "accountId": "a1" }
```

### POST `/v1/accounts/:id/deposit`

Пополнение счёта в указанной валюте.

- `currency` — строковый код валюты (`BTC`, `USDT`, ...).
- `amount` — строка в пользовательском формате (будет масштабирована по scale инструмента).

Ошибки:

- `400 currency and amount are required` — если в теле запроса нет обязательных полей.
- `400 unknown currency: XXX` — если валюта не описана в конфигурации символов.

```bash
curl -X POST http://localhost:3000/v1/accounts/a1/deposit \
  -H 'Content-Type: application/json' \
  -d '{"currency":"USDT","amount":"1000"}'
# { "USDT": "1000" }
```

```bash
curl -i -X POST http://localhost:3000/v1/accounts/a1/deposit \
  -H 'Content-Type: application/json' \
  -d '{"currency":"XYZ","amount":"1"}'
# HTTP/1.1 400 Bad Request
# {"message":"unknown currency: XYZ"}
```

### GET `/v1/accounts/:id/balances`

Возвращает моментальный снимок балансов по счёту (строковые значения).

```bash
curl http://localhost:3000/v1/accounts/a1/balances
# { "BTC": "0", "USDT": "1000" }
```

### POST `/v1/orders`

Создание ордера. Тело запроса:

- `accountId` — идентификатор счёта.
- `symbol` — торгуемый инструмент (`BTCUSDT`).
- `type` — тип ордера (`LIMIT`, `MARKET`, `STOP_LIMIT`, `STOP_MARKET`).
- `side` — `BUY` или `SELL`.
- `qty` — строка с объёмом (масштабируется по `qtyScale`).
- `price` — обязательна для `LIMIT` и `STOP_LIMIT` (масштабируется по `priceScale`).
- `tif` — время жизни ордера (`GTC` по умолчанию).
- `triggerPrice` и `triggerDirection` — требуются для `STOP_LIMIT`/`STOP_MARKET`. `triggerDirection` может быть `UP` или `DOWN`.

Ошибки валидации (`400 Bad Request`):

- Неизвестные или отсутствующие обязательные поля (`invalid body`).
- `price is required for LIMIT` (и аналогично для `STOP_LIMIT`).
- `triggerPrice is required for stop orders` / `triggerDirection is required for stop orders`.
- `triggerDirection must be UP or DOWN` — если значение вне допустимого множества.

#### LIMIT

```bash
curl -X POST http://localhost:3000/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "accountId": "a1",
    "symbol": "BTCUSDT",
    "type": "LIMIT",
    "side": "BUY",
    "qty": "0.01",
    "price": "25000"
  }'
# {
#   "id": "o1",
#   "symbol": "BTCUSDT",
#   "type": "LIMIT",
#   "side": "BUY",
#   "qty": "0.010000",
#   "price": "25000.00000",
#   "status": "OPEN",
#   ...
# }
```

При нарушении валидации сервер вернёт `HTTP/1.1 400 Bad Request`. Например, если для `LIMIT` не передать `price`:

```bash
curl -i -X POST http://localhost:3000/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "accountId": "a1",
    "symbol": "BTCUSDT",
    "type": "LIMIT",
    "side": "BUY",
    "qty": "0.01"
  }'
# HTTP/1.1 400 Bad Request
```

```json
{ "message": "price is required for LIMIT" }
```

Числовые значения — строки (fixed-point). Поля и точный формат зависят от текущей версии API.

```json
{
  "id": "O1",
  "tsCreated": 1,
  "tsUpdated": 1,
  "symbol": "BTCUSDT",
  "type": "LIMIT",
  "side": "BUY",
  "tif": "GTC",
  "qty": "10000",
  "status": "OPEN",
  "accountId": "A1",
  "executedQty": "0",
  "cumulativeQuote": "0",
  "fees": {},
  "fills": [],
  "price": "2500000000",
  "reserved": {
    "currency": "USDT",
    "total": "25012500",
    "remaining": "25012500"
  }
}
```

`tsCreated`/`tsUpdated` — миллисекунды Unix (в чистом запуске используются логические тики, при живых данных будут значения из таймлайна).

#### STOP_LIMIT / STOP_MARKET

```bash
curl -X POST http://localhost:3000/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "accountId": "a1",
    "symbol": "BTCUSDT",
    "type": "STOP_LIMIT",
    "side": "SELL",
    "qty": "0.02",
    "price": "26000",
    "triggerPrice": "25500",
    "triggerDirection": "DOWN"
  }'
# { "id": "o2", "type": "STOP_LIMIT", ... }
```

```bash
curl -i -X POST http://localhost:3000/v1/orders \
  -H 'Content-Type: application/json' \
  -d '{
    "accountId": "a1",
    "symbol": "BTCUSDT",
    "type": "STOP_MARKET",
    "side": "SELL",
    "qty": "0.02"
  }'
# HTTP/1.1 400 Bad Request
# {"message":"triggerPrice is required for stop orders"}
```

### GET `/v1/orders/:id`

Возвращает состояние ордера по идентификатору.

```bash
curl http://localhost:3000/v1/orders/o1
```

### DELETE `/v1/orders/:id`

Отменяет ордер и возвращает итоговое состояние.

```bash
curl -X DELETE http://localhost:3000/v1/orders/o1
```

### GET `/v1/orders/open`

Возвращает список открытых ордеров для счёта. Запрос требует параметр `accountId` и опционально `symbol`.

```bash
curl "http://localhost:3000/v1/orders/open?accountId=a1"
```

> Примечание: маршрут `/v1/orders/open` эквивалентен фильтру `status=OPEN` и будет объединён с `GET /v1/orders?status=OPEN` в будущих итерациях.

## Стратегия обработки ошибок

Все ошибки домена пробрасываются как `500 Internal Server Error`. Явные ошибки валидации (неизвестная валюта, отсутствующие обязательные поля) приводят к `400` с сообщением в формате `{ "message": "..." }`.
