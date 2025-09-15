import type { FastifyInstance } from 'fastify';
import {
  type AccountId,
  type OrderId,
  type PlaceOrderInput,
  type SymbolId,
  toPriceInt,
  toQtyInt,
} from '@tradeforge/core';
import type { ServiceContext } from '../server.js';
import { serializeBigInt } from '../utils.js';
import { handleServiceError } from './errors.js';

interface PlaceOrderBody {
  accountId: string;
  symbol: string;
  type: PlaceOrderInput['type'];
  side: PlaceOrderInput['side'];
  qty: string;
  price?: string;
  tif?: PlaceOrderInput['tif'];
}

function getScales(
  ctx: ServiceContext,
  symbol: string,
): { priceScale: number; qtyScale: number } {
  const cfg = ctx.state.getSymbolConfig(symbol as SymbolId);
  if (cfg) {
    return { priceScale: cfg.priceScale, qtyScale: cfg.qtyScale };
  }
  return { priceScale: 0, qtyScale: 0 };
}

export function registerOrdersRoutes(
  app: FastifyInstance,
  ctx: ServiceContext,
): void {
  app.get('/v1/orders/open', async (request, reply) => {
    const query = request.query as { accountId?: string; symbol?: string };
    if (!query.accountId) {
      reply.status(400).send({ message: 'accountId is required' });
      return;
    }
    try {
      const orders = ctx.orders.listOpenOrders(
        query.accountId as AccountId,
        query.symbol ? (query.symbol as SymbolId) : undefined,
      );
      reply.send(serializeBigInt(orders));
    } catch (err) {
      handleServiceError(reply, err);
      return;
    }
  });

  app.post('/v1/orders', async (request, reply) => {
    const body = request.body as PlaceOrderBody;
    if (
      !body ||
      typeof body.accountId !== 'string' ||
      typeof body.symbol !== 'string' ||
      typeof body.type !== 'string' ||
      typeof body.side !== 'string' ||
      typeof body.qty !== 'string'
    ) {
      reply.status(400).send({ message: 'invalid body' });
      return;
    }
    const { priceScale, qtyScale } = getScales(ctx, body.symbol);
    try {
      const qty = toQtyInt(body.qty, qtyScale);
      const price =
        body.price !== undefined
          ? toPriceInt(body.price, priceScale)
          : undefined;
      const input: PlaceOrderInput = {
        accountId: body.accountId as AccountId,
        symbol: body.symbol as SymbolId,
        type: body.type as PlaceOrderInput['type'],
        side: body.side as PlaceOrderInput['side'],
        qty,
        tif: body.tif ?? 'GTC',
      };
      if (price !== undefined) {
        input.price = price;
      }
      const order = ctx.orders.placeOrder(input);
      reply.send(serializeBigInt(order));
    } catch (err) {
      handleServiceError(reply, err);
      return;
    }
  });

  app.get('/v1/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const order = ctx.orders.getOrder(id as OrderId);
      reply.send(serializeBigInt(order));
    } catch (err) {
      handleServiceError(reply, err);
      return;
    }
  });

  app.delete('/v1/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const order = ctx.orders.cancelOrder(id as OrderId);
      reply.send(serializeBigInt(order));
    } catch (err) {
      handleServiceError(reply, err);
      return;
    }
  });
}
