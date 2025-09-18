import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

function main(): void {
  const trades = resolve('examples', '_smoke', 'mini-trades.jsonl');
  const depth = resolve('examples', '_smoke', 'mini-depth.jsonl');

  const result = spawnSync('node', ['dist-examples/04-stop-orders/run.js'], {
    env: {
      ...process.env,
      TF_TRADES_FILES: process.env['TF_TRADES_FILES'] ?? trades,
      TF_DEPTH_FILES: process.env['TF_DEPTH_FILES'] ?? depth,
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
    const stdoutSnippet = stdout.slice(0, 500);
    const stderrSnippet = stderr.slice(0, 500);
    console.error(
      '[examples/04-stop-orders] smoke stdout snippet:',
      stdoutSnippet.length > 0 ? stdoutSnippet : '<empty>',
    );
    console.error(
      '[examples/04-stop-orders] smoke stderr snippet:',
      stderrSnippet.length > 0 ? stderrSnippet : '<empty>',
    );
  };

  if (typeof result.status === 'number' && result.status !== 0) {
    printSnippet();
    throw new Error(`example exited with code ${result.status}`);
  }

  if (!stdout.includes('STOP_ORDERS_OK')) {
    printSnippet();
    throw new Error('marker STOP_ORDERS_OK not found in stdout');
  }

  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }

  console.log('EX04_STOP_ORDERS_SMOKE_OK');
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[examples/04-stop-orders] smoke failed:', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
