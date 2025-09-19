# jq scripts (SCHEMA=v1)

Набор jq-фильтров для анализа NDJSON-логов TradeForge (схема v1).

## Быстрый старт

```bash
jq -f scripts/jq/extract-fills-v1.jq logs/v1/orders.ndjson | head -n 20
jq -f scripts/jq/summary-v1.jq logs/v1/orders.ndjson
```

> Примечание: для будущей схемы v2 будет добавлена копия фильтров в `scripts/jq-v2/`.
