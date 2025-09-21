import { expect, test } from '@playwright/test';
import WebSocket from 'ws';

function createEnvelope(type: string, payload: unknown, reqId?: string) {
  return JSON.stringify({ type, ts: Date.now(), payload, reqId });
}

test('bot hits rate limit and reconnects successfully', async ({ page }) => {
  await page.goto('/');

  await page
    .getByRole('spinbutton', { name: 'Лимит активных ордеров' })
    .fill('1');
  await page
    .getByRole('spinbutton', { name: 'Таймаут heartbeat (сек)' })
    .fill('2');

  await page.getByRole('button', { name: 'Применить конфигурацию' }).click();
  await expect(page.getByText('Конфигурация обновлена')).toBeVisible();

  await page.getByRole('button', { name: 'Старт' }).click();
  await expect(page.getByText('Текущий статус: running')).toBeVisible();

  const botName = 'rate-bot';
  const initialBalance = '100000';
  const firstSocket = new WebSocket('ws://localhost:3001/ws');

  const rateLimitPromise = new Promise<void>((resolve, reject) => {
    firstSocket.on('open', () => {
      firstSocket.send(
        createEnvelope('hello', {
          botName,
          initialBalanceInt: initialBalance,
        }),
      );
    });

    firstSocket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'hello') {
        firstSocket.send(
          createEnvelope('order.place', {
            clientOrderId: `limit-${Date.now()}`,
            symbol: 'BTCUSDT',
            side: 'buy',
            type: 'LIMIT',
            qtyInt: '1',
            priceInt: '100000',
            timeInForce: 'GTC',
            flags: [],
          }),
        );
        return;
      }
      if (message.type === 'order.ack') {
        firstSocket.send(
          createEnvelope('order.place', {
            clientOrderId: `limit-${Date.now()}-extra`,
            symbol: 'BTCUSDT',
            side: 'buy',
            type: 'LIMIT',
            qtyInt: '1',
            priceInt: '100000',
            timeInForce: 'GTC',
            flags: [],
          }),
        );
        return;
      }
      if (
        message.type === 'order.reject' &&
        message.payload?.code === 'RATE_LIMIT'
      ) {
        resolve();
      }
    });

    firstSocket.on('error', (error) => reject(error));
  });

  await rateLimitPromise;
  firstSocket.close();
  await new Promise((resolve) => firstSocket.once('close', resolve));

  await new Promise((resolve) => setTimeout(resolve, 2500));

  const reconnectSocket = new WebSocket('ws://localhost:3001/ws');
  const reconnectPromise = new Promise<void>((resolve, reject) => {
    reconnectSocket.on('open', () => {
      reconnectSocket.send(
        createEnvelope('hello', {
          botName,
          initialBalanceInt: initialBalance,
        }),
      );
    });

    reconnectSocket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (
        message.type === 'balance.update' &&
        message.payload?.botName === botName &&
        `${message.payload.balanceInt}` === initialBalance
      ) {
        resolve();
      }
    });

    reconnectSocket.on('error', (error) => reject(error));
  });

  await reconnectPromise;
  reconnectSocket.close();
  await new Promise((resolve) => reconnectSocket.once('close', resolve));

  const row = page.locator('tbody tr').filter({ hasText: botName });
  await expect(row).toBeVisible();

  await expect
    .poll(async () => {
      const text = await row.locator('td').nth(1).innerText();
      return text.replace(/[^0-9-]/g, '');
    })
    .toBe(initialBalance);

  await expect
    .poll(async () => {
      const text = await row.locator('td').nth(2).innerText();
      return text.replace(/[^0-9-]/g, '');
    })
    .toBe(initialBalance);
});
