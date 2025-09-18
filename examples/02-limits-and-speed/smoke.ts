import { spawnSync } from 'node:child_process';
import process from 'node:process';

function ensureMarker(output: string): void {
  if (!output.includes('LIMITS_SPEED_OK')) {
    throw new Error('marker LIMITS_SPEED_OK not found in stdout');
  }
}

function main(): void {
  const result = spawnSync(
    'node',
    ['dist-examples/02-limits-and-speed/run.js'],
    {
      env: { ...process.env },
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
  console.log('EX02_LIMITS_SPEED_SMOKE_OK');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[examples/02-limits-and-speed] smoke failed:', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
