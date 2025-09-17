# 03 — Аккаунты и LIMIT-ордера

Пример объединяет работу с аккаунтами и лимитными ордерами в TradeForge. Сценарий создаёт счёт, вносит депозит в котируемой валюте, выставляет пару LIMIT-ордеров (BUY и SELL), дожидается исполнения сделками из исторической ленты и отменяет оставшийся «висящий» ордер. В конце выводятся балансы и счётчик открытых заявок.

## Требования

- Установленные зависимости (`pnpm install`).
- Сборка пакетов (`pnpm -w build`).
- Сборка примеров (`pnpm -w examples:build`) — создаёт `dist-examples/**`.
- Источник данных: JSONL-файлы сделок и стакана. Для быстрого старта можно использовать мини-набор из [`examples/_smoke`](../_smoke/).

## CLI — запуск готового сценария

1. Указываем файлы сделок и стакана (можно перечислять несколько путём разделения запятой или переносом строки):

   ```bash
   export TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl"
   export TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl"
   ```

   Если переменные не заданы, скрипт по умолчанию возьмёт именно эти мини-файлы.

2. Собираем примеры (если ещё не собраны) и запускаем CLI-обёртку:

   ```bash
   pnpm -w examples:build
   pnpm examples:run 03-accounts-and-orders
   ```

   В stdout появятся журнальные сообщения и итоговая строка-маркер:

   ```text
   ACC_ORDERS_OK { balances: { BTC: { free: '0.015000', locked: '0' }, USDT: { free: '59.43875', locked: '0' } }, openOrdersCount: 0 }
   ```

   `ACC_ORDERS_OK` используется смоуком и автоматизацией для проверки успешного прохождения сценария.

## SDK (TypeScript) — основные шаги

В файле [`run.ts`](./run.ts) показан полный сценарий на SDK:

1. Считывание сделок/стакана через `buildTradesReader` и `buildDepthReader`, объединение в единый поток `buildMerged`.
2. Инициализация `ExchangeState`, `AccountsService` и `OrdersService`.
3. Создание аккаунта с депозитом 1000 USDT через `createAccountWithDeposit` (строка "1000" автоматически конвертируется в целое число с учётом `priceScale`).
4. Размещение ордера `LIMIT BUY 0.030 BTC @ 27000.40`, отслеживание заполнения через `executeTimeline`.
5. После частичного/полного заполнения BUY-ордера — размещение `LIMIT SELL` на часть полученного базового актива и дополнительного «висящего» `LIMIT BUY`, который затем отменяется.
6. Финальный снимок балансов (`getBalancesSnapshot`) и подсчёт активных заявок (`listOpenOrders`).

Запуск собранного скрипта напрямую (переменные окружения аналогичны CLI-варианту):

```bash
TF_TRADES_FILES="examples/_smoke/mini-trades.jsonl" \
TF_DEPTH_FILES="examples/_smoke/mini-depth.jsonl" \
node dist-examples/03-accounts-and-orders/run.js
```

Скрипт завершится выводом маркера `ACC_ORDERS_OK` с балансовой сводкой. Все числа в логах конвертируются обратно в человекочитаемый формат (`fromPriceInt`/`fromQtyInt`).

## REST (curl)

Для работы HTTP API поднимаем сервис:

```bash
pnpm --filter @tradeforge/svc dev
```

По умолчанию сервер слушает `http://localhost:3000`. Все числовые поля (`amount`, `qty`, `price`) передаются строками в десятичном формате — сервер сам преобразует их в фиксированную точность по конфигурации символа.

### Создание аккаунта и депозит

```bash
ACCOUNT_ID=$(curl -s -X POST http://localhost:3000/v1/accounts | jq -r '.accountId')

curl -s -X POST "http://localhost:3000/v1/accounts/$ACCOUNT_ID/deposit" \
  -H 'content-type: application/json' \
  -d '{"currency":"USDT","amount":"1000"}'
```

### Размещение LIMIT-ордера

```bash
ORDER_JSON=$(curl -s -X POST http://localhost:3000/v1/orders \
  -H 'content-type: application/json' \
  -d '{
        "accountId": "'"$ACCOUNT_ID"'",
        "symbol": "BTCUSDT",
        "type": "LIMIT",
        "side": "BUY",
        "qty": "0.030",
        "price": "27000.40"
      }')
ORDER_ID=$(echo "$ORDER_JSON" | jq -r '.id')
```

Проверяем статус ордера и текущие балансы:

```bash
curl -s "http://localhost:3000/v1/orders/$ORDER_ID" | jq
curl -s "http://localhost:3000/v1/accounts/$ACCOUNT_ID/balances" | jq
curl -s "http://localhost:3000/v1/orders/open?accountId=$ACCOUNT_ID&symbol=BTCUSDT" | jq
```

### Отмена ордера

```bash
curl -s -X DELETE "http://localhost:3000/v1/orders/$ORDER_ID" | jq
```

Все ответы сервиса сериализуют `bigint` в строки, поэтому значения полей `free`/`locked` либо `price`/`qty` всегда возвращаются строками. Такое представление можно напрямую сохранять или парсить в удобный формат (например, через `fromPriceInt`/`fromQtyInt` в SDK).
