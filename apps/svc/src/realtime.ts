import type { FastifyBaseLogger } from 'fastify';
import { createRealtimeEngine, RealtimeOrderBook } from '@tradeforge/sim';
import type {
  DepthDiff as EngineDepthDiff,
  Trade as EngineTrade,
} from '@tradeforge/sim';
import type {
  DepthDiff as CoreDepthDiff,
  SymbolId,
  Trade as CoreTrade,
} from '@tradeforge/core';

import {
  recordStreamTrade,
  setFeedHealthy,
  setStatus,
  updateDepthFromFeed,
  getFeedHealth,
} from './state.js';
import {
  broadcastDepthUpdate,
  broadcastFeedHealth,
  broadcastTradeUpdate,
} from './wsHandlers.js';
import type { RunConfig } from './types.js';
import type { ServiceContext } from './server.js';

interface StreamSource<T> {
  stream: AsyncIterable<T>;
  close?: () => Promise<void> | void;
}

type StreamDescriptor<T> = AsyncIterable<T> | StreamSource<T>;

function normalizeStream<T>(input: StreamDescriptor<T>): StreamSource<T> {
  if (
    typeof (input as StreamSource<T>).stream === 'object' &&
    (input as StreamSource<T>).stream &&
    typeof (input as StreamSource<T>).stream[Symbol.asyncIterator] ===
      'function'
  ) {
    return input as StreamSource<T>;
  }
  return { stream: input as AsyncIterable<T> };
}

export interface RealtimeFeedDescriptor {
  symbol: string;
  depth: StreamDescriptor<CoreDepthDiff>;
  trades: StreamDescriptor<CoreTrade>;
}

export type RealtimeFeedFactory = (
  config: RunConfig,
) => Promise<RealtimeFeedDescriptor[]>;

function createEmptyStream<T>(): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      return;
    },
  };
}

const defaultFactory: RealtimeFeedFactory = async (config) => {
  return config.instruments.map((instrument) => ({
    symbol: instrument.symbol,
    depth: createEmptyStream<CoreDepthDiff>(),
    trades: createEmptyStream<CoreTrade>(),
  }));
};

let feedFactory: RealtimeFeedFactory = defaultFactory;

export function setRealtimeFeedFactory(
  factory: RealtimeFeedFactory | null,
): void {
  feedFactory = factory ?? defaultFactory;
}

interface WorkerHandle {
  close(): Promise<void>;
}

function formatLevels(
  levels: Array<{ price: bigint; qty: bigint }>,
): Array<[string, string]> {
  return levels.map((level) => [level.price.toString(), level.qty.toString()]);
}

function normalizeSide(side?: string): 'buy' | 'sell' | undefined {
  if (!side) {
    return undefined;
  }
  const lowered = side.toLowerCase();
  if (lowered === 'buy' || lowered === 'sell') {
    return lowered;
  }
  return undefined;
}

function toEngineDepth(diff: CoreDepthDiff): EngineDepthDiff {
  const seq = (diff as CoreDepthDiff & { seq?: number }).seq ?? 0;
  return {
    ts: Number(diff.ts),
    seq,
    bids: diff.bids.map((level) => [
      level.price as unknown as bigint,
      level.qty as unknown as bigint,
    ]),
    asks: diff.asks.map((level) => [
      level.price as unknown as bigint,
      level.qty as unknown as bigint,
    ]),
  };
}

function toEngineTrade(trade: CoreTrade): EngineTrade {
  const sideSource = trade.side ?? trade.aggressor;
  const side = sideSource === 'SELL' ? 'SELL' : 'BUY';
  return {
    ts: Number(trade.ts),
    price: trade.price as unknown as bigint,
    qty: trade.qty as unknown as bigint,
    side,
  };
}

export interface RealtimeRunSchedulerOptions {
  config: RunConfig;
  services: ServiceContext;
  logger: FastifyBaseLogger;
  healthCheckIntervalMs?: number;
}

export class RealtimeRunScheduler {
  private readonly config: RunConfig;
  private readonly services: ServiceContext;
  private readonly logger: FastifyBaseLogger;
  private readonly healthTimeoutMs: number;
  private workers = new Map<string, WorkerHandle>();
  private started = false;
  private healthTimer?: NodeJS.Timeout;

  constructor(options: RealtimeRunSchedulerOptions) {
    this.config = options.config;
    this.services = options.services;
    this.logger = options.logger.child({ scope: 'realtime-scheduler' });
    const configuredTimeout = Math.max(
      2000,
      Math.floor((this.config.heartbeatTimeoutSec ?? 6) * 1000),
    );
    this.healthTimeoutMs = Math.max(
      configuredTimeout,
      options.healthCheckIntervalMs ?? configuredTimeout,
    );
  }

  async start(): Promise<void> {
    if (this.started) {
      this.logger.warn('realtime scheduler already running');
      return;
    }
    this.started = true;
    setFeedHealthy(false);
    broadcastFeedHealth(getFeedHealth());
    const descriptors = await feedFactory(this.config);
    for (const descriptor of descriptors) {
      await this.startWorker(descriptor).catch((error) => {
        this.logger.error(
          { symbol: descriptor.symbol, error },
          'failed to start realtime worker',
        );
      });
    }
    const interval = Math.max(1000, Math.floor(this.healthTimeoutMs / 2));
    this.healthTimer = setInterval(() => {
      this.pollHealth();
    }, interval) as NodeJS.Timeout;
    setStatus('running');
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }
    this.started = false;
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
    const workers = Array.from(this.workers.values());
    this.workers.clear();
    await Promise.allSettled(workers.map((worker) => worker.close()));
    setFeedHealthy(false);
    broadcastFeedHealth(getFeedHealth());
  }

  private async startWorker(descriptor: RealtimeFeedDescriptor): Promise<void> {
    const depthSource = normalizeStream(descriptor.depth);
    const tradesSource = normalizeStream(descriptor.trades);
    const bookMirror = new RealtimeOrderBook();
    const { logger } = this;
    const handleStreamClosed = this.handleStreamClosed.bind(this);
    const handleStreamFailure = this.handleStreamFailure.bind(this);
    const markFeedActive = this.markFeedActive.bind(this);

    const depthIterator = depthSource.stream[Symbol.asyncIterator]();
    const tradesIterator = tradesSource.stream[Symbol.asyncIterator]();
    let cancelled = false;
    let depthIteratorClosed = false;
    let tradesIteratorClosed = false;

    const closeDepthIterator = async () => {
      if (depthIteratorClosed) {
        return;
      }
      depthIteratorClosed = true;
      if (typeof depthIterator.return === 'function') {
        try {
          await depthIterator.return();
        } catch (error) {
          logger.debug(
            { symbol: descriptor.symbol, error },
            'depth iterator return failed',
          );
        }
      }
    };

    const closeTradesIterator = async () => {
      if (tradesIteratorClosed) {
        return;
      }
      tradesIteratorClosed = true;
      if (typeof tradesIterator.return === 'function') {
        try {
          await tradesIterator.return();
        } catch (error) {
          logger.debug(
            { symbol: descriptor.symbol, error },
            'trade iterator return failed',
          );
        }
      }
    };

    const depthStream: AsyncIterable<EngineDepthDiff> = {
      async *[Symbol.asyncIterator]() {
        try {
          while (!cancelled) {
            const { value, done } = await depthIterator.next();
            if (done) {
              if (!cancelled) {
                handleStreamClosed(descriptor.symbol, 'depth');
              }
              break;
            }
            try {
              const diff = value as CoreDepthDiff;
              const engineDiff = toEngineDepth(diff);
              bookMirror.applyDiff(engineDiff);
              const snapshot = bookMirror.getSnapshot(20);
              const ts =
                snapshot.ts !== undefined ? Number(snapshot.ts) : Date.now();
              updateDepthFromFeed(descriptor.symbol, {
                bids: formatLevels(snapshot.bids),
                asks: formatLevels(snapshot.asks),
                ts,
                seq: snapshot.seq,
              });
              markFeedActive(ts);
              broadcastDepthUpdate(descriptor.symbol);
              yield engineDiff;
            } catch (error) {
              logger.error(
                { symbol: descriptor.symbol, error },
                'failed to process depth diff',
              );
            }
          }
        } catch (error) {
          if (!cancelled) {
            handleStreamFailure(descriptor.symbol, 'depth', error);
            throw error;
          }
        } finally {
          await closeDepthIterator();
        }
      },
    };

    const tradeStream: AsyncIterable<EngineTrade> = {
      async *[Symbol.asyncIterator]() {
        try {
          while (!cancelled) {
            const { value, done } = await tradesIterator.next();
            if (done) {
              if (!cancelled) {
                handleStreamClosed(descriptor.symbol, 'trade');
              }
              break;
            }
            try {
              const trade = value as CoreTrade;
              const engineTrade = toEngineTrade(trade);
              recordStreamTrade(descriptor.symbol, {
                priceInt: engineTrade.price.toString(),
                qtyInt: engineTrade.qty.toString(),
                side: normalizeSide(trade.side ?? trade.aggressor),
                ts: engineTrade.ts,
              });
              markFeedActive(engineTrade.ts);
              broadcastTradeUpdate(descriptor.symbol);
              yield engineTrade;
            } catch (error) {
              logger.error(
                { symbol: descriptor.symbol, error },
                'failed to process trade event',
              );
            }
          }
        } catch (error) {
          if (!cancelled) {
            handleStreamFailure(descriptor.symbol, 'trade', error);
            throw error;
          }
        } finally {
          await closeTradesIterator();
        }
      },
    };

    const adapter = createRealtimeEngine({
      symbol: descriptor.symbol as SymbolId,
      state: this.services.state,
      accounts: this.services.accounts,
      orders: this.services.orders,
      streams: {
        depth: depthStream,
        trades: tradeStream,
      },
    });

    const handle: WorkerHandle = {
      close: async () => {
        cancelled = true;
        const closeTasks: Array<Promise<unknown>> = [
          adapter.close(),
          closeDepthIterator(),
          closeTradesIterator(),
        ];
        if (depthSource.close) {
          closeTasks.push(
            Promise.resolve().then(
              () => depthSource.close && depthSource.close(),
            ),
          );
        }
        if (tradesSource.close) {
          closeTasks.push(
            Promise.resolve().then(
              () => tradesSource.close && tradesSource.close(),
            ),
          );
        }
        const closePromise = Promise.allSettled(closeTasks);
        const timeoutMs = Math.min(2000, this.healthTimeoutMs);
        await Promise.race([
          closePromise,
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, timeoutMs);
            if (typeof timer.unref === 'function') {
              timer.unref();
            }
          }),
        ]);
      },
    };

    this.workers.set(descriptor.symbol, handle);
  }

  private markFeedActive(_ts: number): void {
    void _ts;
    const prev = getFeedHealth();
    if (!prev.healthy) {
      setFeedHealthy(true);
      const next = getFeedHealth();
      broadcastFeedHealth(next);
    } else {
      setFeedHealthy(true);
    }
  }

  private handleStreamFailure(
    symbol: string,
    stream: 'depth' | 'trade',
    error: unknown,
  ): void {
    this.logger.error({ symbol, stream, error }, 'realtime stream failure');
    const prev = getFeedHealth();
    if (prev.healthy) {
      setFeedHealthy(false);
      broadcastFeedHealth(getFeedHealth());
    }
  }

  private handleStreamClosed(symbol: string, stream: 'depth' | 'trade'): void {
    this.logger.warn({ symbol, stream }, 'realtime stream closed');
    const prev = getFeedHealth();
    if (prev.healthy) {
      setFeedHealthy(false);
      broadcastFeedHealth(getFeedHealth());
    }
  }

  private pollHealth(): void {
    const status = getFeedHealth();
    if (!status.lastUpdateTs) {
      if (status.healthy) {
        setFeedHealthy(false);
        broadcastFeedHealth(getFeedHealth());
      }
      return;
    }
    const stale = Date.now() - status.lastUpdateTs > this.healthTimeoutMs;
    if (stale && status.healthy) {
      setFeedHealthy(false);
      broadcastFeedHealth(getFeedHealth());
    }
  }
}
