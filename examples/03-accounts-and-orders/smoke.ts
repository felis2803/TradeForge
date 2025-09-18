import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

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

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }

  if (!stdout.includes('ACC_ORDERS_OK')) {
    const stdoutSnippet = stdout.slice(0, 500);
    const stderrSnippet = stderr.slice(0, 500);
    console.error(
      '[examples/03-accounts-and-orders] smoke stdout snippet:',
      stdoutSnippet.length > 0 ? stdoutSnippet : '<empty>',
    );
    console.error(
      '[examples/03-accounts-and-orders] smoke stderr snippet:',
      stderrSnippet.length > 0 ? stderrSnippet : '<empty>',
    );
    throw new Error('marker ACC_ORDERS_OK not found in stdout');
  }
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
