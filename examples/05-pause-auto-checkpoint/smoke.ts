import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

function ensureMarker(output: string): void {
  if (!output.includes('PAUSE_CP_OK')) {
    throw new Error('marker PAUSE_CP_OK not found in stdout');
  }
}

function removeIfExists(path: string): void {
  if (!path) {
    return;
  }
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

function main(): void {
  const trades = resolve('examples', '_smoke', 'mini-trades.jsonl');
  const depth = resolve('examples', '_smoke', 'mini-depth.jsonl');
  const cpPath = process.env['TF_CP_PATH']?.trim() || '/tmp/tf.cp.json';

  removeIfExists(cpPath);

  const result = spawnSync(
    'node',
    ['dist-examples/05-pause-auto-checkpoint/run.js'],
    {
      env: {
        ...process.env,
        TF_TRADES_FILES: process.env['TF_TRADES_FILES'] ?? trades,
        TF_DEPTH_FILES: process.env['TF_DEPTH_FILES'] ?? depth,
        TF_CP_PATH: cpPath,
        TF_MAX_EVENTS: process.env['TF_MAX_EVENTS'] ?? '80',
        TF_CP_INTERVAL_EVENTS: process.env['TF_CP_INTERVAL_EVENTS'] ?? '20',
        TF_CP_INTERVAL_WALL_MS: process.env['TF_CP_INTERVAL_WALL_MS'] ?? '500',
        TF_RESUME_DELAY_MS: process.env['TF_RESUME_DELAY_MS'] ?? '600',
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
  if (!existsSync(cpPath)) {
    throw new Error(`checkpoint not found at ${cpPath}`);
  }

  console.log('PAUSE_CP_SMOKE_OK');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[examples/05-pause-auto-checkpoint] smoke failed:', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
