# @tradeforge/validation

AJV-валидаторы для артефактов TradeForge. Пакет использует схемы из `@tradeforge/schemas` и поставляется с готовыми функциями `validate*V1`.

## Установка

```bash
pnpm add @tradeforge/validation
```

## Использование

```ts
import { validateLogV1 } from '@tradeforge/validation';

const ok = validateLogV1({
  ts: Date.now(),
  kind: 'FILL',
  price: '100',
  qty: '1',
});
if (!ok) {
  console.warn(validateLogV1.errors);
}
```

Функции возвращают `true/false` и заполняют `errors`, как описано в документации AJV.
