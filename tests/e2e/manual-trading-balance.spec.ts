import { expect, test } from '@playwright/test';

const manualBaseURL = `http://localhost:${process.env.MANUAL_FRONTEND_PORT ?? 5174}`;
const FEE_RATE = 0.0004;

function parseNumber(value: string) {
  return Number(value.replace(/[^0-9+\-.,]/g, '').replace(',', '.'));
}

async function readBalance(page: Parameters<typeof test>[0]['page']) {
  const balanceCard = page.getByText('Баланс').first().locator('..');
  const valueText = await balanceCard.locator('text=USDT').first().innerText();
  return parseNumber(valueText);
}

async function readPositionDetails(
  row: ReturnType<Parameters<typeof test>[0]['page']['locator']>,
) {
  const text = await row.innerText();
  const sizeMatch = text.match(/Размер:\s*([0-9.,-]+)/);
  const markMatch = text.match(/Mark:\s*([0-9.,]+)/);
  const pnlMatch = text.match(/PnL:\s*([+\-]?[0-9.,]+)/);
  const liqMatch = text.match(/Ликвидация:\s*([0-9.,]+)/);

  return {
    size: sizeMatch ? parseNumber(sizeMatch[1]) : 0,
    markPrice: markMatch ? parseNumber(markMatch[1]) : 0,
    pnl: pnlMatch ? parseNumber(pnlMatch[1]) : 0,
    liq: liqMatch ? parseNumber(liqMatch[1]) : 0,
  };
}

test('balance reacts to fills, PnL/margin update with price swings', async ({
  page,
}) => {
  await page.goto(`${manualBaseURL}/`);

  await page.getByLabel('Стартовый баланс (USDT)').fill('75000');
  await page.getByRole('button', { name: 'Подключиться' }).click();

  const startingBalance = await readBalance(page);
  expect(startingBalance).toBeGreaterThan(74900);

  await page.getByLabel('Тип ордера').selectOption('market');
  await page.getByLabel('Размер').fill('1');
  await page.getByRole('button', { name: 'Разместить ордер' }).click();

  const positionsCard = page
    .getByRole('heading', { name: 'Позиции' })
    .locator('xpath=../..');
  const btcRow = positionsCard
    .locator('div')
    .filter({ hasText: 'BTC/USDT' })
    .first();
  await expect(btcRow).toBeVisible();

  const detailsAfterFill = await readPositionDetails(btcRow);
  const notional = detailsAfterFill.markPrice * 1;
  const expectedBalance = startingBalance - notional * (1 + FEE_RATE);

  await expect
    .poll(async () => readBalance(page))
    .toBeCloseTo(expectedBalance, 1);

  const pnlBeforePump = detailsAfterFill.pnl;
  await page.getByRole('button', { name: 'Памп цены' }).click();

  await expect
    .poll(async () => {
      const refreshed = await readPositionDetails(btcRow);
      return refreshed.pnl;
    })
    .toBeGreaterThan(pnlBeforePump);

  await page.getByRole('button', { name: 'Обвал цены' }).click();

  await expect(
    positionsCard.locator('div').filter({ hasText: 'BTC/USDT' }),
  ).toHaveCount(0);
  await expect(page.getByText(/ликвидирована/i)).toBeVisible();
});
