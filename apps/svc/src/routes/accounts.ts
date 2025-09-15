import type { FastifyInstance } from 'fastify';
import { type AccountId, toPriceInt, toQtyInt } from '@tradeforge/core';
import type { ServiceContext } from '../server.js';
import { serializeBigInt } from '../utils.js';
import { handleServiceError } from './errors.js';

interface DepositBody {
  currency: string;
  amount: string;
}

function resolveAmount(
  ctx: ServiceContext,
  currency: string,
  amount: string,
): bigint {
  for (const symbol of Object.values(ctx.state.symbols)) {
    if (symbol.base === currency) {
      return toQtyInt(amount, symbol.qtyScale);
    }
    if (symbol.quote === currency) {
      return toPriceInt(amount, symbol.priceScale);
    }
  }
  // Неизвестная валюта — явная ошибка валидации для детерминизма
  throw new Error(`unknown currency: ${currency}`);
}

export function registerAccountsRoutes(
  app: FastifyInstance,
  ctx: ServiceContext,
): void {
  app.post('/v1/accounts', async (_request, reply) => {
    const account = ctx.accounts.createAccount();
    reply.send({ accountId: account.id });
  });

  app.get('/v1/accounts/:id/balances', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const balances = ctx.accounts.getBalancesSnapshot(id as AccountId);
      reply.send(serializeBigInt(balances));
    } catch (err) {
      handleServiceError(reply, err);
      return;
    }
  });

  app.post('/v1/accounts/:id/deposit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as DepositBody;
    if (
      !body ||
      typeof body.currency !== 'string' ||
      typeof body.amount !== 'string'
    ) {
      return reply
        .status(400)
        .send({ message: 'currency and amount are required' });
    }
    try {
      const amount = resolveAmount(ctx, body.currency, body.amount);
      const balance = ctx.accounts.deposit(
        id as AccountId,
        body.currency,
        amount,
      );
      reply.send(serializeBigInt(balance));
    } catch (err) {
      // Преобразуем наше сообщение об ошибке в 400 Bad Request
      if (err instanceof Error && /unknown currency/.test(err.message)) {
        return reply.status(400).send({ message: err.message });
      }
      handleServiceError(reply, err);
      return;
    }
  });
}
