import type { MergedEvent } from '../merge/timeline.js';
import type { TimestampMs } from '../types/index.js';
import type { CheckpointV1 } from './checkpoint.js';

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

export interface ReplayProgress extends ReplayStats {}

export interface ReplayController {
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  waitUntilResumed(): Promise<void>;
}

export interface AutoCheckpointOpts {
  savePath?: string;
  cpIntervalEvents?: number;
  cpIntervalWallMs?: number;
  buildCheckpoint?: () => Promise<CheckpointV1>;
}

export interface RunReplayBasicOptions {
  timeline: AsyncIterable<MergedEvent>;
  clock: SimClock;
  limits?: ReplayLimits;
  onEvent?: (event: MergedEvent, stats: ReplayStats) => void;
}

export interface RunReplayOptions {
  timeline: AsyncIterable<MergedEvent>;
  clock: SimClock;
  limits?: ReplayLimits;
  controller?: ReplayController;
  onEvent?: (event: MergedEvent, stats: ReplayProgress) => Promise<void> | void;
  onProgress?: (progress: ReplayProgress) => void;
  autoCp?: AutoCheckpointOpts;
}

export type {
  CoreReaderCursor,
  EngineSnapshot,
  SerializedExchangeState,
  CheckpointV1,
} from './checkpoint.js';
