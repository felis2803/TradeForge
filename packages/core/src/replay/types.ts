import type { MergedEvent } from '../merge/timeline.js';
import type { TimestampMs } from '../types/index.js';

export interface SimClock {
  now(): number;
  desc(): string;
  tickUntil(targetWallMs: number): Promise<void>;
}

export interface ReplayLimits {
  maxEvents?: number;
  maxSimTimeMs?: number;
  maxWallTimeMs?: number;
}

export interface ReplayStats {
  eventsOut: number;
  simStartTs?: TimestampMs;
  simLastTs?: TimestampMs;
  wallStartMs: number;
  wallLastMs: number;
}

export interface RunReplayBasicOptions {
  timeline: AsyncIterable<MergedEvent>;
  clock: SimClock;
  limits?: ReplayLimits;
  onEvent?: (event: MergedEvent, stats: ReplayStats) => void;
}

export type {
  CoreReaderCursor,
  EngineSnapshot,
  SerializedExchangeState,
  CheckpointV1,
} from './checkpoint.js';
