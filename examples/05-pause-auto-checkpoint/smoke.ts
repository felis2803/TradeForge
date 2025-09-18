import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import process from 'node:process';

const CHECKPOINT_PATH = '/tmp/tf.cp.json';

function ensureMarker(output: string): void {
  if (!output.includes('PAUSE_CP_OK')) {
    throw new Error('marker PAUSE_CP_OK not found in stdout');
  }
}

function ensureCheckpoint(): void {
  if (!existsSync(CHECKPOINT_PATH)) {
    throw new Error(`checkpoint file not created at ${CHECKPOINT_PATH}`);
  }
}

function main(): void {
  if (existsSync(CHECKPOINT_PATH)) {
    rmSync(CHECKPOINT_PATH);
  }

  const result = spawnSync(
    'node',
    ['dist-examples/05-pause-auto-checkpoint/run.js'],
    {
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
  ensureCheckpoint();

  console.log('EX05_PAUSE_AUTO_CP_SMOKE_OK');
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
