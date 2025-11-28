import { expect, test } from '@playwright/test';

const manualBaseURL = `http://localhost:${process.env.MANUAL_FRONTEND_PORT ?? 5174}`;

function parseNumber(value: string) {
  return Number(value.replace(/[^0-9+\-.,]/g, '').replace(',', '.'));
}

function computeLiqPrice(avgPrice: number, size: number, markPrice: number) {
  const reference = Math.min(avgPrice, markPrice);
  const riskClamp = Math.max(0.35, 0.6 - Math.min(0.2, Math.abs(size) * 0.01));
  return Number((reference * riskClamp).toFixed(2));
}

test('positions react to orders, instrument switches, and position controls', async ({
  page,
}) => {
  await page.goto(`${manualBaseURL}/`);

  await page.getByRole('button', { name: 'Пауза' }).click();

  await page.getByLabel('Размер').fill('0.25');
  await page.getByLabel('Цена').fill('66000');
  await page.getByRole('button', { name: 'Разместить ордер' }).click();

  const positionsCard = page
    .getByRole('heading', { name: 'Позиции' })
    .locator('xpath=../..');
  const btcRow = positionsCard
    .locator('div')
    .filter({ hasText: 'BTC/USDT' })
    .first();

  await expect(btcRow).toBeVisible();

  await expect
    .poll(async () => {
      const text = await btcRow.innerText();
      const match = text.match(/Размер:\s*([0-9.,-]+)/);
      return match ? parseNumber(match[1]) : 0;
    })
    .toBeCloseTo(0.75, 2);

  const btcText = await btcRow.innerText();
  const avgMatch = btcText.match(/Средняя цена:\s*([0-9.,]+)/);
  expect(avgMatch).not.toBeNull();
  const avgPrice = parseNumber(avgMatch![1]);
  expect(avgPrice).toBeGreaterThan(65000);

  const markMatch = btcText.match(/Mark:\s*([0-9.,]+)/);
  expect(markMatch).not.toBeNull();
  const markPrice = parseNumber(markMatch![1]);

  const liqMatch = btcText.match(/Ликвидация:\s*([0-9.,]+)/);
  expect(liqMatch).not.toBeNull();
  const liqPrice = parseNumber(liqMatch![1]);
  expect(liqPrice).toBeCloseTo(computeLiqPrice(avgPrice, 0.75, markPrice), 0);

  const pnlMatch = btcText.match(/PnL:\s*([+\-]?[0-9.,]+)/);
  expect(pnlMatch).not.toBeNull();
  const pnlValue = parseNumber(pnlMatch![1]);
  expect(pnlValue).toBeGreaterThanOrEqual(0);

  await page.getByRole('button', { name: 'ETH/USDT' }).click();
  await page.getByLabel('Размер').fill('2');
  await page.getByLabel('Цена').fill('2900');
  await page.getByRole('button', { name: 'Разместить ордер' }).click();

  const ethRow = positionsCard
    .locator('div')
    .filter({ hasText: 'ETH/USDT' })
    .first();
  await expect(ethRow).toBeVisible();
  await expect(ethRow.getByText('2.000')).toBeVisible();

  await page.getByRole('button', { name: 'BTC/USDT' }).click();
  await expect(btcRow).toBeVisible();
  await expect(
    positionsCard.locator('div').filter({ hasText: 'ETH/USDT' }),
  ).toBeVisible();

  await ethRow.getByRole('button', { name: 'Закрыть' }).click();
  await expect(
    positionsCard.locator('div').filter({ hasText: 'ETH/USDT' }),
  ).toHaveCount(0);

  await btcRow.getByRole('button', { name: 'Реверс' }).click();
  await expect
    .poll(async () => {
      const text = await btcRow.innerText();
      const match = text.match(/Размер:\s*([0-9.,-]+)/);
      return match ? parseNumber(match[1]) : 0;
    })
    .toBeLessThan(0);

  const history = positionsCard.locator('text=История действий');
  const historyContainer = history.locator('xpath=..');
  await expect(historyContainer.getByText('История действий')).toBeVisible();
  await expect(historyContainer.getByText('закрыта')).toBeVisible();
  await expect(historyContainer.getByText('развернута')).toBeVisible();
});
