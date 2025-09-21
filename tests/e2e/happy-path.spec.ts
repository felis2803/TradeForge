import { expect, test } from '@playwright/test';
import WebSocket from 'ws';

const initialBalance = 1_000_000;
const expectedBalance = initialBalance - 100_000 - 10; // price 100000, fee 10

function createEnvelope(type: string, payload: unknown, reqId?: string) {
  return JSON.stringify({ type, ts: Date.now(), payload, reqId });
}

test('operator can configure run and see bot updates', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('spinbutton', { name: 'Maker (bps)' }).fill('1');
  await page.getByRole('spinbutton', { name: 'Taker (bps)' }).fill('1');
  await page
    .getByRole('spinbutton', { name: 'Лимит активных ордеров' })
    .fill('5');
  await page
    .getByRole('spinbutton', { name: 'Таймаут heartbeat (сек)' })
    .fill('6');

  await page.getByRole('button', { name: 'Применить конфигурацию' }).click();
  await expect(page.getByText('Конфигурация обновлена')).toBeVisible();

  await page.getByRole('button', { name: 'Старт' }).click();
  await expect(page.getByText('Текущий статус: running')).toBeVisible();

  const ws = new WebSocket('ws://localhost:3001/ws');

  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      ws.send(
        createEnvelope('hello', {
          botName: 'e2e-bot',
          initialBalanceInt: initialBalance.toString(),
        }),
      );
    });

    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'hello') {
        ws.send(
          createEnvelope('order.place', {
            clientOrderId: `order-${Date.now()}`,
            symbol: 'BTCUSDT',
            side: 'buy',
            type: 'MARKET',
            qtyInt: '1',
            timeInForce: 'GTC',
            flags: [],
          }),
        );
      }
      if (
        message.type === 'balance.update' &&
        message.payload.botName === 'e2e-bot'
      ) {
        if (Number(message.payload.balanceInt) !== initialBalance) {
          resolve();
        }
      }
    });

    ws.on('error', (error) => reject(error));
    ws.on('close', () => reject(new Error('socket closed prematurely')));
  });

  ws.close();

  const row = page.locator('tbody tr').filter({ hasText: 'e2e-bot' });
  await expect(row).toBeVisible();
  await expect
    .poll(async () => {
      const text = await row.locator('td').nth(1).innerText();
      return text.replace(/[^0-9-]/g, '');
    })
    .toBe(initialBalance.toString());
  await expect
    .poll(async () => {
      const text = await row.locator('td').nth(2).innerText();
      return text.replace(/[^0-9-]/g, '');
    })
    .toBe(expectedBalance.toString());
});
