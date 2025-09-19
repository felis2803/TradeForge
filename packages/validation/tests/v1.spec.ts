import { describe, expect, it } from 'vitest';
import {
  validateTradeV1,
  validateDepthL2DiffV1,
  validateCheckpointV1,
  validateLogV1,
  validateMetricV1,
} from '../src/index.js';

describe('schemas v1 validation', () => {
  it('trade ok', () => {
    const ok = validateTradeV1({
      ts: 1,
      symbol: 'BTCUSDT',
      price: '50000',
      qty: 1,
      side: 'BUY',
      id: 123,
    });
    expect(ok).toBe(true);
  });

  it('trade error on missing fields', () => {
    const ok = validateTradeV1({});
    expect(ok).toBe(false);
    expect(validateTradeV1.errors).toBeTruthy();
  });

  it('depth ok', () => {
    const ok = validateDepthL2DiffV1({
      ts: 1,
      symbol: 'BTCUSDT',
      bids: [['50000', '1']],
      asks: [['50010', '2']],
    });
    expect(ok).toBe(true);
  });

  it('checkpoint ok (minimal)', () => {
    const ok = validateCheckpointV1({
      version: 1,
      createdAtMs: 1,
      meta: { symbol: 'BTCUSDT' },
      cursors: { trades: { file: 'trades.jsonl', recordIndex: 0 } },
      merge: {},
      engine: {},
      state: {},
    });
    expect(ok).toBe(true);
  });

  it('log ok (fill)', () => {
    const ok = validateLogV1({
      ts: 1,
      kind: 'FILL',
      orderId: 'o1',
      fill: {
        price: '50000',
        qty: '1',
        side: 'BUY',
        liquidity: 'MAKER',
      },
    });
    expect(ok).toBe(true);
  });

  it('metric ok', () => {
    const ok = validateMetricV1({ ts: 1, name: 'pnl', value: '10' });
    expect(ok).toBe(true);
  });
});
