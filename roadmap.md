## 🚀 Дорожная карта TradeForge v1 (фактическая)

### Этап 1. Базовая инфраструктура — ✅ выполнен

- [x] Каркас проекта (TypeScript, Node.js)
- [x] Тестовая среда (Jest или аналог)
- [ ] Загрузка архивов Binance Data Portal (BTCUSDT trades + L2 diff depth)
- [~] Простая структура данных в памяти (ордербук + список сделок)

---

### Этап 2. Эмулятор рынка — 🟡 частично

- [~] Консервативная модель исполнения ордеров  
  (ордер исполняется, только если исторические сделки перекрывают цену)
- [~] Поддержка лимитных и рыночных ордеров
- [~] Баланс и PnL-учёт (без плеча)
- [ ] Простая комиссия (фиксированный %)

---

### Этап 3. Расширенные ордера — ❌ не реализован

- [ ] Стоп-ордера (stop-market, stop-limit)
- [ ] IOC/FOK/GTC (политики исполнения)
- [ ] Частичное исполнение ордеров

---

### Этап 4. Многопользовательский режим — ❌ не реализован

- [ ] Отдельные аккаунты и балансы
- [ ] Независимая история сделок и ордеров
- [ ] Параллельное тестирование нескольких ботов

---

### Этап 5. SDK (TypeScript) — 🟡 частично

- [~] API для управления песочницей  
  (`createSandbox()`, `placeOrder()`, `cancelOrder()`, `getBalance()`)
- [ ] Builder-паттерн настройки песочницы
- [x] Интеграционные примеры: простые боты (например, random-trader)

---

### Этап 6. Детерминизм и производительность — ❌ не реализован

- [ ] Фикс-поинт арифметика (целые числа для цен/количеств)
- [ ] Настраиваемая скорость прогона (реальное время, x2, «максимально быстро»)
- [ ] Реплей с фиксированным seed и жёсткой синхронизацией событий

---

### Этап 7. Сохранение данных — 🟡 частично

- [ ] Экспорт результатов прогона (JSON/CSV)
- [~] Логи исполнений и состояния ордербука
- [ ] Возможность «переиграть» сценарий с теми же настройками

```mermaid
flowchart LR
  %% ---------- STAGE 1 ----------
  subgraph S1[Stage 1 — Base]
    S1D[Binance archives loader]
    S1O[In-memory orderbook & trades]
  end

  %% ---------- STAGE 2 ----------
  subgraph S2[Stage 2 — Emulator]
    S2E[Conservative execution model]
    S2ML[Limit & market orders]
    S2P[Balance & PnL]
    S2F[Simple fee %]
  end

  %% ---------- STAGE 3 ----------
  subgraph S3[Stage 3 — Advanced orders]
    S3S[Stop orders]
    S3T[IOC / FOK / GTC]
    S3PF[Partial fills]
  end

  %% ---------- STAGE 5 ----------
  subgraph S5[Stage 5 — SDK]
    S5A[SDK API]
    S5B[Builder pattern]
  end

  %% ---------- STAGE 4 ----------
  subgraph S4[Stage 4 — Multi-user]
    S4A[Accounts & balances]
    S4H[Separate histories]
    S4P[Parallel bot testing]
  end

  %% ---------- STAGE 6 ----------
  subgraph S6[Stage 6 — Determinism & perf]
    S6FP[Fixed-point arithmetic]
    S6V[Speed control]
    S6R[Seeded replay]
  end

  %% ---------- STAGE 7 ----------
  subgraph S7[Stage 7 — Persistence]
    S7E[Export JSON / CSV]
    S7L[Exec & orderbook logs]
    S7RS[Scenario replay]
  end

  %% ---------- DEPENDENCIES ----------
  S1O --> S2E
  S1O --> S2ML
  S1D --> S2E

  S2E --> S2P
  S2ML --> S2P
  S2P --> S2F

  S2E --> S3S
  S2ML --> S3S
  S2E --> S3T
  S2ML --> S3T
  S2E --> S3PF
  S2ML --> S3PF

  S2ML --> S5A
  S5A --> S5B

  S2P --> S4A
  S4A --> S4H
  S5A --> S4P

  S1O --> S6FP
  S2ML --> S6FP
  S2E --> S6V
  S2E --> S6R

  S2E --> S7L
  S7L --> S7E
  S7L --> S7RS
  S6R --> S7RS

  %% ---------- STYLING (status) ----------
  classDef partial fill:#fff6cc,stroke:#c9a400,stroke-width:1px;
  classDef missing fill:#ffe6e6,stroke:#cc0000,stroke-width:1px;

  %% Частично готово:
  class S1O,S2E,S2ML,S2P,S5A,S7L partial;

  %% Не реализовано:
  class S1D,S2F,S3S,S3T,S3PF,S4A,S4H,S4P,S5B,S6FP,S6V,S6R,S7E,S7RS missing;
```

Коротко, что можно тянуть параллельно уже сейчас:

* **S1D (загрузчик Binance)** и **S1O (ордербук)** — независимы, можно вести двумя потоками.
* На базе **S1O** — параллелить **S2E** и **S2ML** (две команды на исполнение и поддержку типов ордеров).
* После появления базового исполнения (**S2E/S2ML**) разделить работу:
  — **S2P (PnL/баланс)** → затем **S2F (комиссия)**,
  — **S7L (логи)** → потом **S7E (экспорт)** и **S7RS (реплей сценариев)**,
  — **S5A (SDK API)** → затем **S5B (builder)**.
* **S6FP (fixed-point)** можно начинать после стабилизации интерфейсов ордербука и базовых ордеров (S1O + S2ML), не дожидаясь расширенных ордеров.
* **S6V/S6R (скорость и seeded-replay)** — поверх базового цикла симуляции (S2E).
