#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import type { CheckpointV1, ReplayProgress } from '@tradeforge/core';
import { formatCheckpointSummary } from '../checkpoint.js';
import { formatProgress } from '../logging.js';

function printHelp(): void {
  console.log(`Usage: print-summary <file>

Reads a JSON file and prints a short summary. Supports replay progress
objects and checkpoint v1 payloads.
`);
}

function isCheckpoint(value: unknown): value is CheckpointV1 {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as { version?: unknown }).version === 1 &&
      (value as { cursors?: unknown }).cursors,
  );
}

function isReplayProgress(value: unknown): value is ReplayProgress {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as ReplayProgress;
  return (
    typeof candidate.eventsOut === 'number' &&
    typeof candidate.wallStartMs === 'number' &&
    typeof candidate.wallLastMs === 'number'
  );
}

async function main(): Promise<void> {
  const [arg] = process.argv.slice(2);
  if (!arg || arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(arg ? 0 : 1);
  }
  try {
    const raw = await readFile(arg, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (isCheckpoint(parsed)) {
      console.log(formatCheckpointSummary(parsed));
      return;
    }
    if (isReplayProgress(parsed)) {
      console.log(formatProgress(parsed));
      return;
    }
    console.log(JSON.stringify(parsed, null, 2));
  } catch (err) {
    if (err instanceof Error) {
      console.error(`print-summary error: ${err.message}`);
    } else {
      console.error(`print-summary error: ${String(err)}`);
    }
    process.exit(1);
  }
}

await main();
