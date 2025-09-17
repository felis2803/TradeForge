import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

function ensureMarker(output: string): void {
  if (!output.includes('ACC_ORDERS_OK')) {
    throw new Error('marker ACC_ORDERS_OK not found in stdout');
  }
}

function main(): void {
  const trades = resolve('examples', '_smoke', 'mini-trades.jsonl');
  const depth = resolve('examples', '_smoke', 'mini-depth.jsonl');

  const result = spawnSync(
    'node',
    ['dist-examples/03-accounts-and-orders/run.js'],
    {
      env: {
        ...process.env,
        TF_TRADES_FILES: process.env['TF_TRADES_FILES'] ?? trades,
        TF_DEPTH_FILES: process.env['TF_DEPTH_FILES'] ?? depth,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : '';
    throw new Error(`example exited with code ${result.status}${stderr}`);
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  ensureMarker(result.stdout ?? '');
  console.log('EX03_ACC_ORDERS_SMOKE_OK');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[examples/03-accounts-and-orders] smoke failed:', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
