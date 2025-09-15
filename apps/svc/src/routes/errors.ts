import type { FastifyReply } from 'fastify';
import { NotFoundError, ValidationError } from '@tradeforge/core';

export function handleServiceError(reply: FastifyReply, error: unknown): void {
  if (error instanceof ValidationError) {
    reply.status(400).send({ message: error.message });
    return;
  }
  if (error instanceof NotFoundError) {
    reply.status(404).send({ message: error.message });
    return;
  }
  throw error;
}
