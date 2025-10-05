import WebSocket, {
  type ClientOptions as WebSocketClientOptions,
  type RawData,
} from 'ws';
import type { DepthDiff, SymbolId, Trade } from '@tradeforge/core';
import { normalizeTrade, normalizeDepth } from '@tradeforge/io-binance';
import { AsyncQueue } from './asyncQueue.js';

export interface Logger {
  debug?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string, err?: unknown) => void;
}

export interface RetryOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  multiplier?: number;
  maxAttempts?: number;
}

export type RateLimitMode = 'throttle' | 'debounce';

export interface RateLimitOptions {
  mode: RateLimitMode;
  intervalMs: number;
}

interface LiveStreamOptionsBase {
  symbol: SymbolId;
  url?: string;
  retry?: RetryOptions;
  rateLimit?: RateLimitOptions;
  signal?: AbortSignal;
  logger?: Logger;
  wsOptions?: WebSocketClientOptions;
  WebSocketCtor?: WebSocketConstructor;
}

type TradeStreamOptions = LiveStreamOptionsBase;
type DepthStreamOptions = LiveStreamOptionsBase & {
  depthWindow?: '100ms' | '1000ms';
};

type WebSocketLike = {
  on(event: 'open', listener: () => void): WebSocketLike;
  on(event: 'message', listener: (data: RawData) => void): WebSocketLike;
  on(
    event: 'close',
    listener: (code: number, reason: Buffer) => void,
  ): WebSocketLike;
  on(event: 'error', listener: (err: Error) => void): WebSocketLike;
  send(data: string): void;
  close(): void;
  readyState: number;
};

export type WebSocketConstructor = new (
  url: string,
  options?: WebSocketClientOptions,
) => WebSocketLike;

interface BinanceAckMessage {
  result?: unknown;
  id?: number;
}

interface BinanceAggTradeMessage {
  e: 'aggTrade';
  T: number;
  p: string;
  q: string;
  a?: number;
  m: boolean;
  E?: number;
  [key: string]: unknown;
}

interface BinanceDepthUpdateMessage {
  e: 'depthUpdate';
  E: number;
  u?: number;
  U?: number;
  b?: Array<[string, string]>;
  a?: Array<[string, string]>;
  [key: string]: unknown;
}

interface BackoffState {
  attempt: number;
  timeout?: NodeJS.Timeout;
}

const DEFAULT_URL = 'wss://stream.binance.com:9443/ws';

const DEFAULT_RETRY: Required<RetryOptions> = {
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  multiplier: 2,
  maxAttempts: Number.POSITIVE_INFINITY,
};

function applyRateLimit<T>(
  queue: AsyncQueue<T>,
  options?: RateLimitOptions,
): (value: T) => void {
  if (!options) {
    return (value: T) => queue.push(value);
  }
  const { intervalMs, mode } = options;
  if (mode === 'throttle') {
    let lastEmit: number | undefined;
    let trailingTimer: NodeJS.Timeout | undefined;
    let trailingValue: T | undefined;
    return (value: T) => {
      const now = Date.now();
      const diff = lastEmit === undefined ? intervalMs : now - lastEmit;
      if (lastEmit === undefined || diff >= intervalMs) {
        lastEmit = now;
        queue.push(value);
        if (trailingTimer) {
          clearTimeout(trailingTimer);
          trailingTimer = undefined;
          trailingValue = undefined;
        }
        return;
      }
      trailingValue = value;
      if (trailingTimer) {
        return;
      }
      const delay = Math.max(0, intervalMs - diff);
      trailingTimer = setTimeout(() => {
        trailingTimer = undefined;
        lastEmit = Date.now();
        if (trailingValue !== undefined) {
          queue.push(trailingValue);
          trailingValue = undefined;
        }
      }, delay);
    };
  }
  let timer: NodeJS.Timeout | undefined;
  return (value: T) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      queue.push(value);
      timer = undefined;
    }, intervalMs);
  };
}

function computeBackoffDelay(
  state: BackoffState,
  options: Required<RetryOptions>,
): number {
  const attempt = state.attempt;
  if (attempt <= 1) {
    return options.initialDelayMs;
  }
  const delay = Math.min(
    options.initialDelayMs * Math.pow(options.multiplier, attempt - 1),
    options.maxDelayMs,
  );
  return delay;
}

function withAbort(signal: AbortSignal | undefined, fn: () => void): void {
  if (!signal) return;
  if (signal.aborted) {
    fn();
    return;
  }
  const handler = () => {
    signal.removeEventListener('abort', handler);
    fn();
  };
  signal.addEventListener('abort', handler);
}

function isAckMessage(value: unknown): value is BinanceAckMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybeAck = value as Record<string, unknown>;
  return 'result' in maybeAck && 'id' in maybeAck;
}

function createBaseStream<T, TRaw>(
  setup: (ctx: {
    queue: AsyncQueue<T>;
    symbol: SymbolId;
    emit: (value: T) => void;
    options: LiveStreamOptionsBase;
    logger?: Logger;
  }) => {
    params: string[];
    handleMessage: (raw: TRaw) => void;
  },
  options: LiveStreamOptionsBase,
): AsyncIterable<T> {
  const queue = new AsyncQueue<T>();
  const emit = applyRateLimit(queue, options.rateLimit);
  const logger = options.logger;
  const { params, handleMessage } = setup({
    queue,
    symbol: options.symbol,
    emit,
    options,
    logger,
  });
  const retry = {
    ...DEFAULT_RETRY,
    ...options.retry,
  } as Required<RetryOptions>;
  const WebSocketImpl =
    options.WebSocketCtor ?? (WebSocket as unknown as WebSocketConstructor);
  let ws: WebSocketLike | undefined;
  const backoff: BackoffState = { attempt: 0 };
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (backoff.timeout) {
      clearTimeout(backoff.timeout);
      backoff.timeout = undefined;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.close();
      } catch (err) {
        logger?.warn?.(`Failed to close websocket: ${(err as Error).message}`);
      }
    } else if (ws) {
      try {
        ws.close();
      } catch (err) {
        // ignore
      }
    }
    queue.close();
  };

  withAbort(options.signal, cleanup);

  const subscribe = () => {
    if (!ws) return;
    try {
      ws.send(
        JSON.stringify({
          method: 'SUBSCRIBE',
          params,
          id: Date.now(),
        }),
      );
    } catch (err) {
      logger?.error?.('Failed to send subscribe', err);
    }
  };

  const scheduleReconnect = () => {
    if (closed) return;
    if (backoff.timeout) {
      return;
    }
    backoff.attempt += 1;
    if (backoff.attempt > retry.maxAttempts) {
      logger?.error?.('Max reconnect attempts reached');
      cleanup();
      return;
    }
    const delay = computeBackoffDelay(backoff, retry);
    logger?.warn?.(`Reconnecting in ${delay}ms (attempt ${backoff.attempt})`);
    backoff.timeout = setTimeout(() => {
      backoff.timeout = undefined;
      connect();
    }, delay);
  };

  const handleClose = (code: number, reason: Buffer) => {
    logger?.warn?.(`WebSocket closed (${code}): ${reason.toString()}`);
    ws = undefined;
    scheduleReconnect();
  };

  const handleError = (err: Error) => {
    logger?.error?.('WebSocket error', err);
  };

  const handleOpen = () => {
    logger?.debug?.('WebSocket connected');
    backoff.attempt = 0;
    subscribe();
  };

  const handleRawMessage = (data: RawData) => {
    try {
      const text = typeof data === 'string' ? data : data.toString();
      const parsed = JSON.parse(text) as unknown;
      if (isAckMessage(parsed)) {
        return;
      }
      handleMessage(parsed as TRaw);
    } catch (err) {
      logger?.error?.('Failed to process message', err);
    }
  };

  const connect = () => {
    if (closed) return;
    ws = new WebSocketImpl(options.url ?? DEFAULT_URL, options.wsOptions);
    ws.on('open', handleOpen);
    ws.on('message', handleRawMessage);
    ws.on('close', handleClose);
    ws.on('error', handleError);
  };

  connect();

  return {
    [Symbol.asyncIterator]() {
      const iterator = queue[Symbol.asyncIterator]();
      return {
        next: () => iterator.next(),
        return: async () => {
          cleanup();
          return { value: undefined as never, done: true };
        },
      };
    },
  };
}

export function createLiveTradeStream(
  options: TradeStreamOptions,
): AsyncIterable<Trade> {
  return createBaseStream<Trade, BinanceAggTradeMessage>(
    ({ symbol, emit }) => ({
      params: [`${String(symbol).toLowerCase()}@aggTrade`],
      handleMessage: (raw) => {
        if (!raw || raw.e !== 'aggTrade') {
          return;
        }
        const trade = normalizeTrade(
          {
            ...raw,
            time: raw.T,
            price: raw.p,
            qty: raw.q,
            side: raw.m ? 'SELL' : 'BUY',
            id: raw.a,
          },
          {
            symbol,
            mapping: {
              time: 'time',
              price: 'price',
              qty: 'qty',
              side: 'side',
              id: 'id',
            },
          },
        );
        (trade as Trade & { seq?: number }).seq = Number(
          raw.a ?? raw.T ?? raw.E,
        );
        emit(trade);
      },
    }),
    options,
  );
}

export function createLiveDepthStream(
  options: DepthStreamOptions,
): AsyncIterable<DepthDiff> {
  const depthWindow = options.depthWindow ?? '100ms';
  const streamName = `${String(options.symbol).toLowerCase()}@depth@${depthWindow}`;
  return createBaseStream<DepthDiff, BinanceDepthUpdateMessage>(
    ({ symbol, emit }) => ({
      params: [streamName],
      handleMessage: (raw) => {
        if (!raw || raw.e !== 'depthUpdate') {
          return;
        }
        const diff = normalizeDepth(
          {
            ...raw,
          },
          { symbol, mapping: { time: 'E', bids: 'b', asks: 'a' } },
        );
        (diff as DepthDiff & { seq?: number }).seq = Number(raw.u ?? raw.U);
        emit(diff);
      },
    }),
    options,
  );
}
