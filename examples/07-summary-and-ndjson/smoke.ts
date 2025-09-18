import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import process from 'node:process';

const OUTPUT_FILE = '/tmp/tf.reports.ndjson';

async function ensureNdjson(): Promise<number> {
  await access(OUTPUT_FILE, constants.F_OK);
  const raw = await readFile(OUTPUT_FILE, 'utf8');
  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
  if (rows <= 0) {
    throw new Error('NDJSON file is empty');
  }
  return rows;
}

async function main(): Promise<void> {
  const result = spawnSync(
    'node',
    ['dist-examples/07-summary-and-ndjson/run.js'],
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

  const rows = await ensureNdjson();
  console.log('EX07_NDJSON_ROWS', rows);
  console.log('EX07_SUMMARY_SMOKE_OK');
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[examples/07-summary-and-ndjson] smoke failed:', message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
