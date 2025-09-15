# @tradeforge/svc

HTTP сервис (Fastify) с REST-эндпоинтами `/v1/*` для песочницы.

## Балансы и масштабы

- Для **base**-валют (например, BTC) баланс хранится с `qtyScale` символа.
- Для **quote**-валют (например, USDT) баланс хранится в «денежных» тиках с `priceScale` символа.
- Все входные цены/количества принимаются **строками** и конвертируются через `@tradeforge/core` (`toPriceInt`/`toQtyInt`).

## Ошибки валидации

- Депозит неизвестной валюты → `400 {"message":"unknown currency: <code>"}`.
- LIMIT заказ без `price` → `400 {"message":"price is required for LIMIT"}`.
