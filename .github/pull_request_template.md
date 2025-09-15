# 📌 TradeForge Pull Request

## 📝 Описание

<!-- Кратко опиши, что делает этот PR -->

---

# ✅ PR Review Checklist — TradeForge

## 1️⃣ Структура репо

- [ ] pnpm монорепо (`pnpm-workspace.yaml` с `packages/*` и `apps/*`)
- [ ] Пакеты: `@tradeforge/core`, `@tradeforge/io-binance`; приложение: `@tradeforge/cli`
- [ ] Корневые файлы: `.editorconfig`, `.gitignore`, `LICENSE`, `README.md`, `tsconfig.base.json`, `jest.config.mjs`, `.husky/pre-commit`, `.github/workflows/ci.yml`

## 2️⃣ Node / TypeScript / ESM

- [ ] Везде ESM (`"type": "module"`, `moduleResolution: NodeNext`)
- [ ] `tsconfig.base.json` содержит строгие опции (`strict`, `exactOptionalPropertyTypes`, и т.д.)
- [ ] `target: ES2022`, `lib: ["ES2022"]`

## 3️⃣ Скрипты и пакетный менеджер

- [ ] Корневой `package.json` → `private: true`, `packageManager: pnpm@9`
- [ ] Общие скрипты: `build`, `clean`, `lint`, `format`, `test`, `typecheck`, `prepare`
- [ ] Скрипты работают в каждом пакете

## 4️⃣ Линтинг и форматирование

- [ ] ESLint + `@typescript-eslint`
- [ ] Prettier подключён
- [ ] lint-staged форматирует `json/md/yml` и линтит `ts/js`
- [ ] Husky pre-commit запускает `pnpm lint-staged`

## 5️⃣ Тесты

- [ ] Jest + ts-jest с поддержкой ESM (`useESM: true`)
- [ ] Smoke-тесты во всех пакетах и CLI
- [ ] `pnpm test` проходит локально

## 6️⃣ CI

- [ ] Workflow `ci.yml` запускается на push/PR
- [ ] Шаги: checkout → setup pnpm → setup node@22 → install → build → lint → test
- [ ] CI зелёный

## 7️⃣ CLI

- [ ] `apps/cli/bin/tf.mjs` исполняемый (`chmod +x`)
- [ ] `runCli()` выводит `TradeForge CLI: core-ready`
- [ ] Флаг `--version` выводит `TradeForge CLI v0.1.0`

## 8️⃣ Экспорты пакетов

- [ ] `@tradeforge/core` экспортирует `helloCore` и пустые типы
- [ ] `@tradeforge/io-binance` экспортирует `helloIo`
- [ ] Корректный `exports` и `types` в `package.json` пакетов

## 9️⃣ Документация и лицензия

- [ ] README с базовыми инструкциями (установка/билд/тест/запуск CLI)
- [ ] LICENSE — MIT

## 🔟 Быстрые проверки

- [ ] `pnpm i`
- [ ] `pnpm build`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm --filter @tradeforge/cli dev` → вывод `TradeForge CLI: core-ready`
- [ ] `pnpm --filter @tradeforge/cli dev -- --version` → вывод `TradeForge CLI v0.1.0`

## 1️⃣1️⃣ Соответствие требованиям

- [ ] Только каркас (нет бизнес-логики)
- [ ] ESM везде, единый стиль
- [ ] Структура устойчива для следующих PR

---

### ⚠️ Частые огрехи

- [ ] Пропущен `useESM: true` в ts-jest
- [ ] `bin/tf.mjs` не имеет прав на запуск
- [ ] Несогласованные пути в `exports`/`types`
- [ ] Husky не вызывает lint-staged
- [ ] Нет `lib: ["ES2022"]` в tsconfig
