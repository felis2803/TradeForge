import type { RawData } from 'ws';
import type { DepthDiff, Trade, SymbolId } from '@tradeforge/core';
import {
  createLiveTradeStream,
  createLiveDepthStream,
  type WebSocketConstructor,
} from '../src/live.js';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  public readyState = 1;
  public sent: string[] = [];
  private listeners: {
    open: Array<() => void>;
    message: Array<(data: RawData) => void>;
    close: Array<(code: number, reason: Buffer) => void>;
    error: Array<(err: Error) => void>;
  } = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: RawData) => void): this;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(
    event: 'open' | 'message' | 'close' | 'error',
    listener:
      | (() => void)
      | ((data: RawData) => void)
      | ((code: number, reason: Buffer) => void)
      | ((err: Error) => void),
  ): this {
    switch (event) {
      case 'open':
        this.listeners.open.push(listener as () => void);
        break;
      case 'message':
        this.listeners.message.push(listener as (data: RawData) => void);
        break;
      case 'close':
        this.listeners.close.push(
          listener as (code: number, reason: Buffer) => void,
        );
        break;
      case 'error':
        this.listeners.error.push(listener as (err: Error) => void);
        break;
    }
    return this;
  }

  emitOpen(): void {
    for (const listener of this.listeners.open) {
      listener();
    }
  }

  emitMessage(payload: unknown): void {
    const data =
      typeof payload === 'string' ? payload : JSON.stringify(payload, null, 0);
    for (const listener of this.listeners.message) {
      listener(Buffer.from(data));
    }
  }

  emitClose(code = 1000, reason = ''): void {
    this.readyState = 3;
    for (const listener of this.listeners.close) {
      listener(code, Buffer.from(reason));
    }
  }

  emitError(err: Error): void {
    for (const listener of this.listeners.error) {
      listener(err);
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }
}

describe('createLiveTradeStream', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  test('normalizes aggTrade payloads', async () => {
    const stream = createLiveTradeStream({
      symbol: 'BTCUSDT' as SymbolId,
      WebSocketCtor: MockWebSocket as unknown as WebSocketConstructor,
      retry: { maxAttempts: 1 },
    });
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();
    ws.emitOpen();
    const iterator = stream[Symbol.asyncIterator]();
    const next = iterator.next();
    ws.emitMessage({
      e: 'aggTrade',
      T: 1_700_000_000_000,
      p: '100.12',
      q: '0.5',
      a: 42,
      m: true,
    });
    const { value } = await next;
    expect(value.price).toBe(10012000n);
    expect(value.qty).toBe(500000n);
    expect(value.ts).toBe(1_700_000_000_000);
    expect((value as Trade & { seq?: number }).seq).toBe(42);
    await iterator.return?.();
  });

  test('applies throttle rate limiting', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    try {
      const stream = createLiveTradeStream({
        symbol: 'BTCUSDT' as SymbolId,
        WebSocketCtor: MockWebSocket as unknown as WebSocketConstructor,
        retry: { maxAttempts: 1 },
        rateLimit: { mode: 'throttle', intervalMs: 100 },
      });
      const ws = MockWebSocket.instances[0];
      ws.emitOpen();
      const iterator = stream[Symbol.asyncIterator]();

      const first = iterator.next();
      ws.emitMessage({ e: 'aggTrade', T: 1, p: '1', q: '1', a: 1, m: false });
      const firstValue = (await first).value as Trade & { seq?: number };
      expect(firstValue.seq).toBe(1);

      const second = iterator.next();
      jest.setSystemTime(10);
      ws.emitMessage({ e: 'aggTrade', T: 2, p: '2', q: '1', a: 2, m: false });
      jest.setSystemTime(20);
      ws.emitMessage({ e: 'aggTrade', T: 3, p: '3', q: '1', a: 3, m: false });
      await Promise.resolve();
      jest.advanceTimersByTime(100);
      const secondValue = (await second).value as Trade & { seq?: number };
      expect(secondValue.seq).toBe(3);

      await iterator.return?.();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('createLiveDepthStream', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  test('normalizes depth payloads', async () => {
    const stream = createLiveDepthStream({
      symbol: 'BTCUSDT' as SymbolId,
      WebSocketCtor: MockWebSocket as unknown as WebSocketConstructor,
      retry: { maxAttempts: 1 },
    });
    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    const iterator = stream[Symbol.asyncIterator]();
    const next = iterator.next();
    ws.emitMessage({
      e: 'depthUpdate',
      E: 1_700_000_000_500,
      u: 100,
      b: [['100.12', '0.5']],
      a: [['100.13', '1.0']],
    });
    const { value } = await next;
    expect(value.bids[0]?.price).toBe(10012000n);
    expect(value.bids[0]?.qty).toBe(500000n);
    expect(value.asks[0]?.price).toBe(10013000n);
    expect(value.asks[0]?.qty).toBe(1_000_000n);
    expect(value.ts).toBe(1_700_000_000_500);
    expect((value as DepthDiff & { seq?: number }).seq).toBe(100);
    await iterator.return?.();
  });
});
