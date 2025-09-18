import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

function ensureField(payload: Record<string, unknown>, field: string): void {
  if (!(field in payload)) {
    throw new Error(`payload missing field ${field}`);
  }
}

function main(): void {
  const trades = resolve('examples', '_smoke', 'mini-trades.jsonl');
  const depth = resolve('examples', '_smoke', 'mini-depth.jsonl');

  const result = spawnSync('node', ['dist-examples/09-bot-skeleton/run.js'], {
    env: {
      ...process.env,
      TF_TRADES_FILES: process.env['TF_TRADES_FILES'] ?? trades,
      TF_DEPTH_FILES: process.env['TF_DEPTH_FILES'] ?? depth,
      TF_CLOCK: process.env['TF_CLOCK'] ?? 'logical',
      TF_MAX_EVENTS: process.env['TF_MAX_EVENTS'] ?? '1000',
      TF_QTY: process.env['TF_QTY'] ?? '0.001',
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  const printSnippet = (): void => {
    const stdoutSnippet = stdout.slice(0, 600) || '<empty>';
    const stderrSnippet = stderr.slice(0, 600) || '<empty>';
    console.error('[examples/09-bot-skeleton] stdout snippet:', stdoutSnippet);
    console.error('[examples/09-bot-skeleton] stderr snippet:', stderrSnippet);
  };

  if (typeof result.status === 'number' && result.status !== 0) {
    printSnippet();
    throw new Error(`example exited with code ${result.status}`);
  }

  const match = stdout.match(/BOT_OK\s+({.+})/);
  if (!match) {
    printSnippet();
    throw new Error('BOT_OK marker not found in stdout');
  }

  const payloadSource = match[1];
  if (!payloadSource) {
    printSnippet();
    throw new Error('BOT_OK payload missing JSON body');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadSource);
  } catch (err) {
    printSnippet();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse BOT_OK payload: ${message}`);
  }

  if (!payload || typeof payload !== 'object') {
    printSnippet();
    throw new Error('BOT_OK payload must be an object');
  }

  const objectPayload = payload as Record<string, unknown>;
  ensureField(objectPayload, 'fills');
  ensureField(objectPayload, 'fees');
  ensureField(objectPayload, 'ordersPlaced');
  ensureField(objectPayload, 'cancels');
  ensureField(objectPayload, 'finalBalances');
  ensureField(objectPayload, 'pnl');

  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }

  console.log('EX09_BOT_SMOKE_OK');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[examples/09-bot-skeleton] smoke failed:', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
