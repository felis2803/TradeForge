# План PR B1 — `feat/sim-engine-conservative-exec`

## 1. Цель и критерии приёма

### 1.1 Цель

Построить минимально жизнеспособный симуляционный движок, который:

- читает исторические потоки `trades` и `depth` из A1 и поддерживает L2-ордербук из A2;
- принимает заявки (`limit`/`market`) и отмены (`cancel`);
- консервативно исполняет `limit`, только если реальный трейд прошёл через цену заявки по стороне;
- генерирует детерминированные события `orderAccepted` / `orderUpdated` / `orderFilled` / `orderRejected` / `orderCanceled`.

### 1.2 Acceptance Criteria

1. **BUY limit** по 10000 не исполняется до появления трейда с ценой ≤ 10000; после такого трейда заявка исполняется на доступном объёме, не хуже лимит-цены (см. §4).
2. **SELL limit** по 12000 исполняется только при трейде ≥ 12000.
3. **Market**-заявки исполняются сразу по текущей ликвидности книги на лучшей встречной стороне, без ожидания трейда.
4. При отсутствии ликвидности `market` исполняется частично до глубины `maxSlippageLevels`, остаток остаётся открытым (или отклоняется, если `rejectOnExhaustedLiquidity=true`).
5. Нет `fill`-событий без трейда, разрешившего цену (для `limit`).
6. Детерминизм: одинаковый вход ⇒ одинаковая последовательность событий и хэшей (один поток, фиксированный порядок).

## 2. Архитектура и контракты

### 2.1 Пакет

Новый пакет `@tradeforge/sim`.

### 2.2 Публичный API (TypeScript)

```ts
export type Side = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';

export interface SubmitOrder {
  clientId?: string;
  type: OrderType;
  side: Side;
  qty: bigint;
  price?: bigint;
  ts?: number;
}

export interface EngineEvents {
  orderAccepted(o: OrderView): void;
  orderUpdated(o: OrderView): void;
  orderFilled(f: FillEvent): void;
  orderCanceled(o: OrderView): void;
  orderRejected(r: RejectEvent): void;
  tradeSeen(t: Trade): void;
}

export interface Engine {
  submitOrder(o: SubmitOrder): string;
  cancelOrder(orderId: string): boolean;
  on<E extends keyof EngineEvents>(ev: E, cb: EngineEvents[E]): () => void;
  close(): Promise<void>;
}

export function createEngine(opts: {
  streams: {
    trades: AsyncIterable<Trade>;
    depth: AsyncIterable<DepthDiff>;
  };
  book: OrderBook;
  clock?: Clock;
  policy?: ConservativePolicyConfig;
  liquidity?: LiquidityConfig;
}): Engine;
```

### 2.3 Входные модели (адаптеры к A1/A2)

```ts
export interface Trade {
  ts: number;
  price: bigint;
  qty: bigint;
  side: Side;
}

export interface DepthDiff {
  ts: number;
  seq: number;
  bids: [price: bigint, qty: bigint][];
  asks: [bigint, bigint][];
}

export interface OrderBook {
  applyDiff(d: DepthDiff): void;
  getSnapshot(depth?: number): Snapshot;
  // ...
}
```

### 2.4 Консервативная политика

```ts
export interface ConservativePolicyConfig {
  enableConservativeForLimit: boolean;
  tradeStalenessMs: number;
}
```

- BUY LIMIT разрешается трейдом с `price <= limitPrice` в пределах `tradeStalenessMs`.
- SELL LIMIT разрешается трейдом с `price >= limitPrice` в пределах окна свежести.

### 2.5 Ликвидность/слиппедж market

```ts
export interface LiquidityConfig {
  maxSlippageLevels: number;
  rejectOnExhaustedLiquidity: boolean;
}
```

### 2.6 Внутренние подсистемы

- **EventLoop** — единая очередь событий (`depth`, `trades`, `submit`, `cancel`) с гарантированным порядком.
- **OrderStore** — хранение состояний заявок, остатков, статусов.
- **Matcher**:
  - **ConservativeGate** — проверка допуска лимит-заявок по трейдам.
  - **LiquidityPlanner** — выбор уровней книги для исполнения, гарантируя цену не хуже лимита.
- **FillGenerator** — нарезка заявок на `fills`, расчёт остатков.
- **Emit** — марshalling событий наружу в одном месте.

## 3. Порядок обработки событий

1. **Depth**: `applyDiff` → обновление книги и `lastSeq/ts`.
2. **Trade**: кеширование `lastTradeBySide`, эмит `tradeSeen`.
3. **Submit LIMIT**:
   - регистрация ордера в `OrderStore`.
   - проверка `ConservativeGate`.
   - без разрешающего трейда ордер ждёт в книге симулятора.
   - с разрешающим трейдом — матчинг (см. §4).
4. **Новый Trade**:
   - отмечаем трейд;
   - переоцениваем LIMIT, у которых цена стала разрешённой;
   - матчинг в фиксированном порядке.
5. **Submit MARKET**: немедленный матчинг против книги (см. §4).
6. **Cancel**: установка статуса `CANCELED`, возврат остатка.

## 4. Алгоритм матчинга

### 4.1 LIMIT BUY

- Требует трейда `price <= P` в окне свежести.
- Использует ASK-уровни `<= P`, порядок по цене ↑ и времени.
- Не допускает исполнение хуже лимит-цены.
- Генерирует `fills` по уровням до исчерпания объёма или ликвидности.
- Остаток остаётся, если политика разрешает.

### 4.2 LIMIT SELL

- Симметрично LIMIT BUY: BID-уровни `>= P`, порядок по цене ↓.

### 4.3 MARKET BUY/SELL

- Снимает уровни встречной стороны начиная с лучшей цены.
- Ограничение глубины — `maxSlippageLevels`.
- При исчерпании ликвидности: остаток остаётся или отклоняется (`rejectOnExhaustedLiquidity`).

## 5. Инварианты

- **I1.** Нет `fill` без разрешающего трейда для LIMIT.
- **I2.** Цена исполнения не хуже лимита.
- **I3.** Детерминированный порядок событий: FIFO и единая очередь.
- **I4.** `bestBid <= bestAsk`, если обе стороны непусты.
- **I5.** Монотонность `seq` / `ts` книги.
- **I6.** Неотрицательные остатки заявок и уровней.
- **I7.** Идемпотентность `cancel`.

## 6. План имплементации (коммиты)

1. `chore(sim): scaffold + types + event bus`
2. `feat(sim): event loop + adapters to A1/A2`
3. `feat(sim): order store`
4. `feat(sim): conservative gate`
5. `feat(sim): liquidity planner + matcher`
6. `feat(sim): fill generator + market path`
7. `test(sim): unit + integration`
8. `test(sim): e2e mini + determinism + perf soft`
9. `docs(sim): README + examples`
10. `ci: add sim jobs + artifacts`

## 7. Набор тестов

### 7.1 Юнит

- `ConservativeGate`: допустимость BUY/SELL, проверка окна свежести.
- `LiquidityPlanner`: выбор уровней по лимит-цене, edge-кейсы пустой книги.
- `FillGenerator`: частичное/полное исполнение, отсутствие округлений до нуля.

### 7.2 Интеграционные

- Соответствие AC-1/AC-2: LIMIT до и после трейда.
- AC-3: немедленное исполнение MARKET.
- AC-4: MARKET при исчерпании ликвидности с разными политиками.
- Отмена до трейда: `cancel` без `fills`.
- Out-of-order input: проверка корректного порядка.

### 7.3 Property/Fuzz

- **P1:** ни один LIMIT-fill без разрешающего трейда.
- **P2:** цена исполнения не хуже лимита, остатки не отрицательны.
- **P3:** повторный прогон с тем же seed → идентичный поток событий.

### 7.4 E2E

- Миникейс с A1/A2 (BTCUSDT): сценарий заявок, сравнение эталонного журнала.

## 8. Логи и диагностика

- Внутренний NDJSON-лог событий: `depth`, `trade`, `submit`, `fill`, `cancel`, `reject`, `update`.
- Поля: `t`, `ts`, `seq?`, `orderId?`, `price`, `qty`, `side`, `reason?`.
- Хуки `Engine.on` для внешнего логирования (используется в C1).

## 9. Производительность и детерминизм

- Цель: ≥ 50k событий/сек на Node 20.
- Метрики: время обработки 10k событий, GC-паузы, число аллокаций.
- Детерминизм: один поток, порядок «trade → state → pending LIMIT → events».

## 10. CI и артефакты

- Матрица Node: `18.x`, `20.x`.
- Шаги:
  1. `pnpm -r build`
  2. `pnpm -r test -- --reporters=default --coverage`
  3. Двойной запуск determinism-test с одинаковым seed и сравнение хэшей.
  4. Перф-замер (soft) с логированием времени и fail при превышении порога.
- Артефакты: `sim-tests.log`, `determinism.hash`.

## 11. Документация

- `packages/sim/README.md`:
  - Быстрый старт.
  - Раздел про `Conservative matching` с примерами.
  - Таблица инвариантов и рекомендации по устранению проблем.
  - FAQ: «почему мой LIMIT не исполнился?»

## 12. Риски и смягчения

- Стареющие трейды — параметр `tradeStalenessMs`, тесты на границах.
- Разрыв между depth и trades — единый EventLoop, варнинги для старой книги.
- Память на pending LIMIT — лимиты очереди, планы по авто-отмене (флаг/фича позже).

## 13. Разбиение на шаги внутри PR

1. `chore(sim): scaffold + types + event bus`
2. `feat(sim): event loop + adapters to A1/A2`
3. `feat(sim): order store`
4. `feat(sim): conservative gate`
5. `feat(sim): liquidity planner + matcher`
6. `feat(sim): fill generator + market path`
7. `test(sim): unit + integration`
8. `test(sim): e2e mini + determinism + perf soft`
9. `docs(sim): README + examples`
10. `ci: add sim jobs + artifacts`
