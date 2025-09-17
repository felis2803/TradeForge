import type { ReplayProgress } from '@tradeforge/core';

export interface LoggerOptions {
  prefix?: string;
  quiet?: boolean;
  verbose?: boolean;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  progress(progress: ReplayProgress, context?: string): void;
  autoCheckpoint(savePath: string, progress: ReplayProgress): void;
}

function parseFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return undefined;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return 'n/a';
  const value = Math.max(0, ms);
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }
  if (value < 60_000) {
    const seconds = value / 1000;
    return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  }
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
}

function formatSimRange(progress: ReplayProgress): string | undefined {
  if (progress.simStartTs === undefined || progress.simLastTs === undefined) {
    return undefined;
  }
  const start = Number(progress.simStartTs);
  const end = Number(progress.simLastTs);
  const elapsed = Math.max(0, end - start);
  return `${start}..${end} (+${formatDuration(elapsed)})`;
}

export function formatProgress(progress: ReplayProgress): string {
  const parts = [`events=${progress.eventsOut}`];
  const simRange = formatSimRange(progress);
  if (simRange) {
    parts.push(`sim=${simRange}`);
  }
  const wallElapsed = progress.wallLastMs - progress.wallStartMs;
  parts.push(`wall=${formatDuration(wallElapsed)}`);
  return parts.join(' ');
}

function emit(
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
): void {
  if (level === 'warn') {
    console.warn(message);
    return;
  }
  if (level === 'error') {
    console.error(message);
    return;
  }
  if (level === 'debug') {
    console.debug(message);
    return;
  }
  console.log(message);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const envQuiet = parseFlag(process.env['TF_QUIET']);
  const envVerbose = parseFlag(process.env['TF_VERBOSE']);
  const quiet = options.quiet ?? envQuiet ?? false;
  const verbose = options.verbose ?? envVerbose ?? false;
  const prefix = options.prefix ?? '[examples]';

  function wrap(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
  ): void {
    const formatted = prefix ? `${prefix} ${message}` : message;
    emit(level, formatted);
  }

  return {
    info(message: string) {
      if (quiet) return;
      wrap('info', message);
    },
    warn(message: string) {
      wrap('warn', message);
    },
    error(message: string) {
      wrap('error', message);
    },
    debug(message: string) {
      if (!verbose || quiet) return;
      wrap('debug', message);
    },
    progress(progress: ReplayProgress, context?: string) {
      if (quiet) return;
      const prefixMsg = context ? `${context} ` : '';
      wrap('info', `${prefixMsg}${formatProgress(progress)}`);
    },
    autoCheckpoint(savePath: string, progress: ReplayProgress) {
      if (quiet) return;
      const location = savePath ? ` -> ${savePath}` : '';
      wrap('info', `checkpoint saved${location}: ${formatProgress(progress)}`);
    },
  };
}
