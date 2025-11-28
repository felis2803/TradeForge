import { expect, test } from '@playwright/test';

const manualBaseURL = `http://localhost:${process.env.MANUAL_FRONTEND_PORT ?? 5174}`;

async function setHistoryRange(
  page: Parameters<typeof test>[0]['page'],
  from: string,
  to: string,
) {
  await page.getByLabel('Период от').fill(from);
  await page.getByLabel('Период до').fill(to);
}

test('handles connection outages, validation, and retry without freezing UI', async ({
  page,
}) => {
  await page.goto(`${manualBaseURL}/`);

  await page.getByLabel('Стартовый баланс (USDT)').fill('50000');
  await page.getByRole('button', { name: 'Подключиться' }).click();

  await page.getByRole('button', { name: 'Симулировать обрыв' }).click();
  const outageBanner = page.getByText(/Данные недоступны/i);
  await expect(outageBanner).toBeVisible();

  await page.getByLabel('Тип ордера').selectOption('limit');
  await page.getByLabel('Размер').fill('0.1');
  await page.getByLabel('Цена').fill('65000');
  await page.getByRole('button', { name: 'Разместить ордер' }).click();

  await expect(
    page.getByText('Данные недоступны — нельзя отправить ордер.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Вернуть поток' }).click();
  await expect(outageBanner).toBeHidden();
  await expect(page.getByText('Поток данных восстановлен')).toBeVisible();

  await page.getByRole('button', { name: 'Разместить ордер' }).click();
  await expect(page.getByText('Отправлен')).toBeVisible();
});

test('blocks invalid ranges, balance, and order parameters', async ({
  page,
}) => {
  await page.goto(`${manualBaseURL}/`);

  await page.getByLabel('Стартовый баланс (USDT)').fill('0');
  await page.getByRole('button', { name: 'Подключиться' }).click();
  await expect(
    page.getByText('Введите положительный стартовый баланс'),
  ).toBeVisible();

  await page.getByLabel('Стартовый баланс (USDT)').fill('25000');
  await page.getByRole('button', { name: 'Исторические' }).click();
  await page.getByRole('button', { name: 'Подключиться' }).click();
  await expect(
    page.getByText('Укажите дату и время начала и окончания периода'),
  ).toBeVisible();

  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  const earlier = new Date(now.getTime() - 60 * 60 * 1000);
  const startBad = later.toISOString().slice(0, 16);
  const endBad = earlier.toISOString().slice(0, 16);
  await setHistoryRange(page, startBad, endBad);
  await page.getByRole('button', { name: 'Подключиться' }).click();
  await expect(
    page.getByText('Дата начала должна быть раньше даты окончания'),
  ).toBeVisible();

  const startOk = now.toISOString().slice(0, 16);
  const endOk = new Date(now.getTime() + 2 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
  await setHistoryRange(page, startOk, endOk);
  await page.getByRole('button', { name: 'Подключиться' }).click();
  await expect(page.getByText(/Историческое воспроизведение/i)).toBeVisible();

  await page.getByLabel('Тип ордера').selectOption('limit');
  await page.getByLabel('Размер').fill('0.0001');
  await page.getByLabel('Цена').fill('0');
  await page.getByRole('button', { name: 'Разместить ордер' }).click();

  const validationList = page
    .getByText('Проверьте заполнение формы')
    .locator('..');
  await expect(validationList).toContainText('Минимальный размер');
  await expect(validationList).toContainText(
    'Цена должна быть положительным числом.',
  );
  await expect(validationList).toContainText('Минимальная сумма сделки');
});

test('restores saved connection preferences on reload', async ({ page }) => {
  await page.goto(`${manualBaseURL}/`);

  await page.getByLabel('Биржа').selectOption('Bybit');
  await page.getByRole('button', { name: 'Исторические' }).click();
  const from = '2024-02-01T10:00';
  const to = '2024-02-02T10:30';
  await setHistoryRange(page, from, to);
  await page.getByLabel('Скорость воспроизведения').selectOption('2x');
  await page.getByLabel('Стартовый баланс (USDT)').fill('12345');

  await page.reload();

  await expect(page.getByLabel('Биржа')).toHaveValue('Bybit');
  await expect(page.getByRole('button', { name: 'Исторические' })).toHaveClass(
    /bg-emerald-500\/20/,
  );
  await expect(page.getByLabel('Период от')).toHaveValue(from);
  await expect(page.getByLabel('Период до')).toHaveValue(to);
  await expect(page.getByLabel('Скорость воспроизведения')).toHaveValue('2x');
  await expect(page.getByLabel('Стартовый баланс (USDT)')).toHaveValue('12345');
});

test('remains responsive during rapid updates and user actions', async ({
  page,
}) => {
  await page.goto(`${manualBaseURL}/`);

  await page.getByLabel('Стартовый баланс (USDT)').fill('90000');
  await page.getByRole('button', { name: 'Подключиться' }).click();

  const instruments = ['ETH/USDT', 'SOL/USDT', 'BTC/USDT'];
  for (let i = 0; i < 2; i += 1) {
    for (const instrument of instruments) {
      await page.getByRole('button', { name: instrument }).click();
    }
  }

  await page.getByRole('button', { name: 'Памп цены' }).click();
  await page.getByRole('button', { name: 'Обвал цены' }).click();
  await page.getByRole('button', { name: 'Пауза' }).click();
  await page.getByRole('button', { name: 'Возобновить' }).click();

  await page.getByLabel('Тип ордера').selectOption('market');
  const sizes = ['0.3', '0.5', '0.7'];
  for (const size of sizes) {
    await page.getByLabel('Размер').fill(size);
    await page.getByRole('button', { name: 'Разместить ордер' }).click();
  }

  const ordersList = page.locator('text=ord-');
  await expect(ordersList.first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Позиции' })).toBeVisible();
});
